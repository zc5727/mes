import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMaintenanceDto {
  @IsString() @MinLength(2) @MaxLength(40) lineId!: string;
  @IsString() @MinLength(2) @MaxLength(40) deviceId!: string;
  @IsIn(['inspection', 'preventive', 'repair']) type!: 'inspection' | 'preventive' | 'repair';
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsDateString() plannedAt!: string;
}

export class UpdateMaintenanceStatusDto {
  @IsIn(['assigned', 'in_progress', 'completed', 'cancelled']) status!: 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
