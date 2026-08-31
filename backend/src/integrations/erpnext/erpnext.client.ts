import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERPNEXT_CONFIG } from './erpnext.constants';
import { ErpNextError } from './erpnext.errors';
import type { ErpNextConfig, ErpNextRequestOptions } from './erpnext.types';

/** Thin REST client. ERPNext source is not embedded and no client calls a local database. */
@Injectable()
export class ErpNextClient {
  private readonly logger = new Logger(ErpNextClient.name);

  constructor(@Inject(ERPNEXT_CONFIG) private readonly config: ErpNextConfig) {}

  isConfigured(): boolean {
    return this.config.enabled && Boolean(this.config.baseUrl && this.config.apiKey && this.config.apiSecret);
  }

  async request<T>(options: ErpNextRequestOptions): Promise<T> {
    if (!this.isConfigured()) throw new ErpNextError('disabled', 'ERPNext is not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const url = `${this.config.baseUrl!.replace(/\/$/, '')}/${options.path.replace(/^\//, '')}`;
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `token ${this.config.apiKey}:${this.config.apiSecret}`,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
      const raw = await response.text();
      const body = this.parseBody(raw);
      if (!response.ok) throw this.mapResponseError(response.status, body);
      return body as T;
    } catch (error: unknown) {
      if (error instanceof ErpNextError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ErpNextError('timeout', `ERPNext request timed out after ${this.config.timeoutMs}ms`);
      }
      this.logger.error(`ERPNext request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ErpNextError('upstream', 'ERPNext is unreachable');
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<{ latencyMs: number }> {
    const startedAt = Date.now();
    await this.request<{ data: unknown }>({ path: 'api/method/frappe.auth.get_logged_user' });
    return { latencyMs: Date.now() - startedAt };
  }

  private parseBody(raw: string): unknown {
    if (!raw) return {};
    try { return JSON.parse(raw) as unknown; } catch { return { raw }; }
  }

  private mapResponseError(status: number, body: unknown): ErpNextError {
    if (status === 401 || status === 403) return new ErpNextError('unauthorized', 'ERPNext credentials rejected', status);
    if (status === 404) return new ErpNextError('not_found', 'ERPNext resource not found', status);
    return new ErpNextError('upstream', typeof body === 'object' ? 'ERPNext returned an error' : String(body), status);
  }
}
