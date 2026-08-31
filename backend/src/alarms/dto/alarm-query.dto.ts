import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AlarmLevel, AlarmStatus } from '../alarms.service';

export class AlarmQueryDto {
  @IsOptional()
  @IsIn(['info', 'warning', 'critical'])
  level?: AlarmLevel;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lineId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  deviceId?: string;

  @IsOptional()
  @IsIn(['active', 'acknowledged', 'closed'])
  status?: AlarmStatus;
}
