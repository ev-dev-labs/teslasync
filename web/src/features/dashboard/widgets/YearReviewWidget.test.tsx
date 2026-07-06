/**
 * YearReviewWidget — behaviour, unit-conversion correctness, responsive layout,
 * state handling, null-safety and a11y contract.
 *
 * The widget resolves a vehicle (explicit prop → first vehicle → none), reads a
 * single `useYearReview(year, vehicleId)` result and renders the year's headline
 * stats. It has three responsive shapes driven by `size.cols`:
 *
 *   - compact (`cols <= 1`)  → one big AnimatedNumber (total distance) + unit/year
 *   - standard (`2 <= cols`) → titled stat grid, 6 core stats
 *   - wide (`cols >= 3`)     → titled stat grid, 6 core + 2 extra stats
 *
 * The regression this suite pins down: the year-review API returns distances in
 * KILOMETRES (`total_distance_km`, `longest_drive.distance_km`) and speed in
 * KM/H (`fastest_speed_kmh`), but the SI-canonical converters
 * (`convertDistanceFromSI` / `convertSpeedFromSI`) expect METRES / M/S. The
 * widget previously multiplied km by KM_TO_MI and then fed the result straight
 * into the metre-based converter, under-reporting every distance/speed by
 * ~1000×. The fix lifts km → m (×1000) and km/h → m/s (÷3.6) first. The
 * `km` (12,000) and `mi` (7,456 / 112 / 310.7) expectations below only hold
 * with the corrected maths — the old code produced single-digit values.
 *
 * The network boundary (`request` from `@/api/client`) is mocked; TanStack Query
 * runs for real against it, so the `/analytics/year-review?year=…&vehicle_id=…`
 * request contract and the `enabled` gate are exercised end-to-end. `useVehicles`
 * and `useUnits` are mocked at the hook boundary (the latter lets us assert km vs
 * mi maths); `useSettings` / `useTimezone` come from the global test-setup stub
 * so the real `useDateFormat` inside `<WidgetShell>`'s `<DataFreshness>` works.
 * `react-i18next` is stubbed to echo the English fallback. `user-event` is not
 * installed in this repo (see sibling widget suites), so the interaction uses
 * `fireEvent`. `matchMedia` is forced to reduced-motion so `<AnimatedNumber>`
 * lands on its final value synchronously instead of racing jsdom's rAF clock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any interpolated copy renders as real text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Replace only the network primitive; keep the real `isApiError` etc. so
// <QueryError> classifies failures correctly.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// The vehicle list is a controllable vi.fn.
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
}));

// Unit preference is a controllable vi.fn so we can assert km vs mi maths
// without threading the real settings query.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: vi.fn(),
}));

import YearReviewWidget from './YearReviewWidget';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';
import type { WidgetProps } from './types';

const mockRequest = vi.mocked(request);
const mockUseVehicles = vi.mocked(useVehicles);
const mockUseUnits = vi.mocked(useUnits);

const YEAR = new Date().getFullYear();

/**
 * Force reduced motion so <AnimatedNumber> renders its final value immediately
 * (no rAF tween) and framer-motion inside <DataFreshness> skips animations.
 */
function installReducedMotionMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

/** Build a controllable `useUnits()` result with the given distance/speed unit. */
function unitsResult(distance: 'km' | 'mi' = 'km'): ReturnType<typeof useUnits> {
  return {
    unitPrefs: {
      distance,
      speed: distance === 'mi' ? 'mph' : 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
      precision: undefined,
    },
  } as unknown as ReturnType<typeof useUnits>;
}

/** A fully-populated YearReview payload with round numbers for clean assertions. */
function makeYearReview(over: Partial<YearReview> = {}): YearReview {
  return {
    year: YEAR,
    vehicle: { id: 1, display_name: 'Test Car', model: 'Model 3' },
    total_drives: 320,
    total_distance_km: 12000, // 12000 km → 12,000 km / 7,456 mi
    total_energy_kwh: 2400,
    total_charge_sessions: 90,
    total_driving_minutes: 18000, // 300 h
    total_charging_cost: 500,
    gas_savings: 1200,
    co2_offset_kg: 3400,
    longest_drive: {
      drive_id: 5,
      date: `${YEAR}-03-01`,
      distance_km: 500, // 500 km → 500.0 km / 310.7 mi
      duration_min: 300,
      start_address: 'A',
      end_address: 'B',
      efficiency_wh_km: 150,
    },
    shortest_drive: null,
    most_efficient_drive: null,
    least_efficient_drive: null,
    fastest_speed_kmh: 180, // 180 km/h → 180 km/h / 112 mph
    coldest_drive_temp_c: -5,
    hottest_drive_temp_c: 38,
    monthly_stats: [
      { month: 1, drives: 10, distance_km: 400, energy_kwh: 80, cost: 20 },
      { month: 7, drives: 55, distance_km: 2000, energy_kwh: 400, cost: 100 }, // busiest → Jul
      { month: 12, drives: 30, distance_km: 1200, energy_kwh: 240, cost: 60 },
    ],
    most_active_day_of_week: 'Fri',
    most_active_hour: 17,
    avg_drives_per_week: 6.2,
    avg_distance_per_drive_km: 37.5,
    avg_efficiency_wh_km: 152,
    supercharger_pct: 40,
    dc_fast_pct: 10,
    ac_other_pct: 50,
    avg_charge_start_soc: 35,
    comparisons: [],
    ...over,
  };
}

/** Route `/analytics/year-review` reads to the supplied payload; else → null. */
function routeYearReview(payload: YearReview | null) {
  mockRequest.mockImplementation((path: string) =>
    String(path).startsWith('/analytics/year-review')
      ? Promise.resolve(payload)
      : Promise.resolve(null),
  );
}

const yrCalls = () =>
  mockRequest.mock.calls.filter((c) => String(c[0]).startsWith('/analytics/year-review'));

function renderWidget(cols: number, vehicleId?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const props = { vehicleId, size: { cols, rows: 2 } } as WidgetProps;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearReviewWidget {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installReducedMotionMatchMedia();
  // Pin formatter globals for deterministic thousands separators.
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as never);
  mockUseUnits.mockReturnValue(unitsResult('km'));
  routeYearReview(makeYearReview());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Vehicle resolution + request contract ───────────────────────────────────

describe('YearReviewWidget vehicle resolution', () => {
  it('prefers the explicit vehicleId prop and issues the snake_case request', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    renderWidget(2, 42);

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        `/analytics/year-review?year=${YEAR}&vehicle_id=42`,
        expect.anything(),
      ),
    );
    // The vehicle-list fallback must NOT win when a prop is supplied.
    expect(
      yrCalls().some((c) => String(c[0]).includes('vehicle_id=7')),
    ).toBe(false);
  });

  it('falls back to the first vehicle when no prop is given', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    renderWidget(2);

    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        `/analytics/year-review?year=${YEAR}&vehicle_id=7`,
        expect.anything(),
      ),
    );
  });

  it('never queries when no vehicle resolves (id 0 keeps the query disabled)', async () => {
    mockUseVehicles.mockReturnValue({ data: [] } as never);
    routeYearReview(makeYearReview()); // would populate IF the guard were wrong
    renderWidget(2);

    // Empty state (never a blank panel) and no request fired.
    expect(await screen.findByText('No year-in-review data')).toBeInTheDocument();
    expect(yrCalls()).toHaveLength(0);
  });
});

// ── States: loading / error / empty ─────────────────────────────────────────

describe('YearReviewWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while fetching', () => {
    mockRequest.mockImplementation(() => new Promise(() => {})); // hang
    const { container } = renderWidget(2, 1);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText(`Year in Review ${YEAR}`)).toBeNull();
    expect(screen.queryByText('No year-in-review data')).toBeNull();
  });

  it('surfaces a QueryError — not the empty state — when the request fails', async () => {
    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/analytics/year-review')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(null),
    );
    renderWidget(2, 1);

    // Regression: a failed request must NOT masquerade as "no data".
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No year-in-review data')).toBeNull();
    expect(screen.queryByText(`Year in Review ${YEAR}`)).toBeNull();
  });

  it('shows the empty state when the endpoint returns no payload', async () => {
    routeYearReview(null);
    renderWidget(2, 1);

    const empty = await screen.findByText('No year-in-review data');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });
});

// ── Populated: standard (2-col) ─────────────────────────────────────────────

describe('YearReviewWidget standard layout', () => {
  it('renders the titled core stat grid with correctly-scaled km values', async () => {
    renderWidget(2, 1);

    expect(await screen.findByText(`Year in Review ${YEAR}`)).toBeInTheDocument();

    // Total distance: 12000 km → 12,000 km (NOT the old ~7 the bug produced).
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument(); // total drives
    expect(screen.getByText('2,400.0')).toBeInTheDocument(); // energy kWh
    expect(screen.getByText('3,400')).toBeInTheDocument(); // CO₂ kg
    expect(screen.getByText('Jul')).toBeInTheDocument(); // busiest month
    expect(screen.getByText('500.0')).toBeInTheDocument(); // longest drive km

    // Standard layout must NOT include the wide-only stats.
    expect(screen.queryByText('Driving Time')).toBeNull();
    expect(screen.queryByText('Top Speed')).toBeNull();
  });
});

// ── Populated: wide (4-col) ─────────────────────────────────────────────────

describe('YearReviewWidget wide layout', () => {
  it('adds Driving Time and Top Speed to the grid', async () => {
    renderWidget(4, 1);

    expect(await screen.findByText('Driving Time')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument(); // 18000 min → 300 h
    expect(screen.getByText('Top Speed')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument(); // 180 km/h
    // Core stats still present.
    expect(screen.getByText('12,000')).toBeInTheDocument();
  });
});

// ── Unit conversion regression: mi / mph ────────────────────────────────────

describe('YearReviewWidget unit conversion (mi/mph)', () => {
  it('converts km→mi and km/h→mph via the SI floor (proves the ×1000 / ÷3.6 fix)', async () => {
    mockUseUnits.mockReturnValue(unitsResult('mi'));
    renderWidget(4, 1);

    // 12000 km → 12000*1000 m / 1609.344 = 7,456 mi.
    expect(await screen.findByText('7,456')).toBeInTheDocument();
    // 180 km/h → (180/3.6) m/s → 111.85 → 112 mph.
    expect(screen.getByText('112')).toBeInTheDocument();
    // 500 km → 310.7 mi.
    expect(screen.getByText('310.7')).toBeInTheDocument();

    // The mi unit label is shown, and the old broken single-digit km value is gone.
    expect(screen.getAllByText('mi').length).toBeGreaterThan(0);
    expect(screen.queryByText('12,000')).toBeNull();
  });
});

// ── Compact (1-col) ─────────────────────────────────────────────────────────

describe('YearReviewWidget compact layout', () => {
  it('renders a single big number with unit + year and no stat grid', async () => {
    renderWidget(1, 1);

    // AnimatedNumber lands on the converted distance (reduced motion pinned).
    expect(await screen.findByText('12,000')).toBeInTheDocument();
    // Unit + "in {year}" caption.
    expect(screen.getByText(/km\s+in\s+2/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(String(YEAR)))).toBeInTheDocument();

    // Compact has no title and no stat-grid labels.
    expect(screen.queryByText(`Year in Review ${YEAR}`)).toBeNull();
    expect(screen.queryByText('Total Drives')).toBeNull();
  });
});

// ── Null-safety ─────────────────────────────────────────────────────────────

describe('YearReviewWidget null-safety', () => {
  it('renders 0/— placeholders (never NaN/undefined) for missing fields', async () => {
    routeYearReview(
      makeYearReview({
        total_distance_km: undefined as unknown as number,
        total_drives: undefined as unknown as number,
        total_energy_kwh: undefined as unknown as number,
        co2_offset_kg: undefined as unknown as number,
        longest_drive: null,
        fastest_speed_kmh: undefined as unknown as number,
        total_driving_minutes: undefined as unknown as number,
        monthly_stats: [],
      }),
    );
    renderWidget(4, 1);

    await screen.findByText(`Year in Review ${YEAR}`);

    // Busiest month with no monthly stats collapses to the em-dash placeholder.
    expect(screen.getByText('—')).toBeInTheDocument();
    // Missing longest drive + missing energy → 0.0 (both 1-dp stats).
    expect(screen.getAllByText('0.0').length).toBeGreaterThanOrEqual(1);
    // Nothing leaked NaN / undefined into the DOM.
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });

  it('picks the month with the most drives for "Best Month"', async () => {
    routeYearReview(
      makeYearReview({
        monthly_stats: [
          { month: 2, drives: 3, distance_km: 100, energy_kwh: 20, cost: 5 },
          { month: 11, drives: 99, distance_km: 900, energy_kwh: 180, cost: 45 },
        ],
      }),
    );
    renderWidget(2, 1);

    // November has the most drives → 'Nov'.
    expect(await screen.findByText('Nov')).toBeInTheDocument();
    expect(screen.queryByText('Feb')).toBeNull();
  });
});

// ── Refresh interaction ─────────────────────────────────────────────────────

describe('YearReviewWidget refresh', () => {
  it('re-issues the year-review read when the freshness control is activated', async () => {
    renderWidget(2, 1);

    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    const before = yrCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(yrCalls().length).toBe(before + 1));
  });
});
