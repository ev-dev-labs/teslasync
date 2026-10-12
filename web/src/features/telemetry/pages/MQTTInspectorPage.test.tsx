/**
 * MQTTInspectorPage — behavioural contract tests.
 *
 * The page renders the deterministic MQTT broker-status inspector:
 *   1. A four-tile KPI band (streaming vehicles / total signals / batches /
 *      signals-per-sec) that collapses to '—' while the status query loads.
 *   2. A hero throughput chart that accumulates a live *delta* series from
 *      successive `totalSignals` readings — it stays a "Collecting…"
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
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
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

import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import { __resetTitleStoreForTests } from '@/lib/titleStore';
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
};

function setQuery(stub: QueryStub) {
  mockUseMQTTStatus.mockReturnValue({
    data: stub.data,
    isLoading: stub.isLoading ?? false,
    error: stub.error ?? null,
    refetch: stub.refetch,
    isFetching: stub.isFetching ?? false,
    fetchStatus: stub.fetchStatus ?? 'idle',
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mqtt-inspector']}>
        <MQTTInspectorPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ui, ...render(ui) };
}

beforeEach(() => {
  mockUseMQTTStatus.mockReset();
  setQuery({ data: makeStatus() });
});

afterEach(() => {
  __resetTitleStoreForTests();
  vi.restoreAllMocks();
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
    expect(screen.getByText(/1 vehicles/i)).toBeInTheDocument();
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

    // First point recorded → still a placeholder (length 1).
    expect(
      screen.getByText(/Collecting throughput data/i),
    ).toBeInTheDocument();

    setQuery({ data: withTotal(250) });
    rerender(tree()); // second point (length 2)

    setQuery({ data: withTotal(400) });
    rerender(tree()); // third point (length 3) → chart branch

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
    if (stale) expect(screen.getByText('1 stale')).toBeInTheDocument();
    else expect(screen.queryByText('1 stale')).not.toBeInTheDocument();
    if (label === 'Unknown') expect(within(details).queryByText('Live')).not.toBeInTheDocument();
  });
});
