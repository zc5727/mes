import { IsIn, IsOptional } from 'class-validator';
import type { DeviceProfileProtocol } from '../device-profile.types';

export class DeviceProfileQueryDto {
  @IsOptional()
  @IsIn(['opcua', 'modbus-tcp', 'mtconnect', 'mqtt'])
  protocol?: DeviceProfileProtocol;
}
