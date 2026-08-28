import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class ReportWorkOrderDto {
  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  goodQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  defectQty?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  deviceId?: string;

  @IsOptional()
  @IsString()
  sourceTraceId?: string;
}
