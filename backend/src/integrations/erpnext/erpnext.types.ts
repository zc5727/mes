export interface ErpNextConfig {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  timeoutMs: number;
  /** Maps each MES tenant to the ERPNext company used for scoped queries. */
  tenantMapping: Record<string, string>;
}

export type ErpNextIntegrationStatus = 'disabled' | 'healthy' | 'unhealthy';

export interface ErpNextHealth {
  integration: 'erpnext';
  status: ErpNextIntegrationStatus;
  configured: boolean;
  baseUrl: string | null;
  latencyMs: number | null;
  error: string | null;
}

export interface ErpNextListResult<T = Record<string, unknown>> {
  data: T[];
  source: 'erpnext' | 'memory-fallback';
  degraded: boolean;
}

export interface ErpNextBridgeResult {
  accepted: boolean;
  source: 'erpnext';
  externalId: string | null;
  data: Record<string, unknown>;
}

export interface ErpNextRequestOptions {
  method?: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}
