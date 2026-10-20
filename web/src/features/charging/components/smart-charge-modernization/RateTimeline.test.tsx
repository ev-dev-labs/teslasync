import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { HourlyRate } from '@/types/charging';
import { RateTimeline } from './RateTimeline';

const originalPreferences = getFormatterPreferences();
const rate = (hour: number, rate_cents = 10): HourlyRate => ({
  hour, rate_cents, tier: 'OFF_PEAK',
});
const height = (bar: HTMLElement) => (bar.lastElementChild as HTMLElement).style.height;

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  cleanup();
  setGlobalLocale(originalPreferences.locale);
  setGlobalPrecision(originalPreferences.precision);
});

describe('tariff wall-clock presentation', () => {
  it('updates labels, tooltips and accessible rows when the formatter locale changes', () => {
    const { container } = render(<RateTimeline rates={[rate(0), rate(12), rate(15)]} />);
    expect(screen.getAllByRole('img').map(bar => bar.getAttribute('aria-label'))).toEqual([
      '12:00 AM: 10.00¢ per kWh, Off-Peak',
      '12:00 PM: 10.00¢ per kWh, Off-Peak',
      '03:00 PM: 10.00¢ per kWh, Off-Peak',
    ]);
    act(() => setGlobalLocale('de-DE'));
    const bars = screen.getAllByRole('img');
    expect(bars.map(bar => bar.getAttribute('aria-label'))).toEqual([
      '00:00: 10,00¢ per kWh, Off-Peak',
      '12:00: 10,00¢ per kWh, Off-Peak',
      '15:00: 10,00¢ per kWh, Off-Peak',
    ]);
    bars.forEach((bar, index) => {
      expect(bar.title).toBe(bar.getAttribute('aria-label'));
      expect(bar).toHaveTextContent(['00:00', '12:00', '15:00'][index]);
    });
    expect(container.lastElementChild?.lastElementChild).toHaveTextContent('00:0012:0015:00');
  });

  it('preserves every bar and raw numeric cross-midnight window membership', () => {
    const rates = [0, 1, 2, 22, 23, 24, -1, 12.75].map(hour => rate(hour));
    const { rerender } = render(
      <RateTimeline rates={rates} chargeWindow={{ startHour: 22, endHour: 2 }} />,
    );
    const bars = screen.getAllByRole('img');
    expect(bars).toHaveLength(rates.length);
    expect(bars.map(bar => bar.title.includes('in charge window'))).toEqual([
      true, true, false, true, true, true, true, false,
    ]);
    expect(bars[5].title).toMatch(/^12:00 AM:/);
    expect(bars[6].title).toMatch(/^11:00 PM:/);
    expect(bars[7].title).toMatch(/^12:00 PM:/);
    expect(rates.map(row => row.hour)).toEqual([0, 1, 2, 22, 23, 24, -1, 12.75]);
    rerender(<RateTimeline rates={rates} chargeWindow={{ startHour: 1, endHour: 2 }} />);
    expect(screen.getAllByRole('img').map(bar => bar.title.includes('in charge window')))
      .toEqual([false, true, false, false, false, false, false, false]);
    rerender(<RateTimeline rates={rates} chargeWindow={{ startHour: 2, endHour: 2 }} />);
    expect(screen.getAllByRole('img').every(bar => !bar.title.includes('in charge window'))).toBe(true);
  });

  it('distinguishes missing and invalid rates from measured zero, signed and fractional rates', () => {
    const inputs: unknown[] = [null, undefined, NaN, Infinity, -Infinity, '', 'invalid', 0, -2.5, 7.25, 14.5];
    const rates = inputs.map((value, hour) => ({
      ...rate(hour), rate_cents: value,
    })) as HourlyRate[];
    render(<RateTimeline rates={rates} />);
    const bars = screen.getAllByRole('img');
    expect(bars).toHaveLength(inputs.length);
    bars.slice(0, 7).forEach(bar => {
      expect(bar.title).toContain(': —¢ per kWh');
      expect(height(bar)).toBe('0%');
    });
    expect(bars[7].title).toContain(': 0.00¢ per kWh');
    expect(height(bars[7])).toBe('5%');
    expect(bars[8].title).toContain(': -2.50¢ per kWh');
    expect(height(bars[8])).toBe('5%');
    expect(bars[9].title).toContain(': 7.25¢ per kWh');
    expect(height(bars[9])).toBe('50%');
    expect(height(bars[10])).toBe('100%');
  });

  it('does not turn missing or invalid hour coordinates into midnight', () => {
    const hours: unknown[] = [null, undefined, NaN, Infinity, -Infinity, '', 'invalid'];
    render(<RateTimeline rates={hours.map(hour => ({ ...rate(0), hour })) as HourlyRate[]} />);
    expect(screen.getAllByRole('img')).toHaveLength(hours.length);
    screen.getAllByRole('img').forEach(bar => expect(bar.title).toMatch(/^—:/));
  });

  it('retains the no-data state', () => {
    render(<RateTimeline rates={[]} />);
    expect(screen.getByText('No rate data available')).toBeInTheDocument();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });
});
