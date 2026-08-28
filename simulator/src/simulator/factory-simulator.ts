import { LINE_DEFINITIONS } from "../config/line-config";
import { Alarm, FaultType, SimulationMessage, TwinCommand } from "../types";
import { MessagePublisher } from "../mqtt/publisher";
import { ProductionLineSimulator } from "./production-line-simulator";

export class FactorySimulator {
  private lines: ProductionLineSimulator[];
  private readonly pendingMessages: SimulationMessage[] = [];
  private readonly history: Array<{ timestamp: string; messages: SimulationMessage[] }> = [];
  private paused = false;
  private timeScale = 1;

  public constructor(
    private readonly tenantId: string,
    private readonly intervalMs: number,
    random: () => number = Math.random,
    definitions = LINE_DEFINITIONS,
  ) {
    this.definitions = definitions;
    this.random = random;
    this.lines = definitions.map((definition) => new ProductionLineSimulator(definition, tenantId, random));
  }

  private readonly definitions: typeof LINE_DEFINITIONS;
  private readonly random: () => number;

  public setPaused(paused: boolean): void { this.paused = paused; }
  public isPaused(): boolean { return this.paused; }
  public setTimeScale(timeScale: number): void {
    if (!Number.isFinite(timeScale) || timeScale <= 0) throw new Error("timeScale must be greater than 0");
    this.timeScale = timeScale;
  }
  public getTimeScale(): number { return this.timeScale; }
  public reset(): void {
    this.lines = this.definitions.map((definition) => new ProductionLineSimulator(definition, this.tenantId, this.random));
    this.pendingMessages.length = 0;
    this.history.length = 0;
  }
  public exportHistory(): string { return JSON.stringify(this.history, null, 2); }
  public snapshot(timestamp = new Date()) { return this.lines.map((line) => line.snapshot(timestamp)); }

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
    const pending = this.pendingMessages.splice(0);
    if (this.paused) return pending;
    const messages = this.lines.flatMap((line) => line.tick(this.intervalMs / 1000 * this.timeScale, timestamp));
    const result = [...pending, ...messages];
    this.history.push({ timestamp: timestamp.toISOString(), messages: result });
    return result;
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
