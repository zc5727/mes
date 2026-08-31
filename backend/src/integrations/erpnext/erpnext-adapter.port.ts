export type ErpNextAdapterMode = 'live' | 'shadow';

export interface ErpNextAdapterHealth {
  mode: ErpNextAdapterMode;
  status: 'disabled' | 'shadow' | 'healthy' | 'unhealthy';
  configured: boolean;
  error: string | null;
}

export interface ErpNextAdapterListResult {
  data: Array<Record<string, unknown>>;
  source: 'erpnext' | 'shadow';
  degraded: boolean;
}

export interface ErpNextAdapterReportResult {
  accepted: boolean;
  source: 'erpnext' | 'shadow';
  externalId: string | null;
  mode: ErpNextAdapterMode;
  data: Record<string, unknown>;
  reason?: string;
}

/**
 * Stable boundary for ERPNext read projections and Job Card reporting.
 * A live HTTP adapter and the shadow adapter must implement the same port;
 * callers must inspect `mode` and never treat shadow output as upstream state.
 */
export interface ErpNextAdapterPort {
  readonly mode: ErpNextAdapterMode;
  health(): Promise<ErpNextAdapterHealth>;
  list(tenantId: string, resource: string): Promise<ErpNextAdapterListResult>;
  report(tenantId: string, workOrderId: string, payload: Record<string, unknown>): Promise<ErpNextAdapterReportResult>;
}

/**
 * Local fixture adapter for contract testing and demonstrations. It never
 * performs HTTP requests and never claims that ERPNext accepted a report.
 */
export class ErpNextShadowAdapter implements ErpNextAdapterPort {
  readonly mode = 'shadow' as const;
  private readonly fixtures: Readonly<Record<string, Readonly<Record<string, Array<Record<string, unknown>>>>>>;
  private readonly proposals: Array<{ tenantId: string; workOrderId: string; payload: Record<string, unknown> }> = [];

  constructor(fixtures: Readonly<Record<string, Readonly<Record<string, Array<Record<string, unknown>>>>>> = {}) {
    this.fixtures = fixtures;
  }

  async health(): Promise<ErpNextAdapterHealth> {
    return { mode: 'shadow', status: 'shadow', configured: false, error: 'shadow_only_no_external_connection' };
  }

  async list(tenantId: string, resource: string): Promise<ErpNextAdapterListResult> {
    const data = this.fixtures[tenantId]?.[resource] ?? [];
    return { data: data.map((item) => ({ ...item })), source: 'shadow', degraded: true };
  }

  async report(tenantId: string, workOrderId: string, payload: Record<string, unknown>): Promise<ErpNextAdapterReportResult> {
    this.proposals.push({ tenantId, workOrderId, payload: { ...payload } });
    return {
      accepted: false,
      source: 'shadow',
      externalId: null,
      mode: 'shadow',
      data: { workOrderId, ...payload },
      reason: 'shadow_only_no_external_write',
    };
  }

  getProposals(): Array<{ tenantId: string; workOrderId: string; payload: Record<string, unknown> }> {
    return this.proposals.map((item) => ({ ...item, payload: { ...item.payload } }));
  }
}
