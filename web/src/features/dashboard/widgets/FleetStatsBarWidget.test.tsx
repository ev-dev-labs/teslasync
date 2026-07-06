/**
 * FleetStatsBarWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of FleetStatsBarWidget.tsx:
 *   - `toDistanceDisplay` — the pure `total_distance_km` → user-unit converter.
 *     This pins the km→metres scaling bug it was hardened against: the shared
 *     `convertDistanceFromSI` expects METRES, so a kilometre value must be
 *     multiplied by 1000 first. The previous implementation passed kilometres
 *     straight through and under-reported fleet distance by 1000× (500 km
 *     surfaced as 0.5 km). Also covers the mile branch and the non-finite guard.
 *   - the default widget component across every render branch: the full
 *     four-tile grid (with the corrected distance + the online caption /
 *     percentage that the `trend`-less items used to silently drop), the
 *     vehicles-only and analytics-only partial-data paths, the empty state, the
 *     loading skeleton, the query-error path, the compact layout, and the
 *     manual-refresh interaction. Also pins the trailing-30-day analytics
 *     contract.
 *
 * Strategy (mirrors the repo convention, e.g. DriveScoreWidget.test.tsx and
 * ChargeStatusLiveWidget.test.tsx):
 *   - The two data hooks (`useVehicles`, `useFleetAnalytics`) are replaced with
 *     hoisted `vi.fn()` doubles so the network is never touched and every render
 *     is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback string (and
 *     interpolate `{{vars}}`) so assertions read the real English copy.
 *   - The global test-setup already mocks `useSettings` (km / °C), which
 *     `useUnits` reads — that is why distance renders in "km" and the km→display
 *     passthrough is exercised by the render tests, while the miles branch is
 *     covered directly through the pure `toDistanceDisplay`.
 *   - `matchMedia` is stubbed before any import runs because <DataFreshness>'s
 *     `useMotionPreference` (rendered transitively by <WidgetShell>) touches it
 *     on first paint and jsdom does not provide it.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice
 * tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// jsdom lacks matchMedia; <DataFreshness>'s useMotionPreference reads it on
// first paint. Install a no-op (reduced-motion = false) BEFORE any import.
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

// react-i18next passthrough — resolve the fallback (2nd arg) and interpolate
// `{{vars}}` from the options object so assertions read production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { vehiclesMock, fleetAnalyticsMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  fleetAnalyticsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));
vi.mock('@/api/hooks/useAnalytics', () => ({ useFleetAnalytics: fleetAnalyticsMock }));

import FleetStatsBarWidget, { toDistanceDisplay } from './FleetStatsBarWidget';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_STANDARD: WidgetSize = { cols: 4, rows: 2 };
const SIZE_COMPACT: WidgetSize = { cols: 2, rows: 1 };

interface VehicleLike {
  id: number;
  state: string;
}

// Four vehicles, three of them online → 75% online.
const FLEET: VehicleLike[] = [
  { id: 1, state: 'online' },
  { id: 2, state: 'online' },
  { id: 3, state: 'online' },
  { id: 4, state: 'asleep' },
];

interface AnalyticsLike {
  total_distance_km: number;
  total_energy_kwh: number;
}

const ANALYTICS: AnalyticsLike = {
  total_distance_km: 1234, // → "1,234.0" km once scaled through metres
  total_energy_kwh: 250, // → "250.0" kWh
};

interface QueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  error?: unknown;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function analyticsQuery(data?: Partial<AnalyticsLike>, over: QueryOverrides = {}) {
  return {
    data,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

function vehiclesQuery(data?: VehicleLike[], over: { isLoading?: boolean } = {}) {
  return { data, isLoading: false, ...over };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vehiclesMock.mockReset();
  fleetAnalyticsMock.mockReset();
  vehiclesMock.mockReturnValue(vehiclesQuery(FLEET));
  fleetAnalyticsMock.mockReturnValue(analyticsQuery(ANALYTICS));
});

// ── toDistanceDisplay (pure) ─────────────────────────────────────────────────
describe('toDistanceDisplay', () => {
  it('scales kilometres to metres before the SI converter (km passthrough + regression)', () => {
    // km→km is a passthrough numerically (×1000 then ÷1000)…
    expect(toDistanceDisplay(1234, 'km')).toBe(1234);
    // …and the specific bug: 500 km must surface as 500 km, NOT 0.5 km.
    expect(toDistanceDisplay(500, 'km')).toBe(500);
    expect(toDistanceDisplay(0, 'km')).toBe(0);
  });

  it('converts kilometres to the miles display unit', () => {
    // 1609.344 km ⇒ 1,609,344 m ⇒ exactly 1000 miles.
    expect(toDistanceDisplay(1609.344, 'mi')).toBeCloseTo(1000, 6);
    // 100 km ⇒ 62.137… miles.
    expect(toDistanceDisplay(100, 'mi')).toBeCloseTo(62.1371, 3);
  });

  it('collapses non-finite input to 0 so the tile never renders "NaN"', () => {
    expect(toDistanceDisplay(Number.NaN, 'km')).toBe(0);
    expect(toDistanceDisplay(Number.POSITIVE_INFINITY, 'mi')).toBe(0);
    expect(toDistanceDisplay(Number.NEGATIVE_INFINITY, 'km')).toBe(0);
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('FleetStatsBarWidget', () => {
  it('renders all four fleet tiles with the corrected distance and energy', () => {
    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    // Labels — every tile is present.
    expect(screen.getByText('Vehicles')).toBeInTheDocument();
    expect(screen.getByText('Online Now')).toBeInTheDocument();
    expect(screen.getByText('Distance (30d)')).toBeInTheDocument();
    expect(screen.getByText('Energy (30d)')).toBeInTheDocument();

    // Counts.
    expect(screen.getByText('4')).toBeInTheDocument(); // total vehicles
    expect(screen.getByText('3')).toBeInTheDocument(); // online now

    // Corrected distance: 1234 km → "1,234.0" km (NOT the 1000×-off "1.2").
    expect(screen.getByText('1,234.0')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.queryByText('1.2')).not.toBeInTheDocument();

    // Energy passes through unconverted.
    expect(screen.getByText('250.0')).toBeInTheDocument();
    expect(screen.getByText('kWh')).toBeInTheDocument();

    // Not the empty state.
    expect(screen.queryByText('No fleet data available')).not.toBeInTheDocument();
  });

  it('renders the online caption and percentage that the trend-less items used to drop', () => {
    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    // These only render because the widget now pairs `trend` with `trendValue`.
    expect(screen.getByText('3 online')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('requests the trailing 30-day analytics window', () => {
    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);
    expect(fleetAnalyticsMock).toHaveBeenCalledWith(30);
  });

  it('renders the empty state (role=status) when there are no vehicles and no analytics', () => {
    vehiclesMock.mockReturnValue(vehiclesQuery([]));
    fleetAnalyticsMock.mockReturnValue(analyticsQuery(undefined));

    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    expect(screen.getByText('No fleet data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The stat grid is gone.
    expect(screen.queryByText('Vehicles')).not.toBeInTheDocument();
  });

  it('still renders the grid when only vehicles are present (analytics absent)', () => {
    vehiclesMock.mockReturnValue(vehiclesQuery(FLEET));
    fleetAnalyticsMock.mockReturnValue(analyticsQuery(undefined));

    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    // Vehicle-derived tiles still show; the missing analytics does not crash
    // or hide the panel.
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Distance (30d)')).toBeInTheDocument();
    expect(screen.queryByText('No fleet data available')).not.toBeInTheDocument();
  });

  it('still renders the grid when only analytics is present (no vehicles)', () => {
    vehiclesMock.mockReturnValue(vehiclesQuery([]));
    fleetAnalyticsMock.mockReturnValue(analyticsQuery(ANALYTICS));

    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    expect(screen.getByText('1,234.0')).toBeInTheDocument();
    // Both counts collapse to zero with an empty fleet…
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    // …and the online-percentage trend is suppressed (no vehicles to divide by).
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
    expect(screen.queryByText('No fleet data available')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton with no grid or empty state while first fetching', () => {
    fleetAnalyticsMock.mockReturnValue(analyticsQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Vehicles')).not.toBeInTheDocument();
    expect(screen.queryByText('No fleet data available')).not.toBeInTheDocument();
  });

  it('surfaces a query error instead of the stat grid', () => {
    fleetAnalyticsMock.mockReturnValue(
      analyticsQuery(undefined, { error: new Error('boom'), isError: true }),
    );

    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    // WidgetShell swaps the whole body for the QueryError banner.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Vehicles')).not.toBeInTheDocument();
    expect(screen.queryByText('No fleet data available')).not.toBeInTheDocument();
  });

  it('renders every tile in the compact single-row layout', () => {
    renderWidget(<FleetStatsBarWidget size={SIZE_COMPACT} />);

    // Compact collapses the grid to one column but drops no tiles.
    expect(screen.getByText('Vehicles')).toBeInTheDocument();
    expect(screen.getByText('Online Now')).toBeInTheDocument();
    expect(screen.getByText('Distance (30d)')).toBeInTheDocument();
    expect(screen.getByText('Energy (30d)')).toBeInTheDocument();
    expect(screen.getByText('1,234.0')).toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    fleetAnalyticsMock.mockReturnValue(
      analyticsQuery(ANALYTICS, { refetch, isFetching: false, dataUpdatedAt: Date.now() }),
    );

    renderWidget(<FleetStatsBarWidget size={SIZE_STANDARD} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
