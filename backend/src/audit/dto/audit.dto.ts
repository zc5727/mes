import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

const AUDIT_RESULTS = ['success', 'denied', 'failure', 'pending', 'rejected'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export class CreateAuditDto {
  @IsString() @MaxLength(80) action!: string;
  @IsString() @MaxLength(80) resource!: string;
  @IsOptional() @IsString() @MaxLength(80) resourceId?: string;
  @IsOptional() @IsObject() details?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(120) operator?: string;
  @IsOptional() @IsString() @MaxLength(160) object?: string;
  @IsOptional() @IsObject() before?: Record<string, unknown> | null;
  @IsOptional() @IsObject() after?: Record<string, unknown> | null;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(120) traceId?: string;
  @IsOptional() @IsIn(AUDIT_RESULTS) result?: AuditResult;
}
export class CreateApprovalDto {
  @IsString() @MaxLength(80) resource!: string;
  @IsString() @MaxLength(80) resourceId!: string;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class ApprovalDecisionDto {
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}
