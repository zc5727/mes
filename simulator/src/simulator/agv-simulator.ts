import { AgvDefinition, AgvState, AgvTelemetry, Alarm, FaultType } from "../types";

const FAULT_SEVERITY: Record<FaultType, Alarm["severity"]> = {
  OVERHEAT: "CRITICAL",
  JAM: "CRITICAL",
  COMMUNICATION_LOSS: "CRITICAL",
  QUALITY_DRIFT: "WARNING",
  EMERGENCY_STOP: "CRITICAL",
  MATERIAL_SHORTAGE: "WARNING",
  QUALITY_ANOMALY: "CRITICAL",
};

const FAULT_MESSAGES: Record<FaultType, string> = {
  OVERHEAT: "AGV 电池或驱动单元过热",
  JAM: "AGV 路径或载荷发生堵塞",
  COMMUNICATION_LOSS: "AGV 通信中断",
  QUALITY_DRIFT: "AGV 运行参数发生漂移",
  EMERGENCY_STOP: "AGV 触发急停",
  MATERIAL_SHORTAGE: "AGV 待运物料不足",
  QUALITY_ANOMALY: "AGV 任务质量异常",
};

export class AgvSimulator {
  private status: AgvStatus = "IDLE";
  private batteryPercent = 100;
  private loadPercent = 0;
  private distanceMeters = 0;
  private manuallyStopped = false;
  private readonly activeFaults = new Set<FaultType>();
  private readonly faultStartedAt = new Map<FaultType, string>();

  public constructor(private readonly definition: AgvDefinition) {}

  public get agvId(): string {
    return this.definition.id;
  }

  public injectFault(type: FaultType, timestamp: Date): Alarm {
    const startedAt = this.faultStartedAt.get(type) ?? timestamp.toISOString();
    this.faultStartedAt.set(type, startedAt);
    this.activeFaults.add(type);
    this.status = this.deriveFaultStatus();
    return this.createAlarm(type, startedAt);
  }

  public clearFault(type: FaultType, timestamp: Date): Alarm | undefined {
    if (!this.activeFaults.delete(type)) return undefined;
    const startedAt = this.faultStartedAt.get(type) ?? timestamp.toISOString();
    this.faultStartedAt.delete(type);
    this.status = this.deriveStatus();
    return { ...this.createAlarm(type, startedAt), clearedAt: timestamp.toISOString() };
  }

  public resetFaults(timestamp: Date): Alarm[] {
    return [...this.activeFaults]
      .map((fault) => this.clearFault(fault, timestamp))
      .filter((alarm): alarm is Alarm => alarm !== undefined);
  }

  public start(): void {
    this.manuallyStopped = false;
    this.status = this.deriveStatus();
  }

  public stop(): void {
    this.manuallyStopped = true;
    this.status = this.deriveStatus();
  }

  public tick(elapsedSeconds: number, timestamp: Date): AgvTelemetry {
    this.status = this.deriveStatus();
    if (this.status === "IDLE") this.status = "MOVING";

    if (this.status === "MOVING" || this.status === "LOADING" || this.status === "UNLOADING" || this.status === "WARNING") {
      this.distanceMeters += this.definition.speedMetersPerSecond * elapsedSeconds;
      this.batteryPercent = Math.max(0, this.batteryPercent - elapsedSeconds * 0.012);
      if (this.status === "MOVING" && this.loadPercent === 0) this.loadPercent = 60;
      if (this.status === "MOVING" && this.loadPercent > 0 && this.distanceMeters % 120 < this.definition.speedMetersPerSecond * elapsedSeconds) {
        this.status = "UNLOADING";
        this.loadPercent = 0;
      }
    } else if (this.status === "CHARGING") {
      this.batteryPercent = Math.min(100, this.batteryPercent + elapsedSeconds * 0.08);
    }

    return this.toTelemetry(timestamp);
  }

  public getState(timestamp: Date): AgvState {
    const { timestamp: _timestamp, ...state } = this.toTelemetry(timestamp);
    return {
      ...state,
      lastUpdatedAt: timestamp.toISOString(),
    };
  }

  private deriveFaultStatus(): AgvStatus {
    if (this.activeFaults.has("COMMUNICATION_LOSS")) return "OFFLINE";
    if (["JAM", "OVERHEAT", "EMERGENCY_STOP", "QUALITY_ANOMALY"].some((fault) => this.activeFaults.has(fault as FaultType))) {
      return "FAULT";
    }
    if (["QUALITY_DRIFT", "MATERIAL_SHORTAGE"].some((fault) => this.activeFaults.has(fault as FaultType))) {
      return "WARNING";
    }
    return "IDLE";
  }

  private deriveStatus(): AgvStatus {
    const faultStatus = this.deriveFaultStatus();
    if (this.activeFaults.size > 0) return faultStatus;
    if (this.manuallyStopped) return "IDLE";
    return this.status === "IDLE" ? "IDLE" : "MOVING";
  }

  private toTelemetry(timestamp: Date): AgvTelemetry {
    return {
      agvId: this.definition.id,
      name: this.definition.name,
      lineId: this.definition.lineId,
      status: this.status,
      batteryPercent: Number(this.batteryPercent.toFixed(1)),
      loadPercent: Number(this.loadPercent.toFixed(1)),
      distanceMeters: Number(this.distanceMeters.toFixed(1)),
      activeFaults: [...this.activeFaults],
      lastUpdatedAt: timestamp.toISOString(),
      timestamp: timestamp.toISOString(),
    };
  }

  private createAlarm(type: FaultType, startedAt: string): Alarm {
    return {
      id: `${this.definition.lineId}-${this.definition.id}-${type}`,
      lineId: this.definition.lineId,
      deviceId: this.definition.id,
      type,
      severity: FAULT_SEVERITY[type],
      message: FAULT_MESSAGES[type],
      startedAt,
    };
  }
}

type AgvStatus = AgvState["status"];
