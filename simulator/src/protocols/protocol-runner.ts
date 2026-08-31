import { ConsolePublisher, MqttPublisher, type MessagePublisher } from "../mqtt/publisher";
import { ModbusTcpSimulatorServer, ModbusTcpTelemetryClient, OpcUaTelemetrySimulator, parseProtocolEndpoint, type DeterministicTelemetryValues, type ProtocolEndpointConfig, type ProtocolKind } from "./protocol-bridge";
import { MtConnectTelemetrySimulator } from "./mtconnect";
import type { SimulationMessage } from "../types";
import type { DeviceProfile } from "../config/device-profile";

const VALUES: DeterministicTelemetryValues = {
  tenantId: "demo-tenant", lineId: "line-cnc", deviceId: "cnc-01", timestamp: "2026-08-31T00:00:00.000Z",
  status: "RUNNING", temperatureCelsius: 42.5, cycleTimeSeconds: 8.4, totalCount: 100, goodCount: 98, defectCount: 2,
};

export interface ProtocolRunnerOptions {
  protocol: ProtocolKind;
  host: string;
  port: number;
  unitId?: number;
  timeoutMs?: number;
  values?: DeterministicTelemetryValues;
}

/** Start one local protocol endpoint, read its contract, and return canonical telemetry. */
export class ProtocolRunner {
  private readonly endpoint: ProtocolEndpointConfig;

  public constructor(private readonly options: ProtocolRunnerOptions) {
    this.endpoint = parseProtocolEndpoint(options);
  }

  public async readTelemetry(): Promise<SimulationMessage> {
    const values = this.options.values ?? VALUES;
    if (this.options.protocol === "modbus-tcp") {
      const server = new ModbusTcpSimulatorServer(values, this.endpoint.host, this.endpoint.port, this.endpoint.unitId);
      try {
        await server.start();
        return await new ModbusTcpTelemetryClient(identityOf(values), this.endpoint.host, this.endpoint.port, this.endpoint.unitId, this.endpoint.timeoutMs).readTelemetry(2);
      } finally {
        await server.close().catch(() => undefined);
      }
    }
    if (this.options.protocol === "opc-ua") {
      const server = new OpcUaTelemetrySimulator(values, this.endpoint.port, this.endpoint.host);
      try {
        await server.start();
        return await server.readTelemetry(2);
      }
      finally { await server.close().catch(() => undefined); }
    }
    const server = new MtConnectTelemetrySimulator(identityOf(values), values, this.endpoint.host, this.endpoint.port);
    try {
      await server.start();
      return await server.readTelemetry(2);
    } finally {
      await server.close().catch(() => undefined);
    }
  }
}

export function protocolRunnerForProfile(profile: DeviceProfile, host = "127.0.0.1", port = defaultPortFor(profile.protocol), values?: DeterministicTelemetryValues): ProtocolRunner {
  if (profile.protocol === "MQTT") throw new Error("MQTT uses the existing publisher chain and has no local protocol endpoint");
  return new ProtocolRunner({ protocol: toProtocolKind(profile.protocol), host, port, values: values ? { ...values, profileId: values.profileId ?? profile.id } : undefined });
}

/** MQTT remains the existing publication path; protocol endpoints only supply canonical telemetry. */
export async function runProtocolSmoke(protocol: ProtocolKind, host: string, port: number, mqttUrl?: string): Promise<void> {
  const publisher: MessagePublisher = mqttUrl ? await MqttPublisher.connect(mqttUrl) : new ConsolePublisher();
  try {
    const message = await new ProtocolRunner({ protocol, host, port }).readTelemetry();
    await publisher.publish(message);
    console.error(`protocol smoke passed: ${protocol} ${host}:${port}`);
  } finally {
    await publisher.close();
  }
}

function identityOf(values: DeterministicTelemetryValues) {
  return { tenantId: values.tenantId, lineId: values.lineId, deviceId: values.deviceId, timestamp: values.timestamp };
}
function toProtocolKind(protocol: DeviceProfile["protocol"]): ProtocolKind {
  if (protocol === "OPC_UA") return "opc-ua";
  if (protocol === "MODBUS_TCP") return "modbus-tcp";
  if (protocol === "MTCONNECT") return "mtconnect";
  throw new Error(`Unsupported local endpoint protocol '${protocol}'`);
}
function defaultPortFor(protocol: DeviceProfile["protocol"]): number {
  return protocol === "OPC_UA" ? 4841 : protocol === "MTCONNECT" ? 5000 : 1502;
}
if (require.main === module) {
  const protocol = process.argv[2] as ProtocolKind | undefined;
  if (protocol) {
    const defaultPort = protocol === "opc-ua" ? 4841 : protocol === "mtconnect" ? 5000 : 1502;
    void runProtocolSmoke(protocol, process.env.SIMULATOR_PROTOCOL_HOST ?? "127.0.0.1", Number(process.env.SIMULATOR_PROTOCOL_PORT ?? defaultPort), process.env.MQTT_URL)
      .catch((error: unknown) => { console.error(`protocol smoke failed: ${String(error)}`); process.exitCode = 1; });
  }
}
