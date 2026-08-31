import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateMaterialDto { @IsString() @MinLength(2) code!: string; @IsString() @MinLength(1) name!: string; @IsString() @MinLength(1) unit!: string; }
export class CreateLocationDto { @IsString() @MinLength(2) warehouseCode!: string; @IsString() @MinLength(2) locationCode!: string; }
export class StockReceiptDto { @IsString() @MinLength(2) materialCode!: string; @IsString() @MinLength(2) batchNo!: string; @IsString() @MinLength(2) locationCode!: string; @IsNumber() @Min(0.000001) quantity!: number; @IsOptional() @IsString() @MinLength(2) traceId?: string; @IsOptional() @IsString() @MinLength(2) idempotencyKey?: string; }
export class MaterialIssueDto extends StockReceiptDto { @IsOptional() @IsString() workOrderId?: string; }
export class StockCountDto { @IsString() @MinLength(2) materialCode!: string; @IsString() @MinLength(2) batchNo!: string; @IsString() @MinLength(2) locationCode!: string; @IsNumber() @Min(0) countedQuantity!: number; @IsOptional() @IsString() @MinLength(2) idempotencyKey?: string; }
export class ListInventoryQuery {
  @IsOptional() @IsString() factoryId?: string;
  @IsOptional() @IsString() materialCode?: string;
  @IsOptional() @IsString() batchNo?: string;
}
