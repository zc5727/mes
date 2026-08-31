import { canUseSimulatorControl, resolveMesControlMode } from '../src/common/control-mode';

describe('MES control mode', () => {
  const original = {
    nodeEnv: process.env.NODE_ENV,
    configured: process.env.MES_CONTROL_MODE,
    simulator: process.env.MES_SIMULATOR_CONTROL_ENABLED,
  };

  afterEach(() => {
    process.env.NODE_ENV = original.nodeEnv;
    process.env.MES_CONTROL_MODE = original.configured;
    process.env.MES_SIMULATOR_CONTROL_ENABLED = original.simulator;
  });

  it('defaults development to test-control for the simulator demo', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.MES_CONTROL_MODE;
    expect(resolveMesControlMode()).toBe('test-control');
    expect(canUseSimulatorControl()).toBe(true);
  });

  it('fails closed in production unless the server explicitly enables test control', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MES_CONTROL_MODE;
    delete process.env.MES_SIMULATOR_CONTROL_ENABLED;
    expect(resolveMesControlMode()).toBe('read-only');
    expect(canUseSimulatorControl()).toBe(false);
    process.env.MES_SIMULATOR_CONTROL_ENABLED = 'true';
    expect(resolveMesControlMode()).toBe('test-control');
    expect(canUseSimulatorControl()).toBe(true);
  });

  it('honors an explicit valid server mode and rejects unknown values', () => {
    process.env.NODE_ENV = 'test';
    process.env.MES_CONTROL_MODE = 'read-only';
    expect(resolveMesControlMode()).toBe('read-only');
    process.env.MES_CONTROL_MODE = 'not-a-mode';
    expect(resolveMesControlMode()).toBe('test-control');
  });
});
