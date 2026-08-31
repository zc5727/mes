export type MesControlMode = 'read-only' | 'test-control' | 'approved-control';

const CONTROL_MODES: MesControlMode[] = ['read-only', 'test-control', 'approved-control'];

/**
 * Resolves the server-owned control mode. The browser may display this value,
 * but it cannot promote itself to a higher mode.
 */
export function resolveMesControlMode(): MesControlMode {
  const configured = process.env.MES_CONTROL_MODE?.trim() as MesControlMode | undefined;
  if (configured && CONTROL_MODES.includes(configured)) return configured;
  if (process.env.NODE_ENV === 'production') {
    return process.env.MES_SIMULATOR_CONTROL_ENABLED === 'true' ? 'test-control' : 'read-only';
  }
  return 'test-control';
}

export function canUseSimulatorControl(): boolean {
  return resolveMesControlMode() === 'test-control';
}
