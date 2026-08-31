import { createConnection, createServer, type Server, type Socket } from "node:net";
import { OPCUAClient, OPCUAServer, AttributeIds, MessageSecurityMode, SecurityPolicy, Variant, DataType, type ClientSession } from "node-opcua";
import { adaptModbusTelemetry, adaptOpcUaTelemetry, type ModbusTelemetryFrame, type OpcUaTelemetryFrame } from "./event-adapter";
import type { DeviceStatus, SimulationMessage } from "../types";

export interface ProtocolTelemetrySource {
  readTelemetry(retries?: number): Promise<SimulationMessage>;
  close(): Promise<void>;
}

export type ProtocolKind = "modbus-tcp" | "opc-ua";

export interface ProtocolEndpointConfig {
  protocol: ProtocolKind;
  host: string;
  port: number;
  unitId?: number;
  timeoutMs?: number;
}

/** Validate an endpoint before a simulator process opens a socket. */
export function parseProtocolEndpoint(input: Partial<ProtocolEndpointConfig>): ProtocolEndpointConfig {
  if (input.protocol !== "modbus-tcp" && input.protocol !== "opc-ua") throw new Error("protocol must be modbus-tcp or opc-ua");
  if (typeof input.host !== "string" || !input.host.trim()) throw new Error("protocol host is required");
  const port = input.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("protocol port must be an integer from 1 to 65535");
  if (input.unitId !== undefined && (!Number.isInteger(input.unitId) || input.unitId < 1 || input.unitId > 247)) throw new Error("Modbus unitId must be from 1 to 247");
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 30000)) throw new Error("protocol timeoutMs must be from 100 to 30000");
  return { protocol: input.protocol, host: input.host.trim(), port, unitId: input.unitId ?? 1, timeoutMs: input.timeoutMs ?? 2000 };
}

export interface DeterministicTelemetryValues {
  tenantId: string;
  lineId: string;
  deviceId: string;
  timestamp: string;
  status: DeviceStatus;
  temperatureCelsius: number;
  cycleTimeSeconds: number;
  totalCount: number;
  goodCount: number;
  defectCount: number;
  faultCode?: number;
}

const REGISTER_COUNT = 10;

function encodeRegisters(values: DeterministicTelemetryValues): Buffer {
  const registers = Buffer.alloc(REGISTER_COUNT * 2);
  const status: Record<DeterministicTelemetryValues["status"], number> = { RUNNING: 1, IDLE: 2, WARNING: 3, STOPPED: 4, FAULT: 5, OFFLINE: 6 };
  registers.writeUInt16BE(status[values.status], 0);
  registers.writeUInt16BE(Math.round(values.temperatureCelsius * 10), 2);
  registers.writeUInt16BE(Math.round(values.cycleTimeSeconds * 10), 4);
  registers.writeUInt32BE(values.totalCount, 6);
  registers.writeUInt32BE(values.goodCount, 10);
  registers.writeUInt32BE(values.defectCount, 14);
  registers.writeUInt16BE(values.faultCode ?? 0, 18);
  return registers;
}

function decodeRegisters(buffer: Buffer, identity: Omit<DeterministicTelemetryValues, "status" | "temperatureCelsius" | "cycleTimeSeconds" | "totalCount" | "goodCount" | "defectCount" | "faultCode">): ModbusTelemetryFrame {
  if (buffer.length !== REGISTER_COUNT * 2) throw new Error(`Modbus response has invalid register length: ${buffer.length}`);
  const statuses = ["", "RUNNING", "IDLE", "WARNING", "STOPPED", "FAULT", "OFFLINE"] as const;
  const status = statuses[buffer.readUInt16BE(0)];
  if (!status) throw new Error(`Modbus response has invalid status register: ${buffer.readUInt16BE(0)}`);
  return { ...identity, registers: { status: buffer.readUInt16BE(0), temperatureCelsius: buffer.readUInt16BE(2) / 10, cycleTimeSeconds: buffer.readUInt16BE(4) / 10, totalCount: buffer.readUInt32BE(6), goodCount: buffer.readUInt32BE(10), defectCount: buffer.readUInt32BE(14), faultCode: buffer.readUInt16BE(18) || undefined } };
}

/** Deterministic Modbus TCP server implementing read holding registers (FC03) only. */
export class ModbusTcpSimulatorServer {
  private readonly server: Server;
  private values: DeterministicTelemetryValues;

  constructor(values: DeterministicTelemetryValues, private readonly host = "127.0.0.1", private readonly port = 1502) {
    this.values = values;
    this.server = createServer((socket) => this.handleSocket(socket));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.port, this.host, () => resolve()); });
  }

  setValues(values: DeterministicTelemetryValues): void { this.values = values; }
  async close(): Promise<void> { await new Promise<void>((resolve) => this.server.close(() => resolve())); }

  private handleSocket(socket: Socket): void {
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 8) {
        const length = pending.readUInt16BE(4);
        const frameLength = 6 + length;
        if (frameLength < 8 || frameLength > 260) { socket.destroy(new Error("invalid Modbus MBAP length")); return; }
        if (pending.length < frameLength) return;
        const request = pending.subarray(0, frameLength); pending = pending.subarray(frameLength);
        this.respond(socket, request);
      }
    });
  }

  private respond(socket: Socket, request: Buffer): void {
    const transaction = request.readUInt16BE(0); const unit = request[6]; const functionCode = request[7];
    if (functionCode !== 3 || request.length !== 12 || request.readUInt16BE(8) !== 0 || request.readUInt16BE(10) !== REGISTER_COUNT) {
      const response = Buffer.alloc(9); response.writeUInt16BE(transaction, 0); response.writeUInt16BE(3, 4); response[6] = unit; response[7] = functionCode | 0x80; response[8] = 1; socket.write(response); return;
    }
    const registers = encodeRegisters(this.values); const response = Buffer.alloc(9 + registers.length);
    response.writeUInt16BE(transaction, 0); response.writeUInt16BE(3 + registers.length, 4); response[6] = unit; response[7] = 3; response[8] = registers.length; registers.copy(response, 9); socket.write(response);
  }
}

/** Modbus TCP client with bounded reconnect and canonical MQTT event output. */
export class ModbusTcpTelemetryClient implements ProtocolTelemetrySource {
  constructor(private readonly identity: Omit<DeterministicTelemetryValues, "status" | "temperatureCelsius" | "cycleTimeSeconds" | "totalCount" | "goodCount" | "defectCount" | "faultCode">, private readonly host = "127.0.0.1", private readonly port = 1502) {}

  async readTelemetry(retries = 1): Promise<SimulationMessage> {
    let lastError: unknown;
    for (let attempt = 0; attempt < Math.max(1, retries); attempt += 1) {
      try { return adaptModbusTelemetry(decodeRegisters(await this.readRegisters(), this.identity)); }
      catch (error: unknown) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async close(): Promise<void> { return Promise.resolve(); }

  private async readRegisters(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port }); let pending = Buffer.alloc(0);
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("Modbus TCP read timed out")); }, 2_000);
      socket.once("connect", () => { const request = Buffer.alloc(12); request.writeUInt16BE(1, 0); request.writeUInt16BE(6, 4); request[6] = 1; request[7] = 3; request.writeUInt16BE(0, 8); request.writeUInt16BE(REGISTER_COUNT, 10); socket.write(request); });
      socket.on("data", (chunk) => { pending = Buffer.concat([pending, chunk]); if (pending.length < 9) return; clearTimeout(timer); socket.end(); if (pending[7] & 0x80) reject(new Error(`Modbus exception code: ${pending[8]}`)); else resolve(pending.subarray(9, 9 + pending[8])); });
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
  }
}

/** Small real OPC UA server/client pair backed by deterministic in-memory values. */
export class OpcUaTelemetrySimulator implements ProtocolTelemetrySource {
  private readonly server: OPCUAServer;
  private client?: OPCUAClient;
  private session?: ClientSession;
  constructor(private readonly values: Omit<DeterministicTelemetryValues, "faultCode">, private readonly port = 4841) {
    this.server = new OPCUAServer({ port, resourcePath: "/MES/SimulatedDevice", securityModes: [MessageSecurityMode.None], securityPolicies: [SecurityPolicy.None], allowAnonymous: true });
  }

  async start(): Promise<void> {
    await this.server.initialize();
    const namespace = this.server.engine.addressSpace!.getOwnNamespace(); const device = namespace.addObject({ organizedBy: this.server.engine.addressSpace!.rootFolder.objects, browseName: "MESDevice" });
    const fields = ["status", "temperatureCelsius", "cycleTimeSeconds", "totalCount", "goodCount", "defectCount"] as const;
    for (const field of fields) namespace.addVariable({ componentOf: device, nodeId: `s=mes/${field}`, browseName: field, dataType: field === "status" ? DataType.String : field.includes("Count") ? DataType.UInt32 : DataType.Double, minimumSamplingInterval: 1000, value: { get: () => new Variant({ dataType: field === "status" ? DataType.String : field.includes("Count") ? DataType.UInt32 : DataType.Double, value: this.values[field] }) } });
    await this.server.start();
  }

  async readTelemetry(retries = 1): Promise<SimulationMessage> {
    let lastError: unknown;
    for (let attempt = 0; attempt < Math.max(1, retries); attempt += 1) {
      try { return await this.readOnce(); } catch (error: unknown) { lastError = error; await this.resetClient(); }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async readOnce(): Promise<SimulationMessage> {
    this.client ??= OPCUAClient.create({ endpointMustExist: false });
    if (!this.session) { await this.client.connect(`opc.tcp://127.0.0.1:${this.port}`); this.session = await this.client.createSession(); }
    const nodes = ["status", "temperatureCelsius", "cycleTimeSeconds", "totalCount", "goodCount", "defectCount"];
    const results = await this.session.read(nodes.map((field) => ({ nodeId: `ns=1;s=mes/${field}`, attributeId: AttributeIds.Value })));
    const values = Object.fromEntries(nodes.map((field, index) => [field, results[index].value.value]));
    return adaptOpcUaTelemetry({ ...this.values, values: values as OpcUaTelemetryFrame["values"] });
  }

  private async resetClient(): Promise<void> { await this.session?.close().catch(() => undefined); await this.client?.disconnect().catch(() => undefined); this.session = undefined; this.client = undefined; }
  async close(): Promise<void> { await this.resetClient(); await this.server.shutdown(); }
}
