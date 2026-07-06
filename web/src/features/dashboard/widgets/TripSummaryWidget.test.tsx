/**
 * TripSummaryWidget — behaviour, conversion, branch + hardening coverage.
 *
 * The widget is the dashboard's road-trip rollup tile. Its surface under test:
 *
 *   1. Standard layout: a "Last Trip" summary block (name + date + a 4-up
 *      StatCard grid: Distance / Duration / Drives / Charge Stops) plus a
 *      "Recent Trips" list of the 2nd + 3rd trips (name, date, distance,
 *      duration, and a "{n} drv" badge).
 *   2. The SI-boundary conversion it owns: trips carry `total_distance_m`
 *      (metres); the widget converts to the user's unit via the REAL
 *      `convertDistanceFromSI` + REAL `fmtNumber`, so km↔mi is genuinely
 *      exercised on both branches.
 *   3. The responsive `size.cols` branch: compact (cols ≤ 1) collapses each
 *      recent row to distance-only (no duration, no drive badge).
 *   4. The "Recent Trips" gate: the list only appears when there is more than
 *      one trip.
 *   5. Loading / error / empty states (never a blank panel). The error branch
 *      is the key regression guard — the widget now forwards `error` so a fetch
 *      failure surfaces the shared QueryError panel instead of masquerading as
 *      the "No trips recorded yet" empty state.
 *   6. Freshness-control refresh → refetch.
 *   7. Null-safety + the empty/whitespace-name hardening: a `''` / whitespace /
 *      `null` name collapses to "Unnamed trip" (never a blank line), and a
 *      partial payload renders zeros without throwing.
 *   8. The `useTrips` window: the widget requests exactly `{ limit: 5 }`.
 *
 * Strategy (mirrors AnalyticsSummaryWidget.test.tsx + MediaHistoryWidget.test.tsx):
 *   - The data hook + useUnits are mocked with hoisted vi.fn()s so the network
 *     is never touched and every render is deterministic. The widget keeps the
 *     REAL number formatter, REAL convertDistanceFromSI, and REAL useDateFormat
 *     (composed from the global useSettings/useTimezone stubs in
 *     src/test-setup.ts), so conversions + duration maths are genuinely run.
 *   - react-i18next resolves the developer fallback string (interpolating
 *     `{{vars}}`), so assertions read the English defaults.
 *   - matchMedia is shimmed to report `prefers-reduced-motion: reduce`, which
 *     settles the freshness chip (framer-motion) deterministically.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls `useNavigate`.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

const { tripsMock, useUnitsMock } = vi.hoisted(() => ({
  tripsMock: vi.fn(),
  useUnitsMock: vi.fn(),
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

vi.mock('@/api/hooks/useTrips', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useTrips')>(
    '@/api/hooks/useTrips',
  );
  return { ...actual, useTrips: (...args: unknown[]) => tripsMock(...args) };
});

vi.mock('@/hooks/useUnits', () => ({ useUnits: () => useUnitsMock() }));

import TripSummaryWidget from './TripSummaryWidget';
import type { WidgetSize } from './types';
import type { Trip } from '@/api/types';

/* ── Fixtures ─────────────────────────────────────────────────────── */

// Round metres so the km↔mi conversion + 1-dp formatting is exact:
//   50_000 m → 50.0 km / 31.1 mi
//   10_000 m → 10.0 km /  6.2 mi
//   20_000 m → 20.0 km / 12.4 mi
function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 1,
    vehicle_id: 7,
    name: 'Trip',
    start_date: '2026-01-01T10:00:00Z',
    end_date: '2026-01-01T11:30:00Z', // 90 min → "1h 30m"
    started_at: '2026-01-01T10:00:00Z',
    ended_at: '2026-01-01T11:30:00Z',
    total_distance_m: 50_000,
    total_energy_wh: 0,
    total_duration_s: 5_400,
    total_cost: 0,
    drive_count: 7,
    charge_count: 9,
    created_at: '2026-01-01T10:00:00Z',
    ...overrides,
  };
}

const LAST_TRIP = makeTrip({
  id: 1,
  name: 'Big Sur Loop',
  total_distance_m: 50_000,
  start_date: '2026-01-01T10:00:00Z',
  end_date: '2026-01-01T11:30:00Z',
  drive_count: 7,
  charge_count: 9,
});

const TRIP_2 = makeTrip({
  id: 2,
  name: 'Coastal Run',
  total_distance_m: 10_000,
  start_date: '2026-01-02T08:00:00Z',
  end_date: '2026-01-02T08:45:00Z', // 45 min → "45m"
  drive_count: 3,
});

const TRIP_3 = makeTrip({
  id: 3,
  name: 'City Hop',
  total_distance_m: 20_000,
  start_date: '2026-01-03T09:00:00Z',
  end_date: '2026-01-03T09:20:00Z', // 20 min → "20m"
  drive_count: 5,
});

const TRIPS: Trip[] = [LAST_TRIP, TRIP_2, TRIP_3];

interface FakeQuery {
  data?: unknown;
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

function setUnits(distance: 'km' | 'mi') {
  useUnitsMock.mockReturnValue({ unitPrefs: { distance } });
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <TripSummaryWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  tripsMock.mockReset();
  useUnitsMock.mockReset();

  tripsMock.mockReturnValue(makeQuery({ data: TRIPS }));
  setUnits('km');
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('TripSummaryWidget', () => {
  it('requests exactly the five most recent trips', () => {
    renderWidget();
    expect(tripsMock).toHaveBeenCalledTimes(1);
    expect(tripsMock).toHaveBeenCalledWith({ limit: 5 });
  });

  it('renders the last-trip summary + recent list with km conversions', () => {
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Trip Summary')).toBeInTheDocument();
    expect(screen.getByText('Last Trip')).toBeInTheDocument();

    // Last-trip block: name + the 4-up StatCard grid.
    expect(screen.getByText('Big Sur Loop')).toBeInTheDocument();
    for (const label of ['Distance', 'Duration', 'Drives', 'Charge Stops']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // 50_000 m → 50.0 km; 90 min → "1h 30m"; counts pass through fmtInt.
    expect(screen.getByText('50.0 km')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();

    // Recent list: the 2nd + 3rd trips (never the last trip again).
    expect(screen.getByText('Recent Trips')).toBeInTheDocument();
    expect(screen.getByText('Coastal Run')).toBeInTheDocument();
    expect(screen.getByText('City Hop')).toBeInTheDocument();
    expect(screen.getByText('10.0 km')).toBeInTheDocument();
    expect(screen.getByText('20.0 km')).toBeInTheDocument();
    expect(screen.getByText('45m')).toBeInTheDocument();
    expect(screen.getByText('20m')).toBeInTheDocument();
    expect(screen.getByText('3 drv')).toBeInTheDocument();
    expect(screen.getByText('5 drv')).toBeInTheDocument();
  });

  it('applies the mi branch: real metres→miles conversion everywhere', () => {
    setUnits('mi');
    renderWidget();

    // 50_000 / 1609.344 = 31.07 → "31.1"; 10_000 → 6.2; 20_000 → 12.4.
    expect(screen.getByText('31.1 mi')).toBeInTheDocument();
    expect(screen.getByText('6.2 mi')).toBeInTheDocument();
    expect(screen.getByText('12.4 mi')).toBeInTheDocument();

    // The km-unit strings must be gone once converted.
    expect(screen.queryByText('50.0 km')).not.toBeInTheDocument();
    expect(screen.queryByText('10.0 km')).not.toBeInTheDocument();
  });

  it('compact layout drops each recent row to distance-only', () => {
    renderWidget({ cols: 1, rows: 2 });

    // The last-trip stat grid still renders in compact.
    expect(screen.getByText('50.0 km')).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();

    // Recent rows keep their distance…
    expect(screen.getByText('10.0 km')).toBeInTheDocument();
    expect(screen.getByText('20.0 km')).toBeInTheDocument();
    // …but drop the duration + drive badge.
    expect(screen.queryByText('45m')).not.toBeInTheDocument();
    expect(screen.queryByText('3 drv')).not.toBeInTheDocument();
  });

  it('omits the Recent Trips section when there is only one trip', () => {
    tripsMock.mockReturnValue(makeQuery({ data: [LAST_TRIP] }));
    renderWidget();

    // The last-trip block still renders…
    expect(screen.getByText('Big Sur Loop')).toBeInTheDocument();
    expect(screen.getByText('50.0 km')).toBeInTheDocument();
    // …but there is no "Recent Trips" list with a single trip.
    expect(screen.queryByText('Recent Trips')).not.toBeInTheDocument();
    expect(screen.queryByText('Coastal Run')).not.toBeInTheDocument();
  });

  it('renders an em dash for duration when the trip has no end date', () => {
    tripsMock.mockReturnValue(
      makeQuery({ data: [makeTrip({ id: 1, name: 'Ongoing Trip', end_date: null })] }),
    );
    renderWidget();

    // formatDurationRange(start, null) → "—"; the named trip must not itself
    // collapse to a dash, so exactly one "—" (the Duration card) is present.
    expect(screen.getByText('Ongoing Trip')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('collapses an empty / whitespace name to the "Unnamed trip" fallback', () => {
    // Regression guard for the tripName() hardening: a plain `?? fallback`
    // would leak `''` / `'   '` and render a blank line.
    tripsMock.mockReturnValue(
      makeQuery({ data: [makeTrip({ id: 1, name: '   ' })] }),
    );
    renderWidget();

    expect(screen.getByText('Unnamed trip')).toBeInTheDocument();
  });

  it('is null-safe: a partial payload renders zeros without crashing', () => {
    // The backend contract guarantees these fields, but a malformed row must
    // degrade cleanly rather than throw inside fmtInt / the distance converter.
    const partial = {
      id: 1,
      name: 'Sparse Trip',
      start_date: '2026-01-01T10:00:00Z',
      end_date: null,
    } as unknown as Trip;
    tripsMock.mockReturnValue(makeQuery({ data: [partial] }));

    expect(() => renderWidget()).not.toThrow();
    // distance undefined → 0 → "0.0 km"; counts undefined → 0.
    expect(screen.getByText('0.0 km')).toBeInTheDocument();
    expect(screen.getByText('Sparse Trip')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the empty state (keeping the titled shell) when there are no trips', () => {
    tripsMock.mockReturnValue(makeQuery({ data: [] }));
    renderWidget();

    expect(screen.getByText('Trip Summary')).toBeInTheDocument();
    expect(screen.getByText('No trips recorded yet')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No trip content rendered.
    expect(screen.queryByText('Last Trip')).not.toBeInTheDocument();
  });

  it('renders a skeleton placeholder while the trips query is loading', () => {
    tripsMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No shell content while loading.
    expect(screen.queryByText('Trip Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Big Sur Loop')).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the query fails', () => {
    // Regression guard: the widget now forwards `error` so a fetch failure is
    // distinguishable from genuinely-empty data. Before the fix the header +
    // "No trips recorded yet" empty state rendered and the failure masqueraded
    // as an empty dashboard.
    tripsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading empty state must NOT appear on error.
    expect(screen.queryByText('No trips recorded yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Trip Summary')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('refetches when the freshness control is activated', () => {
    const q = makeQuery({ data: TRIPS });
    tripsMock.mockReturnValue(q);
    renderWidget();

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });
});
