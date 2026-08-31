import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DashboardHistoryQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lineId?: string;
}
