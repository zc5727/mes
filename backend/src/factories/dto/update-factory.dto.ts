import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateFactoryDto {
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
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  manager?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  timezone?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}
