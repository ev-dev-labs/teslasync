import { describe, it, expect, beforeEach } from 'vitest';

import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { fmtWatts, fmtWh } from './helpers';

// Display precision and locale follow Settings for both base and scaled units.
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

  it('formats sub-kilowatt readings at Settings precision with a " W" suffix', () => {
    expect(fmtWatts(0)).toBe('0.00 W');
    expect(fmtWatts(500)).toBe('500.00 W');
    expect(fmtWatts(999)).toBe('999.00 W');
  });

  it('preserves fractional watts below the kW threshold', () => {
    expect(fmtWatts(499.4)).toBe('499.40 W');
    expect(fmtWatts(499.6)).toBe('499.60 W');
  });

  it('auto-scales to kilowatts at and above 1000 W', () => {
    expect(fmtWatts(1000)).toBe('1.00 kW');
    expect(fmtWatts(1500)).toBe('1.50 kW');
    expect(fmtWatts(2500)).toBe('2.50 kW');
  });

  it('treats 999.999 as the last watt value and 1000 as the first kW value', () => {
    // Boundary is |value| >= 1000, evaluated on the absolute magnitude.
    expect(fmtWatts(1000)).toContain('kW');
    expect(fmtWatts(999)).toContain(' W');
    expect(fmtWatts(999)).not.toContain('kW');
  });

  it('preserves sign and uses magnitude for the kW threshold on negatives', () => {
    expect(fmtWatts(-500)).toBe('-500.00 W');
    expect(fmtWatts(-1500)).toBe('-1.50 kW');
  });

  it('applies locale grouping separators to large kilowatt values', () => {
    // 1_234_567 W -> 1234.567 kW -> grouped + rounded at display precision.
    expect(fmtWatts(1_234_567)).toBe('1,234.57 kW');
  });

  it('honors a changed global decimal precision', () => {
    setGlobalPrecision(5);
    expect(fmtWatts(500)).toBe('500.00000 W');
    expect(fmtWatts(1500)).toBe('1.50000 kW');
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
    expect(fmtWh(0)).toBe('0.00 Wh');
    expect(fmtWh(750)).toBe('750.00 Wh');
    expect(fmtWh(999)).toBe('999.00 Wh');
  });

  it('auto-scales to kilowatt-hours at and above 1000 Wh with one decimal', () => {
    expect(fmtWh(1000)).toBe('1.00 kWh');
    expect(fmtWh(2500)).toBe('2.50 kWh');
    expect(fmtWh(3000)).toBe('3.00 kWh');
  });

  it('preserves sign and uses magnitude for the kWh threshold on negatives', () => {
    expect(fmtWh(-800)).toBe('-800.00 Wh');
    expect(fmtWh(-2500)).toBe('-2.50 kWh');
  });

  it('applies locale grouping separators to large kWh values', () => {
    expect(fmtWh(1_234_567)).toBe('1,234.57 kWh');
  });
});

describe('fmtWatts vs fmtWh', () => {
  it('emit distinct unit suffixes for the same magnitude', () => {
    // Same numeric magnitude, different physical dimension -> different unit.
    expect(fmtWatts(2500)).toBe('2.50 kW');
    expect(fmtWh(2500)).toBe('2.50 kWh');
    expect(fmtWatts(2500)).not.toEqual(fmtWh(2500));
  });
});
