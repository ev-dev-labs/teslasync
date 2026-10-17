import type { ComponentProps, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { SignalHistoryResponse } from '@/types/telemetry';
import type { ChartContainerProps } from '@/components/charts';
import type { TelemetrySummaryBrief } from '../components/operationalbrief-all/TelemetrySummaryBrief';
type TelemetrySummaryBriefProps = ComponentProps<typeof TelemetrySummaryBrief>;
import { analyzeSignalMutualInformation } from '../lib/signalMutualInformation';
import SignalMutualInformationPage from './SignalMutualInformationPage';

const H = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  catalog: ['NumericA', 'NumericB'] as string[] | undefined,
  catalogError: null as Error | null,
  a: undefined as SignalHistoryResponse | undefined,
  b: undefined as SignalHistoryResponse | undefined,
  aError: null as Error | null,
  bError: null as Error | null,
  loading: false,
  fetching: false,
  paused: false,
  catalogRetry: vi.fn(), aRetry: vi.fn(), bRetry: vi.fn(),
  history: vi.fn(), brief: vi.fn(), chart: vi.fn(), layout: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`)),
  i18n: { language: 'en' } }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: H.vehicleId }) }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({
  fmtInt: (n: number) => String(n), fmtNumber: (n: number) => String(n),
  fmtScientificNumber: (n: number) => String(n), fmtPercent: (n: number) => `${n}%`,
}) }));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => ({ data: H.catalog, error: H.catalogError, isError: H.catalogError !== null,
    isPending: H.catalog === undefined, isLoading: H.loading, refetch: H.catalogRetry }),
  useSignalHistory: (id: number, signal: string, hours: number) => {
    H.history(id, signal, hours);
    const a = signal === 'NumericA';
    const data = signal ? (a ? H.a : H.b) : undefined;
    const error = signal ? (a ? H.aError : H.bError) : null;
    return { data, error, isError: error !== null, isPending: data === undefined,
      isLoading: Boolean(signal) && H.loading && data === undefined,
      isFetching: Boolean(signal) && H.fetching,
      fetchStatus: H.paused ? 'paused' : H.fetching ? 'fetching' : 'idle',
      dataUpdatedAt: data === undefined ? 0 : Date.UTC(2026, 0, 4), refetch: a ? H.aRetry : H.bRetry };
  },
}));
vi.mock('@/components/layout', () => ({
  PageLayout: (props: { title: string; children: ReactNode }) => {
    H.layout(props); return <main><h1>{props.title}</h1>{props.children}</main>;
  },
}));
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => <h1>{pageTitle}</h1>,
}));
vi.mock('../components/operationalbrief-all/TelemetrySummaryBrief', () => ({
  TelemetrySummaryBrief: (props: TelemetrySummaryBriefProps) => {
    H.brief(props); return <section><h2>{props.title}</h2></section>;
  },
}));
vi.mock('@/components/charts', () => ({
  ChartContainer: (props: ChartContainerProps) => {
    H.chart(props);
    return <section><h2>{props.title}</h2>{props.error ? <p>History unavailable</p>
      : props.loading ? <p>Loading contributions</p> : props.empty ? <p>{props.emptyMessage}</p> : typeof props.children === 'function' ? props.children({ annotations: [], hidden: false, hiddenSeries: null }) : props.children}</section>;
  },
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  BarChart: ({ children }: { children: ReactNode }) => <>{children}</>,
  Bar: () => null, CartesianGrid: () => null, ChartTooltip: () => null,
  Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
// Frozen synthetic measurements stay in this test; production still uses the pure domain analysis.
const points = Object.freeze(Array.from({ length: 64 }, (_, index) => Object.freeze({
  ts: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
  kind: 'ValueKindDouble', value: index % 8,
  ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null,
} satisfies SignalHistoryResponse['data'][number])));
function response(signal: string, data: SignalHistoryResponse['data'] = [...points]): SignalHistoryResponse {
  return { vehicleId: 7, signal, data, count: data.length,
    from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:04:00Z' };
}
function choosePair() {
  fireEvent.change(screen.getByLabelText('Signal A'), { target: { value: 'NumericA' } });
  fireEvent.change(screen.getByLabelText('Signal B'), { target: { value: 'NumericB' } });
}
function brief(): TelemetrySummaryBriefProps { return H.brief.mock.calls.at(-1)?.[0] as TelemetrySummaryBriefProps; }
function chart(): ChartContainerProps { return H.chart.mock.calls.at(-1)?.[0] as ChartContainerProps; }
function assertSections() {
  for (const title of ['Signals to compare', 'Mutual information metrics', 'Top joint-state contributions', 'Contribution heatmap']) {
    expect(screen.getByText(title)).toBeInTheDocument();
  }
}
beforeEach(() => {
  vi.clearAllMocks(); H.vehicleId = 7; H.catalog = ['NumericA', 'NumericB']; H.catalogError = null;
  H.a = undefined; H.b = undefined; H.aError = null; H.bError = null;
  H.loading = false; H.fetching = false; H.paused = false;
});
afterEach(cleanup);
describe('SignalMutualInformationPage', () => {
  it('keeps all four sections and unknown metrics before selection', () => {
    render(<SignalMutualInformationPage />); assertSections();
    expect(brief().unknown).toBe(true);
    expect(brief().metrics.every(metric => metric.rawValue == null)).toBe(true);
    expect(screen.getByLabelText('Signal A')).toHaveAttribute('id', 'mutual-information-signal-a');
    expect(screen.getByLabelText('Signal B')).toHaveAttribute('id', 'mutual-information-signal-b');
  });
  it('preserves independent vehicle, signal and 24-hour hook arguments', () => {
    render(<SignalMutualInformationPage />); choosePair();
    expect(H.history).toHaveBeenCalledWith(7, 'NumericA', 24);
    expect(H.history).toHaveBeenCalledWith(7, 'NumericB', 24);
  });
  it('preserves real domain scores, every heatmap cell and top twelve contributions', () => {
    H.a = response('NumericA'); H.b = response('NumericB');
    const original = JSON.stringify([H.a, H.b]);
    const result = analyzeSignalMutualInformation(H.a.data, H.b.data)!;
    render(<SignalMutualInformationPage />); choosePair(); assertSections();
    expect(brief().metrics.map(metric => metric.rawValue)).toEqual([
      result.alignedCount, result.mutualInformation, result.normalizedMutualInformation * 100,
      result.significant ? 'Detected' : 'Null-like',
    ]);
    expect(chart().data).toEqual([...result.cells].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 12).map(cell => ({ cell: `A${cell.aBin + 1} / B${cell.bBin + 1}`,
        contribution: cell.contribution, count: cell.count })));
    expect(screen.getAllByLabelText(/^Signal A bin /)).toHaveLength(result.cells.length);
    expect(JSON.stringify([H.a, H.b])).toBe(original);
  });
  it('retains returned source bounds and requested-window provenance', () => {
    H.a = response('NumericA'); H.b = response('NumericB');
    render(<SignalMutualInformationPage />); choosePair();
    expect(brief().scope).toBe('24h requested · NumericA / NumericB · aligned overlap only');
    expect(brief().sourceBounds).toEqual([
      { signal: 'NumericA', from: H.a.from, to: H.a.to }, { signal: 'NumericB', from: H.b.from, to: H.b.to },
    ]);
    expect(brief().provenance).toBe('Two independently queried signal histories; aligned numeric samples only');
    expect(H.layout.mock.calls.at(-1)?.[0].dataSources.map((source: { id: string; enabled?: boolean }) =>
      [source.id, source.enabled])).toEqual([['signal-catalog', undefined], ['signal-a-history', true], ['signal-b-history', true]]);
  });
  it('keeps chart and heatmap shells during initial history loading', () => {
    H.loading = true; render(<SignalMutualInformationPage />); choosePair(); assertSections();
    expect(brief().loading).toBe(true); expect(chart().loading).toBe(true);
  });
  it('keeps every section and exact failed-source retry on fatal history errors', () => {
    H.aError = new Error('A failed'); H.b = response('NumericB');
    render(<MemoryRouter><SignalMutualInformationPage /></MemoryRouter>); choosePair(); assertSections();
    expect(brief().unavailable).toBe(true); expect(chart().error).toBe(H.aError);
    chart().onRetry?.(); expect(H.aRetry).toHaveBeenCalledOnce(); expect(H.bRetry).not.toHaveBeenCalled();
  });
  it('retains scores and cells after a background refresh failure', () => {
    H.a = response('NumericA'); H.b = response('NumericB'); H.aError = new Error('Refresh failed');
    render(<SignalMutualInformationPage />); choosePair(); assertSections();
    expect(brief().retained).toBe(true); expect(brief().unavailable).toBe(false);
    expect(chart().error).toBeUndefined(); expect(screen.getAllByLabelText(/^Signal A bin /).length).toBeGreaterThan(0);
  });
  it('marks successful empty history unavailable without fabricating zero scores', () => {
    H.a = response('NumericA', []); H.b = response('NumericB');
    render(<SignalMutualInformationPage />); choosePair(); assertSections();
    expect(brief().sourceStatus).toBe('unavailable'); expect(brief().unknown).toBe(true);
    expect(brief().metrics.every(metric => metric.rawValue == null)).toBe(true);
    expect(screen.getAllByText('At least 20 aligned numeric samples are required.')).toHaveLength(2);
  });
  it('keeps all analysis sections when the catalog is empty', () => {
    H.catalog = []; render(<SignalMutualInformationPage />); assertSections();
    expect(screen.getByText('No telemetry signals have been recorded for this vehicle yet.')).toBeInTheDocument();
  });
  it('preserves the no-selected-vehicle onboarding boundary', () => {
    H.vehicleId = null; render(<SignalMutualInformationPage />);
    expect(screen.getByRole('heading', { name: 'Signal mutual information' })).toBeInTheDocument();
    expect(H.brief).not.toHaveBeenCalled(); expect(H.history).toHaveBeenCalledWith(0, '', 24);
  });
});
