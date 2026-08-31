import { ConsolePublisher, MqttPublisher, type MessagePublisher } from "../mqtt/publisher";
import { ModbusTcpSimulatorServer, ModbusTcpTelemetryClient, OpcUaTelemetrySimulator, type DeterministicTelemetryValues } from "./protocol-bridge";
import type { ProtocolKind } from "./protocol-bridge";

const VALUES: DeterministicTelemetryValues = {
  tenantId: "demo-tenant", lineId: "line-cnc", deviceId: "cnc-01", timestamp: "2026-08-31T00:00:00.000Z",
  status: "RUNNING", temperatureCelsius: 42.5, cycleTimeSeconds: 8.4, totalCount: 100, goodCount: 98, defectCount: 2,
};

/** Start one local protocol server, read it with its client, and publish canonical telemetry. */
export async function runProtocolSmoke(protocol: ProtocolKind, host: string, port: number, mqttUrl?: string): Promise<void> {
  const publisher: MessagePublisher = mqttUrl ? await MqttPublisher.connect(mqttUrl) : new ConsolePublisher();
  const server = protocol === "modbus-tcp" ? new ModbusTcpSimulatorServer(VALUES, host, port) : new OpcUaTelemetrySimulator(VALUES, port);
  await server.start();
  try {
    const message = protocol === "modbus-tcp"
      ? await new ModbusTcpTelemetryClient({ tenantId: VALUES.tenantId, lineId: VALUES.lineId, deviceId: VALUES.deviceId, timestamp: VALUES.timestamp }, host, port).readTelemetry(2)
      : await (server as OpcUaTelemetrySimulator).readTelemetry(2);
    await publisher.publish(message);
    console.error(`protocol smoke passed: ${protocol} ${host}:${port}`);
  } finally {
    await server.close();
    await publisher.close();
  }
}

const protocol = process.argv[2] as ProtocolKind | undefined;
if (protocol) void runProtocolSmoke(protocol, process.env.SIMULATOR_PROTOCOL_HOST ?? "127.0.0.1", Number(process.env.SIMULATOR_PROTOCOL_PORT ?? (protocol === "opc-ua" ? 4841 : 1502)), process.env.MQTT_URL).catch((error: unknown) => { console.error(`protocol smoke failed: ${String(error)}`); process.exitCode = 1; });
