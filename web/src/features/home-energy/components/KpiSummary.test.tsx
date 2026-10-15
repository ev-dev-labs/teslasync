import type { ComponentProps } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalBrief } from '@/components/data-display';
import { KpiSummary } from './KpiSummary';
import type { OrchestrationResult } from '../lib/types';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const preferences = vi.hoisted(() => ({
  locale: 'en-GB',
  decimals: 2,
  settings: {
    locale: 'en-GB', decimal_precision: 2, currency_symbol: '$',
    unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
    tz_display_default: 'user', timezone_user: 'Asia/Tokyo',
  },
}));

vi.mock('@/hooks/useSettings', () => ({ useSettings: () => preferences }));
vi.unmock('@/lib/timezone');
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { id: 1, timezone: 'America/Los_Angeles' } }),
}));
vi.mock('@/components/data-display', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return {
    ...actual,
    OperationalBrief: vi.fn((props: ComponentProps<typeof actual.OperationalBrief>) =>
      <actual.OperationalBrief {...props} />),
  };
});

const startTimeIso = '2026-03-08T00:30:00Z';
const result: OrchestrationResult = {
  feasible: false,
  slots: [],
  vehicles: [
    {
      vehicleId: '1', name: 'Family car', priority: 'high',
      startingSocPct: 40, targetSocPct: 80, finalSocPct: 80,
      neededWh: 20000, deliveredWh: 20000, unmetWh: 0,
      readinessAchieved: true, departureSlot: 4, slots: [],
    },
    {
      vehicleId: '2', name: 'Second car', priority: 'medium',
      startingSocPct: 50, targetSocPct: 80, finalSocPct: 75,
      neededWh: 15000, deliveredWh: 12500, unmetWh: 2500,
      readinessAchieved: false, departureSlot: null, slots: [],
    },
  ],
  scores: {
    readiness: 50, cost: 80, selfConsumption: 75, peakShaving: 60,
    reserve: 100, stability: null, overall: 73,
  },
  violations: [],
  totals: {
    solarWh: 30000, loadWh: 12000, vehicleChargeWh: 32500,
    gridImportWh: 14500, gridExportWh: 0, curtailedWh: 0,
    totalCost: 3.25, peakGridImportW: 7200,
  },
  meta: { slotMinutes: 15, horizonSlots: 96, startTimeIso, droppedVehicleCount: 0 },
};
const props: ComponentProps<typeof KpiSummary> = {
  result, startTimeIso, horizonHours: 24, sourceStates: [], slotMinutes: 15,
};

function briefProps() {
  const calls = vi.mocked(OperationalBrief).mock.calls;
  return calls[calls.length - 1][0];
}

const originalNumberPreferences = getFormatterPreferences();
beforeEach(() => {
  setGlobalLocale('en-GB');
  setGlobalPrecision(2);
  preferences.locale = 'en-GB';
  preferences.settings.locale = 'en-GB';
  preferences.settings.tz_display_default = 'user';
  vi.mocked(OperationalBrief).mockClear();
});
afterEach(() => {
  cleanup();
  setGlobalLocale(originalNumberPreferences.locale);
  setGlobalPrecision(originalNumberPreferences.precision);
});

describe('KpiSummary planning horizon dates', () => {
  it('localizes both bounds in UTC and retains an exact 24-hour horizon across daylight saving time', () => {
    render(<KpiSummary {...props} />);
    const scope = 'Planning horizon: 8 Mar 2026, 00:30 — 9 Mar 2026, 00:30 (end exclusive)';
    expect(briefProps().scope).toBe(scope);
    expect(screen.getByTestId('home-energy-outcomes')).toHaveTextContent(scope);
    expect(screen.getByText('15.00-minute modeled slots · UTC · source coverage not established')).toBeVisible();
    expect(screen.queryByText(/2026-03-08T00:30:00Z/)).not.toBeInTheDocument();
  });

  describe('KpiSummary subscribed numeric labels', () => {
    it('updates score, percentage and interval labels on preference changes without altering measurements or physical units', () => {
      const plan = { ...result, scores: { ...result.scores, overall: 1234.6, selfConsumption: 37.256 } };
      const original = JSON.stringify(plan);
      render(<KpiSummary {...props} result={plan} slotMinutes={15.25} />);
      expect(screen.getByText('1,235')).toBeVisible();
      expect(screen.getByText('37.26%')).toBeVisible();
      expect(screen.getByText('1 / 2')).toBeVisible();
      expect(briefProps().freshness).toContain('15.25-minute');
      act(() => {
        setGlobalLocale('de-DE');
        setGlobalPrecision(3);
      });
      expect(screen.getByText('1.235')).toBeVisible();
      expect(screen.getByText('37,256%')).toBeVisible();
      expect(briefProps().freshness).toContain('15,250-minute');
      expect(briefProps().metrics.map(metric => metric.rawValue)).toEqual([1234.6, 3.25, 37.256, 7200, 1, 2500]);
      expect(JSON.stringify(plan)).toBe(original);
    });

    it.each([0, -12.75, 0.125])('preserves measured zero, signed and fractional values: %s', value => {
      const plan = { ...result, vehicles: [], scores: { ...result.scores, overall: value, selfConsumption: value } };
      render(<KpiSummary {...props} result={plan} slotMinutes={value} />);
      const metrics = briefProps().metrics;
      expect(metrics[0].valueState).toBe('value');
      expect(metrics[0].rawValue).toBe(value);
      expect(metrics[0].value).toBe(value.toLocaleString('en-GB', { maximumFractionDigits: 0 }));
      expect(metrics[2].value).toBe(`${value.toLocaleString('en-GB', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      })}%`);
      expect(metrics[4].value).toBe('0 / 0');
      expect(metrics[5].rawValue).toBe(0);
    });

    it.each([NaN, Infinity, -Infinity])('keeps invalid values distinct from measured zero: %s', value => {
      const plan = { ...result, scores: { ...result.scores, overall: value, selfConsumption: value } };
      render(<KpiSummary {...props} result={plan} slotMinutes={value} />);
      expect(briefProps().metrics[0].valueState).toBe('invalid');
      expect(briefProps().metrics[2].valueState).toBe('invalid');
      expect(briefProps().freshness).toContain('—-minute');
    });

    it.each([{ loading: true }, { unavailable: true }])('keeps missing input separate from zero: %j', state => {
      render(<KpiSummary {...props} {...state} />);
      expect(briefProps().metrics.every(metric => metric.rawValue === null && metric.valueState === 'missing')).toBe(true);
    });
  });

  it('reacts to locale changes without changing UTC business timestamps or populated metrics', () => {
    const original = JSON.stringify(result);
    const { rerender } = render(<KpiSummary {...props} />);
    expect(briefProps().metrics.map(metric => metric.rawValue))
      .toEqual([73, 3.25, 75, 7200, 1, 2500]);
    expect(screen.getByText('Planning outcomes')).toBeVisible();
    expect(screen.getByText('Modeled recommendation')).toBeVisible();
    expect(screen.getByText('73')).toBeVisible();
    expect(screen.getByText('2.50 kWh')).toBeVisible();

    preferences.locale = 'de-DE';
    preferences.settings.locale = 'de-DE';
    preferences.settings.tz_display_default = 'vehicle';
    rerender(<KpiSummary {...props} />);
    expect(briefProps().scope).toBe(
      'Planning horizon: 8. März 2026, 00:30 — 9. März 2026, 00:30 (end exclusive)',
    );
    expect(briefProps().metrics.map(metric => metric.rawValue))
      .toEqual([73, 3.25, 75, 7200, 1, 2500]);
    expect(JSON.stringify(result)).toBe(original);
    expect(result.meta.startTimeIso).toBe(startTimeIso);
  });

  it('retains formatted scope and unknown metrics while essential sources are unavailable or loading', () => {
    const { rerender } = render(<KpiSummary {...props} unavailable />);
    expect(screen.getByText('Essential source unavailable')).toBeVisible();
    expect(briefProps().metrics.every(metric => metric.rawValue === null)).toBe(true);
    expect(briefProps().scope).toContain('8 Mar 2026, 00:30');
    rerender(<KpiSummary {...props} loading />);
    expect(screen.getByText('Loading source inputs')).toBeVisible();
    expect(briefProps().metrics.every(metric => metric.rawValue === null)).toBe(true);
    expect(briefProps().scope).toContain('9 Mar 2026, 00:30 (end exclusive)');
  });
});
