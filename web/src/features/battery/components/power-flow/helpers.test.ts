import { describe, it, expect, beforeEach } from 'vitest';

import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { fmtWatts, fmtWh } from './helpers';

// Both formatters pass an explicit decimals argument (0 for the base unit,
// 1 for the scaled unit) so global precision must NOT leak into their output.
// Locale still drives the grouping separator, so pin it to en-US for
// deterministic assertions regardless of any import-time side effects or
// sibling test files that mutate the module-scoped locale.
beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('fmtWatts', () => {
  it('renders the em-dash placeholder for nullish input', () => {
    expect(fmtWatts(null)).toBe('—');
    expect(fmtWatts(undefined)).toBe('—');
  });

  it('renders the em-dash placeholder for non-finite input (bug guard)', () => {
    // A missing signal or divide-by-zero must not masquerade as "0 W"/"0.0 kW".
    expect(fmtWatts(NaN)).toBe('—');
    expect(fmtWatts(Infinity)).toBe('—');
    expect(fmtWatts(-Infinity)).toBe('—');
  });

  it('formats sub-kilowatt readings in whole watts with a " W" suffix', () => {
    expect(fmtWatts(0)).toBe('0 W');
    expect(fmtWatts(500)).toBe('500 W');
    expect(fmtWatts(999)).toBe('999 W');
  });

  it('rounds fractional watts to whole numbers below the kW threshold', () => {
    expect(fmtWatts(499.4)).toBe('499 W');
    expect(fmtWatts(499.6)).toBe('500 W');
  });

  it('auto-scales to kilowatts at and above 1000 W with one decimal', () => {
    expect(fmtWatts(1000)).toBe('1.0 kW');
    expect(fmtWatts(1500)).toBe('1.5 kW');
    expect(fmtWatts(2500)).toBe('2.5 kW');
  });

  it('treats 999.999 as the last watt value and 1000 as the first kW value', () => {
    // Boundary is |value| >= 1000, evaluated on the absolute magnitude.
    expect(fmtWatts(1000)).toContain('kW');
    expect(fmtWatts(999)).toContain(' W');
    expect(fmtWatts(999)).not.toContain('kW');
  });

  it('preserves sign and uses magnitude for the kW threshold on negatives', () => {
    expect(fmtWatts(-500)).toBe('-500 W');
    expect(fmtWatts(-1500)).toBe('-1.5 kW');
  });

  it('applies locale grouping separators to large kilowatt values', () => {
    // 1_234_567 W -> 1234.567 kW -> grouped + rounded to 1 decimal.
    expect(fmtWatts(1_234_567)).toBe('1,234.6 kW');
  });

  it('ignores the global decimal precision (explicit decimals win)', () => {
    setGlobalPrecision(5);
    expect(fmtWatts(500)).toBe('500 W');
    expect(fmtWatts(1500)).toBe('1.5 kW');
  });
});

describe('fmtWh', () => {
  it('renders the em-dash placeholder for nullish input', () => {
    expect(fmtWh(null)).toBe('—');
    expect(fmtWh(undefined)).toBe('—');
  });

  it('renders the em-dash placeholder for non-finite input (bug guard)', () => {
    expect(fmtWh(NaN)).toBe('—');
    expect(fmtWh(Infinity)).toBe('—');
    expect(fmtWh(-Infinity)).toBe('—');
  });

  it('formats sub-kilowatt-hour readings in whole Wh with a " Wh" suffix', () => {
    expect(fmtWh(0)).toBe('0 Wh');
    expect(fmtWh(750)).toBe('750 Wh');
    expect(fmtWh(999)).toBe('999 Wh');
  });

  it('auto-scales to kilowatt-hours at and above 1000 Wh with one decimal', () => {
    expect(fmtWh(1000)).toBe('1.0 kWh');
    expect(fmtWh(2500)).toBe('2.5 kWh');
    expect(fmtWh(3000)).toBe('3.0 kWh');
  });

  it('preserves sign and uses magnitude for the kWh threshold on negatives', () => {
    expect(fmtWh(-800)).toBe('-800 Wh');
    expect(fmtWh(-2500)).toBe('-2.5 kWh');
  });

  it('applies locale grouping separators to large kWh values', () => {
    expect(fmtWh(1_234_567)).toBe('1,234.6 kWh');
  });
});

describe('fmtWatts vs fmtWh', () => {
  it('emit distinct unit suffixes for the same magnitude', () => {
    // Same numeric magnitude, different physical dimension -> different unit.
    expect(fmtWatts(2500)).toBe('2.5 kW');
    expect(fmtWh(2500)).toBe('2.5 kWh');
    expect(fmtWatts(2500)).not.toEqual(fmtWh(2500));
  });
});
