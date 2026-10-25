import { describe, expect, it } from 'vitest';

import { normalizeCsvCellValue } from './csvValidation';
import { escapeCell } from './csvExport';

describe('normalizeCsvCellValue', () => {
  it('preserves CSV scalar and null types exactly', () => {
    expect(normalizeCsvCellValue(null)).toBeNull();
    expect(normalizeCsvCellValue(undefined)).toBeUndefined();
    expect(normalizeCsvCellValue('hello')).toBe('hello');
    expect(normalizeCsvCellValue(0)).toBe(0);
    expect(normalizeCsvCellValue(-12.5)).toBe(-12.5);
    expect(normalizeCsvCellValue(true)).toBe(true);
    expect(normalizeCsvCellValue(false)).toBe(false);
  });

  it('preserves JSON objects and arrays for CSV serialization', () => {
    const object = { enabled: true, count: 3 };
    const array = [1, 'two', false];
    expect(normalizeCsvCellValue(object)).toBe(object);
    expect(normalizeCsvCellValue(array)).toBe(array);
  });

  it('maps unsupported JavaScript types to the visible placeholder', () => {
    expect(normalizeCsvCellValue(() => undefined)).toBe('—');
    expect(normalizeCsvCellValue(Symbol('unsupported'))).toBe('—');
    expect(normalizeCsvCellValue(10n)).toBe('—');
  });

  it('handles NaN and Infinity as CSV numbers without coercion', () => {
    expect(normalizeCsvCellValue(Number.NaN)).toBe(Number.NaN);
    expect(normalizeCsvCellValue(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });

  it('preserves CR/LF and whitespace strings for escapeCell', () => {
    const values = ['line one\rline two', 'line one\nline two', '  padded  ', 'plain'];
    expect(escapeCell(normalizeCsvCellValue(values[0])!)).toContain('\r');
    expect(escapeCell(normalizeCsvCellValue(values[1])!)).toContain('\n');
    expect(escapeCell(normalizeCsvCellValue(values[2])!)).toBe('"  padded  "');
  });
});
