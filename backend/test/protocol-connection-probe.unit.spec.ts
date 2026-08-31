import { createServer } from 'node:net';
import { ProtocolConnectionProbe } from '../src/device-connections/protocol-connection-probe';

describe('protocol connection probe', () => {
  it.each([
    ['modbus-tcp', 'modbus-tcp://127.0.0.1:16102'],
    ['opc-ua', 'opc.tcp://127.0.0.1:16103'],
  ] as const)('reports TCP reachability for %s', async (_type, endpoint) => {
    const url = new URL(endpoint);
    const server = createServer().listen(Number(url.port), '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const result = await new ProtocolConnectionProbe().probe({ type: _type, endpoint, config: { timeoutMs: 500 } });
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('returns a diagnostic error code when an endpoint is unavailable', async () => {
    const result = await new ProtocolConnectionProbe().probe({ type: 'modbus-tcp', endpoint: 'modbus-tcp://127.0.0.1:16104', config: { timeoutMs: 200 } });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBeDefined();
  });

  it('does not pretend to implement MTConnect', async () => {
    const result = await new ProtocolConnectionProbe().probe({
      type: 'mtconnect', endpoint: 'http://127.0.0.1:5000/current', config: {},
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: 'MTConnect adapter is not implemented',
      errorCode: 'PROTOCOL_UNIMPLEMENTED',
    }));
  });
});
