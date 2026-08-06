/**
 * ChargingTelemetryWidget — behaviour + hardening coverage.
 *
 * The widget renders the vehicle's live charging telemetry (voltage, current,
 * power, phases) in three responsive layouts — compact (≤1 col), standard
 * (2–3 col) and wide (≥4 col) — plus a wide-only efficiency stat, an AC/DC
 * charger badge, and a rolling power sparkline. It has a single public export
 * (the default component), so every branch is exercised through it.
 *
 * The suite doubles as the regression guard for two real unit bugs this
 * elevation fixes:
 *   - The SI 1000× bug: `charger_power_w` arrives in watts and was rendered
 *     with a raw "kW" suffix (an 11 kW charger showed as "11,000.0 kW"). The
 *     fix converts at the render boundary via `useUnits()` +
 *     `convertPowerFromSI`, so the tests assert "11.0 kW" and prove the raw
 *     magnitude never leaks.
 *   - The efficiency unit mismatch: the theoretical draw was computed in kW
 *     while the actual power was in watts, making the ratio 1000× too large so
 *     it pinned at the 100% clamp. The fix keeps both sides in watts, so a
 *     7 kW draw against a 32 A / 240 V / 1-phase pilot reads ~91%, not 100%.
 *
 * It also locks in the error-honesty fix (a genuine initial-load failure shows
 * a real error panel, while a background-refetch error with cached data keeps
 * the telemetry on screen), the loading/empty states, the refresh interaction,
 * and vehicle-id resolution.
 *
 * The real `useUnits` runs here (the global test-setup mocks `@/hooks/useSettings`
 * with SI defaults: kW power, en-US, precision 2), so the conversion math is
 * exercised for real. Network is never touched — the two data hooks are mocked
 * and driven per-test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ChargingTelemetry } from '@/api/types';
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
  useChargingTelemetryLatest: vi.fn(),
}));

import { useVehicles, useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import ChargingTelemetryWidget from './ChargingTelemetryWidget';

const mockUseVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockLive = useChargingTelemetryLatest as unknown as ReturnType<typeof vi.fn>;

 
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

function makeTelemetry(over: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 1,
    ts: '2026-01-01T00:00:00Z',
    session_id: 1,
    battery_level: 80,
    battery_range_mi: 200,
    charging_state: 'Charging',
    charger_voltage: 240,
    charger_actual_current: 32,
    // 11 kW charger expressed in SI watts.
    charger_power_w: 11000,
    charger_phases: 1,
    charge_energy_added_wh: 42000,
    range_added_meters: 120000,
    range_added_meters_per_hour: 36000,
    charger_pilot_current: 40,
    scheduled_charging_at: null,
    source: 'test',
    ...over,
  };
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChargingTelemetryWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseVehicles.mockReset();
  mockLive.mockReset();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockLive.mockReturnValue(makeQuery({ data: makeTelemetry() }));
});

describe('ChargingTelemetryWidget — power unit conversion (1000× regression guard)', () => {
  it('renders SI watts as kW in the standard layout, never the raw watt magnitude', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charger_power_w: 11000 }) }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // 11000 W → 11.0 kW (value + separate unit chip).
    expect(screen.getByText('11.0')).toBeInTheDocument();
    expect(screen.getAllByText('kW').length).toBeGreaterThan(0);
    // The raw watt magnitude with a kW suffix (the bug) must never appear.
    expect(screen.queryByText('11,000.0')).not.toBeInTheDocument();
  });

  it('shows the converted kW power (not raw watts) in the compact layout', () => {
    mockLive.mockReturnValue(
      makeQuery({
        data: makeTelemetry({ charger_power_w: 11000, charger_voltage: 240, charger_actual_current: 32 }),
      }),
    );
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText('11.0 kW')).toBeInTheDocument();
    expect(screen.getByText('240V · 32A')).toBeInTheDocument();
    expect(screen.queryByText('11,000.0 kW')).not.toBeInTheDocument();
  });

  it('coalesces a null charger_power_w to 0.0 kW instead of NaN', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charger_power_w: null }) }));
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText('0.0 kW')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe('ChargingTelemetryWidget — standard layout stats', () => {
  it('renders voltage, current, power and phases with their labels', () => {
    mockLive.mockReturnValue(
      makeQuery({
        data: makeTelemetry({
          charger_voltage: 240,
          charger_actual_current: 32,
          charger_power_w: 11000,
          charger_phases: 3,
        }),
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.getByText('240')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(screen.getByText('32')).toBeInTheDocument();
    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText('Phases')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows an em-dash for phases when the phase count is 0', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charger_phases: 0 }) }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('Phases')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('does not render the wide-only efficiency stat in the standard layout', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry() }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
  });
});

describe('ChargingTelemetryWidget — wide layout (efficiency, badge, sparkline)', () => {
  it('computes charging efficiency in watts (not the 100% clamp) and renders it', () => {
    // Theoretical draw = 32 A × 240 V × 1 phase = 7680 W. Actual = 7000 W.
    // Correct efficiency ≈ 91%. The old kW-vs-W mismatch pinned it at 100%.
    mockLive.mockReturnValue(
      makeQuery({
        data: makeTelemetry({
          charger_pilot_current: 32,
          charger_voltage: 240,
          charger_phases: 1,
          charger_power_w: 7000,
        }),
      }),
    );
    renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('omits the efficiency stat when the pilot current is unavailable', () => {
    mockLive.mockReturnValue(
      makeQuery({ data: makeTelemetry({ charger_pilot_current: 0 }) }),
    );
    renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
  });

  it('labels an AC charger below the DC voltage threshold', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charger_voltage: 240 }) }));
    renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.getByText('AC Charger')).toBeInTheDocument();
    expect(screen.queryByText('DC Charger')).not.toBeInTheDocument();
  });

  it('labels a DC charger above the 300 V threshold', () => {
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ charger_voltage: 400 }) }));
    renderWidget({ size: { cols: 4, rows: 2 } });

    expect(screen.getByText('DC Charger')).toBeInTheDocument();
    expect(screen.queryByText('AC Charger')).not.toBeInTheDocument();
  });

  it('accumulates a power sparkline across telemetry updates', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A fresh element each call: reusing one reference makes React bail out of
    // re-rendering (element identity short-circuit), but the widget's element
    // *type* stays constant so its fiber — and the power-history ref — persist.
    const makeTree = () => (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ChargingTelemetryWidget size={{ cols: 4, rows: 2 }} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    // One data point → no sparkline yet (needs a segment to draw across).
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ ts: 't1', charger_power_w: 5000 }) }));
    const { container, rerender } = render(makeTree());
    expect(container.querySelector('svg[role="img"]')).toBeNull();

    // A second (distinct ts) sample extends the history → sparkline renders.
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry({ ts: 't2', charger_power_w: 6000 }) }));
    rerender(makeTree());
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
  });
});

describe('ChargingTelemetryWidget — not-charging empty state', () => {
  it('shows the empty state (role=status) in the standard layout when not charging', () => {
    mockLive.mockReturnValue(
      makeQuery({ data: makeTelemetry({ charging_state: 'Disconnected' }) }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('Not currently charging')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No stat grid when disconnected.
    expect(screen.queryByText('Voltage')).not.toBeInTheDocument();
  });

  it('shows the compact empty state when charging_state is null', () => {
    mockLive.mockReturnValue(
      makeQuery({ data: makeTelemetry({ charging_state: null }) }),
    );
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText('Not currently charging')).toBeInTheDocument();
    // The compact power readout is absent when not charging.
    expect(screen.queryByText(/kW$/)).not.toBeInTheDocument();
  });
});

describe('ChargingTelemetryWidget — loading / error states', () => {
  it('renders a skeleton (no content) while the initial fetch is loading', () => {
    mockLive.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Charging Telemetry')).not.toBeInTheDocument();
    expect(screen.queryByText('Not currently charging')).not.toBeInTheDocument();
  });

  it('surfaces a genuine initial-load failure as a real error panel', () => {
    mockLive.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Honest error panel from WidgetShell (QueryError), not the empty state.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Not currently charging')).not.toBeInTheDocument();
  });

  it('keeps cached telemetry on screen when a background refetch errors', () => {
    mockLive.mockReturnValue(
      makeQuery({
        data: makeTelemetry({ charger_power_w: 11000 }),
        isError: true,
        error: new Error('boom'),
      }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Data present → the error is a subtle freshness signal, not a full panel.
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByText('11.0')).toBeInTheDocument();
  });
});

describe('ChargingTelemetryWidget — refresh + vehicle resolution', () => {
  it('refetches charging telemetry when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockLive.mockReturnValue(makeQuery({ data: makeTelemetry(), refetch }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('queries telemetry for the vehicleId prop (with the 5s refresh interval)', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockLive).toHaveBeenCalledWith(7, 5000);
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockLive).toHaveBeenCalledWith(42, 5000);
  });

  it('passes id 0 (disabling the query) when no vehicle is available', () => {
    mockUseVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockLive).toHaveBeenCalledWith(0, 5000);
  });
});
