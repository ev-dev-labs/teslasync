/**
 * LiveSignalsWidget — behaviour + hardening coverage.
 *
 * The widget aggregates four independent "latest" telemetry snapshots for the
 * first (or explicitly selected) vehicle inside a WidgetShell: motor
 * (torque / stator temp / gear), climate (cabin + outside temp, HVAC power),
 * tire pressures (FL/FR/RL/RR), and a security summary (lock + sentry chips).
 * Every data hook and the display-boundary `useUnits` bridge are mocked so the
 * network is never touched, while the real `convertTempFromSI` /
 * `convertPressureFromSI` + `fmtInt` / `fmtNumber` display math is exercised
 * end-to-end.
 *
 * Facets covered:
 *   - populated render: motor/climate/tire/security values in the default
 *     unit preference (°C + bar), plus the security lock/sentry chips.
 *   - unit conversion: the same SI readings render in °F + psi when the
 *     preference flips, and the labels follow the preference, not the source.
 *   - torque formatting: a large SI torque renders through `fmtInt`
 *     (locale-grouped "1,234 Nm"), not a raw number.
 *   - R2 enum-string regression: motor/climate/tire numeric fields decode to
 *     enum STRINGS on the wire ("On", "Drive", …). The old `!= null` guard let
 *     those flow into the formatters → nonsensical "0"/"0.0 kW"/"0.0 bar". The
 *     `isFiniteNumber` guard now collapses each to the "—" placeholder.
 *   - null-safety: null numerics + a Go "<nil>" gear string collapse to "—"
 *     (via `cleanNil`) without crashing, and the security chips fall back to
 *     the locked/off defaults.
 *   - security branches: unlocked + sentry-off render the danger/neutral chips.
 *   - per-source skeletons: when only one source has landed, the other three
 *     sections render loading skeletons instead of hiding.
 *   - empty state: with no source data the "No live signal data" EmptyState
 *     (role="status") renders and every section is withheld.
 *   - refresh: the freshness control refetches the motor query (a11y — the
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
  useMotorLatest: vi.fn(),
  useClimateLatest: vi.fn(),
  useSecurityLatest: vi.fn(),
  useLatestTirePressure: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: vi.fn(),
}));

import {
  useVehicles,
  useMotorLatest,
  useClimateLatest,
  useSecurityLatest,
  useLatestTirePressure,
} from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import LiveSignalsWidget from './LiveSignalsWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockMotor = useMotorLatest as unknown as ReturnType<typeof vi.fn>;
const mockClimate = useClimateLatest as unknown as ReturnType<typeof vi.fn>;
const mockSecurity = useSecurityLatest as unknown as ReturnType<typeof vi.fn>;
const mockTires = useLatestTirePressure as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// The four snapshot shapes below mirror the flat maps the *_latest handlers
// emit (signal → field). The spread lets each test override individual fields,
// including intentionally wrong-typed values (enum strings, Go "<nil>") to lock
// in the hardening. Numeric values are SI: temps in °C, pressures in kPa, HVAC
// power already in kW.
function makeMotor(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { di_torque: 245, di_stator_temp: 60, gear: 'D', ...over };
}
function makeClimate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { inside_temp: 20, outside_temp: 10, hvac_power: 2.5, ...over };
}
function makeTires(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { front_left: 290, front_right: 300, rear_left: 280, rear_right: 260, ...over };
}
function makeSecurity(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { locked: true, sentry_mode: true, ...over };
}

const STANDARD = { cols: 2, rows: 2 };

function setup(
  opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vehicles?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    motor?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    climate?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    security?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tires?: any;
    tempPref?: '°C' | '°F';
    pressurePref?: 'kPa' | 'psi' | 'bar';
  } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockMotor.mockReturnValue(opts.motor ?? makeQuery({ data: makeMotor() }));
  mockClimate.mockReturnValue(opts.climate ?? makeQuery({ data: makeClimate() }));
  mockSecurity.mockReturnValue(opts.security ?? makeQuery({ data: makeSecurity() }));
  mockTires.mockReturnValue(opts.tires ?? makeQuery({ data: makeTires() }));
  mockUnits.mockReturnValue({
    unitPrefs: { temperature: opts.tempPref ?? '°C', pressure: opts.pressurePref ?? 'bar' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LiveSignalsWidget — rendering', () => {
  it('renders every section with SI readings in the default units (°C + bar)', () => {
    setup();
    render(<LiveSignalsWidget size={STANDARD} />);

    // Section headers.
    expect(screen.getByText('Motor')).toBeInTheDocument();
    expect(screen.getByText('Climate')).toBeInTheDocument();
    expect(screen.getByText('Tires')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();

    // Motor: torque, stator temp (°C), gear.
    expect(screen.getByText('245 Nm')).toBeInTheDocument();
    expect(screen.getByText('60°C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();

    // Climate: cabin + outside temps (°C), HVAC power.
    expect(screen.getByText('20°C')).toBeInTheDocument();
    expect(screen.getByText('10°C')).toBeInTheDocument();
    expect(screen.getByText('2.5 kW')).toBeInTheDocument();

    // Tires: 290/300/280/260 kPa → bar (÷100).
    expect(screen.getByText('2.9 bar')).toBeInTheDocument();
    expect(screen.getByText('3.0 bar')).toBeInTheDocument();
    expect(screen.getByText('2.8 bar')).toBeInTheDocument();
    expect(screen.getByText('2.6 bar')).toBeInTheDocument();

    // Security chips.
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('converts SI readings to the user preference (°F + psi) and labels follow the preference', () => {
    // 20°C→68°F, 10°C→50°F, 60°C→140°F; 290 kPa → 42.1 psi.
    setup({ tempPref: '°F', pressurePref: 'psi' });
    render(<LiveSignalsWidget size={STANDARD} />);

    expect(screen.getByText('68°F')).toBeInTheDocument();
    expect(screen.getByText('50°F')).toBeInTheDocument();
    expect(screen.getByText('140°F')).toBeInTheDocument();
    expect(screen.getByText('42.1 psi')).toBeInTheDocument();

    // The source unit never leaks once the preference flips.
    expect(screen.queryByText('20°C')).not.toBeInTheDocument();
    expect(screen.queryByText('2.9 bar')).not.toBeInTheDocument();
  });

  it('formats a large SI torque through fmtInt (locale-grouped), not a raw number', () => {
    setup({ motor: makeQuery({ data: makeMotor({ di_torque: 1234 }) }) });
    render(<LiveSignalsWidget size={STANDARD} />);

    expect(screen.getByText('1,234 Nm')).toBeInTheDocument();
    expect(screen.queryByText('1234 Nm')).not.toBeInTheDocument();
  });

  it('collapses non-numeric enum-string readings to "—" instead of "0" / "0.0 kW" / "0.0 bar"', () => {
    // Regression (R2): the wire fields decode to enum strings. The old
    // `!= null` guard let them reach fmtInt/fmtNumber → safeNumber(str)=0 →
    // "0 Nm" / "0°C" / "0.0 kW" / "0.0 bar". `isFiniteNumber` rejects them.
    setup({
      motor: makeQuery({ data: makeMotor({ di_torque: 'Drive', di_stator_temp: 'HeatOn', gear: 'D' }) }),
      climate: makeQuery({ data: makeClimate({ inside_temp: 'Cold', outside_temp: 'Warm', hvac_power: 'On' }) }),
      tires: makeQuery({ data: makeTires({ front_left: 'Low', front_right: 'OK', rear_left: 'OK', rear_right: 'OK' }) }),
      security: makeQuery({ data: makeSecurity({ sentry_mode: false }) }),
    });
    render(<LiveSignalsWidget size={STANDARD} />);

    // No numeric-unit output leaked from any of the three numeric sections.
    expect(screen.queryByText(/kW|Nm|bar|°C/)).not.toBeInTheDocument();
    // Nine numeric rows (torque, motor temp, cabin, outside, hvac, 4 tires)
    // all collapse to the placeholder; gear is a valid string and survives.
    expect(screen.getAllByText('—')).toHaveLength(9);
    expect(screen.getByText('D')).toBeInTheDocument();
    // Security is unaffected — it renders from booleans.
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('is null-safe: null numerics and a Go "<nil>" gear collapse to "—" without crashing', () => {
    setup({
      motor: makeQuery({ data: makeMotor({ di_torque: null, di_stator_temp: null, gear: '<nil>' }) }),
      climate: makeQuery({ data: makeClimate({ inside_temp: null, outside_temp: null, hvac_power: null }) }),
      tires: makeQuery({ data: makeTires({ front_left: null, front_right: null, rear_left: null, rear_right: null }) }),
      security: makeQuery({ data: makeSecurity({ locked: null, sentry_mode: null }) }),
    });
    render(<LiveSignalsWidget size={STANDARD} />);

    // Ten placeholders: the nine numerics plus the cleanNil'd "<nil>" gear.
    expect(screen.getAllByText('—')).toHaveLength(10);
    // Nullish security booleans fall back to the locked/off default chips.
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('renders the danger/neutral chips when the vehicle is unlocked with sentry off', () => {
    setup({ security: makeQuery({ data: makeSecurity({ locked: false, sentry_mode: false }) }) });
    render(<LiveSignalsWidget size={STANDARD} />);

    expect(screen.getByText('Unlocked')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows per-source loading skeletons for the sources that have not landed yet', () => {
    // Only the motor snapshot has arrived; climate/security/tires are still
    // loading. The grid renders (motor has data) and the other three sections
    // each show a skeleton rather than disappearing.
    setup({
      climate: makeQuery({ data: null }),
      security: makeQuery({ data: null }),
      tires: makeQuery({ data: null }),
    });
    const { container } = render(<LiveSignalsWidget size={STANDARD} />);

    expect(screen.getByText('245 Nm')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
    // The still-loading sections withhold their values but keep their headers.
    expect(screen.getByText('Climate')).toBeInTheDocument();
    expect(screen.queryByText('2.5 kW')).not.toBeInTheDocument();
  });

  it('shows the "No live signal data" empty state when every source is empty', () => {
    setup({
      motor: makeQuery({ data: null }),
      climate: makeQuery({ data: null }),
      security: makeQuery({ data: null }),
      tires: makeQuery({ data: null }),
    });
    render(<LiveSignalsWidget size={STANDARD} />);

    expect(screen.getByText('No live signal data')).toBeInTheDocument();
    // EmptyState is a semantic status region for screen readers.
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Every data section is withheld.
    expect(screen.queryByText('Motor')).not.toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });

  it('refetches the motor query when the freshness control is activated', () => {
    const refetch = vi.fn();
    setup({ motor: makeQuery({ data: makeMotor(), refetch }) });
    render(<LiveSignalsWidget size={STANDARD} />);

    // The freshness indicator is exposed as an accessible "Refresh" button.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('LiveSignalsWidget — vehicle resolution', () => {
  it('passes the explicit vehicleId prop to every snapshot query with the 5s poll', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 42 }] }) });
    render(<LiveSignalsWidget vehicleId={7} size={STANDARD} />);

    expect(mockMotor).toHaveBeenCalledWith(7, 5000);
    expect(mockClimate).toHaveBeenCalledWith(7, 5000);
    expect(mockSecurity).toHaveBeenCalledWith(7, 5000);
    expect(mockTires).toHaveBeenCalledWith(7, 5000);
    // The resolved data is what gets rendered.
    expect(screen.getByText('245 Nm')).toBeInTheDocument();
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 3 }, { id: 9 }] }) });
    render(<LiveSignalsWidget size={STANDARD} />);

    expect(mockMotor).toHaveBeenCalledWith(3, 5000);
    expect(mockClimate).toHaveBeenCalledWith(3, 5000);
  });

  it('keys every query on 0 (disabled) when there is no vehicle to resolve', () => {
    setup({
      vehicles: makeQuery({ data: [] }),
      motor: makeQuery({ data: null }),
      climate: makeQuery({ data: null }),
      security: makeQuery({ data: null }),
      tires: makeQuery({ data: null }),
    });
    render(<LiveSignalsWidget size={STANDARD} />);

    expect(mockMotor).toHaveBeenCalledWith(0, 5000);
    // With no vehicle and no data, the widget degrades to the empty state.
    expect(screen.getByText('No live signal data')).toBeInTheDocument();
  });
});
