/**
 * BatteryLinearGaugeWidget — behaviour + hardening coverage.
 *
 * The widget renders a battery state-of-charge gauge whose arc colour is
 * driven by `getBatteryColor` (green > 50 %, amber > 20 %, else red), an
 * optional charge-limit overlay ring + "Limit" stat (only when the extended
 * `charge_limit_soc` field is a finite number), a compact 1×1 variant, and a
 * "⚡ Charging" indicator. There is a single public export (the default
 * component) so every branch is exercised through it:
 *   - level → arc colour mapping, including the inclusive 50 / 20 thresholds.
 *   - charge-limit overlay + stat: shown for a finite number, and the honesty
 *     fix this suite locks in — a NON-numeric `charge_limit_soc` must NOT leak a
 *     NaN into the overlay/stat (it is dropped).
 *   - compact (1×1) vs large (≥2×2) layout: title / stats / ring visibility.
 *   - charging indicator on/off.
 *   - loading / empty / error states — including the second honesty fix: a
 *     genuine initial-load failure renders a real error panel instead of the
 *     misleading "No battery data" empty state, while a background-refetch
 *     error with cached data keeps the gauge on screen.
 *   - refresh interaction (refetch wired to an accessible control).
 *   - vehicle-id resolution (prop wins, else first vehicle, else 0 = disabled).
 *
 * Network is never touched: the two hooks the widget calls are mocked and
 * driven per-test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { VehicleState } from '@/api/types';
import type { WidgetProps } from './types';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
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

// ── The data hooks — driven per test ──
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useVehicleState: vi.fn(),
}));

import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import BatteryLinearGaugeWidget from './BatteryLinearGaugeWidget';
import { gaugeColors } from '@/test/gaugeTestUtils';

const mockUseVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockUseVehicleState = useVehicleState as unknown as ReturnType<typeof vi.fn>;

// Fill colours from getBatteryColor — asserted against the LinearGauge fill.
const GREEN = '#10b981';
const AMBER = '#f59e0b';
const RED = '#ef4444';
/** The charge-limit reference tick drawn on the gauge track, if any. */
function limitMarker(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="gauge-marker"]');
}

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 80,
    rated_range: 0,
    ideal_range: 0,
    odometer: 0,
    inside_temp: 0,
    outside_temp: 0,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '',
    ...over,
  };
}

/** A state object with an extra (untyped) `charge_limit_soc` field attached. */
function stateWithLimit(limit: unknown, over: Partial<VehicleState> = {}): Record<string, unknown> {
  return { ...makeState(over), charge_limit_soc: limit };
}

/** Build a `useVehicleState`-shaped query result carrying `{ state, live }`. */
function stateQuery(
  state: Record<string, unknown> | undefined,
  over: Record<string, unknown> = {},
) {
  const data = state === undefined ? { state: undefined, live: false } : { state, live: true };
  return makeQuery({ data, ...over });
}

/** Every gauge fill colour — proves gauge colour. */
function circleStrokes(container: HTMLElement): string[] {
  return gaugeColors(container);
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BatteryLinearGaugeWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseVehicles.mockReset();
  mockUseVehicleState.mockReset();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockUseVehicleState.mockReturnValue(stateQuery(makeState()));
});

describe('BatteryLinearGaugeWidget — level → gauge colour', () => {
  it('renders a green arc when the level is above 50%', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 80 })));
    const { container } = renderWidget();

    expect(circleStrokes(container)).toContain(GREEN);
    expect(circleStrokes(container)).not.toContain(AMBER);
    expect(circleStrokes(container)).not.toContain(RED);
    // Not a blank panel: the LinearGauge label renders in the large variant.
    expect(screen.getAllByText('Battery').length).toBeGreaterThan(0);
  });

  it('renders an amber arc between 20% and 50%', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 35 })));
    const { container } = renderWidget();

    expect(circleStrokes(container)).toContain(AMBER);
    expect(circleStrokes(container)).not.toContain(GREEN);
  });

  it('renders a red arc at or below 20%', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 10 })));
    const { container } = renderWidget();

    expect(circleStrokes(container)).toContain(RED);
    expect(circleStrokes(container)).not.toContain(AMBER);
  });

  it('treats the 50% and 20% thresholds as exclusive upper bounds', () => {
    // Exactly 50 is NOT > 50 → amber, not green.
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 50 })));
    const at50 = renderWidget();
    expect(circleStrokes(at50.container)).toContain(AMBER);
    expect(circleStrokes(at50.container)).not.toContain(GREEN);
    at50.unmount();

    // Exactly 20 is NOT > 20 → red, not amber.
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 20 })));
    const at20 = renderWidget();
    expect(circleStrokes(at20.container)).toContain(RED);
    expect(circleStrokes(at20.container)).not.toContain(AMBER);
  });

  it('falls back to a 0% (red) gauge when battery_level is missing', () => {
    // battery_level omitted at runtime → widget coalesces to 0.
    mockUseVehicleState.mockReturnValue(
      stateQuery({ ...makeState(), battery_level: undefined as unknown as number }),
    );
    const { container } = renderWidget();

    expect(circleStrokes(container)).toContain(RED);
    // The numeric readout shows 0, never NaN/undefined.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});

describe('BatteryLinearGaugeWidget — charge-limit overlay + stat', () => {
  it('shows the limit marker and Limit stat when charge_limit_soc is a finite number (large)', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(stateWithLimit(90, { battery_level: 80 })),
    );
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    // The tick sits at the limit's position on the same 0–100 scale.
    expect(limitMarker(container)?.style.left).toBe('90%');
    expect(screen.getByText('Limit')).toBeInTheDocument();
    expect(screen.getByText('Level')).toBeInTheDocument();
    // The distinct limit value renders in the stat row.
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('omits the limit marker and Limit stat when charge_limit_soc is absent', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 80 })));
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(limitMarker(container)).toBeNull();
    expect(screen.queryByText('Limit')).not.toBeInTheDocument();
    // The Level stat is always present in the large variant.
    expect(screen.getByText('Level')).toBeInTheDocument();
  });

  it('ignores a non-numeric charge_limit_soc so no NaN leaks into the marker/stat', () => {
    // A string value must be dropped by the finite-number guard.
    mockUseVehicleState.mockReturnValue(
      stateQuery(stateWithLimit('90', { battery_level: 80 })),
    );
    const asString = renderWidget({ size: { cols: 2, rows: 2 } });
    expect(limitMarker(asString.container)).toBeNull();
    expect(screen.queryByText('Limit')).not.toBeInTheDocument();
    asString.unmount();

    // NaN is likewise rejected (Number.isFinite(NaN) === false).
    mockUseVehicleState.mockReturnValue(
      stateQuery(stateWithLimit(Number.NaN, { battery_level: 80 })),
    );
    const asNaN = renderWidget({ size: { cols: 2, rows: 2 } });
    expect(limitMarker(asNaN.container)).toBeNull();
    expect(screen.queryByText('Limit')).not.toBeInTheDocument();
  });
});

describe('BatteryLinearGaugeWidget — charging indicator', () => {
  it('renders the charging indicator when the vehicle is charging', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ battery_level: 80, is_charging: true })),
    );
    const { container } = renderWidget();

    expect(screen.getByText(/Charging/)).toBeInTheDocument();
    // Gauge still renders alongside the indicator.
    expect(circleStrokes(container)).toContain(GREEN);
  });

  it('hides the charging indicator when not charging', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ battery_level: 80, is_charging: false })),
    );
    const { container } = renderWidget();

    expect(screen.queryByText(/Charging/)).not.toBeInTheDocument();
    expect(circleStrokes(container)).toContain(GREEN);
  });
});

describe('BatteryLinearGaugeWidget — layout variants', () => {
  it('renders a compact 1×1 gauge without title, stats, or ring', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(stateWithLimit(90, { battery_level: 80 })),
    );
    const { container } = renderWidget({ size: { cols: 1, rows: 1 } });

    // Compact: no header title, no gauge label, and no stat row.
    expect(screen.queryByText('Battery')).not.toBeInTheDocument();
    expect(screen.queryByText('Level')).not.toBeInTheDocument();
    expect(screen.queryByText('Limit')).not.toBeInTheDocument();
    // The gauge fill itself is still drawn.
    expect(circleStrokes(container)).toContain(GREEN);
  });

  it('renders the stat row only for the large (≥2×2) variant', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 80 })));

    const large = renderWidget({ size: { cols: 2, rows: 2 } });
    expect(screen.getByText('Level')).toBeInTheDocument();
    large.unmount();

    // A 2×1 slot is neither compact nor large → title shows, stats do not.
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 80 })));
    renderWidget({ size: { cols: 2, rows: 1 } });
    expect(screen.getByRole('heading', { name: 'Battery' })).toBeInTheDocument();
    expect(screen.queryByText('Level')).not.toBeInTheDocument();
  });
});

describe('BatteryLinearGaugeWidget — loading / empty / error', () => {
  it('shows a skeleton while loading (no gauge, no empty state)', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(undefined, { data: undefined, isLoading: true }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No battery data')).not.toBeInTheDocument();
    expect(circleStrokes(container)).toHaveLength(0);
  });

  it('shows the empty state (not a blank panel) when no state has arrived', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(undefined));
    const { container } = renderWidget();

    expect(screen.getByText('No battery data')).toBeInTheDocument();
    // No gauge is drawn when there is no state.
    expect(circleStrokes(container)).toHaveLength(0);
  });

  it('surfaces a real error panel instead of the empty state on initial-load failure', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(undefined, { data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWidget();

    // Honest error panel from WidgetShell (QueryError), not "No battery data".
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No battery data')).not.toBeInTheDocument();
  });

  it('keeps cached data on screen when a background refetch errors', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ battery_level: 80 }), { isError: true, error: new Error('boom') }),
    );
    const { container } = renderWidget();

    // Data present → error is a subtle freshness signal, not a full panel.
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(circleStrokes(container)).toContain(GREEN);
  });
});

describe('BatteryLinearGaugeWidget — refresh + vehicle resolution', () => {
  it('refetches vehicle state when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 80 }), { refetch }));
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('queries state for the vehicleId prop when provided', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockUseVehicleState).toHaveBeenCalledWith(7);
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockUseVehicleState).toHaveBeenCalledWith(42);
  });

  it('passes id 0 (disabling the query) when no vehicle is available', () => {
    mockUseVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockUseVehicleState).toHaveBeenCalledWith(0);
  });
});
