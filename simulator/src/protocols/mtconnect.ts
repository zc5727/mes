import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { adaptMtConnectTelemetry, type MtConnectTelemetryFrame } from "./event-adapter";
import type { ProtocolTelemetrySource } from "./protocol-bridge";
import type { DeviceStatus, FaultType, SimulationMessage } from "../types";

export interface MtConnectTelemetryValues extends Omit<MtConnectTelemetryFrame["values"], "activeFaults"> {
  activeFaults?: MtConnectTelemetryFrame["values"]["activeFaults"];
}

export interface MtConnectIdentity {
  tenantId: string;
  lineId: string;
  deviceId: string;
  timestamp: string;
}

/** Synthetic data-item IDs are deliberately namespaced and are not vendor identifiers. */
export const MTCONNECT_SYNTHETIC_DATA_ITEMS = {
  status: "sim-status",
  temperatureCelsius: "sim-temperature-celsius",
  cycleTimeSeconds: "sim-cycle-time-seconds",
  totalCount: "sim-total-count",
  goodCount: "sim-good-count",
  defectCount: "sim-defect-count",
  alarm: "sim-alarm",
} as const;

export class MtConnectTelemetrySimulator implements ProtocolTelemetrySource {
  private readonly server: Server;
  private startPromise?: Promise<void>;
  constructor(
    private readonly identity: MtConnectIdentity,
    private values: MtConnectTelemetryValues,
    private readonly host = "127.0.0.1",
    private readonly port = 5000,
  ) {
    this.server = createServer((requestMessage, response) => this.handleRequest(requestMessage, response));
  }

  public async start(): Promise<void> {
    if (this.server.listening) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = listen(this.server, this.port, this.host);
    try { await this.startPromise; } finally { this.startPromise = undefined; }
  }

  public setValues(values: MtConnectTelemetryValues): void { this.values = values; }

  public async readTelemetry(retries = 1): Promise<SimulationMessage> {
    let lastError: unknown;
    for (let attempt = 0; attempt < Math.max(1, retries); attempt += 1) {
      try {
        const body = await readHttp(this.host, this.port, "/current");
        return adaptMtConnectTelemetry(parseCurrent(body, this.identity));
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  public async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  private handleRequest(message: IncomingMessage, response: ServerResponse): void {
    const path = message.url?.split("?")[0];
    if (path === "/probe") {
      sendXml(response, probeDocument(this.identity.deviceId));
      return;
    }
    if (path === "/current" || path === "/sample") {
      sendXml(response, currentDocument(this.values));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  }
}

function probeDocument(deviceId: string): string {
  const items = Object.entries(MTCONNECT_SYNTHETIC_DATA_ITEMS)
    .map(([name, id]) => `<DataItem id="${id}" name="${name}" type="${name === "status" ? "EVENT" : "SAMPLE"}" />`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><MTConnectDevices><Device uuid="sim-${deviceId}" name="${deviceId}"><ComponentStream component="Device">${items}</ComponentStream></Device></MTConnectDevices>`;
}

function currentDocument(values: MtConnectTelemetryValues): string {
  const execution = executionFor(values.status);
  const fault = values.activeFaults?.[0] ?? "";
  return `<?xml version="1.0" encoding="UTF-8"?><MTConnectStreams><ComponentStream component="Device"><Events><Execution dataItemId="${MTCONNECT_SYNTHETIC_DATA_ITEMS.status}">${execution}</Execution>${fault ? `<Alarm dataItemId="${MTCONNECT_SYNTHETIC_DATA_ITEMS.alarm}">${fault}</Alarm>` : ""}</Events><Samples><Temperature dataItemId="${MTCONNECT_SYNTHETIC_DATA_ITEMS.temperatureCelsius}">${values.temperatureCelsius}</Temperature><CycleTime dataItemId="${MTCONNECT_SYNTHETIC_DATA_ITEMS.cycleTimeSeconds}">${values.cycleTimeSeconds}</CycleTime><PartCount dataItemId="${MTCONNECT_SYNTHETIC_DATA_ITEMS.totalCount}">${values.totalCount}</PartCount><GoodCount dataItemId="${MTCONNECT_SYNTHETIC_DATA_ITEMS.goodCount}">${values.goodCount}</GoodCount><DefectCount dataItemId="${MTCONNECT_SYNTHETIC_DATA_ITEMS.defectCount}">${values.defectCount}</DefectCount></Samples></ComponentStream></MTConnectStreams>`;
}

function parseCurrent(xml: string, identity: MtConnectIdentity): MtConnectTelemetryFrame {
  const execution = tagValue(xml, "Execution", MTCONNECT_SYNTHETIC_DATA_ITEMS.status);
  const status = statusFor(execution);
  const alarm = tagValue(xml, "Alarm", MTCONNECT_SYNTHETIC_DATA_ITEMS.alarm);
  const activeFaults: FaultType[] = alarm ? [alarm as FaultType] : [];
  return {
    ...identity,
    values: {
      status,
      temperatureCelsius: numberValue(xml, "Temperature", MTCONNECT_SYNTHETIC_DATA_ITEMS.temperatureCelsius),
      cycleTimeSeconds: numberValue(xml, "CycleTime", MTCONNECT_SYNTHETIC_DATA_ITEMS.cycleTimeSeconds),
      totalCount: integerValue(xml, "PartCount", MTCONNECT_SYNTHETIC_DATA_ITEMS.totalCount),
      goodCount: integerValue(xml, "GoodCount", MTCONNECT_SYNTHETIC_DATA_ITEMS.goodCount),
      defectCount: integerValue(xml, "DefectCount", MTCONNECT_SYNTHETIC_DATA_ITEMS.defectCount),
      activeFaults,
    },
  };
}

function tagValue(xml: string, tag: string, dataItemId: string): string | undefined {
  const match = new RegExp(`<${tag}[^>]*dataItemId="${dataItemId}"[^>]*>([^<]*)</${tag}>`).exec(xml);
  return match?.[1];
}
function numberValue(xml: string, tag: string, id: string): number { return finite(Number(tagValue(xml, tag, id)), tag); }
function integerValue(xml: string, tag: string, id: string): number { const value = numberValue(xml, tag, id); if (!Number.isInteger(value) || value < 0) throw new Error(`invalid MTConnect ${tag}`); return value; }
function finite(value: number, field: string): number { if (!Number.isFinite(value)) throw new Error(`invalid MTConnect ${field}`); return value; }
function executionFor(status: DeviceStatus): string {
  if (status === "RUNNING" || status === "WARNING") return "ACTIVE";
  if (status === "IDLE") return "READY";
  if (status === "OFFLINE") return "UNAVAILABLE";
  return status;
}
function statusFor(execution: string | undefined): DeviceStatus {
  const map: Record<string, DeviceStatus> = { ACTIVE: "RUNNING", READY: "IDLE", STOPPED: "STOPPED", FAULT: "FAULT", UNAVAILABLE: "OFFLINE" };
  const status = execution ? map[execution] : undefined;
  if (!status) throw new Error(`unsupported MTConnect execution: ${String(execution)}`);
  return status;
}
function sendXml(response: ServerResponse, body: string): void { response.statusCode = 200; response.setHeader("content-type", "application/xml"); response.end(body); }

function readHttp(host: string, port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = request({ host, port, path, method: "GET" }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`MTConnect HTTP status ${response.statusCode}`)); return; }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    client.once("error", reject);
    client.end();
  });
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
