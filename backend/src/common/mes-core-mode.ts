export type MesCoreMode = 'legacy';

/**
 * Accept only the runtime mode that is actually wired in this repository.
 * Future migration modes must not silently execute the legacy write path.
 */
export function parseMesCoreMode(value: string | undefined): MesCoreMode {
  const mode = value?.trim().toLowerCase() || 'legacy';
  if (mode !== 'legacy') {
    throw new Error(
      `MES_CORE=${mode} is not wired; only MES_CORE=legacy is supported`,
    );
  }
  return 'legacy';
}
