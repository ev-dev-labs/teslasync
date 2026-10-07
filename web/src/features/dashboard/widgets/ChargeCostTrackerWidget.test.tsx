/**
 * ChargeCostTrackerWidget — behavioural, branch, null-safety and a11y coverage
 * for the dashboard "Charge Cost Tracker" widget.
 *
 * The widget fetches the last 30 days of charging sessions and renders one of
 * three layouts driven by `size`:
 *   • compact (cols ≤ 1 && rows ≤ 1): a single big 30-day total-cost figure;
 *   • full non-tall (rows === 1): energy + cost cards plus an inline
 *     cost/distance + savings summary;
 *   • full tall (rows ≥ 2): the two cards above plus a cost/distance and a
 *     vs-gas-savings card.
 *
 * What this file pins:
 *   - the pure `computeMetrics` aggregation — energy summed from SI watt-hours,
 *     the "prefer recorded session cost, else estimate from kWh" branch, and
 *     null-safe handling of a missing `total_energy_added_wh`;
 *   - the UNIT FIX: the estimated range fed to `costPerDistanceUnit` /
 *     `estimateGasCost` is in SI METERS (~56 327 m for 10 kWh), never miles
 *     (35) — the pre-fix bug silently under-counted distance ~1609× and
 *     corrupted the cost-per-distance and gas-savings figures;
 *   - the LAYOUT SWITCH (compact / non-tall / tall) and each layout's empty
 *     state;
 *   - the ERROR fix: an errored INITIAL load (no cached data) shows an error
 *     panel, but a background-refetch error over cached data keeps the metrics
 *     on screen (matching AutomationHistoryWidget's `isError && !data` guard);
 *   - the REQUEST contract — snake_case params, no `/api/v1` prefix, and the
 *     `vehicles[0].id` fallback when no `vehicleId` prop is supplied;
 *   - the REFRESH control wiring (accessible chip → `refetch`) and the title
 *     heading.
 *
 * Strategy: `useQuery` is the network boundary and is fully controllable via a
 * hoisted mock (only the widget consumes it directly). `useVehicles`,
 * `useFormatting` and `useUnits` are mocked so formatting is deterministic and
 * the SI-meter contract is observable via spies. `react-i18next` echoes each
 * `t(key, fallback)` fallback (with `{{var}}` interpolation) so assertions read
 * against English copy. `DataFreshness`'s display hooks are stubbed. A
 * `<MemoryRouter>` wraps every render because the error panel navigates.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { ChargingSession } from '@/api/types';
import type { WidgetSize } from './types';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { useQueryMock, requestMock, vehiclesMock, formattingMock, unitsMock } =
  vi.hoisted(() => ({
    useQueryMock: vi.fn(),
    requestMock: vi.fn(() => Promise.resolve([])),
    vehiclesMock: vi.fn(),
    formattingMock: vi.fn(),
    unitsMock: vi.fn(),
  }));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  );
  return { ...actual, useQuery: (opts: unknown) => useQueryMock(opts) };
});

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: (...args: unknown[]) => requestMock(...args) };
});

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => formattingMock(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

// i18n → echo the developer fallback, interpolating `{{var}}` placeholders.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interp = (tpl: string, opts?: Record<string, unknown>) =>
    opts ? tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : '')) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) =>
        typeof fallback === 'string' ? interp(fallback, opts) : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// DataFreshness display hooks — stubbed so the freshness chip renders without a
// Settings/QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import ChargeCostTrackerWidget, { computeMetrics, type CostMetrics } from './ChargeCostTrackerWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';
const COST_PER_KWH = 0.12;
/** 1 mile in metres (kept local so the "meters not miles" pin is self-checking). */
const METERS_PER_MILE = 1609.344;
/** Efficiency used by the widget: ~3.5 mi/kWh expressed in SI metres per kWh. */
const AVG_M_PER_KWH = 3.5 * METERS_PER_MILE;

function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 7,
    started_at: NOW,
    ended_at: NOW,
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 10_000,
    peak_power_w: null,
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: NOW,
    duration_min: 30,
    cost: 5,
    ended_status: null,
    ...over,
  };
}

// Deterministic display-boundary spies with realistic SI-metre semantics.
let formatCurrency: ReturnType<typeof vi.fn>;
let costPerDistanceUnit: ReturnType<typeof vi.fn>;
let estimateGasCost: ReturnType<typeof vi.fn>;

interface QueryOverrides {
  data?: ChargingSession[];
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setQuery(over: QueryOverrides = {}) {
  const q = {
    data: undefined as ChargingSession[] | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  useQueryMock.mockReturnValue(q);
  return q;
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const NONTALL: WidgetSize = { cols: 2, rows: 1 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <ChargeCostTrackerWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

/** Pull the queryFn passed to the (mocked) useQuery on the most recent render. */
function lastQueryFn(): () => unknown {
  const opts = useQueryMock.mock.calls.at(-1)?.[0] as { queryFn: () => unknown };
  return opts.queryFn;
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  requestMock.mockReturnValue(Promise.resolve([]));

  formatCurrency = vi.fn((amount: number, decimals = 2) => `$${Number(amount).toFixed(decimals)}`);
  costPerDistanceUnit = vi.fn((kwh: number, distanceM: number) =>
    distanceM <= 0 ? null : (kwh * COST_PER_KWH) / (distanceM / METERS_PER_MILE),
  );
  estimateGasCost = vi.fn((distanceM: number) =>
    distanceM <= 0 ? null : (distanceM / METERS_PER_MILE / 30) * 3.5,
  );
  formattingMock.mockReturnValue({
    costPerKwh: COST_PER_KWH,
    currencySymbol: '$',
    formatEnergyCost: vi.fn(),
    formatCurrency,
    costPerDistanceUnit,
    estimateGasCost,
  });
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'mi',
      speed: 'mph',
      temperature: '°F',
      pressure: 'psi',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
  });
  setQuery({ data: [makeSession()] });
});

// ── computeMetrics (pure aggregation) ─────────────────────────────────────────

describe('computeMetrics', () => {
  it('sums SI energy and prefers a recorded session cost over the kWh estimate', () => {
    const costFn = vi.fn(() => 0.05);
    const gasFn = vi.fn(() => 20);
    const m: CostMetrics = computeMetrics(
      [
        makeSession({ total_energy_added_wh: 5_000, cost: 2.5 }), // recorded → 2.5
        makeSession({ total_energy_added_wh: 5_000, cost: null }), // estimate → 5 kWh * 0.13
      ],
      0.13,
      costFn,
      gasFn,
    );

    expect(m.totalKwh).toBeCloseTo(10, 9);
    expect(m.sessionCount).toBe(2);
    expect(m.totalCost).toBeCloseTo(2.5 + 5 * 0.13, 9); // 3.15
    expect(m.costPerDistance).toBe(0.05);
    expect(m.gasSavings).toBeCloseTo(20 - 3.15, 9); // 16.85
  });

  it('derives the estimated range in SI METERS (not miles) before calling the cost/gas helpers', () => {
    const costFn = vi.fn(() => null);
    const gasFn = vi.fn(() => null);
    computeMetrics([makeSession({ total_energy_added_wh: 10_000, cost: null })], 0.1, costFn, gasFn);

    const expectedMeters = 10 * AVG_M_PER_KWH; // 56 327.04 m for 10 kWh
    const distArg = costFn.mock.calls[0][1] as number;

    expect(distArg).toBeCloseTo(expectedMeters, 2);
    expect(gasFn.mock.calls[0][0]).toBeCloseTo(expectedMeters, 2);
    // Guard against a regression to the raw mile value (35) being passed as "meters".
    expect(distArg).not.toBeCloseTo(35, 1);
  });

  it('is null-safe for a missing energy value and an empty session list', () => {
    const withMissingEnergy = computeMetrics(
      [makeSession({ total_energy_added_wh: undefined as unknown as number, cost: 4 })],
      0.2,
      vi.fn(() => 0),
      vi.fn(() => 0),
    );
    expect(withMissingEnergy.totalKwh).toBe(0);
    expect(withMissingEnergy.totalCost).toBe(4);

    const empty = computeMetrics([], 0.12, vi.fn(() => null), vi.fn(() => null));
    expect(empty.totalKwh).toBe(0);
    expect(empty.sessionCount).toBe(0);
    expect(empty.totalDistanceM).toBe(0);
  });
});

// ── Loading & error states ────────────────────────────────────────────────────

describe('ChargeCostTrackerWidget — loading & error states', () => {
  it('renders only a skeleton (no heading or content) while loading', () => {
    setQuery({ isLoading: true, data: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByText('Total Energy')).toBeNull();
  });

  it('shows an error panel (not the empty state) when the initial load fails with no data', () => {
    setQuery({ isError: true, data: undefined });
    renderWidget(FULL);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No charge data')).toBeNull();
  });

  it('keeps cached metrics visible (no error panel) when a background refetch errors', () => {
    setQuery({ isError: true, data: [makeSession()] });
    renderWidget(FULL);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.getByText('Total Energy')).toBeInTheDocument();
  });
});

// ── Compact layout ────────────────────────────────────────────────────────────

describe('ChargeCostTrackerWidget — compact layout', () => {
  it('renders the 30-day total cost and its caption', () => {
    setQuery({ data: [makeSession({ cost: 12 }), makeSession({ cost: 8 })] });
    renderWidget(COMPACT);

    expect(screen.getByText('$20')).toBeInTheDocument(); // formatCurrency(20, 0)
    expect(screen.getByText('30-day cost')).toBeInTheDocument();
  });

  it('shows the empty state (not a $0 figure) when there are no sessions', () => {
    setQuery({ data: [] });
    renderWidget(COMPACT);

    expect(screen.getByText('No charge data')).toBeInTheDocument();
    expect(screen.queryByText('30-day cost')).toBeNull();
  });
});

// ── Full layout ───────────────────────────────────────────────────────────────

describe('ChargeCostTrackerWidget — full layout', () => {
  it('non-tall: renders the energy + cost cards and omits the tall-only savings card', () => {
    setQuery({ data: [makeSession({ total_energy_added_wh: 10_000, cost: 3 })] });
    renderWidget(NONTALL);

    expect(screen.getByText('Total Energy')).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText('10.0 kWh')).toBeInTheDocument(); // 10 kWh from 10 000 Wh
    expect(screen.queryByText('vs Gas Savings')).toBeNull();
  });

  it('tall: adds the cost/distance and gas-savings cards and exposes the title heading', () => {
    setQuery({ data: [makeSession({ total_energy_added_wh: 10_000, cost: 1 })] });
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /Charge Cost Tracker/i })).toBeInTheDocument();
    expect(screen.getByText('Cost / mi')).toBeInTheDocument(); // distanceUnit = 'mi'
    expect(screen.getByText('vs Gas Savings')).toBeInTheDocument();
  });

  it('renders realistic gas savings because SI meters (not miles) reach the helpers', () => {
    setQuery({ data: [makeSession({ total_energy_added_wh: 10_000, cost: 1 })] });
    renderWidget(FULL);

    // 10 kWh → ~35 mi of range → gas ≈ $4.08 → savings ≈ $3.08 vs the $1 charge cost.
    expect(screen.getByText('$3.08')).toBeInTheDocument();

    const distArg = costPerDistanceUnit.mock.calls.at(-1)?.[1] as number;
    expect(distArg).toBeCloseTo(10 * AVG_M_PER_KWH, 1); // ~56 327 m, not 35
    expect(estimateGasCost.mock.calls.at(-1)?.[0]).toBeCloseTo(10 * AVG_M_PER_KWH, 1);
  });

  it('falls back to "—" for gas savings when no gas price is configured (helper returns null)', () => {
    estimateGasCost.mockReturnValue(null);
    costPerDistanceUnit.mockReturnValue(null);
    setQuery({ data: [makeSession()] });
    renderWidget(FULL);

    expect(screen.getByText('Set gas price in settings')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

// ── Request contract ──────────────────────────────────────────────────────────

describe('ChargeCostTrackerWidget — request contract', () => {
  it('builds the charging request with snake_case params and no /api/v1 prefix', () => {
    setQuery({ data: [] });
    renderWidget(FULL, 7);

    lastQueryFn()();
    const url = requestMock.mock.calls.at(-1)?.[0] as string;

    expect(url).toContain('/charging?vehicle_id=7&limit=100&start=');
    expect(url).not.toContain('/api/v1');
    expect(url).not.toMatch(/vehicleId=/);
  });

  it('falls back to the first vehicle id when no vehicleId prop is provided', () => {
    vehiclesMock.mockReturnValue({ data: [{ id: 42, display_name: 'Other' }] });
    setQuery({ data: [] });
    renderWidget(FULL, undefined);

    lastQueryFn()();
    const url = requestMock.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain('vehicle_id=42');
  });
});

// ── Interactions & accessibility ──────────────────────────────────────────────

describe('ChargeCostTrackerWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setQuery({ data: [makeSession()] });
    renderWidget(FULL);

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });
});
