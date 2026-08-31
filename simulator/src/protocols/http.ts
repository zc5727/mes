import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { adaptHttpEvent } from "./event-adapter";
import type { SimulationMessage } from "../types";

const DEFAULT_PATH = "/events";
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_BODY_BYTES = 1024 * 1024;

export interface HttpEndpointConfig {
  protocol: "http";
  host: string;
  port: number;
  path: string;
  timeoutMs: number;
  maxBodyBytes: number;
  authentication: "none" | "bearer";
  bearerToken?: string;
  tls: false;
}

export type HttpEndpointInput = Partial<Omit<HttpEndpointConfig, "tls">> & { tls?: boolean };

export interface HttpTelemetryEndpointOptions extends HttpEndpointInput {
  onTelemetry?: (message: SimulationMessage) => void | Promise<void>;
}

/** Validate the deliberately small local HTTP contract before binding a port. */
export function parseHttpEndpoint(input: HttpEndpointInput): HttpEndpointConfig {
  if (input.protocol !== undefined && input.protocol !== "http") throw new Error("HTTP endpoint protocol must be http");
  if (typeof input.host !== "string" || !input.host.trim()) throw new Error("HTTP endpoint host is required");
  if (input.host.trim() === "0.0.0.0" || input.host.trim() === "::") throw new Error("HTTP endpoint host must not be a wildcard address");
  const port = input.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("HTTP endpoint port must be an integer from 1 to 65535");
  const path = input.path ?? DEFAULT_PATH;
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.includes("//")) throw new Error("HTTP endpoint path must be an absolute path without query parameters");
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error("HTTP endpoint timeoutMs must be from 100 to 30000");
  const maxBodyBytes = input.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > MAX_BODY_BYTES) throw new Error("HTTP endpoint maxBodyBytes must be from 1 to 1048576");
  if (input.tls === true) throw new Error("HTTPS/TLS is not implemented by the synthetic HTTP endpoint");
  const authentication = input.authentication ?? "none";
  if (authentication !== "none" && authentication !== "bearer") throw new Error("HTTP authentication must be none or bearer");
  if (authentication === "bearer" && (typeof input.bearerToken !== "string" || !input.bearerToken)) throw new Error("HTTP bearerToken is required for bearer authentication");
  if (authentication === "none" && input.bearerToken !== undefined) throw new Error("HTTP bearerToken requires bearer authentication");
  return { protocol: "http", host: input.host.trim(), port, path, timeoutMs, maxBodyBytes, authentication, bearerToken: input.bearerToken, tls: false };
}

/**
 * Strict local HTTP ingest endpoint for canonical telemetry events.
 * It never accepts control commands and reports malformed input as an error.
 */
export class HttpTelemetryEndpoint {
  private readonly server: Server;
  private readonly config: HttpEndpointConfig;
  private readonly onTelemetry: (message: SimulationMessage) => void | Promise<void>;
  private startPromise?: Promise<void>;

  public constructor(options: HttpTelemetryEndpointOptions) {
    this.config = parseHttpEndpoint(options);
    this.onTelemetry = options.onTelemetry ?? (() => undefined);
    this.server = createServer((message, response) => void this.handleRequest(message, response));
  }

  public async start(): Promise<void> {
    if (this.server.listening) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = listen(this.server, this.config.port, this.config.host);
    try { await this.startPromise; } finally { this.startPromise = undefined; }
  }

  public async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }

  private async handleRequest(message: IncomingMessage, response: ServerResponse): Promise<void> {
    if (message.url?.split("?")[0] !== this.config.path) {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    if (message.method !== "POST") {
      response.setHeader("allow", "POST");
      sendJson(response, 405, { error: "only POST telemetry events are accepted" });
      return;
    }
    if (!authorized(message, this.config)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }
    if (mediaType(message.headers["content-type"]) !== "application/json") {
      sendJson(response, 415, { error: "content-type must be application/json" });
      return;
    }
    try {
      const body = await readBody(message, this.config.maxBodyBytes, this.config.timeoutMs);
      const event = adaptHttpEvent(body);
      await this.onTelemetry(event);
      sendJson(response, 202, { event: "accepted", topic: event.topic });
    } catch (error: unknown) {
      const status = error instanceof HttpRequestError ? error.statusCode : 422;
      sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export function postHttpTelemetry(
  endpoint: HttpEndpointConfig,
  payload: string | Record<string, unknown>,
): Promise<{ statusCode: number; body: string }> {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const client = request({
      host: endpoint.host,
      port: endpoint.port,
      path: endpoint.path,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...(endpoint.authentication === "bearer" ? { authorization: `Bearer ${endpoint.bearerToken}` } : {}) },
      timeout: endpoint.timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    client.once("timeout", () => client.destroy(new Error("HTTP request timed out")));
    client.once("error", reject);
    client.end(body);
  });
}

class HttpRequestError extends Error {
  public constructor(public readonly statusCode: number, message: string) { super(message); }
}

function authorized(message: IncomingMessage, config: HttpEndpointConfig): boolean {
  if (config.authentication === "none") return !message.headers.authorization;
  return message.headers.authorization === `Bearer ${config.bearerToken}`;
}

function mediaType(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.split(";", 1)[0].trim().toLowerCase();
}

function readBody(message: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declaredLength = message.headers["content-length"];
    if (declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
      reject(new HttpRequestError(413, "HTTP request body is too large or has an invalid content-length"));
      message.resume();
      return;
    }
    let length = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => finish(new HttpRequestError(408, "HTTP request body timed out")), timeoutMs);
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      message.removeAllListeners("data");
      message.removeAllListeners("end");
      error ? reject(error) : resolve(Buffer.concat(chunks).toString("utf8"));
    };
    message.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxBytes) {
        message.resume();
        finish(new HttpRequestError(413, "HTTP request body is too large"));
      }
      else chunks.push(chunk);
    });
    message.once("end", () => finish());
    message.once("error", (error) => finish(error));
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  const encoded = JSON.stringify(body);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(encoded));
  response.end(encoded);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { server.removeListener("listening", onListening); reject(error); };
    const onListening = (): void => { server.removeListener("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
