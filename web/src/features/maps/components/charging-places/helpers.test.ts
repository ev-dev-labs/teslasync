/**
 * Pure helper tests for the Charging Places rate-conversion boundary.
 *
 * These are the ONLY place currency/kWh <-> rate_per_wh conversion math
 * lives, so correctness here is load-bearing for the whole feature: every
 * component (RateForm, PlacesTable, RateHistoryPanel, PreviewApplyPanel)
 * converts through these functions rather than reimplementing the scaling
 * inline. Also covers the half-open `[effective_from, effective_to)`
 * interval semantics mirrored from the backend's `GeofenceRate.IsActiveAt`.
 */
import { describe, it, expect } from 'vitest';
import {
  currencyPerKwhToRatePerWh,
  ratePerWhToCurrencyPerKwh,
  formatRatePerWh,
  parseRatePerWhFromCurrencyPerKwh,
  isRateOpen,
  isRateActiveAt,
} from './helpers';

describe('currencyPerKwhToRatePerWh / ratePerWhToCurrencyPerKwh', () => {
  it('converts 0.10 currency/kWh to 0.0001 currency/Wh', () => {
    expect(currencyPerKwhToRatePerWh(0.1)).toBeCloseTo(0.0001, 10);
  });

  it('converts 0.12 currency/kWh (the post-cutoff example rate) to 0.00012 currency/Wh', () => {
    expect(currencyPerKwhToRatePerWh(0.12)).toBeCloseTo(0.00012, 10);
  });

  it('is the exact inverse of ratePerWhToCurrencyPerKwh (round-trips without drift)', () => {
    for (const perKwh of [0, 0.1, 0.12, 1, 3.456, 0.0005]) {
      const ratePerWh = currencyPerKwhToRatePerWh(perKwh);
      expect(ratePerWhToCurrencyPerKwh(ratePerWh)).toBeCloseTo(perKwh, 10);
    }
  });

  it('scales by exactly 1000 in each direction (Wh <-> kWh), not any other factor', () => {
    expect(currencyPerKwhToRatePerWh(1)).toBeCloseTo(0.001, 10);
    expect(ratePerWhToCurrencyPerKwh(1)).toBeCloseTo(1000, 10);
  });

  it('maps zero to zero', () => {
    expect(currencyPerKwhToRatePerWh(0)).toBe(0);
    expect(ratePerWhToCurrencyPerKwh(0)).toBe(0);
  });
});

describe('formatRatePerWh', () => {
  it('formats a canonical rate_per_wh value as localized currency/kWh text', () => {
    // 0.00012 USD/Wh -> 0.12 USD/kWh -> "$0.120" at 3-digit precision.
    expect(formatRatePerWh(0.00012, 'USD', 'en-US')).toBe('$0.120');
  });

  it('defaults to 3 fractional digits (rates need more precision than plain money)', () => {
    const formatted = formatRatePerWh(0.0001, 'USD', 'en-US');
    expect(formatted).toBe('$0.100');
  });

  it('honors an explicit precision override', () => {
    const formatted = formatRatePerWh(0.0001234, 'USD', 'en-US', 5);
    expect(formatted).toBe('$0.12340');
  });

  it('returns "" for null/undefined/non-finite input so callers can render a placeholder', () => {
    expect(formatRatePerWh(null, 'USD', 'en-US')).toBe('');
    expect(formatRatePerWh(undefined, 'USD', 'en-US')).toBe('');
    expect(formatRatePerWh(Number.NaN, 'USD', 'en-US')).toBe('');
    expect(formatRatePerWh(Number.POSITIVE_INFINITY, 'USD', 'en-US')).toBe('');
  });
});

describe('parseRatePerWhFromCurrencyPerKwh', () => {
  it('parses a plain typed rate and converts it to rate_per_wh', () => {
    const parsed = parseRatePerWhFromCurrencyPerKwh('0.12', 'USD', 'en-US');
    expect(parsed).toBeCloseTo(0.00012, 10);
  });

  it('parses a currency-symbol-prefixed value', () => {
    const parsed = parseRatePerWhFromCurrencyPerKwh('$0.10', 'USD', 'en-US');
    expect(parsed).toBeCloseTo(0.0001, 10);
  });

  it('returns null for empty/unparseable text instead of silently coercing to 0', () => {
    expect(parseRatePerWhFromCurrencyPerKwh('', 'USD', 'en-US')).toBeNull();
    expect(parseRatePerWhFromCurrencyPerKwh('not a number', 'USD', 'en-US')).toBeNull();
  });
});

describe('isRateOpen', () => {
  it('is true when effective_to is null/undefined (the unbounded version)', () => {
    expect(isRateOpen({ effective_to: null })).toBe(true);
    expect(isRateOpen({ effective_to: undefined })).toBe(true);
  });

  it('is false once effective_to is set (a superseded version)', () => {
    expect(isRateOpen({ effective_to: '2026-08-27T00:00:00Z' })).toBe(false);
  });
});

describe('isRateActiveAt — half-open [effective_from, effective_to) interval semantics', () => {
  const oldRate = { effective_from: '2020-01-01T00:00:00Z', effective_to: '2026-08-27T00:00:00Z' };
  const newRate = { effective_from: '2026-08-27T00:00:00Z', effective_to: null };

  it('the exact cutoff instant belongs to the NEW rate, not the old one (half-open [from, to))', () => {
    const cutoff = new Date('2026-08-27T00:00:00Z');
    expect(isRateActiveAt(oldRate, cutoff)).toBe(false);
    expect(isRateActiveAt(newRate, cutoff)).toBe(true);
  });

  it('one millisecond before the cutoff still belongs to the old rate', () => {
    const justBefore = new Date('2026-08-26T23:59:59.999Z');
    expect(isRateActiveAt(oldRate, justBefore)).toBe(true);
    expect(isRateActiveAt(newRate, justBefore)).toBe(false);
  });

  it('an open-ended rate (effective_to null) is active arbitrarily far in the future', () => {
    expect(isRateActiveAt(newRate, new Date('2099-01-01T00:00:00Z'))).toBe(true);
  });

  it('is false before effective_from', () => {
    expect(isRateActiveAt(oldRate, new Date('2019-01-01T00:00:00Z'))).toBe(false);
  });

  it('defaults `at` to now when omitted', () => {
    const alwaysOpenRate = { effective_from: '2000-01-01T00:00:00Z', effective_to: null };
    expect(isRateActiveAt(alwaysOpenRate)).toBe(true);
  });
});
