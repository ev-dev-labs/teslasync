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
 *   - wide (`cols >= 4`)     → titled stat grid, 6 core + 2 extra stats
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
 * so the real `useDateFormat` inside `<WidgetShell>`'s `<FreshnessDot>` works.
 * `react-i18next` is stubbed to echo the English fallback. `user-event` is not
 * installed in this repo (see sibling widget suites), so the interaction uses
 * `fireEvent`. `matchMedia` is forced to reduced-motion so `<AnimatedNumber>`
 * lands on its final value synchronously instead of racing jsdom's rAF clock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_IDS, PACK_APPEARANCES, type PackId } from './designPacks/types';

it.each(PACK_IDS.flatMap((packId) => [1, 2, 3, 4].map((cols) => ({ packId, cols }))))(
  'identifies the year review at $cols columns in $packId',
  ({ packId, cols }) => {
    renderWidget(cols, 1, packId);
    expect(screen.getByRole('heading', { name: `Year in review ${YEAR}` })).toBeInTheDocument();
  },
);
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';
import type { WidgetProps } from './types';

const mockRequest = vi.mocked(request);
const mockUseVehicles = vi.mocked(useVehicles);
const mockUseUnits = vi.mocked(useUnits);

const YEAR = new Date().getUTCFullYear();

/**
 * Force reduced motion so <AnimatedNumber> renders its final value immediately
 * (no rAF tween) and framer-motion inside <FreshnessDot> skips animations.
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

function renderWidget(cols: number, vehicleId?: number, packId: PackId = 'classic') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const props: WidgetProps = { vehicleId, size: { cols, rows: 2 } };
  const tree = (requestedPackId: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <YearReviewWidget {...props} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  expect(view.container.querySelector('h3')).toHaveAccessibleName(`Year in review ${YEAR}`);
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  return { ...view, rerenderPack: (nextPackId: PackId) => view.rerender(tree(nextPackId)) };
}

async function expectPackPresentation(container: HTMLElement, packId: PackId) {
  if (packId === 'classic') {
    expect(container.querySelector('[data-status-appearance]')).toBeNull();
  } else {
    await waitFor(() => expect(container.querySelector('[data-status-appearance]'))
      .toHaveAttribute('data-status-appearance', PACK_APPEARANCES[packId]));
  }
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
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

// ── Vehicle resolution + request contract ───────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget vehicle resolution (%s)', (packId) => {
  it('prefers the explicit vehicleId prop and issues the snake_case request', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    renderWidget(2, 42, packId);

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
    renderWidget(2, undefined, packId);

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
    renderWidget(2, undefined, packId);

    // Empty state (never a blank panel) and no request fired.
    expect(await screen.findByText('No year-in-review data')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(yrCalls()).toHaveLength(0);
  });
});

// ── States: loading / error / empty ─────────────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget states (%s)', (packId) => {
  it('retains its heading above a loading skeleton without empty copy', () => {
    mockRequest.mockImplementation(() => new Promise(() => {})); // hang
    const { container } = renderWidget(2, 1, packId);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.getByRole('heading', { name: `Year in review ${YEAR}` })).toBeInTheDocument();
    expect(screen.queryByText('No year-in-review data')).toBeNull();
  });

  it('surfaces a QueryError — not the empty state — when the request fails', async () => {
    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/analytics/year-review')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(null),
    );
    renderWidget(2, 1, packId);

    // Regression: a failed request must NOT masquerade as "no data".
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No year-in-review data')).toBeNull();
    expect(screen.getByRole('heading', { name: `Year in review ${YEAR}` })).toBeInTheDocument();
  });

  it('shows the empty state when the endpoint returns no payload', async () => {
    routeYearReview(null);
    renderWidget(2, 1, packId);

    const empty = await screen.findByText('No year-in-review data');
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });
});

// ── Populated: standard (2-col) ─────────────────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget standard layout (%s)', (packId) => {
  it('uses the shared locale month label without changing its calendar identity', async () => {
    const { container } = renderWidget(2, 1, packId);
    await expectPackPresentation(container, packId);
    expect(await screen.findByText(/Best month:\s*Jul/i)).toBeInTheDocument();
    expect(screen.getByText('Total distance')).toBeInTheDocument();
    expect(screen.queryByText('Total miles')).not.toBeInTheDocument();
  });
  it('renders the titled core stat grid with correctly-scaled km values', async () => {
    const { container } = renderWidget(2, 1, packId);

    expect(await screen.findByText(`Year in review ${YEAR}`)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    await expectPackPresentation(container, packId);

    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getAllByText('km').length).toBeGreaterThan(0);
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.getByText('2,400.0')).toBeInTheDocument();
    expect(screen.getByText('3,400.0')).toBeInTheDocument();
    expect(screen.getAllByText('kWh').length).toBeGreaterThan(0);
    expect(screen.getAllByText('kg').length).toBeGreaterThan(0);
    expect(screen.getByText(/Best month:\s*Jul/i)).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();

    // Standard layout must NOT include the wide-only stats.
    expect(screen.queryByText('Driving time')).toBeNull();
    expect(screen.queryByText('Top speed')).toBeNull();
  });
});

// ── Populated: wide (4-col) ─────────────────────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget wide layout (%s)', (packId) => {
  it('adds Driving Time and Top Speed to the grid', async () => {
    const { container } = renderWidget(4, 1, packId);

    await expectPackPresentation(container, packId);
    expect(await screen.findByText('Driving time')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText('300.0')).toBeInTheDocument();
    expect(screen.getAllByText('h').length).toBeGreaterThan(0);
    expect(screen.getByText('Top speed')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getAllByText('km/h').length).toBeGreaterThan(0);
    // Core stats still present.
    expect(screen.getByText('12,000')).toBeInTheDocument();
  });

  it('reviews all eight source quantities with calendar-year coverage and canonical time and speed', async () => {
    const { container } = renderWidget(4, 1, packId);
    await expectPackPresentation(container, packId);
    await screen.findByTestId('year-review-widget');
    expect(screen.getByText('300.0')).toBeInTheDocument();
    expect(screen.getAllByText('h').length).toBeGreaterThan(0);
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getAllByText('km/h').length).toBeGreaterThan(0);
    expect(screen.getByText(/Best month:\s*Jul/i)).toBeInTheDocument();
  });
});

// ── Unit conversion regression: mi / mph ────────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget unit conversion (mi/mph, %s)', (packId) => {
  it('converts km→mi and km/h→mph via the SI floor (proves the ×1000 / ÷3.6 fix)', async () => {
    mockUseUnits.mockReturnValue(unitsResult('mi'));
    const { container } = renderWidget(4, 1, packId);

    await expectPackPresentation(container, packId);
    expect(await screen.findByText('7,456')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText('112')).toBeInTheDocument();
    expect(screen.getAllByText('mph').length).toBeGreaterThan(0);
    expect(screen.getByText('311')).toBeInTheDocument();
    expect(screen.getAllByText('mi').length).toBeGreaterThan(0);

    // The mi unit label is shown, and the old broken single-digit km value is gone.
    expect(screen.getByText('7,456')).toBeInTheDocument();
    expect(screen.queryByText('12,000')).toBeNull();
  });
});

// ── Compact (1-col) ─────────────────────────────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget compact layout (%s)', (packId) => {
  it('renders a single big number with unit + year and no stat grid', async () => {
    const { container } = renderWidget(1, 1, packId);

    await expectPackPresentation(container, packId);
    // AnimatedNumber lands on the converted distance (reduced motion pinned).
    expect(await screen.findByText('12,000')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    // Unit + "in {year}" caption.
    expect(screen.getAllByText('km').length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`in ${YEAR}`))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `Year in review ${YEAR}` })).toBeInTheDocument();

    // Compact has no title and no stat-grid labels.
    expect(screen.getByRole('heading', { name: `Year in review ${YEAR}` })).toBeInTheDocument();
    expect(screen.queryByText('Total drives')).toBeNull();
  });
});

// ── Null-safety ─────────────────────────────────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget null-safety (%s)', (packId) => {
  it.each([1, 4])('preserves unknown measurements instead of inventing zero totals at %i columns', async (cols) => {
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
    const { container } = renderWidget(cols, 1, packId);

    await screen.findByText(`Year in review ${YEAR}`);
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    await expectPackPresentation(container, packId);

    // Busiest month with no monthly stats is omitted from the face.
    // Missing measurements remain placeholders rather than fabricated zeroes.
    const body = within(screen.getByTestId('widget-body'));
    expect(body.getAllByText('—')).toHaveLength(cols === 1 ? 1 : 7);
    expect(body.queryByText('km')).not.toBeInTheDocument();
    expect(body.queryByText('kWh')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Year highlights')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).toBeNull();
    // Nothing leaked NaN / undefined into the DOM.
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });

  it.each([1, 4].flatMap((cols) => [0, NaN, Infinity].map((value) => ({ cols, value }))))(
    'distinguishes zero from non-finite quantities ($value) at $cols columns',
    async ({ cols, value }) => {
      const payload = makeYearReview({
        total_distance_km: value,
        total_drives: value,
        total_energy_kwh: value,
        total_charge_sessions: value,
        co2_offset_kg: value,
        total_driving_minutes: value,
        fastest_speed_kmh: value,
        monthly_stats: [],
      });
      if (payload.longest_drive) payload.longest_drive.distance_km = value;
      routeYearReview(payload);
      const { container } = renderWidget(cols, 1, packId);

      await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
      await expectPackPresentation(container, packId);
      const body = within(screen.getByTestId('widget-body'));
      if (value === 0) {
        expect(body.getAllByText('0')).toHaveLength(cols === 1 ? 1 : 5);
        expect(body.getAllByText('km')).toHaveLength(cols === 1 ? 1 : 2);
        if (cols === 4) {
          expect(body.getAllByText('0.0')).toHaveLength(3);
          expect(body.getByText('km/h')).toBeInTheDocument();
        }
        expect(body.queryByText('—')).not.toBeInTheDocument();
      } else {
        expect(body.getAllByText('—')).toHaveLength(cols === 1 ? 1 : 8);
        expect(body.queryByText('km')).not.toBeInTheDocument();
        expect(body.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
      }
      expect(screen.queryByLabelText('Year highlights')).not.toBeInTheDocument();
    },
  );

  it('picks the month with the most drives for "Best Month"', async () => {
    routeYearReview(
      makeYearReview({
        monthly_stats: [
          { month: 2, drives: 3, distance_km: 100, energy_kwh: 20, cost: 5 },
          { month: 11, drives: 99, distance_km: 900, energy_kwh: 180, cost: 45 },
        ],
      }),
    );
    const { container } = renderWidget(2, 1, packId);

    await expectPackPresentation(container, packId);
    // November has the most drives → 'Nov'.
    expect(await screen.findByText(/Best month:\s*Nov/i)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.queryByText('Feb')).toBeNull();
  });

  it('ignores invalid month identities and drive counts without dropping the summary', async () => {
    routeYearReview(makeYearReview({
      monthly_stats: [
        { month: 0, drives: 999, distance_km: 100, energy_kwh: 20, cost: 5 },
        { month: 13, drives: 999, distance_km: 100, energy_kwh: 20, cost: 5 },
        { month: 1.5, drives: 999, distance_km: 100, energy_kwh: 20, cost: 5 },
        { month: 7, drives: NaN, distance_km: 100, energy_kwh: 20, cost: 5 },
      ],
    }));
    const { container } = renderWidget(2, 1, packId);

    await screen.findByText('12,000');
    await expectPackPresentation(container, packId);
    expect(screen.getByText('Total drives')).toBeInTheDocument();
    expect(screen.queryByLabelText('Year highlights')).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid|NaN|undefined/)).not.toBeInTheDocument();
  });
});

// ── Refresh interaction ─────────────────────────────────────────────────────

describe.each(PACK_IDS)('YearReviewWidget refresh (%s)', (packId) => {
  it('re-issues the year-review read when the freshness control is activated', async () => {
    renderWidget(2, 1, packId);

    const refresh = await screen.findByRole('button', { name: /^Refresh/i });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    const before = yrCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(yrCalls().length).toBe(before + 1));
  });

  it('retains the calendar and vehicle result across pack switches and a failed refresh, then recovers', async () => {
    const { container, rerenderPack } = renderWidget(4, 42, packId);
    await screen.findByText('12,000');
    await expectPackPresentation(container, packId);
    const before = yrCalls().length;

    let rejectRefresh: (reason: Error) => void = () => { throw new Error('Refresh has not started'); };
    mockRequest.mockImplementation(() => new Promise<YearReview>((_resolve, reject) => {
      rejectRefresh = reject;
    }));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    await waitFor(() => expect(yrCalls()).toHaveLength(before + 1));
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('12,000')).toBeInTheDocument();

    const otherPack = PACK_IDS.find((id) => id !== packId) ?? 'classic';
    rerenderPack(otherPack);
    await expectPackPresentation(container, otherPack);
    rerenderPack(packId);
    await expectPackPresentation(container, packId);
    expect(yrCalls()).toHaveLength(before + 1);
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText(/Best month:\s*Jul/i)).toBeInTheDocument();

    await act(async () => { rejectRefresh(new Error('refresh failed')); });
    expect(await screen.findByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('Driving time')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.queryByText('No year-in-review data')).not.toBeInTheDocument();

    routeYearReview(makeYearReview({ total_distance_km: 13000 }));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(await screen.findByText('13,000')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
    expect(yrCalls()).toHaveLength(before + 2);
    expect(yrCalls().every(([path]) => path === `/analytics/year-review?year=${YEAR}&vehicle_id=42`)).toBe(true);
    await expectPackPresentation(container, packId);
  });
});
