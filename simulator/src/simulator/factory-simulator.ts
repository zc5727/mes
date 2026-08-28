import { LINE_DEFINITIONS } from "../config/line-config";
import { Alarm, FaultType, SimulationMessage, TwinCommand } from "../types";
import { MessagePublisher } from "../mqtt/publisher";
import { ProductionLineSimulator } from "./production-line-simulator";

export class FactorySimulator {
  private readonly lines: ProductionLineSimulator[];
  private readonly pendingMessages: SimulationMessage[] = [];

  public constructor(
    private readonly tenantId: string,
    private readonly intervalMs: number,
    random: () => number = Math.random,
    definitions = LINE_DEFINITIONS,
  ) {
    this.lines = definitions.map((definition) => new ProductionLineSimulator(definition, tenantId, random));
  }

  public injectFault(lineId: string, deviceId: string, type: FaultType): SimulationMessage {
    const alarm = this.findLine(lineId).injectFault(deviceId, type);
    const message = this.alarmMessage("alarm.created", alarm);
    this.pendingMessages.push(message);
    return message;
  }

  public clearFault(lineId: string, deviceId: string, type: FaultType): SimulationMessage | undefined {
    const alarm = this.findLine(lineId).clearFault(deviceId, type);
    if (!alarm) return undefined;
    const message = this.alarmMessage("alarm.cleared", alarm);
    this.pendingMessages.push(message);
    return message;
  }

  public handleTwinCommand(command: TwinCommand, timestamp = new Date()): SimulationMessage[] {
    const line = this.findLine(command.lineId);
    const alarms: Alarm[] = [];
    if (command.action === "INJECT_FAULT") {
      if (!command.deviceId || !command.faultType) throw new Error("INJECT_FAULT requires deviceId and faultType");
      alarms.push(line.injectFault(command.deviceId, command.faultType, timestamp));
    } else if (command.action === "START_LINE" || command.action === "STOP_LINE" || command.action === "RESET_FAULT") {
      alarms.push(...line.executeLineAction(command.action, timestamp));
    } else {
      if (!command.deviceId) throw new Error(`${command.action} requires deviceId`);
      alarms.push(...line.executeDeviceAction(command.action, command.deviceId, timestamp));
    }

    const event = command.action === "RESET_FAULT" ? "alarm.cleared" : command.action === "INJECT_FAULT" ? "alarm.created" : "twin.command.applied";
    const messages = alarms.map((alarm) => this.alarmMessage(event === "alarm.created" ? "alarm.created" : "alarm.cleared", alarm));
    messages.push({
      topic: `mes/simulator/${this.tenantId}/twin/state`,
      payload: {
        event: "twin.state.changed",
        commandId: command.commandId,
        data: line.snapshot(timestamp),
      },
    });
    return messages;
  }

  public tick(timestamp = new Date()): SimulationMessage[] {
    const messages = this.lines.flatMap((line) => line.tick(this.intervalMs / 1000, timestamp));
    return [...this.pendingMessages.splice(0), ...messages];
  }

  public snapshots(timestamp = new Date()) {
    return this.lines.map((line) => line.snapshot(timestamp));
  }

  public async run(publisher: MessagePublisher, once = false): Promise<() => Promise<void>> {
    const publishTick = async () => {
      const messages = this.tick();
      await Promise.all(messages.map((message) => publisher.publish(message)));
    };

    await publishTick();
    if (once) {
      return async () => publisher.close();
    }

    const timer = setInterval(() => {
      void publishTick().catch((error: unknown) => console.error("simulation publish failed", error));
    }, this.intervalMs);

    return async () => {
      clearInterval(timer);
      await publisher.close();
    };
  }

  private findLine(lineId: string): ProductionLineSimulator {
    const line = this.lines.find((item) => item.snapshot().lineId === lineId);
    if (!line) {
      throw new Error(`Unknown line '${lineId}'`);
    }
    return line;
  }

  private alarmMessage(event: "alarm.created" | "alarm.cleared", alarm: ReturnType<ProductionLineSimulator["injectFault"]>): SimulationMessage {
    return {
      topic: `mes/simulator/${this.tenantId}/alarms`,
      payload: { event, data: alarm },
    };
  }
}
