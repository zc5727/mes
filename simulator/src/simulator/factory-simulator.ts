import { AGV_DEFINITIONS, LINE_DEFINITIONS } from "../config/line-config";
import {
  Alarm,
  AgvDefinition,
  AgvState,
  AgvTelemetry,
  FaultType,
  LineSnapshot,
  NetworkSimulationOptions,
  ReplayDocument,
  ReplayFrame,
  ScenarioEvent,
  SimulationMessage,
  SimulatorControlCommand,
  SimulatorControlState,
  StrategyInputSnapshot,
  TwinCommand,
} from "../types";
import { MessagePublisher } from "../mqtt/publisher";
import { AgvSimulator } from "./agv-simulator";
import { NetworkSimulator } from "./network-simulator";
import { ProductionLineSimulator } from "./production-line-simulator";

export class FactorySimulator {
  private lines: ProductionLineSimulator[];
  private readonly pendingMessages: SimulationMessage[] = [];
  private readonly history: Array<{ timestamp: string; messages: SimulationMessage[] }> = [];
  private agvs: AgvSimulator[];
  private readonly agvDefinitions: AgvDefinition[];
  private readonly agvAlarms = new Map<string, Alarm>();
  private paused = false;
  private stopped = false;
  private timeScale = 1;
  private readonly network?: NetworkSimulator;
  private scenarioEvents: ScenarioEvent[] = [];
  private scenarioIndex = 0;
  private scenarioElapsedSeconds = 0;
  private processingScenario = false;

  public constructor(
    private readonly tenantId: string,
    private readonly intervalMs: number,
    random: () => number = Math.random,
    definitions = LINE_DEFINITIONS,
    agvDefinitions: AgvDefinition[] = AGV_DEFINITIONS,
    private readonly emitAgvTelemetry = false,
    networkOptions?: NetworkSimulationOptions,
  ) {
    this.definitions = definitions;
    this.random = random;
    const lineIds = new Set(definitions.map((definition) => definition.id));
    this.agvDefinitions = agvDefinitions.filter((definition) => lineIds.has(definition.lineId));
    this.lines = definitions.map((definition) => new ProductionLineSimulator(definition, tenantId, random));
    this.agvs = this.agvDefinitions.map((definition) => new AgvSimulator(definition));
    if (networkOptions) {
      this.network = new NetworkSimulator(networkOptions, createSeededRandom(networkOptions.seed));
    }
  }

  private readonly definitions: typeof LINE_DEFINITIONS;
  private readonly random: () => number;

  public start(): void {
    this.stopped = false;
    this.paused = false;
  }

  public stop(): void {
    this.stopped = true;
    this.paused = false;
  }

  public pause(): void {
    if (!this.stopped) this.paused = true;
  }

  public resume(): void {
    if (!this.stopped) this.paused = false;
  }

  public setPaused(paused: boolean): void {
    if (paused) this.pause();
    else this.resume();
  }

  public isPaused(): boolean { return this.paused; }
  public isStopped(): boolean { return this.stopped; }

  public getControlState(): SimulatorControlState {
    return {
      status: this.stopped ? "STOPPED" : this.paused ? "PAUSED" : "RUNNING",
      paused: this.paused,
      timeScale: this.timeScale,
    };
  }

  public setTimeScale(timeScale: number): void {
    if (!Number.isFinite(timeScale) || timeScale <= 0) throw new Error("timeScale must be greater than 0");
    this.timeScale = timeScale;
  }
  public getTimeScale(): number { return this.timeScale; }
  public reset(): void {
    this.lines = this.definitions.map((definition) => new ProductionLineSimulator(definition, this.tenantId, this.random));
    this.agvs = this.agvDefinitions.map((definition) => new AgvSimulator(definition));
    this.agvAlarms.clear();
    this.pendingMessages.length = 0;
    this.history.length = 0;
    this.network?.reset();
    if (!this.processingScenario) {
      this.scenarioIndex = 0;
      this.scenarioElapsedSeconds = 0;
    }
  }
  public exportHistory(): string { return JSON.stringify(this.history, null, 2); }

  public getReplayFrames(): ReplayFrame[] {
    return this.history.map((frame, sequence) => ({
      sequence,
      timestamp: frame.timestamp,
      messages: cloneMessages(frame.messages),
    }));
  }

  public exportReplay(): string {
    const replay: ReplayDocument = {
      version: 1,
      tenantId: this.tenantId,
      intervalMs: this.intervalMs,
      timeScale: this.timeScale,
      frames: this.getReplayFrames(),
    };
    return JSON.stringify(replay, null, 2);
  }

  public replayFrames(fromSequence = 0, toSequence = Number.POSITIVE_INFINITY): ReplayFrame[] {
    if (!Number.isInteger(fromSequence) || fromSequence < 0) throw new Error("fromSequence must be a non-negative integer");
    if (toSequence < fromSequence) throw new Error("toSequence must be greater than or equal to fromSequence");
    return this.getReplayFrames().filter((frame) => frame.sequence >= fromSequence && frame.sequence <= toSequence);
  }

  public loadScenario(events: ScenarioEvent[]): void {
    const sorted = events.map((event) => ({ ...event })).sort((left, right) => left.atSeconds - right.atSeconds);
    sorted.forEach((event) => {
      if (!Number.isFinite(event.atSeconds) || event.atSeconds < 0) throw new Error("scenario atSeconds must be non-negative");
    });
    this.scenarioEvents = sorted;
    this.scenarioIndex = 0;
    this.scenarioElapsedSeconds = 0;
  }

  public clearScenario(): void {
    this.scenarioEvents = [];
    this.scenarioIndex = 0;
    this.scenarioElapsedSeconds = 0;
  }
  public snapshot(timestamp = new Date()): LineSnapshot[] {
    return this.lines.map((line) => this.withAgvs(line.snapshot(timestamp)));
  }

  public getAgvSnapshots(timestamp = new Date()): AgvState[] {
    return this.agvs.map((agv) => agv.getState(timestamp));
  }

  public strategyInputSnapshot(timestamp = new Date()): StrategyInputSnapshot {
    const lines = this.snapshot(timestamp);
    return {
      timestamp: timestamp.toISOString(),
      runtime: this.getControlState(),
      lines,
      agvs: this.getAgvSnapshots(timestamp),
      activeAlarms: lines.flatMap((line) => line.activeAlarms),
    };
  }

  public injectFault(lineId: string, deviceId: string, type: FaultType): SimulationMessage {
    const agv = this.findAgv(lineId, deviceId);
    const alarm = agv
      ? agv.injectFault(type, new Date())
      : this.findLine(lineId).injectFault(deviceId, type);
    if (agv) this.agvAlarms.set(alarm.id, alarm);
    const message = this.alarmMessage("alarm.created", alarm);
    this.pendingMessages.push(message);
    return message;
  }

  public clearFault(lineId: string, deviceId: string, type: FaultType): SimulationMessage | undefined {
    const agv = this.findAgv(lineId, deviceId);
    const alarm = agv
      ? agv.clearFault(type, new Date())
      : this.findLine(lineId).clearFault(deviceId, type);
    if (!alarm) return undefined;
    if (agv) this.agvAlarms.delete(alarm.id);
    const message = this.alarmMessage("alarm.cleared", alarm);
    this.pendingMessages.push(message);
    return message;
  }

  public handleControlCommand(command: SimulatorControlCommand, timestamp = new Date()): SimulationMessage[] {
    const commandTimestamp = command.timestamp ? new Date(command.timestamp) : timestamp;
    if (Number.isNaN(commandTimestamp.getTime())) throw new Error("timestamp must be a valid ISO date");

    switch (command.action) {
      case "start":
        this.start();
        return [this.controlAppliedMessage(command, commandTimestamp)];
      case "stop":
        this.stop();
        return [this.controlAppliedMessage(command, commandTimestamp)];
      case "pause":
        this.pause();
        return [this.controlAppliedMessage(command, commandTimestamp)];
      case "resume":
        this.resume();
        return [this.controlAppliedMessage(command, commandTimestamp)];
      case "speed":
        if (command.speed === undefined) throw new Error("speed requires a positive speed");
        this.setTimeScale(command.speed);
        return [this.controlAppliedMessage(command, commandTimestamp)];
      case "fault": {
        if (!command.lineId || !command.deviceId || !command.faultType) {
          throw new Error("fault requires lineId, deviceId and faultType");
        }
        const agv = this.findAgv(command.lineId, command.deviceId);
        const alarm = agv
          ? agv.injectFault(command.faultType, commandTimestamp)
          : this.findLine(command.lineId).injectFault(command.deviceId, command.faultType, commandTimestamp);
        if (agv) this.agvAlarms.set(alarm.id, alarm);
        return [
          this.alarmMessage("alarm.created", alarm),
          this.controlAppliedMessage(command, commandTimestamp),
        ];
      }
      case "reset":
        if (!command.lineId) {
          this.reset();
          return [this.controlAppliedMessage(command, commandTimestamp)];
        }
        return this.applyResetCommand(command, commandTimestamp);
      case "snapshot":
        return [
          this.controlMessage("simulator.snapshot", command, {
            // Keep the original snapshot payload shape; strategyInputSnapshot()
            // is the richer, explicitly versionable strategy contract.
            data: this.snapshot(commandTimestamp),
          }),
        ];
      case "export":
        return [
          this.controlMessage("simulator.export", command, {
            data: JSON.parse(this.exportHistory()),
          }),
        ];
      case "replay":
        return [
          this.controlMessage("simulator.replay", command, {
            data: JSON.parse(this.exportReplay()),
          }),
        ];
    }
  }

  public handleTwinCommand(command: TwinCommand, timestamp = new Date()): SimulationMessage[] {
    const line = this.findLine(command.lineId);
    const alarms: Alarm[] = [];
    if (command.action === "INJECT_FAULT") {
      if (!command.deviceId || !command.faultType) throw new Error("INJECT_FAULT requires deviceId and faultType");
      const agv = this.findAgv(command.lineId, command.deviceId);
      const alarm = agv
        ? agv.injectFault(command.faultType, timestamp)
        : line.injectFault(command.deviceId, command.faultType, timestamp);
      if (agv) this.agvAlarms.set(alarm.id, alarm);
      alarms.push(alarm);
    } else if (command.action === "START_LINE" || command.action === "STOP_LINE" || command.action === "RESET_FAULT") {
      alarms.push(...line.executeLineAction(command.action, timestamp));
      if (command.action === "RESET_FAULT") {
        this.agvs.filter((agv) => this.agvDefinitions.find((definition) => definition.id === agv.agvId)?.lineId === command.lineId)
          .forEach((agv) => alarms.push(...this.clearAgvFaults(agv, timestamp)));
      }
    } else {
      if (!command.deviceId) throw new Error(`${command.action} requires deviceId`);
      const agv = this.findAgv(command.lineId, command.deviceId);
      if (agv && command.action === "START_DEVICE") agv.start();
      else if (agv && command.action === "STOP_DEVICE") agv.stop();
      else alarms.push(...line.executeDeviceAction(command.action, command.deviceId, timestamp));
    }

    const event = command.action === "RESET_FAULT" ? "alarm.cleared" : command.action === "INJECT_FAULT" ? "alarm.created" : "twin.command.applied";
    const messages = alarms.map((alarm) => this.alarmMessage(event === "alarm.created" ? "alarm.created" : "alarm.cleared", alarm));
    messages.push({
      topic: `mes/simulator/${this.tenantId}/twin/state`,
      payload: {
        event: "twin.state.changed",
        commandId: command.commandId,
        data: this.withAgvs(line.snapshot(timestamp)),
      },
    });
    return messages;
  }

  public tick(timestamp = new Date()): SimulationMessage[] {
    const pending = this.pendingMessages.splice(0);
    const elapsedSeconds = this.intervalMs / 1000 * this.timeScale;
    const scenarioMessages = this.applyScheduledScenario(elapsedSeconds, timestamp);
    if (this.paused || this.stopped) return this.deliver([...pending, ...scenarioMessages], timestamp);
    const agvTelemetry = this.agvs.map((agv) => agv.tick(elapsedSeconds, timestamp));
    const lineMessages = this.lines.flatMap((line) => line.tick(elapsedSeconds, timestamp))
      .map((message) => this.attachAgvs(message, timestamp));
    const agvMessages = this.emitAgvTelemetry ? agvTelemetry.map((telemetry) => this.agvTelemetryMessage(telemetry)) : [];
    const messages = [...lineMessages, ...agvMessages];
    const result = this.deliver([...pending, ...scenarioMessages, ...messages], timestamp);
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

  private findAgv(lineId: string, deviceId: string): AgvSimulator | undefined {
    const agv = this.agvs.find((item) => item.agvId === deviceId);
    if (!agv) return undefined;
    const definition = this.agvDefinitions.find((item) => item.id === deviceId);
    if (definition?.lineId !== lineId) {
      throw new Error(`AGV '${deviceId}' is not assigned to line '${lineId}'`);
    }
    return agv;
  }

  private withAgvs(snapshot: LineSnapshot): LineSnapshot {
    return {
      ...snapshot,
      agvs: this.getAgvSnapshots(new Date(snapshot.timestamp)).filter((agv) => agv.lineId === snapshot.lineId),
      activeAlarms: [
        ...snapshot.activeAlarms,
        ...[...this.agvAlarms.values()].filter((alarm) => alarm.lineId === snapshot.lineId),
      ],
    };
  }

  private attachAgvs(message: SimulationMessage, timestamp: Date): SimulationMessage {
    if (message.payload.event !== "line.snapshot") return message;
    const snapshot = message.payload.data as LineSnapshot;
    return { ...message, payload: { ...message.payload, data: this.withAgvs(snapshot) } };
  }

  private agvTelemetryMessage(telemetry: AgvTelemetry): SimulationMessage {
    return {
      topic: `mes/simulator/${this.tenantId}/lines/${telemetry.lineId}/agvs/${telemetry.agvId}/telemetry`,
      payload: { event: "agv.telemetry", data: telemetry },
    };
  }

  private alarmMessage(event: "alarm.created" | "alarm.cleared", alarm: ReturnType<ProductionLineSimulator["injectFault"]>): SimulationMessage {
    return {
      topic: `mes/simulator/${this.tenantId}/alarms`,
      payload: { event, data: alarm },
    };
  }

  private controlAppliedMessage(command: SimulatorControlCommand, timestamp: Date): SimulationMessage {
    return this.controlMessage("simulator.control.applied", command, {
      data: this.getControlState(),
      timestamp: timestamp.toISOString(),
    });
  }

  private controlMessage(
    event: "simulator.control.applied" | "simulator.snapshot" | "simulator.export" | "simulator.replay",
    command: SimulatorControlCommand,
    data: Record<string, unknown>,
  ): SimulationMessage {
    const commandId = command.commandId === undefined ? {} : { commandId: command.commandId };
    const requestedBy = command.requestedBy === undefined ? {} : { requestedBy: command.requestedBy };
    return {
      topic: `mes/simulator/${this.tenantId}/control`,
      payload: {
        event,
        action: command.action,
        ...commandId,
        ...requestedBy,
        ...data,
      },
    };
  }

  private applyScheduledScenario(elapsedSeconds: number, timestamp: Date): SimulationMessage[] {
    if (this.scenarioIndex >= this.scenarioEvents.length || this.paused || this.stopped) return [];
    const nextElapsed = this.scenarioElapsedSeconds + elapsedSeconds;
    const messages: SimulationMessage[] = [];
    this.processingScenario = true;
    try {
      while (this.scenarioIndex < this.scenarioEvents.length
        && this.scenarioEvents[this.scenarioIndex].atSeconds <= nextElapsed) {
        const event = this.scenarioEvents[this.scenarioIndex++];
        messages.push(...this.handleControlCommand(event.command, timestamp));
      }
    } finally {
      this.processingScenario = false;
    }
    this.scenarioElapsedSeconds = nextElapsed;
    return messages;
  }

  private deliver(messages: SimulationMessage[], timestamp: Date): SimulationMessage[] {
    return this.network ? this.network.enqueue(messages, timestamp) : messages;
  }

  private applyResetCommand(command: SimulatorControlCommand, timestamp: Date): SimulationMessage[] {
    const alarms: Alarm[] = [];
    if (!command.deviceId) {
      const line = this.findLine(command.lineId!);
      alarms.push(...line.executeLineAction("RESET_FAULT", timestamp));
      this.agvs.filter((agv) => this.agvDefinitions.find((definition) => definition.id === agv.agvId)?.lineId === command.lineId)
        .forEach((agv) => alarms.push(...this.clearAgvFaults(agv, timestamp)));
    } else {
      const agv = this.findAgv(command.lineId!, command.deviceId);
      const cleared = agv
        ? command.faultType ? agv.clearFault(command.faultType, timestamp) : this.clearAgvFaults(agv, timestamp)
        : command.faultType
          ? this.findLine(command.lineId!).clearFault(command.deviceId, command.faultType, timestamp)
          : this.findLine(command.lineId!).executeDeviceAction("RESET_FAULT", command.deviceId, timestamp);
      alarms.push(...Array.isArray(cleared) ? cleared : cleared ? [cleared] : []);
    }
    alarms.forEach((alarm) => this.agvAlarms.delete(alarm.id));
    return [
      ...alarms.map((alarm) => this.alarmMessage("alarm.cleared", alarm)),
      this.controlAppliedMessage(command, timestamp),
    ];
  }

  private clearAgvFaults(agv: AgvSimulator, timestamp: Date): Alarm[] {
    const cleared = agv.resetFaults(timestamp);
    cleared.forEach((alarm) => this.agvAlarms.delete(alarm.id));
    return cleared;
  }
}

function createSeededRandom(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function cloneMessages(messages: SimulationMessage[]): SimulationMessage[] {
  return JSON.parse(JSON.stringify(messages)) as SimulationMessage[];
}
