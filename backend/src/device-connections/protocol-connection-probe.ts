import { Injectable } from '@nestjs/common';
import { connect } from 'mqtt';
import { createConnection } from 'node:net';
import type { DeviceConnectionProbe, ConnectionProbeResult } from './device-connection.types';

/** Performs bounded protocol probes; it never sends a device-control command. */
@Injectable()
export class ProtocolConnectionProbe implements DeviceConnectionProbe {
  async probe(connection: { type: 'mqtt' | 'http' | 'webhook' | 'modbus-tcp' | 'opc-ua'; endpoint: string; config: Record<string, unknown> }): Promise<ConnectionProbeResult> {
    const startedAt = Date.now();
    if (connection.type === 'mqtt') return this.probeMqtt(connection.endpoint, startedAt);
    if (connection.type === 'modbus-tcp' || connection.type === 'opc-ua') return this.probeTcp(connection.endpoint, connection.type, startedAt, connection.config);
    return this.probeHttp(connection.endpoint, startedAt, connection.config);
  }

  private probeTcp(endpoint: string, type: 'modbus-tcp' | 'opc-ua', startedAt: number, config: Record<string, unknown>): Promise<ConnectionProbeResult> {
    return new Promise((resolve) => {
      let url: URL;
      try { url = new URL(endpoint); } catch { resolve({ ok: false, latencyMs: Date.now() - startedAt, error: 'Invalid protocol endpoint', errorCode: 'INVALID_ENDPOINT' }); return; }
      const socket = createConnection({ host: url.hostname, port: Number(url.port), timeout: this.timeout(config) });
      const finish = (result: ConnectionProbeResult): void => { socket.destroy(); resolve(result); };
      socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - startedAt }));
      socket.once('timeout', () => finish({ ok: false, latencyMs: Date.now() - startedAt, error: `${type} endpoint timed out`, errorCode: 'PROTOCOL_TIMEOUT' }));
      socket.once('error', (error: Error & { code?: string }) => finish({ ok: false, latencyMs: Date.now() - startedAt, error: error.message, errorCode: error.code ?? 'PROTOCOL_CONNECTION_FAILED' }));
    });
  }

  private async probeHttp(endpoint: string, startedAt: number, config: Record<string, unknown>): Promise<ConnectionProbeResult> {
    const controller = new AbortController();
    const timeoutMs = this.timeout(config);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, { method: 'HEAD', signal: controller.signal });
      if (!response.ok && response.status !== 405) {
        return { ok: false, latencyMs: Date.now() - startedAt, error: `HTTP probe returned ${response.status}` };
      }
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error: unknown) {
      return { ok: false, latencyMs: Date.now() - startedAt, error: this.errorMessage(error) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private probeMqtt(endpoint: string, startedAt: number): Promise<ConnectionProbeResult> {
    return new Promise((resolve) => {
      let settled = false;
      const client = connect(endpoint, { connectTimeout: 4_000, reconnectPeriod: 0 });
      const finish = (result: ConnectionProbeResult): void => {
        if (settled) return;
        settled = true;
        client.end(true);
        resolve(result);
      };
      const timeout = setTimeout(() => finish({ ok: false, latencyMs: Date.now() - startedAt, error: 'MQTT probe timed out' }), 5_000);
      client.once('connect', () => {
        clearTimeout(timeout);
        finish({ ok: true, latencyMs: Date.now() - startedAt });
      });
      client.once('error', (error: Error) => {
        clearTimeout(timeout);
        finish({ ok: false, latencyMs: Date.now() - startedAt, error: error.message });
      });
    });
  }

  private timeout(config: Record<string, unknown>): number {
    const value = config.timeoutMs;
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 30_000 ? value : 4_000;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
