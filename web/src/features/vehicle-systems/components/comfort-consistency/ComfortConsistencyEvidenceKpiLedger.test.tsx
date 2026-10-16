import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getFormatterPreferences,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';
import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { ComfortConsistencyDataAvailability } from './ComfortConsistencyDataAvailability';
import { ComfortConsistencyEvidenceKpiLedger } from './ComfortConsistencyEvidenceKpiLedger';
import type { ComfortConsistencyQueryState } from './types';
import { formatMetric } from '@/lib/metric-reference';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: 'km', speed: 'km/h', energy: 'kWh', power: 'kW',
    temperature: '°C', pressure: 'bar', duration: 'h',
    precision: 3, locale: 'de-DE',
  } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '€' }),
}));

const originalPreferences = getFormatterPreferences();
const state: ComfortConsistencyQueryState = {
  vehicleSelected: true,
  isLoading: false,
  isResolved: true,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};

afterEach(() => {
  cleanup();
  setGlobalLocale(originalPreferences.locale);
  setGlobalPrecision(originalPreferences.precision);
});

function renderScores(score: number | null | undefined) {
  setGlobalLocale('de-DE');
  setGlobalPrecision(3);
  const summary = { ...summarizeComfortConsistency([]), consistencyScore: score ?? null };
  if (score === undefined) Reflect.deleteProperty(summary, 'consistencyScore');
  const view = render(<>
    <ComfortConsistencyEvidenceKpiLedger summary={summary} state={state}
      formatDuration={value => String(value)} formatDelta={value => String(value)} />
    <ComfortConsistencyDataAvailability summary={summary} state={state} />
  </>);
  const metrics = ['consistency-score', 'score'].map(id => {
    const metric = view.container.querySelector(`[data-operational-metric="${id}"]`);
    return metric;
  });
  return { ...view, summary, metrics };
}

describe('comfort consistency integer score displays', () => {
  it.each([
    [0, '0'],
    [1234, '1.234'],
    [-1234, '-1.234'],
    [1234.6, '1.235'],
    [-1234.6, '-1.235'],
    [79.4, '79'],
  ])('formats measured score %s at both sites without changing the raw score', (raw, display) => {
    const { metrics, summary } = renderScores(raw);
    for (const metric of metrics) {
      expect(metric).toBeInTheDocument();
      expect(metric).toHaveAttribute('data-value-state', 'value');
      expect(metric?.querySelector('[data-operational-value]')?.textContent).toBe(display);
    }
    expect(summary.consistencyScore).toBe(raw);
  });

  it.each([
    [null, 'missing'],
    [undefined, 'missing'],
    [Number.NaN, 'invalid'],
    [Number.POSITIVE_INFINITY, 'invalid'],
    [Number.NEGATIVE_INFINITY, 'invalid'],
  ])('keeps absent or invalid score %s distinct from measured zero', (raw, valueState) => {
    const { metrics, summary } = renderScores(raw);
    for (const metric of metrics) {
      expect(metric).not.toBeInTheDocument();
    }
    expect(formatMetric('number', raw, {
      units: { distance: 'km', speed: 'km/h', energy: 'kWh', power: 'kW', temperature: '°C', pressure: 'bar', duration: 'h', precision: 3, locale: 'de-DE' },
      currency: { kind: 'symbol', value: '€' },
    }).state).toBe(valueState);
    expect(summary.consistencyScore).toBe(raw);
  });

  it('updates both score displays when locale changes, retaining integer precision', () => {
    const { metrics, summary } = renderScores(1234.6);
    act(() => {
      setGlobalLocale('en-US');
      setGlobalPrecision(5);
    });
    for (const metric of metrics) {
      expect(metric).toBeInTheDocument();
      expect(metric?.querySelector('[data-operational-value]')?.textContent).toBe('1,235');
    }
    expect(summary.consistencyScore).toBe(1234.6);
  });
});
