import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  lineId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsIn(['opcua', 'modbus-tcp', 'mqtt', 'simulator'])
  protocol?: 'opcua' | 'modbus-tcp' | 'mqtt' | 'simulator';

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
