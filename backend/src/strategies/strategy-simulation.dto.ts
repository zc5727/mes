import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

const DEVICE_STATUSES = ['online', 'offline', 'maintenance', 'alarm'] as const;
const WORK_ORDER_STATUSES = ['released', 'running', 'paused'] as const;

export class StrategyLineDto {
  @IsString()
  id!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  capacityPerHour!: number;

  @IsBoolean()
  active!: boolean;
}

export class StrategyDeviceDto {
  @IsString()
  id!: string;

  @IsString()
  lineId!: string;

  @IsIn(DEVICE_STATUSES)
  status!: (typeof DEVICE_STATUSES)[number];

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  capacityPerHour!: number;
}

export class StrategyWorkOrderDto {
  @IsString()
  id!: string;

  @IsString()
  lineId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  remainingQty!: number;

  @IsDateString()
  dueAt!: string;

  @Type(() => Number)
  @IsNumber()
  priority!: number;

  @IsIn(WORK_ORDER_STATUSES)
  status!: (typeof WORK_ORDER_STATUSES)[number];
}

export class MaterialShortageDto {
  @IsString()
  materialCode!: string;

  @IsArray()
  @IsString({ each: true })
  affectedWorkOrderIds!: string[];
}

export class StrategySimulationDto {
  @IsDateString()
  timestamp!: string;

  @IsOptional()
  @IsString()
  factoryId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrategyLineDto)
  lines!: StrategyLineDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrategyDeviceDto)
  devices!: StrategyDeviceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StrategyWorkOrderDto)
  workOrders!: StrategyWorkOrderDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MaterialShortageDto)
  materialShortages?: MaterialShortageDto[];
}
