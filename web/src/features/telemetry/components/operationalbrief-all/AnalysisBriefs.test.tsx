import type { ComponentType, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import './metricPreferencesTestSetup';
import SignalTrendPage from '../../pages/SignalTrendPage';
import SignalChangePointsPage from '../../pages/SignalChangePointsPage';
import SignalEntropyPage from '../../pages/SignalEntropyPage';
import SignalDeadbandPage from '../../pages/SignalDeadbandPage';
import SignalMutualInformationPage from '../../pages/SignalMutualInformationPage';
import { summarizeSignalTrend } from '../../lib/signalTrend';
import { summarizeSignalChangePoints } from '../../lib/signalChangePoints';
import { summarizeSignalEntropy } from '../../lib/signalEntropy';
import { analyzeSignalDeadband } from '../../lib/signalDeadband';
import { analyzeSignalMutualInformation } from '../../lib/signalMutualInformation';

const H = vi.hoisted(() => ({
  history: undefined as SignalHistoryResponse | undefined,
  error: null as Error | null,
  loading: false,
  fetching: false,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: unknown, variables?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(variables?.[name] ?? `{{${name}}}`));
  },
  i18n: { language: 'en' },
}) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => ({ data: ['NumericSignal', 'OtherSignal'], isLoading: false, error: null, refetch: vi.fn() }),
  useSignalHistory: () => ({ data: H.history, isLoading: H.loading, isFetching: H.fetching, error: H.error, refetch: vi.fn() }),
  useSignalAnalysisHistory: () => ({ data: H.history, isLoading: H.loading, isFetching: H.fetching, error: H.error, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useDataState', () => ({
  useDataState: (query: { data?: unknown; error?: Error | null; isFetching?: boolean }) => ({
    hasData: query.data !== undefined,
    fatalError: query.data === undefined ? query.error ?? null : null,
    refreshError: query.data === undefined ? null : query.error ?? null,
    isRefreshing: Boolean(query.isFetching),
    status: query.error && query.data !== undefined ? 'stale' : 'ok',
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useHiddenSeries', () => ({ useHiddenSeries: () => ({ isHidden: () => false, toggle: vi.fn() }) }));
vi.mock('@/components/layout', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/layout')>();
  return { ...actual, PageLayout: ({ children }: { children?: ReactNode }) => <main>{children}</main> };
});
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</> }));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return { ...actual, ChartContainer: ({ title }: { title: string }) => <section aria-label={title} /> };
});

const initialPreferences = getFormatterPreferences();
const samples = Array.from({ length: 32 }, (_, index) => Object.freeze({
  timestamp: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
  valueNum: 50 - index * 0.1234567 + (index % 3 === 0 ? 0.01 : 0),
}));
beforeEach(() => {
  H.history = { vehicleId: 7, signal: 'NumericSignal', from: samples[0]!.timestamp,
    to: samples.at(-1)!.timestamp, count: samples.length, data: [...samples] };
  H.error = null; H.loading = false; H.fetching = false;
  setGlobalLocale('de-DE'); setGlobalPrecision(5);
});
afterEach(() => {
  cleanup(); vi.clearAllMocks();
  setGlobalLocale(initialPreferences.locale); setGlobalPrecision(initialPreferences.precision);
});

interface AnalysisCase {
  Page: ComponentType;
  testId: string;
  signalLabel: string;
  hours: number;
  expectedRaw: () => readonly unknown[];
}
const cases: readonly AnalysisCase[] = [
  { Page: SignalTrendPage, testId: 'signal-trend-summary', signalLabel: 'Signal', hours: 168,
    expectedRaw: () => {
      const result = summarizeSignalTrend(samples);
      return [result.slopePerDay, result.mannKendall?.significant ? 'Real' : 'Not significant', result.residualSpread, result.samples];
    } },
  { Page: SignalChangePointsPage, testId: 'signal-change-points-summary', signalLabel: 'Signal', hours: 72,
    expectedRaw: () => {
      const result = summarizeSignalChangePoints(samples);
      return [result.changePoints.length, result.biggestChange?.magnitude, result.segments.length, result.samples];
    } },
  { Page: SignalEntropyPage, testId: 'signal-entropy-summary', signalLabel: 'Signal', hours: 48,
    expectedRaw: () => {
      const result = summarizeSignalEntropy(samples);
      return [result.entropyBits, result.effectiveStates, result.dominantBinFraction * 100, result.changeRate * 100];
    } },
  { Page: SignalDeadbandPage, testId: 'signal-deadband-summary', signalLabel: 'Numeric signal', hours: 24,
    expectedRaw: () => {
      const result = analyzeSignalDeadband(samples)!;
      return [result.noiseThreshold, result.redundantEmissionRatio * 100, result.recommended.threshold, result.recommended.reduction * 100];
    } },
  { Page: SignalMutualInformationPage, testId: 'signal-mutual-information-summary', signalLabel: 'Signal A', hours: 24,
    expectedRaw: () => {
      const result = analyzeSignalMutualInformation(samples, samples)!;
      return [result.alignedCount, result.mutualInformation, result.normalizedMutualInformation * 100, result.significant ? 'Detected' : 'Null-like'];
    } },
];
function selectSignals(testCase: AnalysisCase) {
  fireEvent.change(screen.getByRole('combobox', { name: testCase.signalLabel }), { target: { value: 'NumericSignal' } });
  if (testCase.Page === SignalMutualInformationPage) {
    fireEvent.change(screen.getByRole('combobox', { name: 'Signal B' }), { target: { value: 'OtherSignal' } });
  }
}

describe.each(cases)('$testId actual raw analysis adoption', testCase => {
  it('retains the exact existing algorithm operands, original precision, requested period and real drawer', () => {
    const { Page } = testCase;
    const { container } = render(<Page />);
    selectSignals(testCase);
    const brief = screen.getByTestId(testCase.testId);
    const expected = testCase.expectedRaw();
    const call = vi.mocked(useOperationalMetrics).mock.calls
      .map(args => args[0]).reverse().find(metrics => metrics.length === 4 && metrics[0]?.rawValue === expected[0]);
    expect(call?.map(metric => metric.rawValue)).toEqual(expected);
    expect(brief).toHaveTextContent(`${testCase.hours}h requested`);
    expect(brief).toHaveTextContent('not guaranteed full-window coverage');
    expect(brief).toHaveTextContent(`NumericSignal source bounds: ${samples[0]!.timestamp} → ${samples.at(-1)!.timestamp}`);
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-role="metric-card"]')).toHaveLength(0);
    const values = [...brief.querySelectorAll('[data-operational-value]')];
    if (testCase.Page === SignalTrendPage) {
      expect(values[0]).toHaveTextContent('-');
      expect(values[0]).toHaveTextContent('/day');
      expect(values[0]).toHaveTextContent(',');
      expect(brief).toHaveTextContent('/hour');
      expect(brief).toHaveTextContent('tau');
    }
    if (testCase.Page === SignalEntropyPage) expect(values[0]).toHaveTextContent('bits');
    if (testCase.Page === SignalMutualInformationPage) {
      expect(brief).toHaveTextContent('robust cadence');
      expect(brief).toHaveTextContent('95% null threshold');
    }
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    for (const metric of call ?? []) expect(within(drawer).getByText(metric.label!)).toBeInTheDocument();
    expect(drawer).toHaveTextContent(testCase.Page === SignalMutualInformationPage
      ? 'Two independently queried signal histories' : 'Selected signal history');
    expect(drawer).toHaveTextContent(samples[0]!.timestamp);
    expect(samples[1]!.valueNum).toBe(50 - 0.1234567);
  });

  it('keeps unchosen and unavailable history unknown; never claims a successful zero analysis', () => {
    const { Page } = testCase;
    H.history = undefined;
    const view = render(<Page />);
    const brief = screen.getByTestId(testCase.testId);
    expect([...brief.querySelectorAll('[data-operational-metric]')].every(metric => metric.getAttribute('data-value-state') === 'missing')).toBe(true);
    selectSignals(testCase);
    H.error = new Error('history unavailable');
    view.rerender(<Page />);
    expect(brief).toHaveTextContent('Source unavailable');
    expect([...brief.querySelectorAll('[data-operational-value]')].every(value => value.textContent === '—')).toBe(true);
  });

  it('retains all returned measurements when refresh fails, without hiding selectors or charts', () => {
    const { Page } = testCase;
    const view = render(<Page />);
    selectSignals(testCase);
    const before = [...screen.getByTestId(testCase.testId).querySelectorAll('[data-operational-value]')].map(value => value.textContent);
    H.error = new Error('refresh failed'); H.fetching = true;
    view.rerender(<Page />);
    const brief = screen.getByTestId(testCase.testId);
    expect(brief).toHaveTextContent('Retained source data');
    expect(brief).not.toHaveAttribute('aria-busy', 'true');
    expect([...brief.querySelectorAll('[data-operational-value]')].map(value => value.textContent)).toEqual(before);
    expect(brief).toHaveTextContent(`${samples[0]!.timestamp} → ${samples.at(-1)!.timestamp}`);
    expect(screen.getByRole('combobox', { name: testCase.signalLabel })).toBeEnabled();
  });
});
