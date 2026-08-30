import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

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
