export interface MockEntity {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export type ResourceStatus = 'active' | 'inactive';

export function timestamp(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  const suffixLength = Math.max(0, 40 - prefix.length - 1);
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, suffixLength);
  return `${prefix}-${suffix}`;
}
