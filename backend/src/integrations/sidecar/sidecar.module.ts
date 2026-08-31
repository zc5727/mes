import { Module } from '@nestjs/common';
import { SidecarController } from './sidecar.controller';
import { SidecarService } from './sidecar.service';

@Module({
  controllers: [SidecarController],
  providers: [{ provide: SidecarService, useFactory: () => new SidecarService({
    enabled: process.env.SIDECAR_ENABLED === 'true', provider: process.env.SIDECAR_PROVIDER === 'openmes' ? 'openmes' : 'erpnext',
    baseUrl: process.env.SIDECAR_URL?.trim() || undefined, token: process.env.SIDECAR_TOKEN?.trim() || undefined,
    timeoutMs: boundedNumber(process.env.SIDECAR_TIMEOUT_MS, 5000, 500, 30000), retries: boundedNumber(process.env.SIDECAR_RETRIES, 2, 0, 5),
    tenantMapping: parseMapping(process.env.SIDECAR_TENANT_MAPPING),
  }) }],
  exports: [SidecarService],
})
export class SidecarModule {}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number { const parsed = Number(value); return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback; }
function parseMapping(value: string | undefined): Record<string, string> { if (!value) return {}; try { const parsed = JSON.parse(value) as Record<string, unknown>; return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')); } catch { return {}; } }
