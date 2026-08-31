import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { ReconciliationDomain, ReconciliationItem } from '../sidecar.types';

const RECONCILIATION_DOMAINS: ReconciliationDomain[] = [
  'orders',
  'work-orders',
  'reports',
];

export class ReconciliationItemDto implements ReconciliationItem {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  id!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  externalId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  plannedQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  completedQty?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  quantity?: number;
}

export class SidecarReconcileDto {
  @IsIn(RECONCILIATION_DOMAINS)
  domain!: ReconciliationDomain;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReconciliationItemDto)
  local!: ReconciliationItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReconciliationItemDto)
  fixture?: ReconciliationItemDto[];
}
