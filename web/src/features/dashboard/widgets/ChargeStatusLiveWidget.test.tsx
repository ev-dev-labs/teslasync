/**
 * ChargeStatusLiveWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of ChargeStatusLiveWidget.tsx:
 *   - `formatTimeRemaining` — the pure "hours → Hh Mm" formatter, including the
 *     two bugs it was hardened against (minute-rounding rollover to 60 and
 *     non-finite input), and
 *   - the default widget component across every render branch: charging vs
 *     idle, the compact / medium / tall layout variants, the loading / empty /
 *     error states, the vehicle-selection fallback, and the manual-refresh
 *     interaction.
 *
 * Strategy (mirrors the repo convention, e.g. BatteryCellsWidget.test.tsx):
 *   - The three data hooks (`useVehicles`, `useVehicleState`,
 *     `useChargingSessionsPaginated`) are replaced with hoisted `vi.fn()`
 *     doubles so the network is never touched and every render is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback string so
 *     assertions read the real English copy.
 *   - The global test-setup already mocks `useSettings` (km / °C) and
 *     `useTimezone` (UTC), which `useUnits` and the transitive <DataFreshness>
 *     header depend on. That is why the charge-rate cell reads in "km/h".
 *   - `matchMedia` is stubbed to report `prefers-reduced-motion: reduce` so
 *     <AnimatedNumber> lands on its final value synchronously instead of
 *     easing over rAF frames — this makes the power readout assertable.
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
const { vehiclesMock, vehicleStateMock, sessionsMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  vehicleStateMock: vi.fn(),
  sessionsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vehiclesMock,
  useVehicleState: vehicleStateMock,
}));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessionsPaginated: sessionsMock,
}));

import ChargeStatusLiveWidget, { formatTimeRemaining } from './ChargeStatusLiveWidget';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 1 };
const SIZE_TALL: WidgetSize = { cols: 2, rows: 2 };

interface LiveState {
  is_charging: boolean;
  charger_power: number;
  charge_rate: number;
  time_to_full_charge: number;
  battery_level: number;
}

function makeState(overrides: Partial<LiveState> = {}): LiveState {
  return {
    is_charging: true,
    charger_power: 48, // → "48.0 kW"
    charge_rate: 32000, // m/h (SI) → 32 km/h
    time_to_full_charge: 1.5, // → "1h 30m"
    battery_level: 80,
    ...overrides,
  };
}

interface StateQueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeStateQuery(state: LiveState | undefined, over: StateQueryOverrides = {}) {
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

interface SessionRow {
  total_energy_added_wh: number;
}

function makeSessionsQuery(
  sessions: SessionRow[] | undefined,
  over: { isLoading?: boolean } = {},
) {
  return { data: sessions, isLoading: false, ...over };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vehiclesMock.mockReset();
  vehicleStateMock.mockReset();
  sessionsMock.mockReset();
  // Sensible defaults: one vehicle, actively charging, with a recent session.
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  vehicleStateMock.mockReturnValue(makeStateQuery(makeState()));
  sessionsMock.mockReturnValue(makeSessionsQuery([{ total_energy_added_wh: 12500 }]));
});

// ── formatTimeRemaining (pure) ───────────────────────────────────────────────
describe('formatTimeRemaining', () => {
  it('formats minutes-only, hours-only, and combined durations', () => {
    expect(formatTimeRemaining(0.75)).toBe('45m');
    expect(formatTimeRemaining(2)).toBe('2h');
    expect(formatTimeRemaining(1.5)).toBe('1h 30m');
    expect(formatTimeRemaining(2.25)).toBe('2h 15m');
  });

  it('rolls a rounded 60 minutes over to the next hour (never "1h 60m")', () => {
    // 0.999h → 59.94m rounds to 60 → must read "1h", not "60m".
    expect(formatTimeRemaining(0.999)).toBe('1h');
    // 1.999h → h=1 + 60m → must carry to "2h", not "1h 60m".
    expect(formatTimeRemaining(1.999)).toBe('2h');
    // 3.9917h → 59.5m rounds to 60 → carries to "4h".
    expect(formatTimeRemaining(3.9917)).toBe('4h');
  });

  it('returns an em-dash for zero, negative, or non-finite input', () => {
    expect(formatTimeRemaining(0)).toBe('—');
    expect(formatTimeRemaining(-3)).toBe('—');
    expect(formatTimeRemaining(Number.NaN)).toBe('—');
    expect(formatTimeRemaining(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('ChargeStatusLiveWidget', () => {
  it('renders the full charging view: title, badge, power, energy and time', () => {
    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    // Title chrome is visible above compact.
    expect(screen.getByText('Charge Status')).toBeInTheDocument();
    // Charging badge + primary power readout (rounded-motion → final value).
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('48.0 kW')).toBeInTheDocument();
    // Battery header + derived secondary metrics.
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText('12.5 kWh')).toBeInTheDocument();
    // Secondary-metric labels.
    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('Time Left')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    // Voltage + current have no live source → both render the em-dash.
    expect(screen.getAllByText('—')).toHaveLength(2);
    // The rate/battery row is a tall-only extra — absent here.
    expect(screen.queryByText('Rate')).not.toBeInTheDocument();
    expect(screen.queryByText('32 km/h')).not.toBeInTheDocument();
  });

  it('adds the rate and battery row at tall size (rate converted to km/h)', () => {
    renderWidget(<ChargeStatusLiveWidget size={SIZE_TALL} />);

    expect(screen.getByText('Rate')).toBeInTheDocument();
    // 32000 m/h (SI) → 32 km/h under the default km preference.
    expect(screen.getByText('32 km/h')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    // Battery % now appears twice: the status header and the extra row cell.
    expect(screen.getAllByText('80%')).toHaveLength(2);
  });

  it('renders the compact charging view without the title chrome', () => {
    renderWidget(<ChargeStatusLiveWidget size={SIZE_COMPACT} />);

    // 1×1 tile suppresses the title + the full badge/label chrome.
    expect(screen.queryByText('Charge Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Charging')).not.toBeInTheDocument();
    expect(screen.queryByText('Time Left')).not.toBeInTheDocument();
    // ...but still surfaces the power + battery essentials.
    expect(screen.getByText('48.0 kW')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders the idle full view with the last-session summary', () => {
    vehicleStateMock.mockReturnValue(
      makeStateQuery(makeState({ is_charging: false, battery_level: 64 })),
    );

    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('Not Charging')).toBeInTheDocument();
    expect(screen.getByText('64%')).toBeInTheDocument();
    expect(screen.getByText('Last Session')).toBeInTheDocument();
    expect(screen.getByText('+12.5 kWh')).toBeInTheDocument();
    // The charging badge must not render when idle.
    expect(screen.queryByText('Charging')).not.toBeInTheDocument();
  });

  it('renders the compact idle view (no last-session block) in a 1x1 tile', () => {
    vehicleStateMock.mockReturnValue(
      makeStateQuery(makeState({ is_charging: false, battery_level: 64 })),
    );

    renderWidget(<ChargeStatusLiveWidget size={SIZE_COMPACT} />);

    expect(screen.getByText('Not Charging')).toBeInTheDocument();
    expect(screen.getByText('64%')).toBeInTheDocument();
    expect(screen.queryByText('Last Session')).not.toBeInTheDocument();
    expect(screen.queryByText('Charge Status')).not.toBeInTheDocument();
  });

  it('shows the empty state (role=status) when no live state has arrived', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined));

    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No charge data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Charging')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton with no body while the state query loads', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('No charge data')).not.toBeInTheDocument();
    expect(screen.queryByText('Charging')).not.toBeInTheDocument();
  });

  it('keeps the last-known state on a mid-poll error (never a blank panel)', () => {
    // A live 5s-poll widget must not blow away good data on a transient error.
    vehicleStateMock.mockReturnValue(
      makeStateQuery(makeState({ is_charging: true }), { isError: true }),
    );

    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('48.0 kW')).toBeInTheDocument();
  });

  it('falls back to the empty state on error when no data is present', () => {
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined, { isError: true }));

    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No charge data')).toBeInTheDocument();
  });

  it('selects the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    expect(vehicleStateMock).toHaveBeenCalledWith(42, { refetchInterval: 5000 });
    expect(sessionsMock).toHaveBeenCalledWith(42, { limit: 1 });
  });

  it('uses the explicit vehicleId prop when provided', () => {
    renderWidget(<ChargeStatusLiveWidget vehicleId={7} size={SIZE_MEDIUM} />);

    expect(vehicleStateMock).toHaveBeenCalledWith(7, { refetchInterval: 5000 });
    expect(sessionsMock).toHaveBeenCalledWith(7, { limit: 1 });
  });

  it('disables the queries and shows empty state when there are no vehicles', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    vehicleStateMock.mockReturnValue(makeStateQuery(undefined));
    sessionsMock.mockReturnValue(makeSessionsQuery(undefined));

    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    // id resolves to 0 (disabled) and the sessions query receives null.
    expect(vehicleStateMock).toHaveBeenCalledWith(0, { refetchInterval: 5000 });
    expect(sessionsMock).toHaveBeenCalledWith(null, { limit: 1 });
    expect(screen.getByText('No charge data')).toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    vehicleStateMock.mockReturnValue(
      makeStateQuery(makeState({ is_charging: true }), {
        refetch,
        isFetching: false,
        dataUpdatedAt: Date.now(),
      }),
    );

    renderWidget(<ChargeStatusLiveWidget size={SIZE_MEDIUM} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
