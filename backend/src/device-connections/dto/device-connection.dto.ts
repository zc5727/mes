import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
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

  @IsIn(['mqtt', 'http', 'webhook'])
  type!: DeviceConnectionType;

  @IsUrl({ require_tld: false })
  endpoint!: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
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
  @IsUrl({ require_tld: false })
  endpoint?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
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
  occurredAt?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
