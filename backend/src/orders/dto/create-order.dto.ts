import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  externalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  externalSystem?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  orderNo!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  productCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  productName!: string;

  @IsInt()
  @Min(1)
  @Max(1000000000)
  plannedQty!: number;

  @IsDateString()
  dueAt!: string;

  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority!: 'low' | 'normal' | 'high' | 'urgent';
}
