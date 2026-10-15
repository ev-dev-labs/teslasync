import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { BenchmarkMetric, BenchmarkPrivacyStatus, BenchmarkRelease, BenchmarkReleasePage } from '@/api/hooks/useBenchmarks';
import { deriveDataState } from '@/api/dataState';
import type { UnitPref } from '@/lib/unitConversion';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { MetricComparisonGrid } from '../MetricComparisonGrid';
import { PrivacyBudgetPanel } from '../PrivacyBudgetPanel';

type TranslationOptions = Record<string, unknown> & {
  defaultValue?: string;
  replace?: Record<string, unknown>;
};

const preferences = vi.hoisted(() => {
  const unitPrefs: UnitPref = {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 1,
  };
  return { unitPrefs };
});

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: string | TranslationOptions, values?: TranslationOptions) => {
      const options = typeof fallback === 'string' ? values : fallback;
      const template = typeof fallback === 'string' ? fallback : options?.defaultValue ?? key;
      const replacements = options?.replace ?? options;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(replacements?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: preferences.unitPrefs }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => {
    const fmtNumber = (value: number) => new Intl.NumberFormat(preferences.unitPrefs.locale, {
      maximumFractionDigits: preferences.unitPrefs.precision,
    }).format(value);
    return { fmtNumber, fmtPercent: (value: number) => `${fmtNumber(value)}%` };
  },
}));
vi.mock('@/hooks/useOperationalMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

const metric: BenchmarkMetric = {
  metric_name: 'degradation_pct', unit: 'pct', lower_bound: 0, upper_bound: 100,
  epsilon_spent: 0.25, noisy_cohort_size: 8, noisy_mean: 5, noisy_p25: 2,
  noisy_p75: 8, noise_scale: 1, suppressed: false, quality: 'moderate',
  target_value: 0, percentile: 100, higher_is_better: false,
};
const release: BenchmarkRelease = {
  release_id: 42, period_start: '2026-04-01', period_end: '2026-07-01',
  model_family: 'model_3', model_year_bucket: 2020, mechanism_version: 1,
  minimum_cohort_size: 5, epsilon_spent: 1, suppressed: false,
  suppression_reason: null, created_at: '2026-07-02T00:00:00Z',
  metrics: [
    metric,
    { ...metric, metric_name: 'efficiency_wh_per_km', unit: 'wh_per_km', target_value: 186, noisy_p25: 180, noisy_p75: 210 },
    { ...metric, metric_name: 'operation_reliability_pct', target_value: null, percentile: null, suppressed: true, quality: 'suppressed', higher_is_better: true },
  ],
};
const status: BenchmarkPrivacyStatus = {
  vehicle_id: 7, opted_in: true, opted_in_at: null, revoked_at: null,
  epsilon_budget: 4, epsilon_spent: 0, epsilon_remaining: 4,
  minimum_cohort_size: 5, mechanism_version: 1,
};
function show(children: ReactNode) {
  return render(<MemoryRouter>{children}</MemoryRouter>);
}
function metricElement(container: HTMLElement, id: string) {
  const element = container.querySelector(`[data-operational-metric="${id}"]`);
  expect(element).not.toBeNull();
  return element;
}

beforeEach(() => {
  vi.mocked(useOperationalMetrics).mockClear();
  preferences.unitPrefs.distance = 'km';
  preferences.unitPrefs.locale = 'en-US';
  preferences.unitPrefs.precision = 1;
});

describe('private benchmark OperationalBrief source authoring', () => {
  it('passes actual numeric measurements through the real bridge with a canonical efficiency operand', () => {
    const before = JSON.stringify(release);
    const { container } = show(<MetricComparisonGrid release={release} />);
    expect(container.querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(metricElement(container, 'degradation_pct')).toHaveAttribute('data-value-state', 'value');
    expect(metricElement(container, 'degradation_pct')).toHaveTextContent('0%');
    expect(metricElement(container, 'operation_reliability_pct')).toHaveAttribute('data-value-state', 'missing');
    expect(metricElement(container, 'operation_reliability_pct')).toHaveTextContent('Suppressed below privacy threshold');
    expect(metricElement(container, 'efficiency_wh_per_km')).toHaveTextContent('186 Wh/km');
    const raw = vi.mocked(useOperationalMetrics).mock.calls[0][0];
    expect(raw.find((item) => item.occurrenceId === 'efficiency_wh_per_km')).toMatchObject({
      metricId: 'efficiency', rawValue: 0.186,
    });
    expect(raw.find((item) => item.occurrenceId === 'degradation_pct')?.rawValue).toBe(0);
    expect(raw.find((item) => item.occurrenceId === 'operation_reliability_pct')?.rawValue).toBeNull();
    expect(JSON.stringify(release)).toBe(before);
  });

  it('keeps noisy ranges, quality, direction, eligibility, source window and uncertainty in the real drawer', () => {
    show(<MetricComparisonGrid release={release} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Private IQR 180 Wh/km–210 Wh/km');
    expect(drawer).toHaveTextContent('100th performance percentile');
    expect(drawer).toHaveTextContent('moderate');
    expect(drawer).toHaveTextContent('Suppressed below privacy threshold');
    expect(drawer).toHaveTextContent('Percentile unavailable');
    expect(drawer).toHaveTextContent('Lower source values mean better performance.');
    expect(drawer).toHaveTextContent('Higher source values mean better performance.');
    expect(drawer).toHaveTextContent('Noisy cohort size: 8; noise scale: 1.');
    expect(drawer).toHaveTextContent('not confidence scores');
    expect(drawer).toHaveTextContent('2026-04-01–2026-07-01');
    expect(drawer).toHaveTextContent('2020–2024');
    expect(drawer).toHaveTextContent('k ≥ 5');
    expect(drawer).toHaveTextContent('Release 42; mechanism version 1');
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves source Wh denomination and saved distance, locale and precision without changing raw data', () => {
    preferences.unitPrefs.distance = 'mi';
    preferences.unitPrefs.locale = 'de-DE';
    preferences.unitPrefs.precision = 2;
    const { container } = show(<MetricComparisonGrid release={release} />);
    expect(metricElement(container, 'efficiency_wh_per_km')).toHaveTextContent('299,34 Wh/mi');
    expect(vi.mocked(useOperationalMetrics).mock.calls[0][0].find(
      (item) => item.occurrenceId === 'efficiency_wh_per_km',
    )?.rawValue).toBe(0.186);
  });

  it('keeps localized noisy cohort counts and noise-scale precision in the real drawer', () => {
    preferences.unitPrefs.locale = 'de-DE';
    preferences.unitPrefs.precision = 2;
    const localizedRelease: BenchmarkRelease = {
      ...release,
      metrics: [{ ...metric, noisy_cohort_size: 1234, noise_scale: 0.125 }],
    };
    const before = JSON.stringify(localizedRelease);
    show(<MetricComparisonGrid release={localizedRelease} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Noisy cohort size: 1.234; noise scale: 0,13.');
    expect(drawer).toHaveTextContent('moderate');
    expect(drawer).toHaveTextContent('not confidence scores');
    expect(JSON.stringify(localizedRelease)).toBe(before);
  });

  it('retains measurements and original retry for failed and offline release refreshes', () => {
    const retry = vi.fn();
    const page: BenchmarkReleasePage = { items: [release], limit: 12, offset: 0 };
    const failed = deriveDataState({ data: page, error: new Error('refresh failed'), refetch: retry });
    const { container, rerender } = show(<MetricComparisonGrid release={release} source={failed} />);
    expect(screen.getByText('Retained release')).toBeInTheDocument();
    expect(metricElement(container, 'degradation_pct')).toHaveTextContent('0%');
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    const offline = deriveDataState({ data: page, fetchStatus: 'paused' });
    rerender(<MemoryRouter><MetricComparisonGrid release={release} source={offline} /></MemoryRouter>);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Retained release')).toBeInTheDocument();
    expect(metricElement(container, 'degradation_pct')).toHaveAttribute('data-value-state', 'value');
  });

  it('renders loading and absent release metrics as unknown rather than measured zero', () => {
    const { container, rerender } = show(<MetricComparisonGrid release={null} loading optedIn />);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    rerender(<MemoryRouter><MetricComparisonGrid release={null} optedIn={false} /></MemoryRouter>);
    expect(screen.getByText('Consent required')).toBeInTheDocument();
    expect(screen.getByText('No comparison released')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('does not classify non-finite targets as a real measurement', () => {
    const invalid = { ...release, metrics: [{ ...metric, target_value: Number.NaN }] };
    const { container } = show(<MetricComparisonGrid release={invalid} />);
    expect(metricElement(container, 'degradation_pct')).toHaveAttribute('data-value-state', 'invalid');
    expect(metricElement(container, 'degradation_pct')).toHaveTextContent('Expected a finite numeric measurement');
  });

  it('retains actual zero epsilon spend, cumulative scope, gauge and privacy accounting in its drawer', () => {
    const before = JSON.stringify(status);
    const { container } = show(<PrivacyBudgetPanel status={status} />);
    expect(metricElement(container, 'epsilon-spent')).toHaveAttribute('data-value-state', 'value');
    expect(metricElement(container, 'epsilon-spent')).toHaveTextContent('ε 0');
    expect(screen.getByRole('progressbar', { name: 'Differential privacy budget used' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('ε 4 remaining')).toBeInTheDocument();
    expect(screen.getByText(/not the comparison release window/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Privacy budget spent');
    expect(drawer).toHaveTextContent('ε 0');
    expect(drawer).toHaveTextContent('Reading or refreshing an existing release costs nothing.');
    expect(drawer).toHaveTextContent('not a confidence percentage');
    expect(drawer).toHaveTextContent('mechanism version 1');
    expect(JSON.stringify(status)).toBe(before);
  });

  it('does not enable participation or fabricate zero epsilon when privacy accounting fails initially', () => {
    const source = deriveDataState<BenchmarkPrivacyStatus>({ error: new Error('status unavailable') });
    const { container } = show(<PrivacyBudgetPanel status={null} source={source} />);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
    expect(screen.queryByText('ε 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Participation inactive')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
