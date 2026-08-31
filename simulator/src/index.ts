import { parseCliArgs } from "./config";
import { loadSimulatorConfig } from "./config/line-config";
import { ConsolePublisher, MqttPublisher, MessagePublisher } from "./mqtt/publisher";
import { FactorySimulator } from "./simulator/factory-simulator";
import { parseConsoleControlCommand, parseSimulatorControlCommand, parseTwinCommand } from "./twin/command";
import { runProtocolSmoke } from "./protocols/protocol-runner";

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
  if (options.protocol) {
    const defaultPort = options.protocol === "opc-ua" ? 4841 : options.protocol === "mtconnect" ? 5000 : 1502;
    await runProtocolSmoke(options.protocol, options.protocolHost ?? "127.0.0.1", options.protocolPort ?? defaultPort, options.mqttUrl);
    return;
  }
  const publisher = await createPublisher(options.mqttUrl);
  const random = createSeededRandom(options.seed);
  const simulatorConfig = loadSimulatorConfig(options.lineConfigPath);
  const simulator = new FactorySimulator(
    options.tenantId,
    options.intervalMs,
    random,
    simulatorConfig.lines,
    simulatorConfig.agvs,
    options.emitAgvTelemetry,
    options.network,
  );
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
  const controlHandler = async (payload: string) => {
    try {
      const command = parseSimulatorControlCommand(payload);
      const messages = simulator.handleControlCommand(command);
      await Promise.all(messages.map((message) => publisher.publish(message)));
    } catch (error) {
      console.error(`simulator control rejected: ${String(error)}`);
    }
  };
  await publisher.subscribe(`mes/control/${options.tenantId}/simulator/command`, controlHandler);
  await publisher.subscribe(`mes/control/${options.tenantId}/simulator`, controlHandler);
  const stop = await simulator.run(publisher, options.once);

  if (options.once) {
    await stop();
    return;
  }

  console.error(`MES simulator started: 4 lines, interval=${options.intervalMs}ms`);
  console.error(`timeScale=${simulator.getTimeScale()}, paused=${simulator.isPaused()}, seed=${options.seed ?? "random"}`);
  console.error("Press Ctrl+C to stop. Use stdin commands: start, stop, pause, resume, speed 5, fault line:device:TYPE, reset, snapshot, export, replay.");
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

export function handleConsoleCommand(command: string, simulator: FactorySimulator): void {
  if (!command) return;

  try {
    const control = parseConsoleControlCommand(command);
    const messages = simulator.handleControlCommand(control);
    if (control.action === "snapshot") {
      console.log(JSON.stringify((messages[0].payload.data)));
    } else if (control.action === "export") {
      // Keep the original CLI export format: pretty-printed history JSON.
      console.log(simulator.exportHistory());
    } else if (control.action === "replay") {
      console.log(simulator.exportReplay());
    } else if (control.action === "fault") {
      messages.forEach((message) => console.log(JSON.stringify({ topic: message.topic, ...message.payload })));
    }
  } catch (error) {
    console.error(String(error));
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
