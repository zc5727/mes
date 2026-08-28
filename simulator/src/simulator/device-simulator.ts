import {
  Alarm,
  DeviceDefinition,
  DeviceState,
  DeviceTelemetry,
  FaultType,
} from "../types";

const FAULT_MESSAGES: Record<FaultType, string> = {
  OVERHEAT: "设备温度超过安全阈值",
  JAM: "物料输送堵塞",
  COMMUNICATION_LOSS: "设备通信中断",
  QUALITY_DRIFT: "质量参数发生漂移",
  EMERGENCY_STOP: "设备触发急停",
};

const FAULT_SEVERITY: Record<FaultType, Alarm["severity"]> = {
  OVERHEAT: "CRITICAL",
  JAM: "CRITICAL",
  COMMUNICATION_LOSS: "CRITICAL",
  QUALITY_DRIFT: "WARNING",
  EMERGENCY_STOP: "CRITICAL",
};

export class DeviceSimulator {
  private status: DeviceState["status"] = "RUNNING";
  private temperatureCelsius = 36;
  private totalCount = 0;
  private goodCount = 0;
  private defectCount = 0;
  private fractionalOutput = 0;
  private readonly activeFaults = new Set<FaultType>();

  public constructor(
    private readonly lineId: string,
    private readonly definition: DeviceDefinition,
    private readonly random: () => number,
  ) {}

  public get deviceId(): string {
    return this.definition.id;
  }

  public injectFault(type: FaultType, timestamp: Date): Alarm {
    this.activeFaults.add(type);
    this.status = "FAULT";

    return {
      id: `${this.lineId}-${this.definition.id}-${type}`,
      lineId: this.lineId,
      deviceId: this.definition.id,
      type,
      severity: FAULT_SEVERITY[type],
      message: FAULT_MESSAGES[type],
      startedAt: timestamp.toISOString(),
    };
  }

  public clearFault(type: FaultType, timestamp: Date): Alarm | undefined {
    if (!this.activeFaults.delete(type)) {
      return undefined;
    }

    if (this.activeFaults.size === 0) {
      this.status = "RUNNING";
    }

    return {
      id: `${this.lineId}-${this.definition.id}-${type}`,
      lineId: this.lineId,
      deviceId: this.definition.id,
      type,
      severity: FAULT_SEVERITY[type],
      message: FAULT_MESSAGES[type],
      startedAt: timestamp.toISOString(),
      clearedAt: timestamp.toISOString(),
    };
  }

  public start(): void {
    if (this.activeFaults.size === 0) this.status = "RUNNING";
  }

  public stop(): void {
    if (this.activeFaults.size === 0) this.status = "STOPPED";
  }

  public resetFaults(timestamp: Date): Alarm[] {
    return [...this.activeFaults]
      .map((type) => this.clearFault(type, timestamp))
      .filter((alarm): alarm is Alarm => alarm !== undefined);
  }

  public tick(lineId: string, elapsedSeconds: number, timestamp: Date): DeviceTelemetry {
    if (this.activeFaults.size > 0) {
      this.status = "FAULT";
    } else if (this.status === "RUNNING" && this.random() < 0.03) {
      this.status = "IDLE";
    } else if (this.status === "IDLE" && this.random() < 0.25) {
      this.status = "RUNNING";
    } else if (this.status === "STOPPED" && this.random() < 0.1) {
      this.status = "RUNNING";
    }

    if (this.status === "RUNNING") {
      this.fractionalOutput += (elapsedSeconds / this.definition.cycleTimeSeconds) * (0.9 + this.random() * 0.16);
      const produced = Math.floor(this.fractionalOutput);
      this.fractionalOutput -= produced;
      const defects = Array.from({ length: produced }).filter(() => this.random() < 0.02).length;
      this.totalCount += produced;
      this.defectCount += defects;
      this.goodCount += produced - defects;
      this.temperatureCelsius = Math.min(85, this.temperatureCelsius + 0.35 + this.random() * 0.7);
    } else {
      this.temperatureCelsius = Math.max(28, this.temperatureCelsius - 0.8);
    }

    if (this.activeFaults.has("OVERHEAT")) {
      this.temperatureCelsius = Math.min(98, this.temperatureCelsius + 2.5);
    }

    return {
      deviceId: this.definition.id,
      deviceName: this.definition.name,
      lineId,
      status: this.status,
      temperatureCelsius: Number(this.temperatureCelsius.toFixed(1)),
      cycleTimeSeconds: this.definition.cycleTimeSeconds,
      totalCount: this.totalCount,
      goodCount: this.goodCount,
      defectCount: this.defectCount,
      activeFaults: [...this.activeFaults],
      timestamp: timestamp.toISOString(),
    };
  }

  public getState(timestamp: Date): DeviceState {
    return {
      deviceId: this.definition.id,
      deviceName: this.definition.name,
      kind: this.definition.kind,
      status: this.status,
      temperatureCelsius: Number(this.temperatureCelsius.toFixed(1)),
      cycleTimeSeconds: this.definition.cycleTimeSeconds,
      totalCount: this.totalCount,
      goodCount: this.goodCount,
      defectCount: this.defectCount,
      activeFaults: [...this.activeFaults],
      lastUpdatedAt: timestamp.toISOString(),
    };
  }
}
