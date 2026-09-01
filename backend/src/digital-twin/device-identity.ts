import type { Device } from '../devices/devices.service';

export interface DeviceIdentity {
  canonicalId: string;
  sourceId: string;
}

export interface SimulatorDeviceCatalogEntry extends DeviceIdentity {
  lineId: string;
  name: string;
}

const SIMULATOR_DEVICE_ALIASES: Record<string, string> = {
  'line-cnc/cnc-01': 'device-cnc-01',
  'line-cnc/cnc-02': 'device-cnc-02',
  'line-cnc/cnc-03': 'device-cnc-03',
  'line-assembly/asm-01': 'device-assembly-01',
  'line-assembly/asm-02': 'device-assembly-02',
  'line-assembly/asm-03': 'device-assembly-03',
  'line-welding/weld-01': 'device-welding-01',
  'line-welding/weld-02': 'device-welding-02',
  'line-welding/weld-03': 'device-welding-03',
  'line-vision/vision-01': 'device-vision-01',
  'line-vision/vision-02': 'device-vision-02',
  'line-vision/vision-03': 'device-vision-03',
};

const SOURCE_BY_CANONICAL_ID = new Map(
  Object.entries(SIMULATOR_DEVICE_ALIASES).map(([key, canonicalId]) => [canonicalId, key.split('/')[1]]),
);

export const SIMULATOR_DEVICE_CATALOG: SimulatorDeviceCatalogEntry[] = [
  ['line-cnc', ['cnc-01', 'cnc-02', 'cnc-03']],
  ['line-assembly', ['asm-01', 'asm-02', 'asm-03']],
  ['line-welding', ['weld-01', 'weld-02', 'weld-03']],
  ['line-vision', ['vision-01', 'vision-02', 'vision-03']],
].flatMap(([lineId, sourceIds]) => (sourceIds as string[]).map((sourceId) => {
  const identity = resolveSimulatorIdentity(lineId as string, sourceId);
  return { ...identity, lineId: lineId as string, name: sourceId.toUpperCase() };
}));

/**
 * Identity contract for the twin:
 * - canonicalId is the stable MES identity used by REST consumers;
 * - sourceId is the simulator/gateway identity carried by telemetry;
 * - unknown source devices receive a deterministic, non-colliding fallback.
 */
export function resolveSimulatorIdentity(lineId: string, sourceId: string): DeviceIdentity {
  return {
    canonicalId: SIMULATOR_DEVICE_ALIASES[`${lineId}/${sourceId}`] ?? `sim-${normalize(lineId)}-${normalize(sourceId)}`,
    sourceId,
  };
}

export function resolveLedgerIdentity(device: Device): DeviceIdentity {
  return {
    canonicalId: device.id,
    sourceId: SOURCE_BY_CANONICAL_ID.get(device.id) ?? device.id,
  };
}

/** Convert a canonical MES device id to the source id expected by the simulator. */
export function resolveSimulatorSourceId(lineId: string, deviceId: string): string {
  const knownSourceId = SOURCE_BY_CANONICAL_ID.get(deviceId);
  if (knownSourceId) return knownSourceId;
  const identity = resolveSimulatorIdentity(lineId, deviceId);
  return identity.canonicalId === deviceId ? identity.sourceId : deviceId;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}
