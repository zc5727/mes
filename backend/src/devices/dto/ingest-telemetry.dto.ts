import { IsDateString, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class IngestTelemetryDto {
  @IsObject()
  metrics!: Record<string, number | string | boolean | null>;

  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;
}
