import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateMaintenanceDto {
  @IsOptional() @IsString() @MaxLength(80) alarmId?: string;
  @IsString() @MinLength(2) @MaxLength(40) lineId!: string;
  @IsString() @MinLength(2) @MaxLength(40) deviceId!: string;
  @IsIn(['inspection', 'preventive', 'repair']) type!: 'inspection' | 'preventive' | 'repair';
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() inspectionRequired?: boolean;
  @IsDateString() plannedAt!: string;
}

export class MaintenanceInspectionDto {
  @IsIn(['passed', 'failed']) result!: 'passed' | 'failed';
  @IsString() @MinLength(2) @MaxLength(200) remark!: string;
}

export class UpdateMaintenanceStatusDto {
  @IsIn(['assigned', 'in_progress', 'completed', 'cancelled']) status!: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class CreatePreventivePlanDto {
  @IsString() @MinLength(2) deviceId!: string;
  @IsString() @MinLength(2) title!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsDateString() nextDueAt!: string;
  @IsOptional() @IsInt() @Min(1) @Max(8760) intervalHours?: number;
}

export class CreateSparePartDto {
  @IsString() @MinLength(2) code!: string;
  @IsString() @MinLength(2) name!: string;
  @IsOptional() stock?: number;
  @IsOptional() minimumStock?: number;
}

export class ConsumeSparePartDto {
  @IsString() @MinLength(2) code!: string;
  @IsInt() @Min(1) @Max(1000000) quantity!: number;
  @IsOptional() @IsString() @MaxLength(120) operationId?: string;
}
