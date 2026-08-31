import { Injectable, Logger } from '@nestjs/common';
import type { ReconciliationDomain, ReconciliationItem, ReconciliationReport, SidecarConfig } from './sidecar.types';

/** Configurable read/reconcile boundary. It never replaces the local MES or controls equipment. */
@Injectable()
export class SidecarService {
  private readonly logger = new Logger(SidecarService.name);
  constructor(private readonly config: SidecarConfig) {}

  health() { return { provider: this.config.provider, enabled: this.config.enabled, configured: Boolean(this.config.baseUrl && this.config.token), source: this.config.baseUrl ? 'sidecar' : 'fixture', retries: this.config.retries, timeoutMs: this.config.timeoutMs }; }

  async reconcile(tenantId: string, domain: ReconciliationDomain, local: ReconciliationItem[], fixture?: ReconciliationItem[]): Promise<ReconciliationReport> {
    const externalTenantId = this.config.tenantMapping[tenantId] ?? tenantId;
    let external: ReconciliationItem[];
    let source: ReconciliationReport['source'];
    let error: string | null = null;
    if (fixture) {
      external = fixture;
      source = 'fixture';
    } else if (!this.config.enabled || !this.config.baseUrl || !this.config.token) {
      external = [];
      source = 'fixture';
    } else {
      try {
        external = await this.readExternal(externalTenantId, domain);
        source = 'sidecar';
      } catch (cause: unknown) {
        external = [];
        source = 'fallback';
        error = cause instanceof Error ? cause.message : String(cause);
        this.logger.warn(`Reconciliation degraded to local-only mode: ${error}`);
      }
    }
    const localMap = new Map(local.map((item) => [this.key(item), item]));
    const externalMap = new Map(external.map((item) => [this.key(item), item]));
    const localOnly = [...localMap.keys()].filter((key) => !externalMap.has(key));
    const externalOnly = [...externalMap.keys()].filter((key) => !localMap.has(key));
    const conflicts = [...localMap.keys()].filter((key) => externalMap.has(key)).map((key) => ({ key, fields: this.conflictingFields(localMap.get(key)!, externalMap.get(key)!) })).filter((item) => item.fields.length > 0);
    return {
      provider: this.config.provider, tenantId, externalTenantId, domain, source,
      degraded: source !== 'sidecar', error,
      matched: local.length - localOnly.length - conflicts.length, localOnly, externalOnly, conflicts,
    };
  }

  private async readExternal(tenantId: string, domain: ReconciliationDomain): Promise<ReconciliationItem[]> {
    if (!this.config.enabled || !this.config.baseUrl || !this.config.token) return [];
    const path = `api/v1/reconciliation/${encodeURIComponent(domain)}?tenantId=${encodeURIComponent(tenantId)}`;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${this.config.token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`sidecar returned ${response.status}`);
        const body = await response.json() as { data?: ReconciliationItem[] } | ReconciliationItem[];
        return Array.isArray(body) ? body : body.data ?? [];
      } catch (error: unknown) {
        lastError = error;
        if (attempt < this.config.retries) await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      } finally { clearTimeout(timeout); }
    }
    this.logger.warn(`Sidecar reconciliation failed after ${this.config.retries + 1} attempts`);
    throw lastError instanceof Error ? lastError : new Error('Sidecar reconciliation failed');
  }

  private key(item: ReconciliationItem): string { return item.externalId?.trim() || item.id; }
  private conflictingFields(local: ReconciliationItem, external: ReconciliationItem): string[] {
    return (['status', 'plannedQty', 'completedQty', 'quantity'] as const).filter((field) => local[field] !== undefined && external[field] !== undefined && local[field] !== external[field]);
  }
}
