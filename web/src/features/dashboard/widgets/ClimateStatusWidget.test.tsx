/**
 * ClimateStatusWidget — behaviour + hardening coverage.
 *
 * The widget renders the latest climate/HVAC reading for the first (or
 * explicitly selected) vehicle inside a WidgetShell: cabin + outside
 * temperature (converted to the user's unit at the render boundary), the HVAC
 * state, and two status chips (defrost active / battery heater on). Every
 * data hook is mocked so the network is never touched, and `useUnits` is
 * stubbed with a deterministic temperature preference so the real
 * `convertTempFromSI` + `fmtInt` display math is exercised end-to-end.
 *
 * Facets covered:
 *   - populated render: both temperatures (°C), HVAC state, and both chips.
 *   - unit conversion: the same SI Celsius values render in °F when the
 *     preference flips, and the label follows the preference (not the source).
 *   - battery-heater regression (R1): the chip is driven by the `battery_heater`
 *     field the `/climate/latest` handler actually emits (BatteryHeaterOn →
 *     battery_heater), NOT the legacy `battery_heater_on` alias which is always
 *     undefined on this endpoint — so the chip used to be dead code.
 *   - hvac-power regression (R2): canonical boolean state renders as On/Off;
 *     malformed non-boolean payloads collapse to the placeholder.
 *   - chip branches: defrost "Off" and inactive/null heater hide their chips.
 *   - null-safety: missing temps + power collapse to "—" without crashing.
 *   - empty state: the "No climate data" EmptyState (role="status") with the
 *     data rows withheld.
 *   - loading: WidgetShell skeleton with all content (header + body) withheld.
 *   - refresh: the freshness control refetches the climate query (a11y — the
 *     control is exposed as a button named "Refresh").
 *   - vehicle-id resolution: explicit prop, first-vehicle fallback, and the
 *     disabled (id 0) query when no vehicle exists — always with the 5s poll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Data hooks + the display-boundary unit bridge, driven per test. ──
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useClimateLatest: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: vi.fn(),
}));

import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import ClimateStatusWidget from './ClimateStatusWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockClimate = useClimateLatest as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

 
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

// Mirrors the flat map the climate/latest handler emits (signal → field). The
// spread lets each test override individual fields, including intentionally
// wrong-typed values to lock in boundary hardening. Temperatures are SI °C.
function makeClimate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inside_temp: 20,
    outside_temp: 10,
    hvac_power: true,
    defrost_mode: 'Normal',
    battery_heater: true,
    ...over,
  };
}

const STANDARD = { cols: 2, rows: 3 };

function setup(
  opts: {
     
    vehicles?: any;
     
    climate?: any;
    tempPref?: '°C' | '°F';
  } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockClimate.mockReturnValue(opts.climate ?? makeQuery({ data: makeClimate() }));
  mockUnits.mockReturnValue({ unitPrefs: { temperature: opts.tempPref ?? '°C' } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClimateStatusWidget — rendering', () => {
  it('renders both temperatures (°C), HVAC state, and both status chips', () => {
    setup({ climate: makeQuery({ data: makeClimate() }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.getByText('Climate')).toBeInTheDocument();
    expect(screen.getByText('20°C')).toBeInTheDocument();
    expect(screen.getByText('10°C')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('Defrost')).toBeInTheDocument();
    expect(screen.getByText('Heater')).toBeInTheDocument();
  });

  it('converts the SI Celsius readings to °F and labels them with the user preference', () => {
    // 20°C → 68°F, 0°C → 32°F. The label follows the preference, never the
    // source unit, so no °C string survives.
    setup({
      climate: makeQuery({ data: makeClimate({ inside_temp: 20, outside_temp: 0 }) }),
      tempPref: '°F',
    });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.getByText('68°F')).toBeInTheDocument();
    expect(screen.getByText('32°F')).toBeInTheDocument();
    expect(screen.queryByText('20°C')).not.toBeInTheDocument();
  });

  it('drives the heater chip from `battery_heater`, ignoring the legacy `battery_heater_on` alias', () => {
    // Regression (R1): the /climate/latest handler maps BatteryHeaterOn →
    // "battery_heater". The widget used to read "battery_heater_on", which is
    // undefined on this endpoint, so the chip never rendered. Here the two
    // fields DISAGREE to prove the widget reads the correct one.
    setup({
      climate: makeQuery({
        data: makeClimate({ battery_heater: true, battery_heater_on: false, defrost_mode: 'Off' }),
      }),
    });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.getByText('Heater')).toBeInTheDocument();
    expect(screen.queryByText('Defrost')).not.toBeInTheDocument();
  });

  it('does not render the heater chip when only the legacy `battery_heater_on` is set', () => {
    // The inverse of the R1 guard: a truthy legacy alias must NOT resurrect the
    // chip once the canonical field is false.
    setup({
      climate: makeQuery({
        data: makeClimate({ battery_heater: false, battery_heater_on: true, defrost_mode: 'Off' }),
      }),
    });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.queryByText('Heater')).not.toBeInTheDocument();
    expect(screen.queryByText('Defrost')).not.toBeInTheDocument();
  });

  it('collapses a non-boolean HVAC payload to a placeholder', () => {
    setup({
      climate: makeQuery({
        data: makeClimate({ inside_temp: 21, outside_temp: 11, hvac_power: 'On' }),
      }),
    });
    render(<ClimateStatusWidget size={STANDARD} />);

    // Only the HVAC row is missing a value; both temps still render.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('hides both status chips when defrost is "Off" and the heater is inactive', () => {
    setup({
      climate: makeQuery({
        data: makeClimate({ defrost_mode: 'Off', battery_heater: false }),
      }),
    });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.queryByText('Defrost')).not.toBeInTheDocument();
    expect(screen.queryByText('Heater')).not.toBeInTheDocument();
    // Temperature rows still render — only the chips are gated.
    expect(screen.getByText('20°C')).toBeInTheDocument();
  });

  it('renders null-safe placeholders for missing temps and power without crashing', () => {
    setup({
      climate: makeQuery({
        data: makeClimate({
          inside_temp: null,
          outside_temp: null,
          hvac_power: null,
          defrost_mode: null,
          battery_heater: null,
        }),
      }),
    });
    render(<ClimateStatusWidget size={STANDARD} />);

    // Cabin, Outside, and HVAC all collapse to the em-dash placeholder.
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('Defrost')).not.toBeInTheDocument();
    expect(screen.queryByText('Heater')).not.toBeInTheDocument();
  });

  it('shows the "No climate data" empty state when the endpoint returns nothing', () => {
    setup({ climate: makeQuery({ data: null }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.getByText('No climate data')).toBeInTheDocument();
    // EmptyState is a semantic status region for screen readers.
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The data rows are withheld entirely.
    expect(screen.queryByText('Cabin')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds header + content while data loads', () => {
    setup({ climate: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Climate')).not.toBeInTheDocument();
    expect(screen.queryByText('No climate data')).not.toBeInTheDocument();
  });

  it('refetches the climate query when the freshness control is activated', () => {
    const refetch = vi.fn();
    setup({ climate: makeQuery({ data: makeClimate(), refetch }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    // The freshness indicator is exposed as an accessible "Refresh" button.
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ClimateStatusWidget — vehicle resolution', () => {
  it('passes the explicit vehicleId prop to the climate query with the 5s poll', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 42 }] }) });
    render(<ClimateStatusWidget vehicleId={7} size={STANDARD} />);

    expect(mockClimate).toHaveBeenCalledWith(7, 5000);
    // The resolved data is what gets rendered.
    expect(screen.getByText('20°C')).toBeInTheDocument();
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 3 }, { id: 9 }] }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(mockClimate).toHaveBeenCalledWith(3, 5000);
  });

  it('keys the climate query on 0 (disabled) when there is no vehicle to resolve', () => {
    setup({ vehicles: makeQuery({ data: [] }), climate: makeQuery({ data: null }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(mockClimate).toHaveBeenCalledWith(0, 5000);
    // With no vehicle and no data, the widget degrades to the empty state.
    expect(screen.getByText('No climate data')).toBeInTheDocument();
  });
});
