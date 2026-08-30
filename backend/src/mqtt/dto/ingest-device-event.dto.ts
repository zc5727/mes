import { IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Protocol-neutral event accepted by HTTP gateways and test harnesses. */
export class IngestDeviceEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  eventId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  deviceId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  lineId!: string;

  @IsIn(['telemetry', 'alarm.created', 'alarm.cleared'])
  eventType!: 'telemetry' | 'alarm.created' | 'alarm.cleared';

  @IsDateString()
  eventTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  traceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  gatewayId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  quality?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
