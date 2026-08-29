/** Canonical identifiers used by the MES UI. Backend aliases are kept here so
 * REST and realtime adapters cannot silently map the same object differently. */
export const lineIdMap: Record<string, string> = {
  'line-cnc': 'LINE-01',
  'line-assembly': 'LINE-02',
  'line-welding': 'LINE-03',
  'line-vision': 'LINE-04',
};

export const deviceIdMap: Record<string, string> = {
  'cnc-01': 'device-cnc-01',
  'cnc-02': 'device-cnc-02',
  'asm-01': 'device-assembly-01',
  'weld-01': 'device-welding-01',
  'vision-01': 'device-vision-01',
};

export const mapLineId = (value: string): string => lineIdMap[value] ?? value;
export const mapDeviceId = (value: string): string => deviceIdMap[value] ?? value;
