import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class ErpNextReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  employee?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  operation?: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
