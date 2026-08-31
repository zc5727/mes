import type { IngestDeviceEventDto } from '../../mqtt/dto/ingest-device-event.dto';

/** Boundary for a simulated or real Modbus/OPC UA server adapter. */
export interface ProtocolGatewayAdapter {
  readonly protocol: 'modbus-tcp' | 'opc-ua';
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readTelemetry(): Promise<IngestDeviceEventDto[]>;
}

/** Test harness contract; production adapters must map points into the common event DTO. */
export interface SimulatedProtocolServer extends ProtocolGatewayAdapter {
  injectPoint(deviceId: string, point: string, value: number | string | boolean): void;
}
