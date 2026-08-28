import { parseCliArgs } from "./config";
import { loadLineDefinitions } from "./config/line-config";
import { ConsolePublisher, MqttPublisher, MessagePublisher } from "./mqtt/publisher";
import { FactorySimulator } from "./simulator/factory-simulator";
import { parseTwinCommand } from "./twin/command";

async function createPublisher(mqttUrl?: string): Promise<MessagePublisher> {
  if (!mqttUrl) {
    return new ConsolePublisher();
  }

  try {
    return await MqttPublisher.connect(mqttUrl);
  } catch (error) {
    console.error(`MQTT connection failed, fallback to stdout: ${String(error)}`);
    return new ConsolePublisher();
  }
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const publisher = await createPublisher(options.mqttUrl);
  const simulator = new FactorySimulator(options.tenantId, options.intervalMs, Math.random, loadLineDefinitions(options.lineConfigPath));
  for (const fault of options.faults) {
    simulator.injectFault(fault.lineId, fault.deviceId, fault.type);
  }
  for (const fault of options.clearFaults) {
    simulator.clearFault(fault.lineId, fault.deviceId, fault.type);
  }
  await publisher.subscribe(`mes/control/${options.tenantId}/twin/command`, async (payload) => {
    try {
      const command = parseTwinCommand(payload);
      const messages = simulator.handleTwinCommand(command);
      await Promise.all(messages.map((message) => publisher.publish(message)));
    } catch (error) {
      console.error(`twin command rejected: ${String(error)}`);
    }
  });
  const stop = await simulator.run(publisher, options.once);

  if (options.once) {
    await stop();
    return;
  }

  console.error(`MES simulator started: 4 lines, interval=${options.intervalMs}ms`);
  console.error("Press Ctrl+C to stop. Use --once for one tick.");
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
