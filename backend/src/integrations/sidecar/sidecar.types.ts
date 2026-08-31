export type SidecarProvider = 'erpnext' | 'openmes';
export type ReconciliationDomain = 'orders' | 'work-orders' | 'reports';

export interface SidecarConfig {
  enabled: boolean;
  provider: SidecarProvider;
  baseUrl?: string;
  token?: string;
  timeoutMs: number;
  retries: number;
  tenantMapping: Record<string, string>;
}

export interface ReconciliationItem {
  id: string;
  externalId?: string | null;
  status?: string;
  plannedQty?: number;
  completedQty?: number;
  quantity?: number;
}

export interface ReconciliationReport {
  provider: SidecarProvider;
  tenantId: string;
  externalTenantId: string;
  domain: ReconciliationDomain;
  source: 'sidecar' | 'fixture' | 'fallback';
  degraded: boolean;
  error: string | null;
  matched: number;
  localOnly: string[];
  externalOnly: string[];
  conflicts: Array<{ key: string; fields: string[] }>;
}
