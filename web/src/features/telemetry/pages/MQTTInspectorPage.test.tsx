/**
 * MQTTInspectorPage — behavioural contract tests.
 *
 * The page renders the deterministic MQTT broker-status inspector:
 *   1. A four-tile KPI band (streaming vehicles / total signals / batches /
 *      signals-per-sec) that collapses to '—' while the status query loads.
 *   2. A hero throughput chart that accumulates a live *delta* series from
 *      successive successful broker receipts — it stays a "Collecting…"
 *      placeholder until more than two points have been observed.
 *   3. A connection panel (broker / uptime / topic patterns) with its own
 *      loading / error / empty branches.
 *   4. A per-vehicle breakdown table plus a header "N stale" warning derived
 *      from the shared {@link isVehicleStale} predicate.
 *
 * The `useMQTTStatus` hook is mocked so every data state (loading, error,
 * connected-with-data, connected-empty, missing-status) is driven
 * deterministically without a network. `react-i18next` is stubbed to return
 * each key's English fallback so visible copy assertions stay stable. The
 * global test-setup already stubs `useSettings` (ai_mode='off', so the AI
 * explainer card renders null) and `useTimezone` (UTC), which keeps the
 * `useDateFormat` formatters deterministic.
 *
 * The DataTable is virtualized: jsdom reports zero-height viewports so the
 * per-row cells never paint. Assertions therefore target the deterministic
 * header count + empty message rather than individual rows (mirroring the
 * existing TestMqttSseInspectorAIOffShowsRawInspectorOnly baseline test).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const translationFixture = vi.hoisted(() => ({
  messages: {} as Record<string, string>,
  calls: vi.fn(),
  timeZone: 'UTC',
}));

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        translationFixture.calls(key, options);
        const pluralKey = options?.count === 1 ? `${key}_one` : `${key}_other`;
        const defaultValue = options?.count === 1 && typeof options.defaultValue_one === 'string'
          ? options.defaultValue_one : typeof fallback === 'string' ? fallback : key;
        const message = translationFixture.messages[pluralKey] ?? translationFixture.messages[key] ?? defaultValue;
        return message.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
          options?.[name] == null ? match : String(options[name]));
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// useMQTTStatus owns a TanStack Query lifecycle we don't want to exercise —
// replace it with a deterministic stub whose return value each test controls.
vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
      '@/api/hooks/useTelemetry',
    );
  return { ...actual, useMQTTStatus: vi.fn() };
});

vi.mock('@/hooks/useDateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDateFormat')>('@/hooks/useDateFormat');
  return {
    ...actual,
    useDateFormat: (...args: Parameters<typeof actual.useDateFormat>) => {
      const formatters = actual.useDateFormat(...args);
      return { ...formatters, formatTime: (...values: Parameters<typeof formatters.formatTime>) =>
        formatters.formatTime(values[0], { ...values[1], tz: translationFixture.timeZone }) };
    },
  };
});

import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { __resetTitleStoreForTests } from '@/lib/titleStore';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import MQTTInspectorPage from './MQTTInspectorPage';

const mockUseMQTTStatus = useMQTTStatus as unknown as ReturnType<typeof vi.fn>;

interface TestVehicle {
  vin: string;
  state?: string;
  signalCount?: number;
  batchCount?: number;
  signalsPerSecond?: number;
  lastReceived?: string;
}

interface TestStatus {
  connected?: boolean;
  broker?: string;
  uptimeSeconds?: number;
  topics?: unknown;
  vehicles?: TestVehicle[];
}

const freshIso = () => new Date(Date.now() - 5_000).toISOString();
const staleIso = () => new Date(Date.now() - 300_000).toISOString();

function makeStatus(overrides: Partial<TestStatus> = {}): TestStatus {
  return {
    connected: true,
    broker: 'mqtt://mosquitto:1883',
    uptimeSeconds: 3661, // 1h 1m
    topics: ['telemetry/+/v/+', 'telemetry/+/errors'],
    vehicles: [
      {
        vin: '5YJ3E1EA1NF000001',
        state: 'online',
        signalCount: 12_345,
        batchCount: 678,
        signalsPerSecond: 3.4,
        lastReceived: freshIso(),
      },
      {
        vin: '5YJ3E1EA1NF000002',
        state: 'asleep',
        signalCount: 100,
        batchCount: 5,
        signalsPerSecond: 0.1,
        lastReceived: freshIso(),
      },
    ],
    ...overrides,
  };
}

type QueryStub = {
  data?: unknown;
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => unknown;
  isFetching?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt?: number;
  isSuccess?: boolean;
};

let receiptTime = 0;

function setQuery(stub: QueryStub) {
  mockUseMQTTStatus.mockReturnValue({
    data: stub.data,
    isLoading: stub.isLoading ?? false,
    error: stub.error ?? null,
    refetch: stub.refetch,
    isFetching: stub.isFetching ?? false,
    fetchStatus: stub.fetchStatus ?? 'idle',
    dataUpdatedAt: stub.dataUpdatedAt ?? (stub.data == null ? 0 : receiptTime += 5_000),
    isSuccess: stub.isSuccess ?? (stub.data != null && !stub.error),
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mqtt-inspector']}>
        <MQTTInspectorPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const ui = tree();
  const result = render(ui);
  return { ui, ...result, rerenderPage: () => result.rerender(tree()) };
}

beforeEach(() => {
  mockUseMQTTStatus.mockReset();
  translationFixture.messages = {};
  translationFixture.calls.mockClear();
  translationFixture.timeZone = 'UTC';
  receiptTime = Date.now() - 100_000;
  setQuery({ data: makeStatus() });
});

afterEach(() => {
  __resetTitleStoreForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('MQTTInspectorPage — connected happy path', () => {
  it('opens the real operational review with complete cumulative counters and the rate-versus-delta caveat', () => {
    renderPage();
    const summary = screen.getByTestId('mqtt-summary');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Total signals')).toBeInTheDocument();
    expect(within(drawer).getByText('Total batches')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('12,445');
    expect(drawer).toHaveTextContent('not the throughput chart’s per-poll deltas');
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
  });

  it('uses the canonical strip for broker counters, not throughput deltas, without losing any inspector section', () => {
    const { container } = renderPage();
    const summary = screen.getByTestId('mqtt-summary');
    expect(summary).toHaveAttribute('data-operational-brief');
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(within(summary).getByText('Signals / sec').closest('[data-operational-metric]')).toHaveTextContent('Signals / sec');
    expect(summary).toHaveTextContent('Latest broker status snapshot');
    expect(summary).toHaveTextContent('not the throughput chart’s per-poll deltas');
    expect(container.querySelector('[data-role="metric-card"]')).toBeNull();
    expect(container.querySelector('[data-stat-strip]')).toBeNull();
    expect(screen.getAllByText('Signal throughput').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Vehicle breakdown/ })).toBeInTheDocument();
    expect(screen.getByText('Refreshes every 5s')).toBeInTheDocument();
  });

  it('renders the connected badge, connection details, KPI totals, and vehicle count', () => {
    setQuery({ data: makeStatus() });
    renderPage();

    // Connection status chip in the header actions.
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();

    // Connection panel: broker + formatted uptime + topic chips.
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
    expect(screen.getByText('1h 1m')).toBeInTheDocument(); // formatUptime(3661)
    expect(screen.getByText('telemetry/+/v/+')).toBeInTheDocument();
    expect(screen.getByText('telemetry/+/errors')).toBeInTheDocument();

    // KPI band: total signals = 12,345 + 100 = 12,445 (locale-grouped).
    expect(screen.getByText('12,445')).toBeInTheDocument();

    // Header row count from the deterministic snapshot.
    expect(screen.getByText(/2 vehicles/i)).toBeInTheDocument();
  });

  it('sets the document title and keeps the AI explainer hidden while ai_mode=off', () => {
    setQuery({ data: makeStatus() });
    renderPage();

    expect(document.title).toContain('MQTT inspector');

    // The opt-in AI card is gated off by the global useSettings stub.
    expect(
      screen.queryByTestId('ai-feature-mqtt-sse-inspector-explanations-root'),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Explain streams/i }),
    ).toBeNull();
  });
});

describe('MQTTInspectorPage — loading state', () => {
  it('shows placeholder KPI values and unknown connectivity while the query loads', () => {
    setQuery({ data: undefined, isLoading: true });
    renderPage();

    // All four MetricCards render the em-dash placeholder while loading.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);

    // No snapshot is not evidence of a disconnected broker.
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();

    // The vehicle-count header span only renders once vehicles exist.
    expect(screen.queryByText(/\d+ vehicles/i)).not.toBeInTheDocument();
  });
});

describe('MQTTInspectorPage — error state', () => {
  it('retains counters, connection, throughput and vehicle details after a failed status refresh', () => {
    const status = makeStatus();
    setQuery({ data: status, error: new Error('refresh unavailable') });
    renderPage();
    const summary = screen.getByTestId('mqtt-summary');
    expect(summary).toHaveTextContent('Showing retained measurements');
    expect(summary.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(screen.getByText('12,445')).toBeInTheDocument();
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/2 vehicles/i)).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByText(/Unable to load MQTT status/)).toBeNull();
  });

  it('surfaces the top error banner (with the message) and per-panel QueryErrors', () => {
    setQuery({ data: undefined, error: new Error('boom') });
    renderPage();

    // Top AlertBanner concatenates the fallback copy with the error message.
    const bannerMatches = screen.getAllByText((_content, el) => {
      const txt = el?.textContent ?? '';
      return (
        txt.includes('Unable to load MQTT status') && txt.includes('boom')
      );
    });
    expect(bannerMatches.length).toBeGreaterThan(0);

    // Each data panel falls back to QueryError (generic network copy) because
    // there is no cached status to fall back to.
    expect(
      screen.getAllByText(/Check your internet connection/i).length,
    ).toBeGreaterThanOrEqual(1);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });
});

describe('MQTTInspectorPage — connected but empty', () => {
  it('distinguishes absent status from an observed empty broker snapshot', () => {
    setQuery({ data: undefined });
    const { unmount } = renderPage();
    expect(screen.getByTestId('mqtt-summary').querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    unmount();
    setQuery({ data: makeStatus({ vehicles: [] }) });
    renderPage();
    const summary = screen.getByTestId('mqtt-summary');
    expect(summary.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(summary.querySelector('[data-value-state="missing"]')).toBeNull();
  });

  it('renders topic + vehicle empty states without a stale badge', () => {
    setQuery({
      data: makeStatus({ topics: [], vehicles: [] }),
    });
    renderPage();

    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
    expect(screen.getByText(/No MQTT topics detected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/No vehicles currently streaming/i),
    ).toBeInTheDocument();

    // No vehicles → no stale count anywhere in the DOM.
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument();
  });

  it('renders the connection empty state when status is absent but not loading or errored', () => {
    setQuery({ data: undefined, isLoading: false, error: null });
    renderPage();

    expect(
      screen.getByText(/MQTT broker status not available/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No vehicles currently streaming/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
  });
});

describe('MQTTInspectorPage — stale detection', () => {
  it('counts a vehicle as stale when its last signal is older than the threshold', () => {
    setQuery({
      data: makeStatus({
        vehicles: [
          {
            vin: 'FRESH00000000001',
            state: 'online',
            signalCount: 10,
            batchCount: 1,
            signalsPerSecond: 1,
            lastReceived: freshIso(),
          },
          {
            vin: 'STALE00000000002',
            state: 'online',
            signalCount: 20,
            batchCount: 2,
            signalsPerSecond: 0,
            lastReceived: staleIso(), // 5 min ago → stale
          },
        ],
      }),
    });
    renderPage();

    // Exactly one of the two vehicles is stale.
    expect(screen.getByText(/1 stale/i)).toBeInTheDocument();
    expect(screen.getByText(/2 vehicles/i)).toBeInTheDocument();
  });

  it('treats a vehicle with no lastReceived timestamp as stale', () => {
    setQuery({
      data: makeStatus({
        vehicles: [
          {
            vin: 'NEVER0000000001',
            state: 'online',
            signalCount: 5,
            batchCount: 1,
            // lastReceived omitted → never reported → stale
          },
        ],
      }),
    });
    renderPage();

    expect(screen.getByText(/1 stale/i)).toBeInTheDocument();
    expect(screen.getByText(/1 vehicle$/i)).toBeInTheDocument();
  });
});

describe('MQTTInspectorPage — uptime formatting', () => {
  it('formats a sub-hour uptime as minutes only', () => {
    setQuery({ data: makeStatus({ uptimeSeconds: 1800 }) }); // 30m
    renderPage();
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.queryByText('1h 1m')).not.toBeInTheDocument();
  });
});

describe('MQTTInspectorPage — throughput accumulation', () => {
  it('replaces the collecting placeholder once more than two delta points accrue', () => {
    // 1 vehicle whose cumulative signalCount climbs each poll. The page derives
    // a per-poll delta series; the chart only replaces the "Collecting…"
    // placeholder after it has observed >2 points.
    const withTotal = (n: number) =>
      makeStatus({
        topics: ['telemetry/+/v/+'],
        vehicles: [
          {
            vin: 'ACCUM00000000001',
            state: 'online',
            signalCount: n,
            batchCount: 1,
            signalsPerSecond: 1,
            lastReceived: freshIso(),
          },
        ],
      });

    setQuery({ data: withTotal(100) });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Fresh element per render (new reference) so React actually reconciles the
    // subtree and re-reads the updated mock — a reused element reference would
    // hit React's bail-out path. The same QueryClient keeps the page instance
    // mounted so `throughputHistory` accrues across polls instead of resetting.
    const tree = () => (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/mqtt-inspector']}>
          <MQTTInspectorPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree());

    // First successful receipt is a baseline, not a synthetic zero point.
    expect(
      screen.getByText(/Collecting throughput data/i),
    ).toBeInTheDocument();

    setQuery({ data: withTotal(250) });
    rerender(tree()); // first observed interval

    setQuery({ data: withTotal(400) });
    rerender(tree()); // second observed interval
    expect(screen.getByText(/Collecting throughput data/i)).toBeInTheDocument();

    setQuery({ data: withTotal(550) });
    rerender(tree()); // third observed interval → chart branch

    expect(
      screen.queryByText(/Collecting throughput data/i),
    ).not.toBeInTheDocument();
    // The Recharts responsive container mounts once the chart branch renders.
    expect(
      document.querySelector('.recharts-responsive-container'),
    ).not.toBeNull();
  });
});

describe('MQTTInspectorPage — contract adoption', () => {
  function useMobileWidth() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, bottom: 640, right: 375,
      width: 375, height: 640, toJSON: () => ({}),
    });
  }

  it('keeps every vehicle field reachable in named mobile details', () => {
    useMobileWidth();
    const vehicle = makeStatus().vehicles?.[0];
    setQuery({ data: makeStatus({ vehicles: vehicle ? [vehicle] : [] }) });
    renderPage();

    const table = screen.getByRole('group', { name: 'Vehicle breakdown' });
    expect(table).toHaveAttribute('data-mobile-table');
    fireEvent.click(within(table).getByRole('button', { name: 'Quick view' }));
    const details = screen.getByRole('dialog');
    const fields: Record<string, string | RegExp> = {
      VIN: '5YJ3E1EA1NF000001',
      State: 'online',
      Signals: '12,345',
      Batches: '678',
      'Sig/sec': '3.4',
      'Last received': 'just now',
      Status: 'Live',
    };
    for (const [label, value] of Object.entries(fields)) {
      const field = within(details).getByText(label, { selector: 'dt' }).parentElement;
      expect(field).toHaveTextContent(value);
    }
    const footer = details.querySelector<HTMLElement>('[data-modal-footer="true"]');
    if (!footer) throw new Error('Mobile details footer is missing');
    fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('telemetry/+/errors')).toBeInTheDocument();
  });

  it('offers one explicit fatal-source refresh without hiding inspector sections', () => {
    const refetch = vi.fn();
    setQuery({ error: new Error('broker read unavailable'), refetch });
    renderPage();
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
    for (const title of ['Signal throughput', 'Connection', 'Vehicle breakdown']) {
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByTestId('mqtt-summary').querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
  });

  it('disables fatal-source refresh during an in-flight retry', () => {
    const refetch = vi.fn();
    setQuery({ error: new Error('broker read unavailable'), refetch, isFetching: true });
    renderPage();
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(refetch).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'reported connected', connected: true, label: 'Connected' },
    { id: 'reported disconnected', connected: false, label: 'Disconnected' },
    { id: 'unreported connection', connected: undefined, label: 'Unknown' },
  ])('shows only source-backed connectivity for $id', ({ connected, label }) => {
    setQuery({ data: makeStatus({ connected }) });
    renderPage();
    expect(screen.getByText(label)).toBeInTheDocument();
    if (connected === undefined) {
      expect(screen.queryByText('Connected')).not.toBeInTheDocument();
      expect(screen.queryByText('Disconnected')).not.toBeInTheDocument();
    }
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
  });

  it('retains source-backed connectivity, counters and mobile details when refresh is paused', () => {
    useMobileWidth();
    const status = makeStatus({ connected: false, vehicles: makeStatus().vehicles?.slice(0, 1) });
    setQuery({ data: status, fetchStatus: 'paused' });
    renderPage();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByTestId('mqtt-summary')).toHaveTextContent('Showing retained measurements');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
    const table = screen.getByRole('group', { name: 'Vehicle breakdown' });
    fireEvent.click(within(table).getByRole('button', { name: 'Quick view' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('12,345');
    expect(screen.getByRole('dialog')).toHaveTextContent('678');
  });

  it.each([
    { id: 'invalid timestamp', received: 'not-a-timestamp', label: 'Unknown', stale: false },
    { id: 'future timestamp', received: '2030-01-01T00:01:00.000Z', label: 'Unknown', stale: false },
    { id: 'exact freshness boundary', received: '2029-12-31T23:58:00.000Z', label: 'Live', stale: false },
    { id: 'past freshness boundary', received: '2029-12-31T23:57:59.999Z', label: 'Stale', stale: true },
    { id: 'missing timestamp', received: undefined, label: 'Stale', stale: true },
  ])('keeps freshness status and stale count consistent for $id', ({ received, label, stale }) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00.000Z'));
    useMobileWidth();
    setQuery({ data: makeStatus({ vehicles: [{
      vin: 'DRILL-FRESHNESS-ONLY', state: 'online',
      signalCount: 12, batchCount: 3, signalsPerSecond: 1,
      lastReceived: received,
    }] }) });
    renderPage();
    const table = screen.getByRole('group', { name: 'Vehicle breakdown' });
    fireEvent.click(within(table).getByRole('button', { name: 'Quick view' }));
    const details = screen.getByRole('dialog');
    const statusField = within(details).getByText('Status', { selector: 'dt' }).parentElement;
    expect(statusField).toHaveTextContent(label);
    if (stale) expect(screen.getByText('1 stale vehicle')).toBeInTheDocument();
    else expect(screen.queryByText('1 stale vehicle')).not.toBeInTheDocument();
    if (label === 'Unknown') expect(within(details).queryByText('Live')).not.toBeInTheDocument();
  });
});

describe('MQTTInspectorPage — causal freshness clock', () => {
  it('ages the same retained array coherently in header, mobile row, filter and already-open details', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2030-01-01T00:00:00Z');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, bottom: 640, right: 375,
      width: 375, height: 640, toJSON: () => ({}),
    });
    const status = makeStatus({ vehicles: [{
      vin: 'CLOCK-ONLY', state: 'online', signalCount: 10, batchCount: 1,
      lastReceived: '2029-12-31T23:58:10Z',
    }] });
    setQuery({ data: status, fetchStatus: 'paused', dataUpdatedAt: Date.now() - 5_000 });
    const { rerenderPage, unmount } = renderPage();
    const table = screen.getByRole('group', { name: 'Vehicle breakdown' });
    expect(within(table).getByText('Live')).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Quick view' }));
    const details = screen.getByRole('dialog');
    const statusField = within(details).getByText('Status', { selector: 'dt' }).parentElement;
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(statusField).toHaveTextContent('Live'); // Exactly 120s remains live.
    expect(screen.queryByText('1 stale vehicle')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(statusField).toHaveTextContent('Stale');
    expect(screen.getByText('1 stale vehicle')).toBeInTheDocument();
    expect(within(table).getByText('Stale')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(translationFixture.calls).toHaveBeenCalledWith('mqtt.staleVehicleCount',
      expect.objectContaining({ count: 1, formattedCount: '1' }));
    const footer = details.querySelector<HTMLElement>('[data-modal-footer="true"]');
    if (!footer) throw new Error('Details footer missing');
    fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Status filter' }));
    expect(screen.getByRole('checkbox', { name: 'Stale' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Live' })).not.toBeInTheDocument();
    rerenderPage();
    expect(screen.getByText('1 stale vehicle')).toBeInTheDocument();
    unmount();
  });
});

describe('MQTTInspectorPage — successful receipt samples', () => {
  const at = Date.parse('2030-01-01T00:00:00Z');
  const snapshot = (count: number | undefined, vin = 'RECEIPT-ONLY') => makeStatus({
    vehicles: [{ vin, signalCount: count, batchCount: 1, lastReceived: freshIso() }],
  });
  const sampleRows = () => {
    const table = screen.queryByRole('table', { name: 'Signal throughput — data table' });
    if (!table) return [];
    return within(table).getAllByRole('row').slice(1).map(row =>
      within(row).getAllByRole('cell').slice(1).map(cell => cell.textContent));
  };

  it('requires a successful receipt, records true zeros including structurally shared data, and keeps elapsed windows', () => {
    const status = snapshot(0);
    setQuery({ data: status, dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    expect(sampleRows()).toEqual([]);
    for (const [offset, window] of [[5_000, '5'], [12_000, '7'], [20_000, '8']] as const) {
      setQuery({ data: status, dataUpdatedAt: at + offset });
      rerenderPage();
      expect(sampleRows().slice(-1)[0]).toEqual([window, '0']);
    }
    expect(screen.queryByText(/Collecting throughput data/i)).not.toBeInTheDocument();
    expect(screen.getByText(/not a server throughput or signals-per-second measurement/)).toBeInTheDocument();
  });

  it('does not sample rerenders, changed query objects, request starts, paused refreshes or failures', () => {
    const status = snapshot(100);
    setQuery({ data: status, dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    for (const query of [
      { data: snapshot(999), dataUpdatedAt: at },
      { data: status, dataUpdatedAt: at, isFetching: true, fetchStatus: 'fetching' as const },
      { data: status, dataUpdatedAt: at, fetchStatus: 'paused' as const },
      { data: status, dataUpdatedAt: at, error: new Error('retained failure') },
      { data: snapshot(500), dataUpdatedAt: at + 10_000, isSuccess: false },
    ]) {
      setQuery(query);
      rerenderPage();
      expect(sampleRows()).toEqual([]);
    }
    setQuery({ data: snapshot(130), dataUpdatedAt: at + 30_000 });
    rerenderPage();
    expect(sampleRows()).toEqual([['30', '30']]);
  });

  it('does not create samples on precision, locale or formatter changes and updates existing time labels only', () => {
    const preferences = getFormatterPreferences();
    setQuery({ data: snapshot(100), dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    setQuery({ data: snapshot(110), dataUpdatedAt: at + 5_000 });
    rerenderPage();
    const before = sampleRows();
    const firstReceiptTime = () => {
      const table = screen.getByRole('table', { name: 'Signal throughput — data table' });
      return within(table).getAllByRole('row')[1].querySelector('td')?.textContent;
    };
    const beforeTime = firstReceiptTime();
    try {
      act(() => { setGlobalLocale('ar-EG'); setGlobalPrecision(3); });
      translationFixture.timeZone = 'America/New_York';
      rerenderPage();
      expect(sampleRows()).toEqual(before);
      expect(firstReceiptTime()).not.toEqual(beforeTime);
      translationFixture.messages['mqtt.time'] = 'Receipt time';
      rerenderPage();
      expect(sampleRows()).toEqual(before);
    } finally {
      act(() => { setGlobalLocale(preferences.locale); setGlobalPrecision(preferences.precision); });
    }
  });

  it('keeps reset, missing counter and changed vehicle scope as gaps, then rebases without invented zero', () => {
    setQuery({ data: snapshot(100), dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    const observations: [number | undefined, string, string][] = [
      [110, 'RECEIPT-ONLY', '10'], [0, 'RECEIPT-ONLY', '—'],
      [0, 'RECEIPT-ONLY', '0'], [undefined, 'RECEIPT-ONLY', '—'],
      [5, 'RECEIPT-ONLY', '—'], [8, 'RECEIPT-ONLY', '3'],
      [20, 'OTHER-SCOPE', '—'], [22, 'OTHER-SCOPE', '2'],
    ];
    observations.forEach(([count, vin, expected], index) => {
      setQuery({ data: snapshot(count, vin), dataUpdatedAt: at + (index + 1) * 5_000 });
      rerenderPage();
      expect(sampleRows().slice(-1)[0]).toEqual(['5', expected]);
    });
    expect(sampleRows()).toHaveLength(8);
  });

  it('rebases a backwards receipt clock with an explicit unknown window instead of manufacturing a rate', () => {
    setQuery({ data: snapshot(100), dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    setQuery({ data: snapshot(110), dataUpdatedAt: at - 1_000 });
    rerenderPage();
    expect(sampleRows()).toEqual([['—', '—']]);
    setQuery({ data: snapshot(120), dataUpdatedAt: at + 4_000 });
    rerenderPage();
    expect(sampleRows()).toEqual([['—', '—'], ['5', '10']]);
  });

  it('preserves a per-vehicle reset gap even when another counter masks it in the fleet total', () => {
    const pair = (first: number, second: number) => makeStatus({ vehicles: [
      { vin: 'RESET-A', signalCount: first, batchCount: 1 },
      { vin: 'RESET-B', signalCount: second, batchCount: 1 },
    ] });
    setQuery({ data: pair(100, 0), dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    setQuery({ data: pair(0, 120), dataUpdatedAt: at + 5_000 });
    rerenderPage();
    expect(sampleRows()).toEqual([['5', '—']]);
    setQuery({ data: pair(2, 123), dataUpdatedAt: at + 10_000 });
    rerenderPage();
    expect(sampleRows()).toEqual([['5', '—'], ['5', '5']]);
  });
});

describe('MQTTInspectorPage — localized complete messages', () => {
  it.each([
    { seconds: 3599.9, label: '59m' },
    { seconds: 3600, label: '1h 0m' },
    { seconds: 7199.9, label: '1h 59m' },
    { seconds: 7200, label: '2h 0m' },
    { seconds: 0, label: '0m' },
  ])('formats the complete uptime without minute overflow at $seconds seconds', ({ seconds, label }) => {
    setQuery({ data: makeStatus({ uptimeSeconds: seconds }) });
    renderPage();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/1h 60m/)).not.toBeInTheDocument();
  });

  it('localizes all uptime/count digits and permits translated word order and singular vehicle phrasing', () => {
    const preferences = getFormatterPreferences();
    translationFixture.messages = {
      'mqtt.vehicleCount_one': 'Vehicle: {{formattedCount}}',
      'mqtt.staleVehicleCount_one': 'Stale: {{formattedCount}}',
      'mqtt.uptimeHoursMinutes': '{{minutes}}min / {{hours}}hr',
    };
    setQuery({ data: makeStatus({ uptimeSeconds: 7200, vehicles: [{
      vin: 'LOCALE-ONLY', signalCount: 0, batchCount: 0, lastReceived: staleIso(),
    }] }) });
    const { rerenderPage } = renderPage();
    try {
      act(() => { setGlobalLocale('ar-EG'); });
      rerenderPage();
      expect(screen.getByText('٠min / ٢hr')).toBeInTheDocument();
      expect(screen.getByText('Vehicle: ١')).toBeInTheDocument();
      expect(screen.getByText('Stale: ١')).toBeInTheDocument();
      expect(translationFixture.calls).toHaveBeenCalledWith('mqtt.vehicleCount',
        expect.objectContaining({ count: 1, formattedCount: '١' }));
    } finally {
      act(() => { setGlobalLocale(preferences.locale); });
    }
  });
});

describe('MQTTInspectorPage — independent aggregate missingness', () => {
  const metric = (label: string) => {
    const summary = screen.getByTestId('mqtt-summary');
    const element = within(summary).getByText(label).closest('[data-operational-metric]');
    if (!(element instanceof HTMLElement)) throw new Error(`Missing metric: ${label}`);
    return element;
  };

  it.each([
    { field: 'signalCount', label: 'Total signals', known: ['Total batches', 'Signals / sec'] },
    { field: 'batchCount', label: 'Total batches', known: ['Total signals', 'Signals / sec'] },
    { field: 'signalsPerSecond', label: 'Signals / sec', known: ['Total signals', 'Total batches'] },
  ] as const)('does not publish a complete $label aggregate when one returned vehicle omits $field', ({ field, label, known }) => {
    const vehicles = makeStatus().vehicles!;
    const incomplete = { ...vehicles[1], [field]: undefined };
    setQuery({ data: makeStatus({ vehicles: [vehicles[0], incomplete] }) });
    renderPage();
    expect(metric(label)).toHaveAttribute('data-value-state', 'missing');
    expect(metric(label)).toHaveTextContent('—');
    expect(metric('Streaming vehicles')).toHaveAttribute('data-value-state', 'value');
    for (const name of known) expect(metric(name)).toHaveAttribute('data-value-state', 'value');
    const notice = screen.getByTestId('mqtt-partial-measurements');
    expect(notice).toHaveAttribute('data-data-state', 'partial');
    expect(within(notice).getByText(label)).toBeInTheDocument();
    expect(within(notice).getByText('Unknown')).toBeInTheDocument();
    for (const name of known) expect(within(notice).queryByText(name)).toBeNull();
    expect(screen.getByTestId('mqtt-summary')).toHaveTextContent('Partial data');
    expect(screen.getByTestId('mqtt-summary')).not.toHaveTextContent('Broker snapshot available');
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Vehicle breakdown/ })).toBeInTheDocument();
  });

  it('keeps measured zeros distinct from an omitted rate and recovers each aggregate after a complete receipt', () => {
    const incomplete = makeStatus({ vehicles: [
      { vin: 'MISSING-RATE', signalCount: 0, batchCount: 0, lastReceived: freshIso() },
    ] });
    setQuery({ data: incomplete });
    const { rerenderPage } = renderPage();
    for (const label of ['Total signals', 'Total batches']) {
      expect(metric(label)).toHaveAttribute('data-value-state', 'value');
      expect(metric(label)).toHaveTextContent('0');
    }
    expect(metric('Signals / sec')).toHaveAttribute('data-value-state', 'missing');
    setQuery({ data: makeStatus({ vehicles: [
      { ...incomplete.vehicles![0], signalsPerSecond: 0 },
    ] }) });
    rerenderPage();
    expect(metric('Signals / sec')).toHaveAttribute('data-value-state', 'value');
    expect(metric('Signals / sec')).toHaveTextContent('0');
    expect(screen.queryByTestId('mqtt-partial-measurements')).toBeNull();
    expect(screen.getByTestId('mqtt-summary')).toHaveTextContent('Broker snapshot available');
  });

  it.each([
    { id: 'failed refresh', error: new Error('partial refresh rejected'), fetchStatus: 'idle' as const },
    { id: 'paused refresh', error: undefined, fetchStatus: 'paused' as const },
  ])('retains partial measurements and independent connectivity during $id without promoting unknown totals', ({ error, fetchStatus }) => {
    const vehicles = makeStatus().vehicles!;
    const status = makeStatus({ connected: false, vehicles: [
      vehicles[0], { ...vehicles[1], signalsPerSecond: undefined },
    ] });
    const at = Date.now() - 5_000;
    setQuery({ data: status, dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    setQuery({ data: status, dataUpdatedAt: at, error, fetchStatus });
    rerenderPage();
    expect(screen.getByTestId('mqtt-summary')).toHaveTextContent('Showing retained measurements');
    expect(metric('Signals / sec')).toHaveAttribute('data-value-state', 'missing');
    expect(metric('Total signals')).toHaveTextContent('12,445');
    expect(metric('Total batches')).toHaveTextContent('683');
    expect(screen.getByTestId('mqtt-partial-measurements')).toHaveTextContent('Signals / sec');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.queryByText(/Unable to load MQTT status/)).toBeNull();
    expect(screen.getByText('mqtt://mosquitto:1883')).toBeInTheDocument();
  });

  it('keeps counter-based throughput and all seven mobile fields usable when only aggregate rate coverage is missing', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, bottom: 640, right: 375,
      width: 375, height: 640, toJSON: () => ({}),
    });
    const at = Date.now() - 30_000;
    const snapshot = (signalCount: number) => makeStatus({ vehicles: [{
      vin: 'COUNTERS-WITHOUT-RATE', state: 'online', signalCount, batchCount: 0,
      lastReceived: freshIso(),
    }] });
    setQuery({ data: snapshot(10), dataUpdatedAt: at });
    const { rerenderPage } = renderPage();
    for (let index = 1; index <= 3; index += 1) {
      setQuery({ data: snapshot(10 + index * 5), dataUpdatedAt: at + index * 5_000 });
      rerenderPage();
    }
    expect(metric('Signals / sec')).toHaveAttribute('data-value-state', 'missing');
    const history = screen.getByRole('table', { name: 'Signal throughput — data table' });
    const intervals = within(history).getAllByRole('row').slice(1).map(row =>
      within(row).getAllByRole('cell').slice(1).map(cell => cell.textContent));
    expect(intervals).toEqual([['5', '5'], ['5', '5'], ['5', '5']]);
    const table = screen.getByRole('group', { name: 'Vehicle breakdown' });
    fireEvent.click(within(table).getByRole('button', { name: 'Quick view' }));
    const details = screen.getByRole('dialog');
    const fields = {
      VIN: 'COUNTERS-WITHOUT-RATE', State: 'online', Signals: '25', Batches: '0',
      'Sig/sec': '—', 'Last received': 'just now', Status: 'Live',
    };
    for (const [label, value] of Object.entries(fields)) {
      expect(within(details).getByText(label, { selector: 'dt' }).parentElement).toHaveTextContent(value);
    }
    expect(within(details).getAllByRole('term')).toHaveLength(7);
  });

  it('does not certify a fleet aggregate whose returned numeric evidence is invalid or whose count sum is unsafe', () => {
    const status = makeStatus({ vehicles: [
      { vin: 'NUMERIC-A', signalCount: Number.MAX_SAFE_INTEGER, batchCount: -1, signalsPerSecond: Number.POSITIVE_INFINITY },
      { vin: 'NUMERIC-B', signalCount: 1, batchCount: 2, signalsPerSecond: 0 },
    ] });
    setQuery({ data: status });
    renderPage();
    for (const label of ['Total signals', 'Total batches', 'Signals / sec']) {
      expect(metric(label)).toHaveAttribute('data-value-state', 'missing');
      expect(metric(label)).toHaveTextContent('—');
      expect(within(screen.getByTestId('mqtt-partial-measurements')).getByText(label)).toBeInTheDocument();
    }
    expect(metric('Streaming vehicles')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });
});
