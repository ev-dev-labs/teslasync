/**
 * OdometerCounterWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of OdometerCounterWidget.tsx:
 *   - `toOdometerDisplay` — the pure SI-**metres** → user-unit converter for the
 *     live odometer (km passthrough, the miles divide, and the non-finite → 0
 *     guard);
 *   - `toTotalDrivenDisplay` — the pure `DrivingStats.totalDistanceKm` →
 *     user-unit converter. This pins the km→metres scaling bug it was hardened
 *     against: the shared `convertDistanceFromSI` expects METRES, so a kilometre
 *     value must be scaled ×1000 first. The previous widget applied the SAME
 *     metre-based converter to both odometer AND `totalDistanceKm`, so the
 *     "Total Driven" tile under-reported by 1000× (12,345 km surfaced as 12 km).
 *     A dedicated contrast case proves the two converters now scale differently;
 *   - the default widget component across every render branch: the compact 1×1
 *     counter, the tall expanded reading, the wide breakdown (with the corrected
 *     total-driven distance and the em-dash fallback when stats are absent), the
 *     vehicle-id resolution / prop-override contract, the empty state, the
 *     loading skeleton, the keep-last-data-on-error resilience path, the
 *     zero-vs-null odometer boundary, and the manual-refresh interaction.
 *
 * Strategy (mirrors the repo convention, e.g. ChargeStatusLiveWidget.test.tsx
 * and DriveScoreWidget.test.tsx):
 *   - The three data hooks (`useVehicles`, `useVehicleState`, `useDrivingStats`)
 *     are replaced with hoisted `vi.fn()` doubles so the network is never
 *     touched and every render is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback string so
 *     assertions read the real English copy.
 *   - The global test-setup already mocks `useSettings` (km / °C), which
 *     `useUnits` reads — that is why distance renders in "km" and the metre→km
 *     passthrough is exercised by the render tests, while the miles branch is
 *     covered directly through the pure converters.
 *   - `matchMedia` is stubbed to report `prefers-reduced-motion: reduce` so
 *     <AnimatedNumber> lands on its final value synchronously instead of easing
 *     over rAF frames — this makes the odometer readout assertable. The same
 *     stub keeps <DataFreshness>'s useMotionPreference (rendered transitively by
 *     <WidgetShell>) from touching an absent jsdom matchMedia.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice
 * tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// jsdom lacks matchMedia. Install a stub reporting reduced-motion = true BEFORE
// any import runs so <AnimatedNumber> skips its rAF tween and paints the final
// value, and <DataFreshness>'s useMotionPreference resolves cleanly.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: true,
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

// react-i18next passthrough — resolve the fallback (2nd arg) so assertions read
// production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { vehiclesMock, vehicleStateMock, drivingStatsMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
  drivingStatsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vehiclesMock,
  useVehicleState: vehicleStateMock,
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingStats: drivingStatsMock,
}));

import OdometerCounterWidget, {
  toOdometerDisplay,
  toTotalDrivenDisplay,
} from './OdometerCounterWidget';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_TALL: WidgetSize = { cols: 1, rows: 2 };
const SIZE_WIDE: WidgetSize = { cols: 2, rows: 2 };

// 50,000,000 m ⇒ 50,000 km. 12,345 km ⇒ 12,345 km (once scaled through metres).
const ODOMETER_M = 50_000_000;
const TOTAL_DISTANCE_KM = 12_345;

interface StateShape {
  odometer: number;
}

interface StateQueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeStateQuery(state: StateShape | undefined, over: StateQueryOverrides = {}) {
  return {
    data: state ? { state, live: true } : undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: state ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

interface Stats {
  totalDistanceKm: number;
}

function makeStatsQuery(stats: Stats | undefined, over: { isLoading?: boolean } = {}) {
  return { data: stats, isLoading: false, ...over };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vehiclesMock.mockReset();
  vehicleStateMock.mockReset();
  drivingStatsMock.mockReset();
  // Sensible defaults: one vehicle, a live odometer, and a driving-stats total.
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  vehicleStateMock.mockReturnValue(makeStateQuery({ odometer: ODOMETER_M }));
  drivingStatsMock.mockReturnValue(makeStatsQuery({ totalDistanceKm: TOTAL_DISTANCE_KM }));
});

// ── toOdometerDisplay (pure) ─────────────────────────────────────────────────
describe('toOdometerDisplay', () => {
  it('divides SI metres to km (passthrough scale) and to miles', () => {
    expect(toOdometerDisplay(50_000_000, 'km')).toBe(50_000);
    // 1,609,344 m ⇒ exactly 1000 miles.
    expect(toOdometerDisplay(1_609_344, 'mi')).toBeCloseTo(1000, 6);
    expect(toOdometerDisplay(0, 'km')).toBe(0);
  });

  it('collapses non-finite input to 0 so the counter never renders "NaN"', () => {
    expect(toOdometerDisplay(Number.NaN, 'km')).toBe(0);
    expect(toOdometerDisplay(Number.POSITIVE_INFINITY, 'mi')).toBe(0);
    expect(toOdometerDisplay(Number.NEGATIVE_INFINITY, 'km')).toBe(0);
  });
});

// ── toTotalDrivenDisplay (pure) ──────────────────────────────────────────────
describe('toTotalDrivenDisplay', () => {
  it('scales kilometres to metres before the SI converter (km passthrough + 1000× regression)', () => {
    // km→km is numerically a passthrough (×1000 then ÷1000)…
    expect(toTotalDrivenDisplay(12_345, 'km')).toBe(12_345);
    // …and the specific bug: 500 km must surface as 500 km, NOT 0.5 km.
    expect(toTotalDrivenDisplay(500, 'km')).toBe(500);
    expect(toTotalDrivenDisplay(0, 'km')).toBe(0);
  });

  it('converts kilometres to the miles display unit', () => {
    // 1609.344 km ⇒ 1,609,344 m ⇒ exactly 1000 miles.
    expect(toTotalDrivenDisplay(1609.344, 'mi')).toBeCloseTo(1000, 6);
    // 100 km ⇒ 62.137… miles.
    expect(toTotalDrivenDisplay(100, 'mi')).toBeCloseTo(62.1371, 3);
  });

  it('collapses non-finite input to 0 so the tile never renders "NaN"', () => {
    expect(toTotalDrivenDisplay(Number.NaN, 'km')).toBe(0);
    expect(toTotalDrivenDisplay(Number.POSITIVE_INFINITY, 'mi')).toBe(0);
    expect(toTotalDrivenDisplay(Number.NEGATIVE_INFINITY, 'km')).toBe(0);
  });

  it('scales total-driven kilometres 1000× larger than odometer metres (proves they are not the same converter)', () => {
    // The core bug: the widget used to apply the odometer (metre) converter to
    // the kilometre `totalDistanceKm`. For an identical numeric input the two
    // converters must now differ by exactly the km→m factor.
    expect(toOdometerDisplay(5000, 'km')).toBe(5); // 5000 m ⇒ 5 km
    expect(toTotalDrivenDisplay(5000, 'km')).toBe(5000); // 5000 km ⇒ 5000 km
    expect(toTotalDrivenDisplay(5000, 'km')).toBe(1000 * toOdometerDisplay(5000, 'km'));
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('OdometerCounterWidget', () => {
  it('renders the compact 1×1 counter (value + unit, title suppressed)', () => {
    renderWidget(<OdometerCounterWidget size={SIZE_COMPACT} />);

    // 50,000,000 m ⇒ 50,000 km, animated straight to its final value.
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    // Compact drops the title chrome and never shows the empty state.
    expect(screen.queryByText('Odometer')).not.toBeInTheDocument();
    expect(screen.queryByText('No odometer data')).not.toBeInTheDocument();
  });

  it('renders the tall expanded reading (odometer suffixed + section label, no breakdown grid)', () => {
    renderWidget(<OdometerCounterWidget size={SIZE_TALL} />);

    expect(screen.getByText('Odometer')).toBeInTheDocument();
    expect(screen.getByText('Total Odometer')).toBeInTheDocument();
    expect(screen.getByText('50,000 km')).toBeInTheDocument();
    // The breakdown tiles are wide-only.
    expect(screen.queryByText('Total Driven')).not.toBeInTheDocument();
    expect(screen.queryByText('Unit')).not.toBeInTheDocument();
  });

  it('renders the wide breakdown with the CORRECTED total-driven distance', () => {
    renderWidget(<OdometerCounterWidget size={SIZE_WIDE} />);

    // Odometer hero.
    expect(screen.getByText('50,000 km')).toBeInTheDocument();
    // Breakdown tiles.
    expect(screen.getByText('Total Driven')).toBeInTheDocument();
    expect(screen.getByText('Unit')).toBeInTheDocument();
    // 12,345 km must render as "12,345 km" — the fix. The pre-fix bug divided
    // the kilometre value by 1000 and showed "12 km".
    expect(screen.getByText('12,345 km')).toBeInTheDocument();
    expect(screen.queryByText('12 km')).not.toBeInTheDocument();
  });

  it('resolves the vehicle id from the prop and reads state (number) + stats (string id)', () => {
    renderWidget(<OdometerCounterWidget size={SIZE_TALL} vehicleId={7} />);

    expect(vehicleStateMock).toHaveBeenCalledWith(7);
    // Driving stats is scoped by the snake_case/string vehicle id.
    expect(drivingStatsMock).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget(<OdometerCounterWidget size={SIZE_TALL} />);

    expect(vehicleStateMock).toHaveBeenCalledWith(42);
    expect(drivingStatsMock).toHaveBeenCalledWith('42');
  });

  it('renders the empty state (role=status) when the vehicle state has no odometer', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined));

    renderWidget(<OdometerCounterWidget size={SIZE_TALL} />);

    expect(screen.getByText('No odometer data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('50,000 km')).not.toBeInTheDocument();
  });

  it('shows the em-dash for total-driven when driving stats are absent (odometer still renders)', () => {
    drivingStatsMock.mockReturnValue(makeStatsQuery(undefined));

    renderWidget(<OdometerCounterWidget size={SIZE_WIDE} />);

    // The odometer hero and the Total Driven label still render…
    expect(screen.getByText('50,000 km')).toBeInTheDocument();
    expect(screen.getByText('Total Driven')).toBeInTheDocument();
    // …but the missing stats source collapses to the em-dash, not a crash.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('treats a zero odometer as a real reading (renders "0"), not the empty state', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery({ odometer: 0 }));

    renderWidget(<OdometerCounterWidget size={SIZE_COMPACT} />);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('No odometer data')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton while first fetching (no counter, no empty state)', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<OdometerCounterWidget size={SIZE_TALL} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('50,000 km')).not.toBeInTheDocument();
    expect(screen.queryByText('No odometer data')).not.toBeInTheDocument();
  });

  it('keeps the counter on a background-refetch error (never blanks a live widget)', () => {
    vehicleStateMock.mockReturnValue(
      makeStateQuery({ odometer: ODOMETER_M }, { isError: true }),
    );

    renderWidget(<OdometerCounterWidget size={SIZE_TALL} />);

    // Last-known odometer is retained despite the error flag.
    expect(screen.getByText('50,000 km')).toBeInTheDocument();
    expect(screen.queryByText('No odometer data')).not.toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    vehicleStateMock.mockReturnValue(
      makeStateQuery(
        { odometer: ODOMETER_M },
        { refetch, isFetching: false, dataUpdatedAt: Date.now() },
      ),
    );

    renderWidget(<OdometerCounterWidget size={SIZE_WIDE} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
