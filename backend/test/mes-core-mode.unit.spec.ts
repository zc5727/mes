import { parseMesCoreMode } from '../src/common/mes-core-mode';

describe('MES core mode', () => {
  it('defaults to the wired legacy runtime', () => {
    expect(parseMesCoreMode(undefined)).toBe('legacy');
    expect(parseMesCoreMode(' legacy ')).toBe('legacy');
  });

  it('fails closed for migration modes that are not wired', () => {
    expect(() => parseMesCoreMode('shadow')).toThrow(
      'only MES_CORE=legacy is supported',
    );
    expect(() => parseMesCoreMode('erpnext')).toThrow(
      'only MES_CORE=legacy is supported',
    );
  });
});
