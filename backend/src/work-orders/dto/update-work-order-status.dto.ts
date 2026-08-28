import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateWorkOrderStatusDto {
  @IsIn(['draft', 'released', 'in_progress', 'paused', 'completed', 'cancelled'])
  status!: 'draft' | 'released' | 'in_progress' | 'paused' | 'completed' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
