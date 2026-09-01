import { resolveSimulatorSourceId } from '../src/digital-twin/device-identity';

describe('simulator device identity contract', () => {
  it('maps canonical MES ids to simulator source ids', () => {
    expect(resolveSimulatorSourceId('line-cnc', 'device-cnc-01')).toBe('cnc-01');
  });

  it('keeps already-source ids unchanged', () => {
    expect(resolveSimulatorSourceId('line-cnc', 'cnc-01')).toBe('cnc-01');
  });
});
