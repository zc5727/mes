import { Inject, Injectable } from '@nestjs/common';
import { ERPNEXT_CONFIG } from './erpnext.constants';
import { ErpNextClient } from './erpnext.client';
import { ErpNextError, mapErpNextError } from './erpnext.errors';
import type { ErpNextConfig, ErpNextHealth, ErpNextListResult, ErpNextBridgeResult } from './erpnext.types';

@Injectable()
export class ErpNextService {
  constructor(
    @Inject(ERPNEXT_CONFIG) private readonly config: ErpNextConfig,
    private readonly client: ErpNextClient,
  ) {}

  async health(): Promise<ErpNextHealth> {
    if (!this.client.isConfigured()) return { integration: 'erpnext', status: 'disabled', configured: false, baseUrl: this.config.baseUrl ?? null, latencyMs: null, error: 'ERPNext is not configured' };
    try {
      const result = await this.client.health();
      return { integration: 'erpnext', status: 'healthy', configured: true, baseUrl: this.config.baseUrl ?? null, latencyMs: result.latencyMs, error: null };
    } catch (error: unknown) {
      const mapped = error instanceof ErpNextError ? error.message : 'ERPNext health check failed';
      return { integration: 'erpnext', status: 'unhealthy', configured: true, baseUrl: this.config.baseUrl ?? null, latencyMs: null, error: mapped };
    }
  }

  async productionOrders(tenantId: string): Promise<ErpNextListResult> {
    return this.readResource(tenantId, 'Production Plan');
  }

  async workOrders(tenantId: string): Promise<ErpNextListResult> {
    return this.readResource(tenantId, 'Work Order');
  }

  async reports(tenantId: string): Promise<ErpNextListResult> {
    return this.readResource(tenantId, 'Job Card');
  }

  async bridgeReport(tenantId: string, workOrderId: string, report: Record<string, unknown>): Promise<ErpNextBridgeResult> {
    void tenantId;
    try {
      const response = await this.client.request<{ data?: Record<string, unknown> }>({
        method: 'POST', path: `api/resource/${encodeURIComponent('Job Card')}`, body: { work_order: workOrderId, ...report },
      });
      const data = response.data ?? response as unknown as Record<string, unknown>;
      return { accepted: true, source: 'erpnext', externalId: typeof data.name === 'string' ? data.name : null, data };
    } catch (error: unknown) {
      throw mapErpNextError(error);
    }
  }

  private async readResource(tenantId: string, resource: string): Promise<ErpNextListResult> {
    void tenantId;
    try {
      const response = await this.client.request<{ data?: Record<string, unknown>[] }>({
        path: `api/resource/${encodeURIComponent(resource)}`,
      });
      return { data: response.data ?? [], source: 'erpnext', degraded: false };
    } catch (error: unknown) {
      throw mapErpNextError(error);
    }
  }
}
