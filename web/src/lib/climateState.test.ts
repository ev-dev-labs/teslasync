import { describe, expect, it } from 'vitest';
import { resolveHvacActive } from './climateState';

describe('resolveHvacActive', () => {
  it('lets any explicit active signal take precedence', () => {
    expect(resolveHvacActive(true, false)).toBe(true);
    expect(resolveHvacActive(false, true)).toBe(true);
  });

  it('preserves explicit off and unknown states', () => {
    expect(resolveHvacActive(false, null)).toBe(false);
    expect(resolveHvacActive(null, false)).toBe(false);
    expect(resolveHvacActive(null, undefined)).toBeNull();
  });

  it('rejects non-boolean runtime payloads', () => {
    expect(resolveHvacActive('On', 1)).toBeNull();
  });
});
