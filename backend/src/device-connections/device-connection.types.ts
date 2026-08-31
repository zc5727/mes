export type DeviceConnectionType = 'mqtt' | 'http' | 'webhook' | 'modbus-tcp' | 'opc-ua' | 'mtconnect';
export type DeviceConnectionStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unsupported';
export type DeviceConnectionHealthStatus = 'unknown' | 'healthy' | 'unhealthy' | 'unsupported';
export type DeviceDriverVerificationStatus = 'verified' | 'not-verified' | 'unimplemented';
export type UnifiedDeviceEventType = 'telemetry' | 'alarm' | 'status' | 'capabilities';

export interface ConnectionHealth {
  status: DeviceConnectionHealthStatus;
  checkedAt: string | null;
  latencyMs: number | null;
}

export interface DeviceConnection {
  id: string;
  tenantId: string;
  deviceId: string;
  name: string;
  type: DeviceConnectionType;
  profileKey: string | null;
  driverVerification: DeviceDriverVerificationStatus;
  endpoint: string;
  config: Record<string, unknown>;
  capabilities: string[];
  enabled: boolean;
  status: DeviceConnectionStatus;
  health: ConnectionHealth;
  lastError: string | null;
  lastErrorCode: string | null;
  lastEventAt: string | null;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedDeviceEvent {
  eventId: string;
  tenantId: string;
  connectionId: string;
  deviceId: string;
  type: UnifiedDeviceEventType;
  occurredAt: string;
  receivedAt: string;
  payload: Record<string, unknown>;
}

export interface ConnectionProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  errorCode?: string;
}

export interface DeviceConnectionProbe {
  probe(connection: Pick<DeviceConnection, 'type' | 'endpoint' | 'config'>): Promise<ConnectionProbeResult>;
}
