import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateWorkOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  productName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  lineId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  plannedQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  completedQty?: number;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}
