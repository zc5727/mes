import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
export class CreateAuditDto {
  @IsString() @MaxLength(80) action!: string;
  @IsString() @MaxLength(80) resource!: string;
  @IsOptional() @IsString() @MaxLength(80) resourceId?: string;
  @IsOptional() @IsObject() details?: Record<string, unknown>;
}
export class CreateApprovalDto {
  @IsString() @MaxLength(80) resource!: string;
  @IsString() @MaxLength(80) resourceId!: string;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}
