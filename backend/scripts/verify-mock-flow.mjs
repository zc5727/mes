import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../test/fixtures/factory-snapshot.json', import.meta.url));
const snapshot = JSON.parse(await readFile(fixturePath, 'utf8'));
const validLineStatuses = new Set(['running', 'warning', 'error', 'idle']);
const validDeviceStatuses = new Set(['running', 'warning', 'error', 'offline']);

if (!snapshot.factoryId || !snapshot.capturedAt) throw new Error('Mock snapshot metadata is incomplete');
if (!Array.isArray(snapshot.lines) || snapshot.lines.length !== 4) throw new Error('Mock flow must contain exactly four production lines');
if (!Array.isArray(snapshot.devices) || snapshot.devices.length < 4) throw new Error('Mock flow must contain devices');

const lineIds = new Set(snapshot.lines.map((line) => line.id));
if (lineIds.size !== snapshot.lines.length) throw new Error('Production line IDs must be unique');

for (const line of snapshot.lines) {
  if (!line.id || !line.name || !validLineStatuses.has(line.status)) throw new Error(`Invalid production line: ${line.id ?? '<unknown>'}`);
  if (line.completedQuantity > line.plannedQuantity) throw new Error(`Completed quantity exceeds plan: ${line.id}`);
  if (line.completionRate < 0 || line.completionRate > 100 || line.oee < 0 || line.oee > 100) {
    throw new Error(`Rate fields must be between 0 and 100: ${line.id}`);
  }
}

for (const device of snapshot.devices) {
  if (!device.id || !lineIds.has(device.lineId) || !validDeviceStatuses.has(device.status)) {
    throw new Error(`Invalid device binding: ${device.id ?? '<unknown>'}`);
  }
}

const lineStatusSummary = snapshot.lines.map((line) => `${line.id}:${line.status}`).join(', ');
console.log(`Mock flow valid: ${snapshot.lines.length} lines, ${snapshot.devices.length} devices`);
console.log(`Line status: ${lineStatusSummary}`);
