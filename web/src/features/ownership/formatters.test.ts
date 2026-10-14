import { describe, expect, it } from 'vitest';
import { fromDateInput, toDateInput } from './formatters';

describe('ownership date inputs', () => {
  it.each([
    '',
    ' ',
    'not-a-date',
    '2026-13-01',
    '2026-01-32',
    '2026-02-30',
    '2025-02-29',
    '2026-04-31',
    '2026-1-01',
    '2026-01-01T12:00:00Z',
  ])('keeps empty or invalid input %j empty and blocked by required validation', (value) => {
    const wireValue = fromDateInput(value);
    expect(wireValue).toBe('');

    const input = document.createElement('input');
    input.type = 'date';
    input.required = true;
    input.value = toDateInput(wireValue);
    expect(input.value).toBe('');
    expect(input.validity.valueMissing).toBe(true);
    expect(input.checkValidity()).toBe(false);
  });

  it.each(['2026-01-01', '2024-02-29', '2026-12-31', '0099-01-01'])(
    'preserves UTC-midnight wire semantics for %s',
    (value) => {
      const wireValue = fromDateInput(value);
      expect(wireValue).toBe(`${value}T00:00:00.000Z`);
      expect(toDateInput(wireValue)).toBe(value);

      const input = document.createElement('input');
      input.type = 'date';
      input.required = true;
      input.value = toDateInput(wireValue);
      expect(input.checkValidity()).toBe(true);
    },
  );

  it('preserves the UTC date of populated wire timestamps', () => {
    expect(toDateInput('2026-01-01T00:00:00Z')).toBe('2026-01-01');
    expect(toDateInput('2026-01-01T23:30:00-02:00')).toBe('2026-01-02');
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(undefined)).toBe('');
    expect(toDateInput('invalid')).toBe('');
  });
});
