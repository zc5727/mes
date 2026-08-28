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
  return `${prefix}-${crypto.randomUUID()}`;
}
