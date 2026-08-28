import { IsDateString, IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateOrderDto {
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
