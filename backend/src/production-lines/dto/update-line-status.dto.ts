import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateLineStatusDto {
  @IsIn(['active', 'inactive', 'maintenance'])
  status!: 'active' | 'inactive' | 'maintenance';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
