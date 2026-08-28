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
  const random = createSeededRandom(options.seed);
  const simulator = new FactorySimulator(options.tenantId, options.intervalMs, random, loadLineDefinitions(options.lineConfigPath));
  simulator.setTimeScale(options.timeScale ?? 1);
  simulator.setPaused(options.paused);
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
  console.error(`timeScale=${simulator.getTimeScale()}, paused=${simulator.isPaused()}, seed=${options.seed ?? "random"}`);
  console.error("Press Ctrl+C to stop. Use stdin commands: pause, resume, speed 5, reset, snapshot, export.");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => handleConsoleCommand(chunk.trim(), simulator));
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

function createSeededRandom(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function handleConsoleCommand(command: string, simulator: FactorySimulator): void {
  const [action, value] = command.split(/\s+/, 2);
  if (action === "pause") simulator.setPaused(true);
  else if (action === "resume" || action === "start") simulator.setPaused(false);
  else if (action === "speed") simulator.setTimeScale(Number(value));
  else if (action === "reset") simulator.reset();
  else if (action === "snapshot") console.log(JSON.stringify(simulator.snapshot()));
  else if (action === "export") console.log(simulator.exportHistory());
  else if (command) console.error("Unknown command. Use pause, resume, speed <n>, reset, snapshot, export.");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
