import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fmtNumber, getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { analyzeShareCard } from '../../lib/shareCard';
import { ShareCardAccountingIdentities } from './ShareCardAccountingIdentities';
import type { ShareCardDisplay, ShareCardQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));

const originalPreferences = getFormatterPreferences();
afterEach(() => {
  setGlobalPrecision(originalPreferences.precision);
  setGlobalLocale(originalPreferences.locale);
});

const state: ShareCardQueryState = {
  enabled: true, hasData: true, isInitialLoading: false, isInitialPaused: false,
  initialError: null, isResolved: true, isRefreshing: false,
  cachedRefreshError: null, cachedRefreshPaused: false, onRetry: vi.fn(),
};
const display: ShareCardDisplay = {
  distanceUnit: 'mi', durationUnit: 'h', energyUnit: 'kWh',
  formatNumber: fmtNumber,
  formatDistance: fmtNumber, formatDuration: fmtNumber, formatEnergy: fmtNumber,
  formatSpeed: fmtNumber, formatTemperature: fmtNumber,
  formatEfficiency: fmtNumber, formatPercent: fmtNumber, formatMonth: value => value,
  distanceValue: value => value / 1609.344,
  durationValue: value => value / 3600, energyValue: value => value / 1000,
};

function populatedAnalysis() {
  return analyzeShareCard([{
    id: 1, start_ts: '2026-07-03T12:00:00Z',
    distance_m: 2500.123456789, duration_s: 400.123456789,
    energy_used_wh: 500, regen_energy_wh: 20,
    avg_speed_mps: 6.25, max_speed_mps: 12, outside_temp_avg_c: 17,
  }], {
    startLabel: '2026-07-01', endLabel: '2026-07-31',
    startInstant: '2026-07-01T00:00:00Z',
    endInstantExclusive: '2026-08-01T00:00:00Z', timezone: 'UTC',
  });
}

describe('ShareCardAccountingIdentities diagnostic precision', () => {
  it.each([0, 2])('keeps tolerance and signed residuals visible at preference precision %s', precision => {
    setGlobalPrecision(precision);
    setGlobalLocale('en-US');
    const analysis = populatedAnalysis();
    analysis.identities = analysis.identities.map(check =>
      check.id === 'distribution.distanceTotal'
        ? { ...check, actual: check.expected + 0.000001000001, residual: 0.000001000001, passes: false }
        : check.id === 'distribution.durationTotal'
          ? { ...check, actual: check.expected - 0.0000005, residual: -0.0000005, passes: true }
          : check);
    const before = structuredClone(analysis);
    render(<ShareCardAccountingIdentities analysis={analysis} state={state} display={display} />);

    const distance = screen.getByRole('table', { name: 'Distance-band SI totals reconcile' });
    expect(within(distance).getByText('0.000001000001 / 0.000001000000')).toBeInTheDocument();
    expect(within(distance).getByText('2,500.123456789000')).toBeInTheDocument();
    expect(within(distance).getByText('2,500.123457789001')).toBeInTheDocument();
    expect(screen.getByText('Outside tolerance')).toBeInTheDocument();
    const duration = screen.getByRole('table', { name: 'Duration-band SI totals reconcile' });
    expect(within(duration).getByText('-0.000000500000 / 0.000001000000')).toBeInTheDocument();
    expect(analysis).toEqual(before);
    expect(getFormatterPreferences()).toEqual({ precision, locale: 'en-US' });
  });

  it('preserves populated count identities and locale and higher precision preferences', () => {
    setGlobalPrecision(14);
    setGlobalLocale('de-DE');
    const analysis = populatedAnalysis();
    render(<ShareCardAccountingIdentities analysis={analysis} state={state} display={display} />);

    expect(screen.getAllByRole('table')).toHaveLength(analysis.identities.length);
    expect(screen.getAllByText('Balances')).toHaveLength(analysis.identities.length);
    const counts = screen.getByRole('table', { name: 'Terminal dispositions sum to returned rows' });
    expect(within(counts).getAllByText('1,00000000000000')).toHaveLength(2);
    expect(within(counts).getByText('0,00000000000000 / 0,00000000000000')).toBeInTheDocument();
    const distance = screen.getByRole('table', { name: 'Distance-band SI totals reconcile' });
    expect(within(distance).getByText('0,00000000000000 / 0,00000100000000')).toBeInTheDocument();
    expect(getFormatterPreferences()).toEqual({ precision: 14, locale: 'de-DE' });
  });
});
