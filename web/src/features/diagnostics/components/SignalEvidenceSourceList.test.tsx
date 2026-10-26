import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { SignalEvidenceBundleSource } from '@/api/hooks/useTelemetry';
import type { SignalHistoryPoint } from '@/api/types';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { SignalEvidenceSourceList } from './SignalEvidenceSourceList';
import { hasSignalHistory } from '../lib/signalEvidenceAvailability';
import { formatDateTime } from '@/lib/dateFormat';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { RootCauseSignalTimelineChart } from './RootCauseSignalTimelineChart';

const datePreferences = vi.hoisted(() => ({ locale: 'en-GB', tz: 'America/Los_Angeles' }));
const chart = vi.hoisted(() => ({
  container: vi.fn<(props: { children?: ReactNode; data: unknown; dataColumns: { key: string; format: (value: unknown) => string }[] }) => ReactNode>(),
  axis: vi.fn<(props: { tickFormatter: (value: string | null | undefined) => string }) => ReactNode>(),
  tooltip: vi.fn<(props: { labelFormatter: (value: string | number | undefined) => ReactNode }) => ReactNode>(),
}));

vi.mock('@/hooks/useChartPalette', () => ({ useChartPalette: () => ['var(--chart-1)'] }));
vi.mock('@/components/charts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/charts')>();
  const children = ({ children }: { children?: ReactNode }) => children;
  return {
    ...original,
    ChartContainer: chart.container.mockImplementation(children),
    ResponsiveContainer: children,
    LineChart: children,
    XAxis: chart.axis.mockImplementation(() => null),
    YAxis: () => null,
    CartesianGrid: () => null,
    Line: () => null,
    ChartLegend: () => null,
    Tooltip: ({ content }: { content: ReactNode }) => content,
    ChartTooltip: chart.tooltip.mockImplementation(() => null),
  };
});

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | Date | null | undefined) => formatDateTime(value, datePreferences),
  }),
}));

function point(ts: string, value: SignalHistoryPoint['value'] = 0): SignalHistoryPoint {
  return {
    ts,
    kind: typeof value === 'number' ? 'ValueKindDouble' : typeof value === 'string' ? 'ValueKindString' : 'ValueKindBoolean',
    value, ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null,
  };
}

function response(signal: string, data: SignalHistoryPoint[]): SignalHistoryResponse {
  return { vehicleId: 7, signal, from: '2026-10-06T00:00:00Z', to: '2026-10-06T01:00:00Z', count: data.length, data };
}

function row(signal: string): HTMLElement {
  return screen.getByText(signal).closest('[data-signal-source]') as HTMLElement;
}

describe('complete signal evidence source presentation', () => {
  it('allocates mobile retry targets locally, restores desktop sizing and preserves keyboard recovery and evidence', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const retained = response('LongSignalIdentityWithoutAnySpaces', [
      point('2026-10-06T00:05:00Z', 0),
    ]);
    const state = deriveDataState({
      data: retained, dataUpdatedAt: Date.UTC(2026, 9, 6, 0, 30),
      error: new Error('Retained source refresh failed'), refetch: retry,
    }, { provenance: 'historical' });
    const { rerender } = render(<SignalEvidenceSourceList label="History" sources={[
      { signal: retained.signal, state },
    ]} />);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(button).toHaveClass('max-md:min-h-11', 'max-md:min-w-11', 'md:min-h-9', 'md:min-w-0');
    expect(button).toHaveClass('h-auto', 'max-w-full', 'whitespace-normal');
    expect(button).toHaveClass('focus-visible:outline-2', 'focus-visible:outline-offset-2');
    for (const caption of screen.getAllByText(/Requested window:|Actually recorded:|^Fetched /)) {
      expect(caption).toHaveClass('block', 'break-words');
      expect(caption).not.toHaveAttribute('title');
    }
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(retry).toHaveBeenCalledTimes(2);
    expect(state.data).toBe(retained);
    expect(screen.getByText('1 sample(s)')).toBeVisible();

    rerender(<SignalEvidenceSourceList label="History" sources={[
      { signal: retained.signal, state: { ...state, isRefreshing: true } },
    ]} />);
    expect(button).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(retry).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1 sample(s)')).toBeVisible();
  });

  it('keeps a paused initial source unresolved without guessing a connectivity cause and resumes loading', () => {
    const retry = vi.fn();
    const paused = deriveDataState<SignalHistoryResponse>({
      isPending: true, fetchStatus: 'paused', refetch: retry,
    });
    const { rerender } = render(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state: paused },
    ]} />);
    expect(within(row('Speed')).getByText('Refresh paused')).toBeInTheDocument();
    expect(within(row('Speed')).getByRole('status')).toHaveTextContent('Speed loading is paused. No data has been loaded yet.');
    expect(within(row('Speed')).queryByLabelText('Loading Speed')).toBeNull();
    expect(within(row('Speed')).queryByRole('alert')).toBeNull();
    expect(within(row('Speed')).queryByText(/offline|connection|unavailable|No data available for this period|sample\(s\)/i)).toBeNull();
    expect(paused.hasData).toBe(false);
    expect(paused.updatedAt).toBeNull();
    fireEvent.click(within(row('Speed')).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);

    rerender(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state: deriveDataState<SignalHistoryResponse>({
        isPending: true, isLoading: true, isFetching: true, fetchStatus: 'fetching', refetch: retry,
      }) },
    ]} />);
    expect(within(row('Speed')).getByText('Pending')).toBeInTheDocument();
    expect(within(row('Speed')).getByRole('status', { name: 'Loading Speed' })).toBeInTheDocument();
    expect(within(row('Speed')).queryByText('Refresh paused')).toBeNull();
    expect(within(row('Speed')).queryByText('Speed loading is paused. No data has been loaded yet.')).toBeNull();
    expect(within(row('Speed')).queryByRole('button')).toBeNull();
  });

  it('keeps paused retained evidence and its last-success timestamp visible without an offline claim', () => {
    const retained = response('Speed', [point('2026-10-06T00:00:00Z', 0)]);
    const updatedAt = Date.UTC(2026, 9, 6, 0, 30);
    const state = deriveDataState({
      data: retained, dataUpdatedAt: updatedAt, fetchStatus: 'paused',
    }, { provenance: 'historical' });
    render(<SignalEvidenceSourceList label="History" sources={[{ signal: 'Speed', state }]} />);
    expect(within(row('Speed')).getByText('Refresh paused')).toBeInTheDocument();
    expect(within(row('Speed')).getByRole('status')).toHaveTextContent('Speed refresh is paused. Previously loaded data remains visible.');
    expect(within(row('Speed')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(within(row('Speed')).getByText(`Fetched ${formatDateTime(new Date(updatedAt), datePreferences)}`)).toBeInTheDocument();
    expect(within(row('Speed')).queryByText(/offline|connection|refresh failed/i)).toBeNull();
    expect(within(row('Speed')).queryByRole('alert')).toBeNull();
    expect(state.data).toBe(retained);
    expect(state.data?.data[0].value).toBe(0);
  });

  it('resolves a paused initial request to successful empty history without leaving deferred feedback', () => {
    const retry = vi.fn();
    const { rerender } = render(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state: deriveDataState<SignalHistoryResponse>({ fetchStatus: 'paused', refetch: retry }) },
    ]} />);
    expect(within(row('Speed')).getByRole('status')).toHaveTextContent('No data has been loaded yet.');

    rerender(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state: deriveDataState({ data: response('Speed', []), isSuccess: true, refetch: retry }) },
    ]} />);
    expect(within(row('Speed')).getByText('Ready')).toBeVisible();
    expect(within(row('Speed')).getByText('No data available for this period')).toBeVisible();
    expect(within(row('Speed')).queryByRole('status')).toBeNull();
    expect(within(row('Speed')).queryByRole('button')).toBeNull();
    expect(within(row('Speed')).queryByRole('alert')).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });

  it('keeps a measured zero ready beside a pending identity without fabricating pending samples', () => {
    const zero = response('Speed', [point('2026-10-06T00:00:00Z', 0)]);
    const sources: SignalEvidenceBundleSource[] = [
      { signal: 'Speed', state: deriveDataState({ data: zero }, { provenance: 'historical' }) },
      { signal: 'Heading', state: deriveDataState({ isPending: true, isLoading: true }) },
    ];
    render(<SignalEvidenceSourceList sources={sources} label="History" />);
    expect(within(row('Speed')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Speed')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(sources[0].state.data).toBe(zero);
    expect(sources[0].state.data?.data[0].value).toBe(0);
    expect(hasSignalHistory(sources, 'Speed')).toBe(true);
    expect(hasSignalHistory(sources, 'Heading')).toBe(false);
    expect(hasSignalHistory(sources, 'MissingIdentity')).toBe(false);
    expect(within(row('Heading')).getByText('Pending')).toBeInTheDocument();
    expect(within(row('Heading')).getByRole('status', { name: 'Loading Heading' })).toBeInTheDocument();
    expect(within(row('Heading')).queryByText(/sample\(s\)/)).toBeNull();
    expect(within(row('Heading')).queryByText('Unavailable')).toBeNull();
  });

  it('keeps ready evidence alongside initial failure and retries only the failed source', () => {
    const retryReady = vi.fn();
    const retryFailed = vi.fn();
    render(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Soc', state: deriveDataState({ data: response('Soc', [point('2026-10-06T00:00:00Z', 0)]), refetch: retryReady }) },
      { signal: 'Voltage', state: deriveDataState({ error: new Error('Voltage request failed'), refetch: retryFailed }) },
    ]} />);
    expect(within(row('Soc')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Voltage')).getByRole('alert')).toHaveTextContent('Voltage request failed');
    expect(within(row('Voltage')).queryByText(/sample\(s\)/)).toBeNull();
    fireEvent.click(within(row('Voltage')).getByRole('button', { name: 'Retry' }));
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(retryReady).not.toHaveBeenCalled();
  });

  it('distinguishes resolved empty history from nonnumeric received history', () => {
    const sources: SignalEvidenceBundleSource[] = [
      { signal: 'Empty', state: deriveDataState({ data: response('Empty', []) }, { unavailable: true }) },
      { signal: 'Gear', state: deriveDataState({ data: response('Gear', [point('2026-10-06T00:00:00Z', 'Park')]) }) },
    ];
    render(<SignalEvidenceSourceList label="History" sources={sources} />);
    expect(hasSignalHistory(sources, 'Empty')).toBe(false);
    expect(hasSignalHistory(sources, 'Gear')).toBe(true);
    expect(within(row('Empty')).getByText('Unavailable')).toBeInTheDocument();
    expect(within(row('Empty')).getByText('No data available for this period')).toBeInTheDocument();
    expect(within(row('Empty')).queryByText('0 sample(s)')).toBeNull();
    expect(within(row('Empty')).queryByTestId('stale-refresh-warning')).toBeNull();
    expect(within(row('Gear')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Gear')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(within(row('Gear')).queryByText('Unavailable')).toBeNull();
  });

  it('preserves the original retained payload and last-success timestamp with source-specific recovery', () => {
    const retry = vi.fn();
    const neighborRetry = vi.fn();
    const retained = response('Speed', [point('2026-10-06T00:00:00Z', 0)]);
    const updatedAt = Date.UTC(2026, 9, 6, 0, 30);
    const state = deriveDataState({ data: retained, dataUpdatedAt: updatedAt, error: new Error('Speed refresh failed'), refetch: retry }, { provenance: 'historical' });
    const { rerender } = render(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state },
      { signal: 'Heading', state: deriveDataState({ data: response('Heading', [point('2026-10-06T00:00:00Z', 90)]), refetch: neighborRetry }) },
    ]} />);
    expect(state.data).toBe(retained);
    expect(state.updatedAt).toBe(updatedAt);
    expect(state.fatalError).toBeNull();
    expect(within(row('Speed')).getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(within(row('Speed')).getByText(`Fetched ${formatDateTime(new Date(updatedAt), datePreferences)}`)).toBeInTheDocument();
    expect(within(row('Speed')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(within(row('Heading')).getByText('Ready')).toBeInTheDocument();
    fireEvent.click(within(row('Speed')).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(neighborRetry).not.toHaveBeenCalled();
    expect(state.data?.data[0].value).toBe(0);

    const recovered = response('Speed', [point('2026-10-06T00:45:00Z', 0)]);
    const recoveredAt = updatedAt + 60_000;
    rerender(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state: deriveDataState({
        data: recovered, dataUpdatedAt: recoveredAt, refetch: retry,
      }, { provenance: 'historical' }) },
      { signal: 'Heading', state: deriveDataState({
        data: response('Heading', [point('2026-10-06T00:00:00Z', 90)]), refetch: neighborRetry,
      }) },
    ]} />);
    expect(within(row('Speed')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Speed')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(within(row('Speed')).getByText(`Fetched ${formatDateTime(new Date(recoveredAt), datePreferences)}`)).toBeInTheDocument();
    expect(within(row('Speed')).queryByTestId('stale-refresh-warning')).toBeNull();
    expect(within(row('Speed')).queryByRole('button')).toBeNull();
    expect(within(row('Heading')).getByText('Ready')).toBeInTheDocument();
  });

  it('uses display locale and timezone for last success without changing evidence or unknown timestamps', () => {
    const retained = response('Speed', [point('2026-10-06T00:00:00Z', 0)]);
    const updatedAt = Date.UTC(2026, 9, 6, 0, 30);
    const state = deriveDataState({ data: retained, dataUpdatedAt: updatedAt }, { provenance: 'historical' });
    const unknownState = deriveDataState({ data: response('Heading', []) });
    const invalidState = { ...state, updatedAt: Infinity };
    const sources: SignalEvidenceBundleSource[] = [
      { signal: 'Speed', state },
      { signal: 'Heading', state: unknownState },
      { signal: 'Invalid', state: invalidState },
    ];
    const { rerender } = render(<SignalEvidenceSourceList sources={sources} label="History" />);
    expect(within(row('Speed')).getByText(`Fetched ${formatDateTime(new Date(updatedAt), datePreferences)}`)).toBeInTheDocument();
    expect(within(row('Heading')).queryByText(/^Fetched /)).toBeNull();
    expect(within(row('Invalid')).getByText('Fetched —')).toBeInTheDocument();

    const originalPreferences = { ...datePreferences };
    try {
      Object.assign(datePreferences, { locale: 'de-DE', tz: 'Asia/Tokyo' });
      rerender(<SignalEvidenceSourceList sources={sources} label="History" />);
      expect(within(row('Speed')).getByText(`Fetched ${formatDateTime(new Date(updatedAt), datePreferences)}`)).toBeInTheDocument();
      expect(state.updatedAt).toBe(updatedAt);
      expect(unknownState.updatedAt).toBeNull();
      expect(invalidState.updatedAt).toBe(Infinity);
      expect(state.data).toBe(retained);
      expect(state.provenance).toBe('historical');
      expect(retained.data[0]).toEqual(point('2026-10-06T00:00:00Z', 0));
    } finally {
      Object.assign(datePreferences, originalPreferences);
    }
  });

  it('separates requested bounds, recorded instants and retrieval across saved timezone day boundaries', () => {
    const retained = response('Speed', [
      point('2026-10-06T00:45:12.345Z', 1),
      point('invalid', 2),
      point('2026-10-06T00:05:01.123Z', 0),
    ]);
    const updatedAt = Date.UTC(2026, 9, 7, 2, 30);
    const original = JSON.stringify(retained);
    const sources = [{ signal: 'Speed', state: deriveDataState({ data: retained, dataUpdatedAt: updatedAt }) }];
    const { rerender } = render(<SignalEvidenceSourceList label="History" sources={sources} />);
    const assertTimes = () => {
      expect(within(row('Speed')).getByText(`Requested window: ${formatDateTime(retained.from, datePreferences)} → ${formatDateTime(retained.to, datePreferences)}`)).toBeInTheDocument();
      expect(within(row('Speed')).getByText(`Actually recorded: ${formatDateTime(retained.data[2].ts, datePreferences)} → ${formatDateTime(retained.data[0].ts, datePreferences)}`)).not.toHaveAttribute('title');
      expect(within(row('Speed')).getByText(`Fetched ${formatDateTime(new Date(updatedAt), datePreferences)}`)).toBeInTheDocument();
    };
    assertTimes();
    expect(formatDateTime(retained.from, datePreferences)).toContain('5 Oct 2026');
    const previous = { ...datePreferences };
    try {
      Object.assign(datePreferences, { locale: 'de-DE', tz: 'Asia/Tokyo' });
      rerender(<SignalEvidenceSourceList label="History" sources={sources} />);
      assertTimes();
      expect(formatDateTime(retained.from, datePreferences)).toContain('6. Okt. 2026');
      expect(JSON.stringify(retained)).toBe(original);
      expect(sources[0].state.updatedAt).toBe(updatedAt);
    } finally {
      Object.assign(datePreferences, previous);
    }
  });

  it('does not substitute requested or fetch dates for missing or invalid observations', () => {
    const retained = { ...response('Speed', [point('invalid', 0)]), from: '', to: 'invalid' };
    render(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state: deriveDataState({ data: retained }) },
      { signal: 'Empty', state: deriveDataState({ data: response('Empty', []) }) },
    ]} />);
    expect(within(row('Speed')).getByText('Requested window: — → —')).toBeInTheDocument();
    expect(within(row('Speed')).getByText('Actually recorded: — → —')).toBeInTheDocument();
    expect(within(row('Empty')).getByText('Actually recorded: — → —')).toBeInTheDocument();
    expect(within(row('Speed')).queryByText(/^Fetched /)).toBeNull();
    expect(retained.data[0].ts).toBe('invalid');
  });

  it('uses saved date preferences on timeline axes, data tables and exact-instant tooltips without changing rows', () => {
    const timeline = [{ ms: Date.parse('2026-10-06T00:05:01.123Z'), time: '2026-10-06T00:05:01.123Z', Speed: 0 }];
    const props = { timeline, seriesNames: ['Speed'], focalSignal: 'Speed', hasChosenSignal: true, isLoading: false, isError: false };
    const renderChart = () => <MemoryRouter><RootCauseSignalTimelineChart {...props} /></MemoryRouter>;
    const { rerender } = render(renderChart());
    const assertFormatters = () => {
      const axis = chart.axis.mock.calls[chart.axis.mock.calls.length - 1][0];
      const container = chart.container.mock.calls[chart.container.mock.calls.length - 1][0];
      const tooltip = chart.tooltip.mock.calls[chart.tooltip.mock.calls.length - 1][0];
      const formatted = formatDateTime(timeline[0].time, datePreferences);
      expect(axis.tickFormatter(timeline[0].time)).toBe(formatted);
      expect(container.data).toBe(timeline);
      expect(container.dataColumns[0].format(timeline[0].time)).toBe(formatted);
      expect(tooltip.labelFormatter(timeline[0].time)).toBe(`${formatted} · ${timeline[0].time}`);
      for (const invalid of ['', 'invalid', undefined, null]) {
        expect(axis.tickFormatter(invalid)).toBe('—');
        expect(container.dataColumns[0].format(invalid)).toBe('—');
      }
      expect(tooltip.labelFormatter('invalid')).toBe('—');
      expect(tooltip.labelFormatter(undefined)).toBe('—');
    };
    assertFormatters();
    const previous = { ...datePreferences };
    try {
      Object.assign(datePreferences, { locale: 'de-DE', tz: 'Asia/Tokyo' });
      rerender(renderChart());
      assertFormatters();
      expect(timeline).toEqual([{ ms: Date.parse('2026-10-06T00:05:01.123Z'), time: '2026-10-06T00:05:01.123Z', Speed: 0 }]);
    } finally {
      Object.assign(datePreferences, previous);
    }
  });

  it('renders all eight normalized identities in hook order, regardless of their outcomes', () => {
    const names = ['Speed', 'Heading', 'Gear', 'Soc', 'Voltage', 'Current', 'Temperature', 'Torque'];
    const sources = names.map((signal, index) => ({
      signal,
      state: index % 3 === 0
        ? deriveDataState({ data: response(signal, [point('2026-10-06T00:00:00Z', 0)]) })
        : index % 3 === 1 ? deriveDataState<SignalHistoryResponse>({ isPending: true })
        : deriveDataState<SignalHistoryResponse>({ error: new Error(`${signal} failed`) }),
    }));
    const { container } = render(<SignalEvidenceSourceList sources={sources} label="History" />);
    expect(Array.from(container.querySelectorAll('[data-signal-source]'), element => element.getAttribute('data-signal-source'))).toEqual(names);
    expect(sources.map(source => source.signal)).toEqual(names);
  });
});
