/**
 * LiveSignalInspectorPage behavioural + regression tests.
 *
 * The page fans a single 1 s live-signal poll out into five self-sufficient
 * section states (no-vehicle / loading / error / empty / ready) plus a KPI
 * band that always renders. These tests drive every branch of that
 * discriminator, the vehicle-selection wiring, the refresh + retry callbacks,
 * the snapshot-table name filter, and the a11y landmarks — and pin the
 * transient-error regression (a dropped background poll must NOT blank the
 * inspector while a last-known snapshot is still in `data`).
 *
 * Network is never touched: both data hooks (`useVehicles`,
 * `useVehicleLiveSignals`) are mocked. `useVehicleLiveSignals` is modelled
 * faithfully — it returns an inert (data-less) result when the page passes
 * `enabled:false`, and the test-configured result when enabled — so the
 * page's own `enabled: vehicleId !== null` wiring is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ── i18n: return the fallback string, interpolating {{var}} from opts ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          return fallbackOrOpts.replace(/\{\{(\w+)\}\}/g, (_m, name) =>
            name in opts ? String(opts[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props, keep tests deterministic ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safeRest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              ['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'variants'].includes(k)
            )
              continue;
            safeRest[k] = v;
          }
          return <div {...(safeRest as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── live-connection: LiveIndicator renders a stable "connected" chip ──
vi.mock('@/hooks/useLiveConnection', () => ({
  useLiveConnection: () => ({
    status: 'connected' as const,
    lastMessageAt: null,
    channels: { sse: 'open' as const },
  }),
}));

// ── data hooks — driven per-test ──
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useTelemetry', () => ({ useVehicleLiveSignals: vi.fn() }));

import { useVehicles } from '@/api/hooks/useVehicles';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';
import LiveSignalInspectorPage from './LiveSignalInspectorPage';

const mockedUseVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockedUseLive = useVehicleLiveSignals as unknown as ReturnType<typeof vi.fn>;

const refetch = vi.fn(() => Promise.resolve(undefined));

interface LiveResult {
  data: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: typeof refetch;
}

function makeLive(overrides: Partial<LiveResult> = {}): LiveResult {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch,
    ...overrides,
  };
}

/** Result returned once the page enables the query (a vehicle is selected). */
let liveWhenEnabled: LiveResult = makeLive();
function setLive(overrides: Partial<LiveResult>) {
  liveWhenEnabled = makeLive(overrides);
}

/** A dense, mixed-kind, mixed-source snapshot: 7 signals total. */
function readyData() {
  const signals: Record<string, unknown> = {};
  for (let i = 1; i <= 4; i++) {
    signals[`a${i}`] = {
      value: i,
      kind: 'ValueKindFloat',
      source: 'l1',
      age_ms: 100 + i,
      timestamp: '2026-07-03T22:00:00Z',
    };
  }
  signals['b1'] = { value: true, kind: 'ValueKindBool', source: 'stale', age_ms: 200_000 };
  signals['b2'] = { value: false, kind: 'ValueKindBool', source: 'stale', age_ms: 200_001 };
  signals['c1'] = { value: 'hello', kind: 'ValueKindString', source: 'l2' };
  // total 7 · L1=4 · stale=2 · L2=1 · numeric=4 · freshest=101ms
  return { vehicle_id: 1, count: 7, at: '2026-07-03T22:00:00Z', signals };
}

const NO_VEHICLE_TABLE_MSG =
  'Pick a vehicle from the selector above to start streaming its live signal cache.';

beforeEach(() => {
  refetch.mockClear();
  liveWhenEnabled = makeLive();
  mockedUseVehicles.mockReturnValue({
    data: [
      { id: 1, display_name: 'Falcon', vin: 'TESLA0000000001' },
      { id: 2, display_name: 'Hawk', vin: 'TESLA0000000002' },
    ],
    isLoading: false,
  });
  // Faithful to the real hook: no data while disabled (no vehicle picked).
  mockedUseLive.mockImplementation((_id: unknown, opts?: { enabled?: boolean }) =>
    opts?.enabled ? liveWhenEnabled : makeLive(),
  );
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LiveSignalInspectorPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function selectVehicle(id = '1') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle' }), {
    target: { value: id },
  });
}

describe('LiveSignalInspectorPage — empty fleet', () => {
  it('shows a per-section "pick a vehicle" affordance in every data panel and disables refresh', () => {
    mockedUseVehicles.mockReturnValue({ data: [], isLoading: false });
    renderPage();

    expect(screen.getByText(NO_VEHICLE_TABLE_MSG)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Select a vehicle to see how its signals are distributed across the L1 / L2 / stale layers.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Select a vehicle to break its signals down by value kind.'),
    ).toBeInTheDocument();

    // Refresh is inert until a vehicle drives the query.
    expect(screen.getByRole('button', { name: 'Refresh live snapshot' })).toBeDisabled();

    // KPI band always renders; freshest age collapses to the em-dash.
    const kpi = within(screen.getByRole('region', { name: 'Snapshot summary' }));
    expect(kpi.getByText('Total Signals')).toBeInTheDocument();
    expect(kpi.getByText('—')).toBeInTheDocument();
  });

  it('leaves the live query disabled when no vehicle exists', () => {
    mockedUseVehicles.mockReturnValue({ data: [], isLoading: false });
    renderPage();
    expect(mockedUseLive).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false, refetchInterval: 1000 }),
    );
  });
});

describe('LiveSignalInspectorPage — vehicle selection wiring', () => {
  it('defaults to the global vehicle and enables the 1 s poll immediately', () => {
    setLive({ data: readyData(), dataUpdatedAt: Date.now() });
    renderPage();

    expect(mockedUseLive).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ enabled: true, refetchInterval: 1000 }),
    );
    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Refresh live snapshot' })).toBeEnabled();
    expect(screen.getByRole('status', { name: 'Live' })).toBeInTheDocument();
  });
});

describe('LiveSignalInspectorPage — ready state', () => {
  it('renders the snapshot table rows, KPI aggregates, and source-layer badges', () => {
    setLive({ data: readyData(), dataUpdatedAt: Date.now() });
    renderPage();
    selectVehicle('1');

    // Table rows (name + coerced value cells).
    expect(screen.getByText('a1')).toBeInTheDocument();
    expect(screen.getByText('c1')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();

    // KPI band aggregates (scoped so breakdown counts don't collide).
    const kpi = within(screen.getByRole('region', { name: 'Snapshot summary' }));
    expect(kpi.getByText('7')).toBeInTheDocument(); // total
    expect(kpi.getByText('2')).toBeInTheDocument(); // stale
    expect(kpi.getByText('101ms')).toBeInTheDocument(); // freshest age

    // One SourceLayerBadge per normalised source bucket (l1/stale/l2/unknown).
    const breakdowns = within(screen.getByRole('region', { name: 'Signal breakdowns' }));
    expect(breakdowns.getAllByTestId('source-layer-badge')).toHaveLength(4);
  });

  it('filters the snapshot table by signal name', () => {
    setLive({ data: readyData(), dataUpdatedAt: Date.now() });
    renderPage();
    selectVehicle('1');

    expect(screen.getByText('a1')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter signals'), { target: { value: 'c1' } });

    expect(screen.queryByText('a1')).toBeNull();
    expect(screen.getByText('c1')).toBeInTheDocument();
  });

  it('refetches when the refresh button is pressed', () => {
    setLive({ data: readyData(), dataUpdatedAt: Date.now() });
    renderPage();
    selectVehicle('1');

    refetch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh live snapshot' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('LiveSignalInspectorPage — loading / empty states', () => {
  it('shows skeleton placeholders (not the table) while the first fetch is loading', () => {
    setLive({ isLoading: true, isFetching: true });
    renderPage();
    selectVehicle('1');

    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    // The filter input only mounts with the table, so its absence proves we
    // are not yet in the ready state.
    expect(screen.queryByLabelText('Filter signals')).toBeNull();
    expect(screen.queryByText(NO_VEHICLE_TABLE_MSG)).toBeNull();
  });

  it('shows the empty-cache affordance when the snapshot has no signals', () => {
    setLive({ data: { vehicle_id: 1, count: 0, signals: {} }, dataUpdatedAt: Date.now() });
    renderPage();
    selectVehicle('1');

    expect(
      screen.getByText(
        'Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('No live signals to classify yet.')).toBeInTheDocument();
    expect(screen.getByText('No live signals to categorise yet.')).toBeInTheDocument();
  });
});

describe('LiveSignalInspectorPage — error handling', () => {
  it('shows a retryable error only when there is no snapshot to fall back to', () => {
    setLive({ isError: true, error: new Error('boom') });
    renderPage();
    selectVehicle('1');

    // The generic network branch of <QueryError> renders per data section.
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThan(0);

    const retryButtons = screen.getAllByRole('button', { name: 'Retry' });
    fireEvent.click(retryButtons[0]);
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps the last snapshot visible when a background poll errors (regression)', () => {
    // A dropped 1 s poll flips isError while `data` is retained. The page must
    // keep rendering the snapshot rather than blanking to a full error.
    setLive({
      data: readyData(),
      isError: true,
      error: new Error('transient blip'),
      dataUpdatedAt: Date.now(),
    });
    renderPage();
    selectVehicle('1');

    expect(screen.getByText('a1')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    // No section collapsed to the error affordance.
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('LiveSignalInspectorPage — accessibility landmarks', () => {
  it('exposes titled regions and a labelled vehicle picker', async () => {
    setLive({ data: readyData(), dataUpdatedAt: Date.now() });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Live Signal Inspector' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('region', { name: 'Snapshot summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Signal breakdowns' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toBeInTheDocument();
  });
});
