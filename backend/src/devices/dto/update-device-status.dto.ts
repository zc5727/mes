import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDeviceStatusDto {
  @IsIn(['online', 'offline', 'maintenance', 'alarm'])
  status!: 'online' | 'offline' | 'maintenance' | 'alarm';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
