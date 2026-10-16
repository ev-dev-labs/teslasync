import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { Children, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { ChartContainer, XAxis, type ChartContainerProps } from '@/components/charts';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useSignalAnalysisHistory } from '@/api/hooks/useTelemetry';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import * as dateFormatting from '@/hooks/useDateFormat';
import * as entropy from '../lib/signalEntropy';
import '../components/operationalbrief-all/metricPreferencesTestSetup';
import SignalEntropyPage from './SignalEntropyPage';

const H = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  history: undefined as SignalHistoryResponse | undefined,
  historyError: null as Error | null,
  catalog: ['NumericSignal'],
  catalogError: null as Error | null,
  loading: false,
  fetching: false,
  paused: false,
  tz: 'UTC',
  historyRetry: vi.fn(),
  catalogRetry: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, variables?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' && fallback !== null ? fallback : {};
      const defaultValue = 'defaultValue' in options ? options.defaultValue : undefined;
      const text = typeof fallback === 'string' ? fallback : typeof defaultValue === 'string' ? defaultValue : key;
      const replacements = variables ?? options;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(name in replacements ? Reflect.get(replacements, name) : `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => ({
    data: H.catalogError ? undefined : H.catalog,
    error: H.catalogError,
    isLoading: false,
    isSuccess: H.catalogError === null,
    refetch: H.catalogRetry,
  }),
  useSignalAnalysisHistory: vi.fn((_id: number, signal: string) => ({
    data: signal ? H.history : undefined,
    error: signal ? H.historyError : null,
    isLoading: Boolean(signal) && H.loading && H.history === undefined,
    isFetching: Boolean(signal) && H.fetching,
    isSuccess: Boolean(signal) && H.history !== undefined && H.historyError === null,
    isError: Boolean(signal) && H.historyError !== null,
    isPending: !signal || H.history === undefined,
    fetchStatus: H.paused ? 'paused' : H.fetching ? 'fetching' : 'idle',
    dataUpdatedAt: H.history === undefined ? 0 : Date.UTC(2026, 0, 4),
    refetch: H.historyRetry,
  })),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: H.vehicleId }) }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    tz: H.tz,
    formatDateTime: (value: string | Date | null | undefined) =>
      value == null ? '—' : new Intl.DateTimeFormat('de-DE', {
        timeZone: H.tz, dateStyle: 'short', timeStyle: 'short',
      }).format(new Date(value)),
  }),
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  return { ...actual, ChartContainer: vi.fn((props: ChartContainerProps) => <actual.ChartContainer {...props} />) };
});
vi.mock('@/components/layout', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/layout')>();
  return { ...actual, PageLayout: ({ children }: { children?: ReactNode }) => <main>{children}</main> };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</> };
});
vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => <h1>{pageTitle}</h1>,
}));

const preferences = getFormatterPreferences();
const samples = Array.from({ length: 40 }, (_, index) => Object.freeze({
  ts: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
  kind: 'ValueKindDouble',
  value: index,
  ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null,
} satisfies SignalHistoryResponse['data'][number]));

function response(data: SignalHistoryResponse['data'] = [...samples]): SignalHistoryResponse {
  return { vehicleId: 7, signal: 'NumericSignal', data, count: data.length,
    from: data[0]?.ts, to: data.at(-1)?.ts };
}
function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<SignalEntropyPage />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
    ),
  });
}
function chooseSignal() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Signal' }), { target: { value: 'NumericSignal' } });
}
function latestMetrics() {
  return vi.mocked(useOperationalMetrics).mock.calls.at(-1)![0];
}
function latestChart(title: string) {
  return vi.mocked(ChartContainer).mock.calls.map(call => call[0]).reverse().find(props => props.title === title)!;
}
function expectSections() {
  const selectionHelp = 'Quantile (equal-frequency) binning is used instead of fixed-width bins, so a signal that spends most of its time in a narrow band and rarely spikes still gets a fair, distribution-agnostic entropy estimate.';
  for (const title of ['Choose a signal', 'Entropy metrics', 'Rolling information density',
    'Quantile bin distribution', 'Reading the result']) {
    const name = title === 'Choose a signal' ? `${title}${selectionHelp}` : title;
    expect(screen.getByRole('heading', { name })).toBeInTheDocument();
  }
}

beforeEach(() => {
  H.vehicleId = 7; H.history = response(); H.historyError = null;
  H.catalog = ['NumericSignal']; H.catalogError = null;
  H.loading = false; H.fetching = false; H.paused = false; H.tz = 'UTC';
  setGlobalLocale('de-DE'); setGlobalPrecision(5);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.clearAllMocks();
  setGlobalLocale(preferences.locale); setGlobalPrecision(preferences.precision);
});

describe('SignalEntropyPage preservation and presentation', () => {
  it('keeps all five sections and four unknown metrics before signal selection', () => {
    mountPage();
    expectSections();
    expect(latestMetrics().map(metric => metric.rawValue)).toEqual([null, null, null, null]);
    expect(latestMetrics()[1]?.description).toBe('Source values unknown');
    expect(latestMetrics()[3]?.description).toBe('Source values unknown');
    expect(latestChart('Rolling information density').emptyMessage).toBe('Choose a signal above to compute its entropy.');
    expect(latestChart('Quantile bin distribution').empty).toBe(true);
    expect(screen.getByText('Pick a signal to see how its entropy should be read.')).toBeInTheDocument();
    expect(useSignalAnalysisHistory).toHaveBeenLastCalledWith(7, '', 48);
  });

  it('preserves exact entropy math, all series rows, raw bin edges, source bounds and review action', () => {
    const original = structuredClone(H.history);
    mountPage(); chooseSignal(); expectSections();
    expect(useSignalAnalysisHistory).toHaveBeenLastCalledWith(7, 'NumericSignal', 48);
    expect(latestMetrics().map(metric => metric.rawValue)).toEqual([3, 8, 12.5, 17.9]);
    expect(latestMetrics().map(metric => metric.occurrenceId)).toEqual([
      'entropy', 'effective-states', 'dominant-state', 'change-rate',
    ]);
    const rolling = latestChart('Rolling information density');
    expect(rolling.data).toHaveLength(5);
    expect(rolling.data?.map(row => row.time)).toEqual([19, 24, 29, 34, 39].map(hour =>
      new Date(Date.UTC(2026, 0, 1) + hour * 3_600_000).toISOString()));
    expect(rolling.data?.[0]?.bits).toBe(2);
    const distribution = latestChart('Quantile bin distribution');
    expect(distribution.data?.map(row => row.count)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(distribution.data?.[0]).toEqual({ bin: '0,00000–4,87500', lo: 0, hi: 4.875, key: 0, count: 5 });
    expect(rolling.height).toBe(300); expect(distribution.height).toBe(260);
    const brief = screen.getByTestId('signal-entropy-summary');
    expect(brief).toHaveTextContent('48h requested · NumericSignal');
    expect(brief).toHaveTextContent('2026-01-01T00:00:00.000Z → 2026-01-02T15:00:00.000Z');
    expect(brief).toHaveTextContent('bits');
    expect(screen.getByText(/0,00000 to 39,00000 across 40 samples/)).toBeInTheDocument();
    expect(screen.getAllByText(/not guaranteed full-window coverage/)).toHaveLength(2);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    for (const metric of latestMetrics()) expect(within(drawer).getByText(metric.label!)).toBeInTheDocument();
    expect(H.history).toEqual(original);
  });

  it('keeps raw timestamp identity while formatting chart tables with configured locale and timezone', () => {
    const view = mountPage(); chooseSignal();
    const before = latestChart('Rolling information density');
    expect(before.dataColumns?.[0]?.format?.(before.data?.[0]?.time)).toBe('01.01.26, 19:00');
    expect(before.dataColumns?.[0]?.format?.(before.data?.[1]?.time)).toBe('02.01.26, 00:00');
    H.tz = 'America/Los_Angeles'; view.rerender(<SignalEntropyPage />);
    const after = latestChart('Rolling information density');
    expect(after.data).toEqual(before.data);
    expect(after.dataColumns?.[0]?.format?.(after.data?.[0]?.time)).toBe('01.01.26, 11:00');
    expect(after.metadata?.rangeLabel).toBe('America/Los_Angeles');
    expect(screen.getByText('01.01.26, 11:00')).toBeInTheDocument();
  });

  it.each([
    { name: 'resolved empty history', data: [], message: 'No signal samples' },
    { name: 'nonnumeric history', data: [{ ...samples[0]!, kind: 'ValueKindBool', value: false }],
      message: 'No aggregate statistics are available.' },
  ])('distinguishes $name without inventing zero analysis or a selection prompt', ({ data, message }) => {
    H.history = response(data);
    mountPage(); chooseSignal(); expectSections();
    expect(latestMetrics().map(metric => metric.rawValue)).toEqual([null, null, null, null]);
    expect(latestChart('Rolling information density').emptyMessage).toBe(message);
    expect(latestChart('Quantile bin distribution').emptyMessage).toBe(message);
    expect(screen.getAllByText(message)).toHaveLength(3);
    expect(screen.queryByText('Pick a signal to see how its entropy should be read.')).not.toBeInTheDocument();
    expect(screen.queryByText('Mostly parked')).not.toBeInTheDocument();
  });

  it('keeps measured zero distinct from unknown and preserves the parked interpretation', () => {
    H.history = response(samples.map(sample => ({ ...sample, value: 0 })));
    mountPage(); chooseSignal();
    expect(latestMetrics().map(metric => metric.rawValue)).toEqual([0, 1, 100, 0]);
    expect(latestChart('Quantile bin distribution').data).toEqual([
      { bin: '0,00000–0,00000', lo: 0, hi: 0, key: 0, count: 40 },
    ]);
    expect(screen.getByText('Mostly parked')).toBeInTheDocument();
    expect(screen.getByText(/0,00000 to 0,00000 across 40 samples/)).toBeInTheDocument();
  });

  it('keeps short-history distribution and interpretation available when rolling samples are insufficient', () => {
    H.history = response(samples.slice(0, 3));
    mountPage(); chooseSignal(); expectSections();
    expect(latestChart('Rolling information density').emptyMessage)
      .toBe('Not enough samples yet for a rolling entropy window on this signal.');
    expect(latestChart('Quantile bin distribution').empty).toBe(false);
    expect(latestChart('Quantile bin distribution').data?.reduce((sum, row) => sum + Number(row.count), 0)).toBe(3);
    expect(screen.getByText('Informative')).toBeInTheDocument();
  });

  it.each([
    { name: 'below boundary', fraction: 0.899, label: 'Informative' },
    { name: 'at boundary', fraction: 0.9, label: 'Mostly parked' },
    { name: 'above boundary', fraction: 0.901, label: 'Mostly parked' },
  ])('preserves the dominant-state threshold $name', ({ fraction, label }) => {
    const summary = entropy.summarizeSignalEntropy(samples);
    vi.spyOn(entropy, 'summarizeSignalEntropy').mockReturnValue({ ...summary, dominantBinFraction: fraction });
    mountPage(); chooseSignal();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(latestMetrics()[2]?.rawValue).toBe(fraction * 100);
  });

  it.each([
    { name: 'refresh failure', error: new Error('history refresh unavailable'), paused: false },
    { name: 'paused refresh', error: null, paused: true },
  ])('retains every metric and chart through $name', ({ error, paused }) => {
    const view = mountPage(); chooseSignal();
    const beforeMetrics = latestMetrics().map(metric => metric.rawValue);
    const beforeRolling = latestChart('Rolling information density').data;
    const beforeBins = latestChart('Quantile bin distribution').data;
    H.historyError = error; H.paused = paused; H.fetching = !paused;
    view.rerender(<SignalEntropyPage />);
    expectSections();
    assertOperationalBriefDisclosure(screen.getByTestId('signal-entropy-summary'), 'Retained source data', { contains: true });
    expect(latestMetrics().map(metric => metric.rawValue)).toEqual(beforeMetrics);
    expect(latestChart('Rolling information density').data).toEqual(beforeRolling);
    expect(latestChart('Rolling information density').error).toBeNull();
    expect(latestChart('Quantile bin distribution').data).toEqual(beforeBins);
    expect(screen.getByRole('combobox', { name: 'Signal' })).toBeEnabled();
  });

  it('keeps independent catalog recovery, history loading and fatal-error chart shells and retries', () => {
    const view = mountPage(); chooseSignal();
    H.catalogError = new Error('catalog unavailable');
    view.rerender(<SignalEntropyPage />); expectSections();
    expect(latestMetrics().map(metric => metric.rawValue)).toEqual([3, 8, 12.5, 17.9]);
    fireEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]!);
    expect(H.catalogRetry).toHaveBeenCalledOnce();
    H.catalogError = null; H.history = undefined; H.loading = true;
    view.rerender(<SignalEntropyPage />); expectSections();
    expect(latestChart('Rolling information density').loading).toBe(true);
    expect(latestChart('Quantile bin distribution').loading).toBe(true);
    expect(latestMetrics().map(metric => metric.rawValue)).toEqual([null, null, null, null]);
    H.loading = false; H.historyError = new Error('history unavailable');
    view.rerender(<SignalEntropyPage />); expectSections();
    expect(latestChart('Rolling information density').error).toEqual(H.historyError);
    expect(latestChart('Quantile bin distribution').error).toEqual(H.historyError);
    assertOperationalBriefDisclosure(screen.getByTestId('signal-entropy-summary'), 'Source unavailable', { contains: true });
    fireEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]!);
    expect(H.historyRetry).toHaveBeenCalledOnce();
  });

  it('formats rolling ticks without forwarding numeric indices as date options', () => {
    const configured = dateFormatting.useDateFormat();
    const formatDateTime = vi.fn(configured.formatDateTime);
    vi.spyOn(dateFormatting, 'useDateFormat').mockImplementation(() => ({
      ...configured, tz: H.tz, formatDateTime,
    }));
    const timeAxis = () => {
      const responsive = latestChart('Rolling information density').children;
      if (!isValidElement<{ children: ReactNode }>(responsive)) throw new Error('Missing responsive chart');
      const chart = Children.only(responsive.props.children);
      if (!isValidElement<{ children: ReactNode }>(chart)) throw new Error('Missing rolling chart');
      const axis = Children.toArray(chart.props.children).find(child =>
        isValidElement(child) && child.type === XAxis);
      if (!isValidElement<ComponentProps<typeof XAxis>>(axis)) throw new Error('Missing time axis');
      return axis.props;
    };
    const view = mountPage(); chooseSignal();
    const before = latestChart('Rolling information density');
    const timestamp = '2026-01-01T19:00:00.000Z';
    formatDateTime.mockClear();
    expect(timeAxis().tickFormatter?.(timestamp, 3)).toBe('01.01.26, 19:00');
    expect(formatDateTime).toHaveBeenLastCalledWith(timestamp);
    H.tz = 'America/Los_Angeles'; view.rerender(<SignalEntropyPage />);
    formatDateTime.mockClear();
    expect(timeAxis().tickFormatter?.(timestamp, 8)).toBe('01.01.26, 11:00');
    expect(formatDateTime).toHaveBeenLastCalledWith(timestamp);
    const after = latestChart('Rolling information density');
    expect(after.data).toEqual(before.data);
    expect(after.metadata).toEqual({ unitLabel: 'bits', rangeLabel: 'America/Los_Angeles' });
  });

  it('preserves no-vehicle onboarding without fabricating measurements', () => {
    H.vehicleId = null; mountPage();
    expect(screen.getByRole('heading', { name: 'Signal entropy' })).toBeInTheDocument();
    expect(screen.queryByTestId('signal-entropy-summary')).not.toBeInTheDocument();
  });
});
