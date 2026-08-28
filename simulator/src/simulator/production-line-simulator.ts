import { calculateOee } from "../metrics/oee";
import {
  Alarm,
  DeviceTelemetry,
  FaultType,
  LineDefinition,
  LineSnapshot,
  LineStatus,
  SimulationMessage,
  TwinCommandAction,
} from "../types";
import { DeviceSimulator } from "./device-simulator";

const TOPIC_PREFIX = "mes/simulator";

export class ProductionLineSimulator {
  private plannedTimeSeconds = 0;
  private operatingTimeSeconds = 0;
  private readonly devices: DeviceSimulator[];
  private readonly alarms = new Map<string, Alarm>();

  public constructor(
    private readonly definition: LineDefinition,
    tenantId: string,
    random: () => number,
  ) {
    this.tenantId = tenantId;
    this.devices = definition.devices.map((device) => new DeviceSimulator(definition.id, device, random));
  }

  private readonly tenantId: string;

  public injectFault(deviceId: string, type: FaultType, timestamp = new Date()): Alarm {
    const device = this.findDevice(deviceId);
    const alarm = device.injectFault(type, timestamp);
    this.alarms.set(alarm.id, alarm);
    return alarm;
  }

  public clearFault(deviceId: string, type: FaultType, timestamp = new Date()): Alarm | undefined {
    const device = this.findDevice(deviceId);
    const clearedAlarm = device.clearFault(type, timestamp);
    if (clearedAlarm) {
      this.alarms.delete(clearedAlarm.id);
    }
    return clearedAlarm;
  }

  public executeDeviceAction(action: TwinCommandAction, deviceId: string, timestamp = new Date()): Alarm[] {
    const device = this.findDevice(deviceId);
    if (action === "START_DEVICE") device.start();
    if (action === "STOP_DEVICE") device.stop();
    if (action === "RESET_FAULT") {
      const cleared = device.resetFaults(timestamp);
      cleared.forEach((alarm) => this.alarms.delete(alarm.id));
      return cleared;
    }
    return [];
  }

  public executeLineAction(action: TwinCommandAction, timestamp = new Date()): Alarm[] {
    if (action === "START_LINE" || action === "STOP_LINE") {
      this.devices.forEach((device) => action === "START_LINE" ? device.start() : device.stop());
      return [];
    }

    if (action === "RESET_FAULT") {
      const cleared = this.devices.flatMap((device) => device.resetFaults(timestamp));
      cleared.forEach((alarm) => this.alarms.delete(alarm.id));
      return cleared;
    }
    return [];
  }

  public tick(elapsedSeconds: number, timestamp = new Date()): SimulationMessage[] {
    this.plannedTimeSeconds += elapsedSeconds;
    const telemetry = this.devices.map((device) => device.tick(this.definition.id, elapsedSeconds, timestamp));
    const status = this.getLineStatus(telemetry);
    if (status === "RUNNING") {
      this.operatingTimeSeconds += elapsedSeconds;
    }

    const snapshot = this.createSnapshot(status, timestamp);
    return [
      ...telemetry.map((item) => this.telemetryMessage(item)),
      this.snapshotMessage(snapshot),
    ];
  }

  public snapshot(timestamp = new Date()): LineSnapshot {
    const devices = this.devices.map((device) => device.getState(timestamp));
    return this.createSnapshot(this.getLineStatus(devices), timestamp);
  }

  private createSnapshot(status: LineStatus, timestamp: Date): LineSnapshot {
    const devices = this.devices.map((device) => device.getState(timestamp));
    const totalCount = devices.reduce((sum, device) => sum + device.totalCount, 0);
    const goodCount = devices.reduce((sum, device) => sum + device.goodCount, 0);

    return {
      lineId: this.definition.id,
      code: this.definition.code,
      name: this.definition.name,
      product: this.definition.product,
      status,
      oee: calculateOee({
        plannedTimeSeconds: this.plannedTimeSeconds,
        operatingTimeSeconds: this.operatingTimeSeconds,
        idealCycleTimeSeconds: this.definition.idealCycleTimeSeconds,
        totalCount,
        goodCount,
      }),
      devices,
      activeAlarms: [...this.alarms.values()],
      timestamp: timestamp.toISOString(),
    };
  }

  private getLineStatus(devices: Array<{ status: string }>): LineStatus {
    if (devices.some((device) => device.status === "FAULT")) return "FAULT";
    if (devices.every((device) => device.status === "STOPPED")) return "STOPPED";
    if (devices.some((device) => device.status === "RUNNING")) return "RUNNING";
    return "IDLE";
  }

  private telemetryMessage(telemetry: DeviceTelemetry): SimulationMessage {
    return {
      topic: `${TOPIC_PREFIX}/${this.tenantId}/lines/${this.definition.id}/devices/${telemetry.deviceId}/telemetry`,
      payload: { event: "device.telemetry", data: telemetry },
    };
  }

  private snapshotMessage(snapshot: LineSnapshot): SimulationMessage {
    return {
      topic: `${TOPIC_PREFIX}/${this.tenantId}/lines/${this.definition.id}/snapshot`,
      payload: {
        event: "line.snapshot",
        data: snapshot,
      },
    };
  }

  private findDevice(deviceId: string): DeviceSimulator {
    const device = this.devices.find((item) => item.deviceId === deviceId);
    if (!device) {
      throw new Error(`Unknown device '${deviceId}' in line '${this.definition.id}'`);
    }
    return device;
  }
}
