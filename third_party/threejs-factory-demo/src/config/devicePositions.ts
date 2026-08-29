import type { VectorPoint } from '@/types/factory';

/** Layout is presentation configuration, not telemetry. Replace these values
 * per factory when the backend does not provide a position. */
export const devicePositions: Record<string, VectorPoint> = {
  'device-cnc-01': { x: -7.8, y: 0, z: -3.6 },
  'device-cnc-02': { x: -4.6, y: 0, z: -3.6 },
  'device-assembly-01': { x: -1.4, y: 0, z: -3.6 },
  'device-assembly-02': { x: 1.8, y: 0, z: -3.6 },
  'device-welding-01': { x: 4.8, y: 0, z: 3.4 },
  'device-welding-02': { x: 7.5, y: 0, z: 3.4 },
  'device-vision-01': { x: 1.8, y: 0, z: 4.4 },
  'device-vision-02': { x: -5.8, y: 0, z: 4.2 },
};

export const positionForDevice = (id: string, position?: VectorPoint): VectorPoint =>
  position ?? devicePositions[id] ?? { x: 0, y: 0, z: 0 };
