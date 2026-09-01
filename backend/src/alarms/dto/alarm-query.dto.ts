import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AlarmLevel, AlarmStatus } from '../alarms.service';

export class AlarmQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

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
