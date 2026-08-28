import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateProductionLineDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  factoryId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(60)
  type!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  targetOee?: number;

  @IsOptional()
  @IsIn(['active', 'inactive', 'maintenance'])
  status?: 'active' | 'inactive' | 'maintenance';
}
