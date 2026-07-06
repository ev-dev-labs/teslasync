/**
 * VehicleCostPage — orchestration + branch coverage.
 *
 * The page is a thin orchestrator over five child sections. Its own behaviour
 * (the surface actually under test here) is:
 *
 *   1. window-state → `since` derivation → `useVehicleCost(since, 100)` args.
 *   2. 503 "subsystem missing" detection → banner + `sectionError` suppression
 *      so every section renders a calm empty state instead of a red error.
 *   3. generic-error pass-through → `sectionError` handed to every section.
 *   4. null-safe `vehicles` / `totals` extraction.
 *   5. real `rankVehicles` derivations — cost bars sorted by BYTES, top talkers
 *      sorted by ROWS (deliberately divergent fixtures prove the sort key).
 *   6. `nameOf` fallback for a vehicle with no display name.
 *   7. toolbar interactions (window change, refresh) wired to state + refetch.
 *
 * Strategy: render the REAL page shell + REAL toolbar + REAL helpers, and stub
 * only the four data sections so we can capture the exact props the page
 * computed. Network is never touched — `useVehicleCost` is mocked to return a
 * controllable query result. This keeps the assertions crisp and the render
 * deterministic (no recharts sizing / async react-query timing in the way).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion / useMotionPreference (reached via the
// page's <FadeIn> + PageContainer freshness chip) read it at module load.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// Shared, hoisted test doubles so the mock factories below and the specs can
// both reach them.
const { useVehicleCostMock, captured } = vi.hoisted(() => ({
  useVehicleCostMock: vi.fn(),
  captured: {} as Record<string, Record<string, unknown>>,
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Drive the data hook deterministically without any network.
vi.mock('@/api/hooks/useOperatorConfidence', async () => {
  const actual = await vi.importActual<
    typeof import('@/api/hooks/useOperatorConfidence')
  >('@/api/hooks/useOperatorConfidence');
  return {
    ...actual,
    useVehicleCost: (...args: unknown[]) => useVehicleCostMock(...args),
  };
});

// Stub ONLY the four data sections; keep the real toolbar + real helpers
// (rankVehicles/vehicleName/TOP_N) so the page's actual derivation logic runs.
vi.mock('../components/vehicle-cost', async () => {
  const actual = await vi.importActual<
    typeof import('../components/vehicle-cost')
  >('../components/vehicle-cost');
  const React = await vi.importActual<typeof import('react')>('react');
  const makeStub = (name: string, testid: string) =>
    function Stub(props: Record<string, unknown>) {
      captured[name] = props;
      return React.createElement('div', { 'data-testid': testid });
    };
  return {
    ...actual,
    FleetCostKpis: makeStub('kpis', 'stub-kpis'),
    CostByVehicleChart: makeStub('chart', 'stub-chart'),
    TopTalkersPanel: makeStub('talkers', 'stub-talkers'),
    VehicleCostTable: makeStub('table', 'stub-table'),
  };
});

import VehicleCostPage from './VehicleCostPage';
import { ApiError } from '@/lib/resilience';
import type {
  VehicleCostResponse,
  VehicleCostRow,
} from '@/types/admin-operator-confidence';

interface FakeQuery {
  data?: VehicleCostResponse;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeRow(overrides: Partial<VehicleCostRow>): VehicleCostRow {
  return {
    vehicle_id: 0,
    display_name: 'Vehicle',
    signal_row_count: 0,
    signal_bytes_est: 0,
    ingest_rate_per_minute_24h: 0,
    dlq_failures_24h: 0,
    last_seen_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// Fixture where the BYTES ranking and the ROWS ranking deliberately diverge,
// so a passing ordering assertion can only mean the page used the right key.
//   bytes desc → Cybertruck (864k) > Vehicle #3 (384k) > Model 3 (96k)
//   rows  desc → Model 3 (9000)   > Vehicle #3 (4000)  > Cybertruck (1000)
const RESPONSE: VehicleCostResponse = {
  vehicles: [
    makeRow({
      vehicle_id: 1,
      display_name: 'Model 3',
      signal_row_count: 9000,
      signal_bytes_est: 96_000,
      dlq_failures_24h: 0,
    }),
    makeRow({
      vehicle_id: 2,
      display_name: 'Cybertruck',
      signal_row_count: 1000,
      signal_bytes_est: 864_000,
      dlq_failures_24h: 3,
    }),
    makeRow({
      vehicle_id: 3,
      display_name: null,
      signal_row_count: 4000,
      signal_bytes_est: 384_000,
      dlq_failures_24h: 0,
    }),
  ],
  totals: {
    total_rows: 14_000,
    total_bytes_est: 1_344_000,
    total_rate_per_minute_24h: 12.5,
    total_failures_24h: 3,
  },
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VehicleCostPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useVehicleCostMock.mockReset();
  for (const key of Object.keys(captured)) delete captured[key];
});

describe('VehicleCostPage', () => {
  it('renders the page title and mounts all four data sections + toolbar', () => {
    useVehicleCostMock.mockReturnValue(makeQuery({ data: RESPONSE }));
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Vehicle Ingest Cost' }),
    ).toBeInTheDocument();
    // Every section is present — no gutted / hidden panels.
    expect(screen.getByTestId('stub-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('stub-chart')).toBeInTheDocument();
    expect(screen.getByTestId('stub-talkers')).toBeInTheDocument();
    expect(screen.getByTestId('stub-table')).toBeInTheDocument();
    // Real toolbar rendered (native window <select> + refresh button).
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refresh vehicle cost data' }),
    ).toBeInTheDocument();
  });

  it('calls useVehicleCost with a ~30d "since" Date and a limit of 100', () => {
    useVehicleCostMock.mockReturnValue(makeQuery({ data: RESPONSE }));
    renderPage();

    expect(useVehicleCostMock).toHaveBeenCalled();
    const [since, limit] = useVehicleCostMock.mock.calls[0];
    expect(since).toBeInstanceOf(Date);
    expect(limit).toBe(100);
    const daysAgo = (Date.now() - (since as Date).getTime()) / 86_400_000;
    expect(Math.round(daysAgo)).toBe(30);
  });

  it('feeds cost bars sorted by BYTES and top talkers sorted by ROWS', () => {
    useVehicleCostMock.mockReturnValue(makeQuery({ data: RESPONSE }));
    renderPage();

    const bars = captured.chart.bars as Array<{ name: string; bytes: number }>;
    const talkers = captured.talkers.talkers as Array<{ name: string; rows: number }>;

    expect(bars.map((b) => b.name)).toEqual(['Cybertruck', 'Vehicle #3', 'Model 3']);
    expect(talkers.map((tk) => tk.name)).toEqual(['Model 3', 'Vehicle #3', 'Cybertruck']);
    // Same source rows, two different orderings ⇒ the sort key really is honoured.
    expect(bars.map((b) => b.name)).not.toEqual(talkers.map((tk) => tk.name));
    expect(captured.talkers.totalRows).toBe(14_000);
  });

  it('passes real totals, derived vehicle count and window down to the KPI band', () => {
    useVehicleCostMock.mockReturnValue(makeQuery({ data: RESPONSE }));
    renderPage();

    expect(captured.kpis.totals).toEqual(RESPONSE.totals);
    expect(captured.kpis.vehicleCount).toBe(3);
    expect(captured.kpis.windowDays).toBe(30);
    expect(captured.kpis.loading).toBe(false);
    expect(captured.kpis.error).toBeNull();
    // Table receives the untouched rows array (same reference — no copy).
    expect(captured.table.vehicles).toBe(RESPONSE.vehicles);
  });

  it('falls back to "Vehicle #{id}" when a row has no display name', () => {
    useVehicleCostMock.mockReturnValue(makeQuery({ data: RESPONSE }));
    renderPage();

    const bars = captured.chart.bars as Array<{ vehicle_id: number; name: string }>;
    const unnamed = bars.find((b) => b.vehicle_id === 3);
    expect(unnamed?.name).toBe('Vehicle #3');
  });

  it('propagates the loading flag and empty derives while the first fetch is in flight', () => {
    useVehicleCostMock.mockReturnValue(
      makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 }),
    );
    renderPage();

    expect(captured.kpis.loading).toBe(true);
    expect(captured.chart.loading).toBe(true);
    expect((captured.chart.bars as unknown[]).length).toBe(0);
    // Refresh is disabled during an in-flight fetch to prevent double-loads.
    expect(
      screen.getByRole('button', { name: 'Refresh vehicle cost data' }),
    ).toBeDisabled();
  });

  it('shows the subsystem-missing banner and suppresses section errors on a 503', () => {
    const err = new ApiError('subsystem not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED');
    useVehicleCostMock.mockReturnValue(
      makeQuery({ error: err, isError: true, dataUpdatedAt: 0 }),
    );
    renderPage();

    expect(screen.getByText('Subsystem unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/ingest-x-ray subsystem is not configured/i),
    ).toBeInTheDocument();
    // sectionError is nulled so panels render calm empty states, not red errors.
    expect(captured.kpis.error).toBeNull();
    expect(captured.chart.error).toBeNull();
    expect(captured.talkers.error).toBeNull();
    expect(captured.table.error).toBeNull();
  });

  it('passes a generic (non-503) error straight through to every section', () => {
    const err = new ApiError('boom', 500);
    useVehicleCostMock.mockReturnValue(
      makeQuery({ error: err, isError: true, dataUpdatedAt: 0 }),
    );
    renderPage();

    expect(screen.queryByText('Subsystem unavailable')).not.toBeInTheDocument();
    expect(captured.kpis.error).toBe(err);
    expect(captured.chart.error).toBe(err);
    expect(captured.table.error).toBe(err);
  });

  it('degrades to empty derives when the response omits the vehicles array', () => {
    // Backend contract says `vehicles` is always present, but the page must not
    // assume it — a partial payload must not throw.
    const partial = { totals: RESPONSE.totals } as VehicleCostResponse;
    useVehicleCostMock.mockReturnValue(makeQuery({ data: partial }));
    renderPage();

    expect((captured.chart.bars as unknown[]).length).toBe(0);
    expect((captured.table.vehicles as unknown[]).length).toBe(0);
    expect(captured.kpis.vehicleCount).toBe(0);
    expect(captured.talkers.totalRows).toBe(RESPONSE.totals.total_rows);
  });

  it('narrows the trailing window when the operator picks a shorter preset', async () => {
    useVehicleCostMock.mockReturnValue(makeQuery({ data: RESPONSE }));
    renderPage();

    const firstSince = useVehicleCostMock.mock.calls[0][0] as Date;

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } });

    await waitFor(() => expect(captured.kpis.windowDays).toBe(7));

    const calls = useVehicleCostMock.mock.calls;
    const lastSince = calls[calls.length - 1][0] as Date;
    // 7 days ago is more recent than 30 days ago ⇒ the window really narrowed.
    expect(lastSince.getTime()).toBeGreaterThan(firstSince.getTime());
    expect(calls[calls.length - 1][1]).toBe(100);
    const daysAgo = (Date.now() - lastSince.getTime()) / 86_400_000;
    expect(Math.round(daysAgo)).toBe(7);
  });

  it('triggers a refetch when the refresh button is pressed', () => {
    const query = makeQuery({ data: RESPONSE });
    useVehicleCostMock.mockReturnValue(query);
    renderPage();

    expect(query.refetch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh vehicle cost data' }),
    );
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });
});
