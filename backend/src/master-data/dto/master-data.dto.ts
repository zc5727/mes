import { IsArray, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateProductDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class CreateProcessDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) standardSeconds?: number;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class CreateShiftDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsISO8601() startAt!: string;
  @IsISO8601() endAt!: string;
  @IsOptional() @IsString() @MaxLength(80) supervisor?: string;
}

export class CreateCalendarDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsISO8601() date!: string;
  @IsOptional() @IsInt() @Min(0) @Max(24) plannedHours?: number;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}

export class CreateOperationDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) standardSeconds?: number;
  @IsOptional() @IsString() @MaxLength(80) workstation?: string;
  @IsOptional() @IsObject() parameters?: Record<string, unknown>;
}

export class CreateBomDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(1) @MaxLength(40) productCode!: string;
  @IsString() @MinLength(1) @MaxLength(20) version!: string;
  @IsArray() @IsObject({ each: true }) items!: Array<Record<string, unknown>>;
  @IsOptional() @IsArray() @IsString({ each: true }) operationCodes?: string[];
}

export class CreateRoutingDto {
  @IsString() @MinLength(2) @MaxLength(40) code!: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(1) @MaxLength(40) productCode!: string;
  @IsString() @MinLength(1) @MaxLength(20) version!: string;
  @IsArray() @IsString({ each: true }) operationCodes!: string[];
}

export class CreateBatchInventoryDto {
  @IsString() @MinLength(2) @MaxLength(40) materialCode!: string;
  @IsString() @MinLength(2) @MaxLength(80) batchNo!: string;
  @IsNumber() @Min(0) quantity!: number;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
}

export class BatchInventoryMovementDto {
  @IsString() @MinLength(2) @MaxLength(40) materialCode!: string;
  @IsString() @MinLength(2) @MaxLength(80) batchNo!: string;
  @IsNumber() @Min(0.000001) quantity!: number;
  @IsOptional() @IsString() @MaxLength(120) idempotencyKey?: string;
}
