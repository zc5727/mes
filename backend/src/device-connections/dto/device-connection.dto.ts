import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { DeviceConnectionType, UnifiedDeviceEventType } from '../device-connection.types';

export class CreateDeviceConnectionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  deviceId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(['mqtt', 'http', 'webhook', 'modbus-tcp', 'opc-ua', 'mtconnect'])
  type!: DeviceConnectionType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  profileKey?: string;

  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['mqtt', 'mqtts', 'ws', 'wss', 'http', 'https', 'modbus-tcp', 'opc.tcp'],
  })
  endpoint!: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateDeviceConnectionDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  profileKey?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['mqtt', 'mqtts', 'ws', 'wss', 'http', 'https', 'modbus-tcp', 'opc.tcp'],
  })
  endpoint?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateUnifiedDeviceEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  eventId?: string;

  @IsIn(['telemetry', 'alarm', 'status', 'capabilities'])
  type!: UnifiedDeviceEventType;

  @IsOptional()
  @IsString()
  @IsDateString()
  occurredAt?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
