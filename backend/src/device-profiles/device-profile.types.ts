export type DeviceProfileProtocol = 'opcua' | 'modbus-tcp' | 'mtconnect' | 'mqtt';
export type DataPointAccess = 'read' | 'write';

export interface DeviceProfileDataPoint {
  key: string;
  name: string;
  dataType: 'boolean' | 'number' | 'string';
  access: DataPointAccess;
  address: string;
  unit?: string;
  scale?: number;
}

export interface DeviceProfile {
  key: string;
  name: string;
  machineType: string;
  controller: string;
  protocol: DeviceProfileProtocol;
  modelKey: string;
  verified: boolean;
  dataPoints: DeviceProfileDataPoint[];
  faultCodes: string[];
  controlMethods: string[];
}
