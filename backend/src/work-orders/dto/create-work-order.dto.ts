import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateWorkOrderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  orderNo!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  productCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  productName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  orderId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  lineId!: string;

  @IsInt()
  @Min(1)
  plannedQty!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  completedQty?: number;

  @IsDateString()
  dueAt!: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}
