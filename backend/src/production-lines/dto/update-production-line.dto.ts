import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class UpdateProductionLineDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  factoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  targetOee?: number;

  @IsOptional()
  @IsIn(['active', 'inactive', 'maintenance'])
  status?: 'active' | 'inactive' | 'maintenance';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
