import { createHash } from "node:crypto";

export type ReplayMessageKind = "telemetry" | "alarm" | "connection";
export type ReplayConnectionState = "CONNECTED" | "DISCONNECTED";
export type ReplayDeviceStatus = "RUNNING" | "IDLE" | "WARNING" | "STOPPED" | "FAULT" | "OFFLINE";
export type ReplayFaultType =
  | "MATERIAL_SHORTAGE"
  | "QUALITY_ANOMALY"
  | "JAM"
  | "OVERHEAT"
  | "COMMUNICATION_LOSS"
  | "QUALITY_DRIFT"
  | "EMERGENCY_STOP";

export interface ReplayMessage {
  messageId: string;
  tenantId: string;
  lineId?: string;
  deviceId?: string;
  kind: ReplayMessageKind;
  sequence: number;
  occurredAt: string;
  status?: ReplayDeviceStatus;
  activeFaults?: ReplayFaultType[];
  connection?: "DISCONNECTED" | "RECONNECTED" | "RESTARTED";
}

export interface ReplayDeviceState {
  tenantId: string;
  lineId: string;
  deviceId: string;
  status: ReplayDeviceStatus;
  activeFaults: ReplayFaultType[];
  lastSequence: number;
  lastOccurredAt: string;
}

export interface ReplayResult {
  connection: ReplayConnectionState;
  restartCount: number;
  acceptedMessageIds: string[];
  duplicateMessageIds: string[];
  staleMessageIds: string[];
  ignoredWhileDisconnected: string[];
  devices: ReplayDeviceState[];
  lineStatuses: Record<string, ReplayDeviceStatus>;
  replayFingerprint: string;
}

interface MutableDeviceState extends ReplayDeviceState {}

export function replayOperationalMessages(messages: ReplayMessage[]): ReplayResult {
  const acceptedMessageIds: string[] = [];
  const duplicateMessageIds: string[] = [];
  const staleMessageIds: string[] = [];
  const ignoredWhileDisconnected: string[] = [];
  const devices = new Map<string, MutableDeviceState>();
  const connectionByTenant = new Map<string, ReplayConnectionState>();
  let restartCount = 0;

  for (const message of messages) {
    validateMessage(message);
    const connection = connectionByTenant.get(message.tenantId) ?? "CONNECTED";
    if (message.kind === "connection") {
      if (message.connection === "DISCONNECTED") {
        connectionByTenant.set(message.tenantId, "DISCONNECTED");
        markTenantOffline(devices, message.tenantId, message.occurredAt);
      } else if (message.connection === "RECONNECTED") {
        connectionByTenant.set(message.tenantId, "CONNECTED");
      } else if (message.connection === "RESTARTED") {
        connectionByTenant.set(message.tenantId, "CONNECTED");
        restartCount += 1;
      }
      acceptedMessageIds.push(message.messageId);
      continue;
    }

    if (connection === "DISCONNECTED") {
      ignoredWhileDisconnected.push(message.messageId);
      continue;
    }

    const key = deviceKey(message);
    const current = devices.get(key);
    if (current && message.sequence <= current.lastSequence) {
      (message.sequence === current.lastSequence && message.occurredAt === current.lastOccurredAt
        ? duplicateMessageIds
        : staleMessageIds).push(message.messageId);
      continue;
    }
    if (current && Date.parse(message.occurredAt) < Date.parse(current.lastOccurredAt)) {
      staleMessageIds.push(message.messageId);
      continue;
    }

    const next: MutableDeviceState = {
      tenantId: message.tenantId,
      lineId: message.lineId as string,
      deviceId: message.deviceId as string,
      status: message.status ?? current?.status ?? "IDLE",
      activeFaults: [...(message.activeFaults ?? current?.activeFaults ?? [])],
      lastSequence: message.sequence,
      lastOccurredAt: message.occurredAt,
    };
    devices.set(key, next);
    acceptedMessageIds.push(message.messageId);
  }

  const connectionStates = [...connectionByTenant.values()];
  const connection = connectionStates.includes("DISCONNECTED") ? "DISCONNECTED" : "CONNECTED";
  const lineStatuses = deriveLineStatuses([...devices.values()]);
  const result = {
    connection,
    restartCount,
    acceptedMessageIds,
    duplicateMessageIds,
    staleMessageIds,
    ignoredWhileDisconnected,
    devices: [...devices.values()].sort((left, right) => deviceKey(left).localeCompare(deviceKey(right))),
    lineStatuses,
  } satisfies Omit<ReplayResult, "replayFingerprint">;

  return {
    ...result,
    replayFingerprint: createHash("sha256").update(JSON.stringify(result)).digest("hex"),
  };
}

function markTenantOffline(devices: Map<string, MutableDeviceState>, tenantId: string, occurredAt: string): void {
  for (const device of devices.values()) {
    if (device.tenantId !== tenantId) continue;
    device.status = "OFFLINE";
    device.lastOccurredAt = occurredAt;
  }
}

function deriveLineStatuses(devices: ReplayDeviceState[]): Record<string, ReplayDeviceStatus> {
  const grouped = new Map<string, ReplayDeviceState[]>();
  for (const device of devices) grouped.set(device.lineId, [...(grouped.get(device.lineId) ?? []), device]);
  return Object.fromEntries([...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([lineId, lineDevices]) => {
    const status: ReplayDeviceStatus = lineDevices.some((device) => device.status === "FAULT")
      ? "FAULT"
      : lineDevices.some((device) => device.status === "OFFLINE")
        ? "OFFLINE"
        : lineDevices.some((device) => device.status === "WARNING")
          ? "WARNING"
          : lineDevices.every((device) => device.status === "STOPPED")
            ? "STOPPED"
            : lineDevices.some((device) => device.status === "RUNNING") ? "RUNNING" : "IDLE";
    return [lineId, status];
  }));
}

function deviceKey(message: ReplayMessage | ReplayDeviceState): string {
  return `${message.tenantId}/${message.lineId}/${message.deviceId}`;
}

function validateMessage(message: ReplayMessage): void {
  if (!message.messageId || !message.tenantId || !Number.isInteger(message.sequence) || message.sequence < 0) {
    throw new Error("replay message requires messageId, tenantId and a non-negative integer sequence");
  }
  if (Number.isNaN(Date.parse(message.occurredAt))) throw new Error(`invalid occurredAt for '${message.messageId}'`);
  if (message.kind === "connection") {
    if (!message.connection) throw new Error(`connection message '${message.messageId}' requires connection`);
    return;
  }
  if (!message.lineId || !message.deviceId) throw new Error(`message '${message.messageId}' requires lineId and deviceId`);
  if (message.kind === "telemetry" && !message.status) throw new Error(`telemetry '${message.messageId}' requires status`);
}
