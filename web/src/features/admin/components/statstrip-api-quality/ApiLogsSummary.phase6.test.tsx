import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { APICallLogStats } from '@/api/types';
import {
  getFormatterPreferences, setGlobalLocale, setGlobalPrecision,
} from '@/lib/numberFormat';
import { ApiLogsSummary } from './ApiLogsSummary';

const settings = vi.hoisted(() => ({
  locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
  unit_of_pressure: 'bar', currency_symbol: '$',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (match, name: string) =>
      vars && name in vars ? String(vars[name]) : match) }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings, settingsUnavailable: false }),
}));

const snapshot: APICallLogStats = Object.freeze({
  total_calls: 2468, error_rate: 6.5, error_count: 1234, avg_duration_ms: 145.9, last_24h: 56,
  by_method: {}, by_service: {},
});
const range = {
  start: '2026-10-01T00:00:00Z', endExclusive: '2026-10-02T00:00:00Z', timezone: 'UTC',
};
let originalPreferences: ReturnType<typeof getFormatterPreferences>;

beforeEach(() => {
  originalPreferences = getFormatterPreferences();
  settings.locale = 'en-US';
  settings.decimal_precision = 2;
  setGlobalLocale(settings.locale);
  setGlobalPrecision(settings.decimal_precision);
});
afterEach(() => {
  cleanup();
  setGlobalLocale(originalPreferences.locale);
  setGlobalPrecision(originalPreferences.precision);
});

function renderStats(stats = snapshot, allTime = false) {
  return render(<MemoryRouter><ApiLogsSummary {...range}
    state={deriveDataState({ data: stats })} loading={false} allTime={allTime} /></MemoryRouter>);
}

function errorMetric(container: HTMLElement) {
  const metric = container.querySelector<HTMLElement>('[data-operational-metric="api-error-rate"]');
  if (!metric) throw new Error('Error-rate metric missing');
  return metric;
}

function emphasizedCount(container: HTMLElement) {
  return errorMetric(container).querySelector('.text-rose-700');
}

describe('API log summary supported severity and measured count', () => {
  it('keeps the measured count and severity without claiming a temporal increase', () => {
    const { container } = renderStats();
    expect(emphasizedCount(container)).toHaveTextContent('1,234');
    expect(emphasizedCount(container)).toHaveClass('dark:text-rose-300');
    expect(errorMetric(container)).not.toHaveTextContent(/increased|decreased|↑|↓/i);
    expect(errorMetric(container).querySelector('[data-operational-value]')).toHaveTextContent('6.50');
    expect(snapshot.error_count).toBe(1234);
    expect(snapshot.error_rate).toBe(6.5);
  });

  it.each([0, 4.999, 5])('does not emphasize a count when error_rate is %s', error_rate => {
    const { container } = renderStats({ ...snapshot, error_rate });
    expect(emphasizedCount(container)).toBeNull();
    expect(errorMetric(container)).not.toHaveTextContent('1,234');
  });

  it.each([5.001, 6.5])('retains the strict >5 threshold when error_rate is %s', error_rate => {
    const { container } = renderStats({ ...snapshot, error_rate });
    expect(emphasizedCount(container)).toHaveTextContent('1,234');
    expect(errorMetric(container)).not.toHaveTextContent(/increased|↑/i);
  });

  it('retains a measured zero count without replacing it or suppressing it', () => {
    const { container } = renderStats({ ...snapshot, error_count: 0 });
    expect(emphasizedCount(container)?.textContent).toBe('0');
  });

  it.each([null, undefined])('does not invent an error count for a nullish wire value %s', missing => {
    const wireStats = { ...snapshot };
    Reflect.set(wireStats, 'error_count', missing);
    const { container } = renderStats(wireStats);
    expect(emphasizedCount(container)).toBeNull();
    expect(errorMetric(container)).not.toHaveTextContent(/increased|↑/i);
  });

  it.each(['en-US', 'de-DE', 'ar-EG'])('formats the real integer count with saved locale %s', locale => {
    settings.locale = locale;
    settings.decimal_precision = 4;
    setGlobalLocale(locale);
    setGlobalPrecision(settings.decimal_precision);
    const { container } = renderStats();
    expect(emphasizedCount(container)?.textContent).toBe(new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(snapshot.error_count));
    expect(snapshot.error_count).toBe(1234);
  });

  it('reacts to saved number preferences without replacing the statistics source', () => {
    const { container } = renderStats();
    expect(emphasizedCount(container)?.textContent).toBe('1,234');
    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(4);
    });
    expect(emphasizedCount(container)?.textContent).toBe('1.234');
    expect(snapshot.error_count).toBe(1234);
  });

  it('preserves four numeric tiles, both scope explanations, and integer milliseconds', () => {
    const { container } = renderStats();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-metric="api-total-calls"]')).toHaveTextContent('2,468');
    expect(container.querySelector('[data-operational-metric="api-average-duration"] [data-operational-value]'))
      .toHaveTextContent('146 ms');
    const selected = screen.getByTestId('api-logs-range-summary');
    expect(selected).toHaveTextContent(range.start);
    expect(selected).toHaveTextContent(range.endExclusive);
    expect(selected).toHaveTextContent('UTC, exclusive end');
    expect(selected).toHaveTextContent('request-list filters do not change these metrics');
    const rolling = screen.getByTestId('api-logs-24h-summary');
    expect(rolling).toHaveTextContent('56');
    expect(rolling).toHaveTextContent('not the View settings range');
    expect(rolling).toHaveTextContent('does not record its exact bounds');
    expect(snapshot.avg_duration_ms).toBe(145.9);
  });

  it('preserves all-time scope and fixed milliseconds above one second', () => {
    const { container } = renderStats({ ...snapshot, avg_duration_ms: 1499.9 }, true);
    expect(screen.getByTestId('api-logs-range-summary')).toHaveTextContent('All time');
    expect(screen.getByTestId('api-logs-range-summary')).not.toHaveTextContent(range.start);
    expect(container.querySelector('[data-operational-metric="api-average-duration"] [data-operational-value]'))
      .toHaveTextContent('1,500 ms');
    expect(screen.getByTestId('api-logs-24h-summary')).toHaveTextContent('56');
  });

  it('keeps retained measurements, severity, and independent summaries after refresh failure', () => {
    const state = deriveDataState({ data: snapshot, error: new Error('stats refresh failed'), isFetching: true });
    const { container } = render(<MemoryRouter><ApiLogsSummary {...range}
      state={state} loading={false} allTime={false} /></MemoryRouter>);
    expect(emphasizedCount(container)).toHaveTextContent('1,234');
    expect(screen.getByRole('alert')).toHaveTextContent('stats refresh failed');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(screen.getByTestId('api-logs-range-summary')).toHaveTextContent('Refreshing source');
    expect(screen.getByTestId('api-logs-24h-summary')).toHaveTextContent('Refreshing source');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(state.data).toBe(snapshot);
  });

  it('keeps first-load and initial-failure shells without manufacturing zero or severity', () => {
    const { container, rerender } = render(<MemoryRouter><ApiLogsSummary {...range}
      state={deriveDataState<APICallLogStats>({ isLoading: true })} loading allTime={false} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByTestId('api-logs-range-summary')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    expect(emphasizedCount(container)).toBeNull();
    rerender(<MemoryRouter><ApiLogsSummary {...range}
      state={deriveDataState<APICallLogStats>({ error: new Error('stats unavailable') })}
      loading={false} allTime={false} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
    expect(screen.getByRole('alert')).toHaveTextContent('stats unavailable');
    expect(emphasizedCount(container)).toBeNull();
  });

  it('preserves measured zero tiles and both real review-details actions', () => {
    const { container } = renderStats({
      ...snapshot, total_calls: 0, error_rate: 0, error_count: 0, avg_duration_ms: 0, last_24h: 0,
    });
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(emphasizedCount(container)).toBeNull();
    fireEvent.click(within(screen.getByTestId('api-logs-range-summary'))
      .getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByTestId('api-logs-24h-summary'))
      .getByRole('button', { name: 'Review details' })).toBeInTheDocument();
  });
});
