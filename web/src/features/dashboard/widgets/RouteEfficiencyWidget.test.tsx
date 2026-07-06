/**
 * RouteEfficiencyWidget — behaviour, hardening & a11y contract.
 *
 * The widget resolves a vehicle (explicit prop → first vehicle → none), reads a
 * single `useQuery('/analytics/route-efficiency?vehicle_id=…')` result and fans
 * it into three responsive layouts (compact 1×1 list-only / standard titled
 * ranked list / wide list with per-route best/worst annotations) — or the
 * loading / empty / error states. This suite drives the whole component through
 * its accessible surface:
 *
 *   - vehicle resolution (prop wins over the vehicle list; the list supplies the
 *     fallback; no vehicle keeps the query DISABLED so `/analytics/route-
 *     efficiency` is never hit and an empty state renders instead of a blank
 *     panel);
 *   - the loading / empty / error paths — most importantly that a FAILED request
 *     surfaces a `QueryError` (role="alert"), NOT the misleading "No route data"
 *     empty state;
 *   - the populated ranked list: title + icon, the `A → B` route label, the
 *     `<eff> <unit> · <trips>×` formatted value, and the four efficiency badge
 *     buckets (Excellent / Good / Fair / Poor);
 *   - the SI→display efficiency maths (km passthrough AND the ×1.609344 mile
 *     conversion, applied to both the value and the wide-mode best/worst
 *     annotations);
 *   - the "best route" highlight (lowest raw efficiency → emerald bar, the rest
 *     → blue);
 *   - null-safety: a route with null locations / null efficiency / null trip
 *     count renders "—" and "0" placeholders instead of NaN / "undefined";
 *   - the compact (title-less) and wide (annotated) layout variants;
 *   - the freshness refresh interaction re-issuing the read.
 *
 * The network boundary (`request` from `@/api/client`) is mocked; TanStack Query
 * runs for real against it (so the request URL contract and `enabled` gating are
 * exercised end to end). `useVehicles` and `useUnits` are mocked at the hook
 * boundary. `react-i18next` is stubbed to echo the English fallback.
 * `@testing-library/user-event` is not installed in this repo (see the sibling
 * RecentDrivesWidget / ChargeSessionChartWidget suites), so the one interaction
 * goes through `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

import RouteEfficiencyWidget from './RouteEfficiencyWidget';
import { request } from '@/api/client';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import type { RouteEfficiencyData, RouteSummary } from '@/types/driving';
import type { WidgetProps } from './types';

const mockRequest = vi.mocked(request);
const mockUseVehicles = vi.mocked(useVehicles);
const mockUseUnits = vi.mocked(useUnits);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Build a controllable `useUnits()` result with the given distance unit. */
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

let routeSeq = 0;
function makeRoute(over: Partial<RouteSummary> = {}): RouteSummary {
  routeSeq += 1;
  return {
    startLocation: `Start ${routeSeq}`,
    endLocation: `End ${routeSeq}`,
    tripCount: 5,
    avgDistanceKm: 20,
    avgEfficiency: 200,
    bestEfficiency: 180,
    worstEfficiency: 260,
    ...over,
  };
}

function routeData(routes: RouteSummary[]): RouteEfficiencyData {
  return { routes, totalRoutes: routes.length, totalTrips: routes.reduce((s, r) => s + (r.tripCount ?? 0), 0) };
}

/** Route `/analytics/route-efficiency` reads to the supplied payload. */
function routeRequest(data: RouteEfficiencyData) {
  mockRequest.mockImplementation((path: string) =>
    String(path).startsWith('/analytics/route-efficiency')
      ? Promise.resolve(data)
      : Promise.resolve([]),
  );
}

const routeEffCalls = () =>
  mockRequest.mock.calls.filter((c) => String(c[0]).startsWith('/analytics/route-efficiency'));

function renderWidget(opts: { vehicleId?: number; cols?: number } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const props = {
    vehicleId: opts.vehicleId,
    size: { cols: opts.cols ?? 2, rows: 2 },
  } as WidgetProps;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RouteEfficiencyWidget {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  routeSeq = 0;
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as never);
  mockUseUnits.mockReturnValue(unitsResult('km'));
  routeRequest(routeData([]));
});

// ── Vehicle resolution ──────────────────────────────────────────────────────

describe('RouteEfficiencyWidget vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
    routeRequest(routeData([makeRoute()]));
    renderWidget({ vehicleId: 42 });

    await waitFor(() =>
      expect(routeEffCalls()[0]?.[0]).toBe('/analytics/route-efficiency?vehicle_id=42'),
    );
    expect(
      routeEffCalls().some((c) => String(c[0]).includes('vehicle_id=7')),
    ).toBe(false);
  });

  it('falls back to the first vehicle when no prop is given', async () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }, { id: 9 }] } as never);
    routeRequest(routeData([makeRoute()]));
    renderWidget();

    await waitFor(() =>
      expect(routeEffCalls()[0]?.[0]).toBe('/analytics/route-efficiency?vehicle_id=7'),
    );
  });

  it('never queries when no vehicle resolves and shows an empty state (never a blank panel)', async () => {
    mockUseVehicles.mockReturnValue({ data: [] } as never);
    routeRequest(routeData([makeRoute()])); // would show data IF the guard were wrong
    renderWidget();

    expect(await screen.findByText('No route data')).toBeInTheDocument();
    expect(routeEffCalls()).toHaveLength(0);
  });
});

// ── States: loading / empty / error ─────────────────────────────────────────

describe('RouteEfficiencyWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while fetching', () => {
    mockRequest.mockImplementation(() => new Promise(() => {})); // hang
    const { container } = renderWidget({ vehicleId: 1 });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Route Efficiency')).toBeNull();
    expect(screen.queryByText('No route data')).toBeNull();
  });

  it('shows an empty state with role=status when the vehicle has no routes', async () => {
    routeRequest(routeData([]));
    renderWidget({ vehicleId: 1 });

    const empty = await screen.findByText('No route data');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('surfaces a QueryError — not the empty state — when the request fails', async () => {
    mockRequest.mockImplementation((path: string) =>
      String(path).startsWith('/analytics/route-efficiency')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve([]),
    );
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No route data')).toBeNull();
    expect(screen.queryByText('Route Efficiency')).toBeNull();
  });
});

// ── Populated ranked list ───────────────────────────────────────────────────

describe('RouteEfficiencyWidget populated list', () => {
  it('renders the title, route label and formatted value/trip line', async () => {
    routeRequest(
      routeData([
        makeRoute({ startLocation: 'Home', endLocation: 'Work', avgEfficiency: 220, tripCount: 12 }),
      ]),
    );
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText('Route Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Home → Work')).toBeInTheDocument();
    // km unit → value passes through untouched; trips rendered with the ×.
    expect(screen.getByText(/220 Wh\/km · 12×/)).toBeInTheDocument();
  });

  it('assigns the four efficiency badge buckets by raw Wh threshold', async () => {
    routeRequest(
      routeData([
        makeRoute({ startLocation: 'A', endLocation: 'B', avgEfficiency: 200 }), // ≤250 → Excellent
        makeRoute({ startLocation: 'C', endLocation: 'D', avgEfficiency: 300 }), // ≤325 → Good
        makeRoute({ startLocation: 'E', endLocation: 'F', avgEfficiency: 375 }), // ≤400 → Fair
        makeRoute({ startLocation: 'G', endLocation: 'H', avgEfficiency: 500 }), // else  → Poor
      ]),
    );
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText('Excellent')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(screen.getByText('Fair')).toBeInTheDocument();
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });

  it('highlights the most-efficient route (lowest raw) with an emerald bar and the rest blue', async () => {
    routeRequest(
      routeData([
        makeRoute({ startLocation: 'Slow', endLocation: 'Trip', avgEfficiency: 300 }),
        makeRoute({ startLocation: 'Best', endLocation: 'Trip', avgEfficiency: 180 }),
      ]),
    );
    const view = renderWidget({ vehicleId: 1 });

    await screen.findByText('Best → Trip');
    expect(view.container.querySelector('.bg-emerald-400')).not.toBeNull();
    expect(view.container.querySelector('.bg-blue-400')).not.toBeNull();
  });

  it('is null-safe: null locations / efficiency / trip count render placeholders, not NaN', async () => {
    routeRequest(
      routeData([
        makeRoute({
          startLocation: null as unknown as string,
          endLocation: null as unknown as string,
          avgEfficiency: null as unknown as number,
          tripCount: null as unknown as number,
        }),
      ]),
    );
    renderWidget({ vehicleId: 1 });

    expect(await screen.findByText('— → —')).toBeInTheDocument();
    expect(screen.getByText(/0 Wh\/km · 0×/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN|undefined/)).toBeNull();
  });
});

// ── Unit conversion ─────────────────────────────────────────────────────────

describe('RouteEfficiencyWidget unit conversion', () => {
  it('converts efficiency to Wh/mi when the distance unit is miles', async () => {
    mockUseUnits.mockReturnValue(unitsResult('mi'));
    routeRequest(
      routeData([makeRoute({ startLocation: 'A', endLocation: 'B', avgEfficiency: 200, tripCount: 3 })]),
    );
    renderWidget({ vehicleId: 1 });

    // 200 Wh/km × 1.609344 = 321.87 → rounds to 322 Wh/mi.
    expect(await screen.findByText(/322 Wh\/mi · 3×/)).toBeInTheDocument();
    expect(screen.queryByText(/Wh\/km/)).toBeNull();
  });
});

// ── Layout variants ─────────────────────────────────────────────────────────

describe('RouteEfficiencyWidget layout variants', () => {
  it('renders the compact (title-less) layout for a 1-column widget', async () => {
    routeRequest(
      routeData([makeRoute({ startLocation: 'Home', endLocation: 'Gym', avgEfficiency: 210 })]),
    );
    renderWidget({ vehicleId: 1, cols: 1 });

    expect(await screen.findByText('Home → Gym')).toBeInTheDocument();
    // Compact widgets drop the header title.
    expect(screen.queryByText('Route Efficiency')).toBeNull();
  });

  it('annotates each route with best/worst efficiency in the wide layout', async () => {
    routeRequest(
      routeData([
        makeRoute({
          startLocation: 'Home',
          endLocation: 'Lake',
          avgEfficiency: 200,
          bestEfficiency: 180,
          worstEfficiency: 260,
        }),
      ]),
    );
    renderWidget({ vehicleId: 1, cols: 3 });

    expect(await screen.findByText(/Home → Lake/)).toBeInTheDocument();
    expect(screen.getByText(/best 180 \/ worst 260 Wh\/km/)).toBeInTheDocument();
  });
});

// ── Refresh interaction ─────────────────────────────────────────────────────

describe('RouteEfficiencyWidget refresh', () => {
  it('re-issues the read when the freshness refresh control is activated', async () => {
    routeRequest(routeData([makeRoute()]));
    renderWidget({ vehicleId: 1 });

    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    const before = routeEffCalls().length;
    expect(before).toBeGreaterThanOrEqual(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(routeEffCalls().length).toBe(before + 1));
  });
});
