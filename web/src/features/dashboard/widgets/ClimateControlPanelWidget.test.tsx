/**
 * ClimateControlPanelWidget — behavioural, branch, null-safety and a11y
 * coverage for the dashboard "Climate Control" widget.
 *
 * The widget reads `useClimateLatest()` (TanStack Query, 5s poll) and renders
 * one of two layouts driven by `size`:
 *   • compact (cols ≤ 1 && rows ≤ 1): a single big cabin-temperature figure;
 *   • full: an HVAC on/off badge, a cabin/outside temperature
 *     row, a fan-speed / wheel-heat row, and a wrap of seat-heater + defrost +
 *     battery-heater status chips.
 *
 * What this file pins:
 *   - the LAYOUT SWITCH (compact vs full) and each layout's null/empty handling;
 *   - the TEMPERATURE display boundary — SI °C read verbatim, converted to °F
 *     via the user's `useUnits()` preference, and null-safe "—" placeholders;
 *   - THREE FIELD-NAME FIXES against the real `/climate/latest` contract
 *     (`internal/api/climate/handler.go` `climateMappings`): the widget now
 *     reads `is_ac_on` (HVAC-on badge), `fan_speed` (fan-speed cell) and
 *     `battery_heater` (battery-heater chip). The pre-fix code read
 *     `hvac_ac_enabled` / `hvac_fan_speed` / `battery_heater_on`, none of which
 *     the endpoint ever emits, so those facets silently rendered off/"—";
 *   - the SEAT-HEATER derivation — only seats with a level > 0 appear, each with
 *     its `label level/3` chip, else a "no seat heaters active" caption;
 *   - the DEFROST / WHEEL-HEAT branches (present vs "Off" vs null);
 *   - the HOOK CONTRACT — `useClimateLatest(id, 5000)` with the resolved id and
 *     the `vehicles[0].id` / `0` fallbacks when no `vehicleId` prop is supplied;
 *   - the LOADING skeleton and the REFRESH control wiring (chip → `refetch`).
 *
 * Strategy: `useClimateLatest` + `useVehicles` are the network boundary and are
 * fully controllable via hoisted mocks. `useUnits` is mocked so the temperature
 * preference is observable. `react-i18next` echoes each `t(key, fallback)`
 * fallback so assertions read against English copy. `DataFreshness`'s display
 * hooks are stubbed so the freshness chip renders without a Settings provider.
 * A `<MemoryRouter>` wraps every render because `EmptyState` renders a `<Link>`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { ClimateSnapshot } from '@/api/types';
import type { WidgetSize } from './types';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { vehiclesMock, climateMock, unitsMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  climateMock: vi.fn(),
  unitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useClimateLatest: (...args: unknown[]) => climateMock(...args),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

// i18n → return the developer fallback so copy reads as English.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string, options?: Record<string, unknown>) =>
        (fallback ?? _key).replace(/\{\{(\w+)\}\}/g, (match, key: string) => String(options?.[key] ?? match)),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// DataFreshness display hooks — stubbed so the freshness chip renders without a
// Settings/QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

import ClimateControlPanelWidget from './ClimateControlPanelWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';

/**
 * A `/climate/latest` snapshot. The required SI `*_c` columns are set to null
 * (the endpoint projects the legacy-named `inside_temp`/`outside_temp` aliases
 * that the widget actually reads); every field the widget touches defaults to
 * null so each test opts into exactly the facet it exercises.
 */
function makeClimate(over: Partial<ClimateSnapshot> = {}): ClimateSnapshot {
  return {
    vehicle_id: 7,
    ts: NOW,
    inside_temp_c: null,
    outside_temp_c: null,
    driver_setpoint_c: null,
    passenger_setpoint_c: null,
    hvac_state: null,
    defrost_mode: null,
    is_climate_on: null,
    is_preconditioning: null,
    fan_status: null,
    seat_heater_left: null,
    seat_heater_right: null,
    seat_heater_rear_left: null,
    seat_heater_rear_right: null,
    steering_wheel_heater: null,
    cabin_overheat_protection: null,
    source: 'signal',
    // Fields actually projected by climateMappings in the Go handler:
    inside_temp: null,
    outside_temp: null,
    hvac_power: null,
    is_ac_on: null,
    fan_speed: null,
    hvac_steering_wheel_heat_level: null,
    battery_heater: null,
    seat_heater_rear_center: null,
    ...over,
  };
}

interface QueryOverrides {
  data?: ClimateSnapshot;
  error?: unknown;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setQuery(over: QueryOverrides = {}) {
  const q = {
    data: undefined as ClimateSnapshot | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  climateMock.mockReturnValue(q);
  return q;
}

/** Set the user's temperature display preference (drives the SI→display path). */
function setTempUnit(temperature: '°C' | '°F') {
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature,
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
  });
}

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <ClimateControlPanelWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  setTempUnit('°C');
  setQuery({ data: makeClimate() });
});

describe('ClimateControlPanelWidget — source brief', () => {
  it('renders four real cells with zero and negative Celsius, zero levels and all independent status chips in their original order', () => {
    setQuery({ data: makeClimate({
      inside_temp: 0, outside_temp: -10, fan_speed: 0, hvac_steering_wheel_heat_level: 0,
      hvac_power: true, is_ac_on: false, defrost_mode: 'Front', battery_heater: true,
      seat_heater_left: 3, seat_heater_right: 2, seat_heater_rear_left: 1,
      seat_heater_rear_center: 2, seat_heater_rear_right: 3,
    }) });
    renderWidget(FULL, 7);

    const brief = screen.getByTestId('dashboard-climate-panel-brief');
    const cells = within(brief).getAllByRole('listitem');
    expect(cells).toHaveLength(4);
    expect(cells.map(cell => cell.getAttribute('data-operational-metric'))).toEqual([
      'climate-panel-cabin', 'climate-panel-outside', 'climate-panel-fan-level', 'climate-panel-wheel-level',
    ]);
    expect(cells.map(cell => cell.getAttribute('data-value-state'))).toEqual(['value', 'value', 'value', 'value']);
    expect(cells.map(cell => cell.querySelector('[data-operational-value]')?.textContent)).toEqual([
      '0°C', '-10°C', '0', 'Off',
    ]);
    expect(brief).toHaveTextContent('Source available');
    expect(brief).toHaveTextContent('Vehicle 7');
    expect(brief).toHaveTextContent('continuous recording coverage is not established');
    expect(brief).toHaveTextContent('not a velocity measurement');
    expect(screen.getByText('HVAC on')).toBeInTheDocument();
    expect(screen.getByText('Defrost')).toBeInTheDocument();
    expect(screen.getByText('Bat heater')).toBeInTheDocument();
    expect(screen.getAllByText(/^(FL|FR|RL|RC|RR) [1-3]\/3$/).map(chip => chip.textContent?.trim())).toEqual([
      'FL 3/3', 'FR 2/3', 'RL 1/3', 'RC 2/3', 'RR 3/3',
    ]);
  });

  it('distinguishes missing operands from invalid source values without treating malformed HVAC strings as known status', () => {
    const query = setQuery({ data: makeClimate() });
    climateMock.mockReturnValue({
      ...query,
      data: { ...makeClimate(), inside_temp: null, outside_temp: Number.NaN, fan_speed: '0',
        hvac_steering_wheel_heat_level: Number.POSITIVE_INFINITY, hvac_power: '—', is_ac_on: 'false' },
    });
    renderWidget(FULL);

    const brief = screen.getByTestId('dashboard-climate-panel-brief');
    const cells = within(brief).getAllByRole('listitem');
    expect(cells).toHaveLength(4);
    expect(cells.map(cell => cell.getAttribute('data-value-state'))).toEqual(['missing', 'invalid', 'invalid', 'invalid']);
    expect(cells.map(cell => cell.querySelector('[data-operational-value]')?.textContent)).toEqual(['—', '—', '—', '—']);
    expect(cells[0]).toHaveTextContent('No measurement supplied');
    expect(cells[1]).toHaveTextContent('Expected a finite numeric measurement');
    expect(screen.getByText('HVAC unknown')).toBeInTheDocument();
    expect(screen.queryByText('HVAC off')).toBeNull();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(within(brief).queryByText('Off')).toBeNull();
  });

  it('keeps the parent retained-source state, four measurements and heater chips on refresh failure with the same retry action', () => {
    const query = setQuery({ data: makeClimate({
      inside_temp: 0, outside_temp: -5, fan_speed: 2, hvac_steering_wheel_heat_level: 1,
      defrost_mode: 'Front', battery_heater: true,
    }), isError: true, error: new Error('refresh failed') });
    renderWidget(FULL);

    const brief = screen.getByTestId('dashboard-climate-panel-brief');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(4);
    expect(brief).toHaveTextContent('Retained readings');
    expect(brief.querySelector('[data-provenance="cached"]')).toHaveAttribute('data-data-status', 'stale');
    expect(screen.getByText('0°C')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(screen.getByText('Defrost')).toBeInTheDocument();
    expect(screen.getByText('Bat heater')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('does not manufacture a four-cell summary after initial source failure and retains the shell retry', () => {
    const query = setQuery({ data: undefined, isError: true, error: new Error('source failed') });
    renderWidget(FULL);

    expect(screen.queryByTestId('dashboard-climate-panel-brief')).toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Loading & empty states ──────────────────────────────────────────────────────

describe('ClimateControlPanelWidget — loading & empty states', () => {
  it('keeps measured values and heater status during a failed cached refresh', () => {
    setQuery({ data: makeClimate({ inside_temp: 21, seat_heater_left: 3 }), isError: true });
    renderWidget(FULL);
    expect(screen.getByText('21°C')).toBeInTheDocument();
    expect(screen.getByText('FL 3/3')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('renders only a skeleton (no heading or content) while loading', () => {
    setQuery({ isLoading: true, data: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /Climate control/i })).toBeInTheDocument();
    expect(screen.queryByText('Fan speed')).toBeNull();
  });

  it('shows the empty state (not a temperature row) when there is no climate data', () => {
    setQuery({ data: undefined });
    renderWidget(FULL);

    expect(screen.getByRole('status')).toHaveTextContent('No climate data');
    expect(screen.queryByText('Fan speed')).toBeNull();
    expect(screen.queryByText('HVAC on')).toBeNull();
    expect(screen.queryByText('HVAC off')).toBeNull();
  });
});

// ── Compact layout ───────────────────────────────────────────────────────────────

describe('ClimateControlPanelWidget — compact layout', () => {
  it('renders the cabin temperature with its unit and no full-view labels', () => {
    setQuery({ data: makeClimate({ inside_temp: 21 }) });
    renderWidget(COMPACT);

    expect(screen.getByText('21°C')).toBeInTheDocument();
    expect(screen.queryByText('Fan speed')).toBeNull();
    expect(screen.queryByText('Cabin')).toBeNull();
  });

  it('falls back to "—" when the cabin temperature is missing', () => {
    setQuery({ data: makeClimate({ inside_temp: null }) });
    renderWidget(COMPACT);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/°C$/)).toBeNull();
  });
});

// ── Temperature display boundary ─────────────────────────────────────────────────

describe('ClimateControlPanelWidget — temperature display', () => {
  it('reads SI °C verbatim for cabin and outside', () => {
    setQuery({ data: makeClimate({ inside_temp: 21, outside_temp: 9 }) });
    renderWidget(FULL);

    expect(screen.getByText('21°C')).toBeInTheDocument();
    expect(screen.getByText('9°C')).toBeInTheDocument();
  });

  it('converts SI °C to °F at the render boundary when the user prefers Fahrenheit', () => {
    setTempUnit('°F');
    setQuery({ data: makeClimate({ inside_temp: 20, outside_temp: 0 }) });
    renderWidget(FULL);

    expect(screen.getByText('68°F')).toBeInTheDocument(); // 20°C → 68°F
    expect(screen.getByText('32°F')).toBeInTheDocument(); // 0°C  → 32°F
    expect(screen.queryByText('20°C')).toBeNull();
  });

  it('renders "—" placeholders for both temperatures when they are null', () => {
    setQuery({ data: makeClimate({ inside_temp: null, outside_temp: null }) });
    renderWidget(FULL);

    // Cabin + Outside cells both fall back.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

// ── HVAC status badge (field-name fix: is_ac_on) ─────────────────────────────────

describe('ClimateControlPanelWidget — HVAC status', () => {
  it('shows "HVAC On" from is_ac_on even when hvac_power is absent', () => {
    // Pins the fix: pre-fix the widget read `hvac_ac_enabled` (never emitted)
    // so an AC-only-on vehicle wrongly showed "HVAC Off".
    setQuery({ data: makeClimate({ is_ac_on: true, hvac_power: null }) });
    renderWidget(FULL);

    expect(screen.getByText('HVAC on')).toBeInTheDocument();
    expect(screen.queryByText('HVAC off')).toBeNull();
  });

  it('shows "HVAC On" from the canonical boolean hvac_power field', () => {
    setQuery({ data: makeClimate({ hvac_power: true, is_ac_on: false }) });
    renderWidget(FULL);

    expect(screen.getByText('HVAC on')).toBeInTheDocument();
  });

  it('shows "HVAC Off" when both HVAC signals are explicitly off', () => {
    setQuery({ data: makeClimate({ is_ac_on: false, hvac_power: false }) });
    renderWidget(FULL);

    expect(screen.getByText('HVAC off')).toBeInTheDocument();
  });
});

// ── Fan speed & wheel heat (field-name fix: fan_speed) ───────────────────────────

describe('ClimateControlPanelWidget — fan speed & wheel heat', () => {
  it('renders the fan_speed value (the field the endpoint actually emits)', () => {
    // Pins the fix: pre-fix read `hvac_fan_speed` (never emitted) → always "—".
    setQuery({ data: makeClimate({ fan_speed: 7 }) });
    renderWidget(FULL);

    expect(screen.getByText('Fan speed')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('grades wheel-heat: a level shows "n/3", zero shows "Off"', () => {
    setQuery({ data: makeClimate({ hvac_steering_wheel_heat_level: 2 }) });
    const { rerender } = renderWidget(FULL);
    expect(screen.getByText('2/3')).toBeInTheDocument();

    setQuery({ data: makeClimate({ hvac_steering_wheel_heat_level: 0 }) });
    rerender(
      <MemoryRouter>
        <ClimateControlPanelWidget size={FULL} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
});

// ── Seat heaters, defrost & battery heater chips ─────────────────────────────────

describe('ClimateControlPanelWidget — status chips', () => {
  it('lists only the seats whose heater level is > 0, each as "label n/3"', () => {
    setQuery({
      data: makeClimate({
        seat_heater_left: 3,
        seat_heater_right: 0, // off → omitted
        seat_heater_rear_left: 2,
      }),
    });
    renderWidget(FULL);

    expect(screen.getByText('FL 3/3')).toBeInTheDocument();
    expect(screen.getByText('RL 2/3')).toBeInTheDocument();
    expect(screen.queryByText(/FR/)).toBeNull();
    expect(screen.queryByText('No seat heaters active')).toBeNull();
  });

  it('shows the "no seat heaters active" caption when none are on', () => {
    setQuery({ data: makeClimate({ seat_heater_left: 0, seat_heater_right: 0, seat_heater_rear_left: 0, seat_heater_rear_center: 0, seat_heater_rear_right: 0 }) });
    renderWidget(FULL);

    expect(screen.getByText('No seat heaters active')).toBeInTheDocument();
  });

  it('does not claim missing seat-heater observations are off', () => {
    setQuery({ data: makeClimate({ seat_heater_left: null, seat_heater_rear_center: null }) });
    renderWidget(FULL);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText('No seat heaters active')).toBeNull();
  });

  it('shows the defrost chip only when defrost_mode is set and not "Off"', () => {
    setQuery({ data: makeClimate({ defrost_mode: 'Front' }) });
    const { rerender } = renderWidget(FULL);
    expect(screen.getByText('Defrost')).toBeInTheDocument();

    setQuery({ data: makeClimate({ defrost_mode: 'Off' }) });
    rerender(
      <MemoryRouter>
        <ClimateControlPanelWidget size={FULL} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Defrost')).toBeNull();
  });

  it('shows the battery-heater chip from battery_heater (not the mis-named legacy field)', () => {
    // Pins the fix: pre-fix read `battery_heater_on` (never emitted) → chip never showed.
    setQuery({ data: makeClimate({ battery_heater: true }) });
    const { rerender } = renderWidget(FULL);
    expect(screen.getByText('Bat heater')).toBeInTheDocument();

    setQuery({ data: makeClimate({ battery_heater: false }) });
    rerender(
      <MemoryRouter>
        <ClimateControlPanelWidget size={FULL} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Bat heater')).toBeNull();
  });
});

// ── Hook contract & vehicle-id resolution ────────────────────────────────────────

describe('ClimateControlPanelWidget — hook contract', () => {
  it('subscribes to useClimateLatest with the vehicleId prop and a 5s poll', () => {
    setQuery({ data: makeClimate() });
    renderWidget(FULL, 7);

    expect(climateMock).toHaveBeenCalledWith(7, 5000);
  });

  it('falls back to the first vehicle id when no vehicleId prop is provided', () => {
    vehiclesMock.mockReturnValue({ data: [{ id: 42, display_name: 'Other' }] });
    setQuery({ data: makeClimate() });
    renderWidget(FULL, undefined);

    expect(climateMock).toHaveBeenCalledWith(42, 5000);
  });

  it('resolves to id 0 when neither a prop nor any vehicle is available', () => {
    vehiclesMock.mockReturnValue({ data: undefined });
    setQuery({ data: undefined });
    renderWidget(FULL, undefined);

    expect(climateMock).toHaveBeenCalledWith(0, 5000);
  });
});

// ── Interactions & accessibility ─────────────────────────────────────────────────

describe('ClimateControlPanelWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setQuery({ data: makeClimate() });
    renderWidget(FULL);

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the widget title as a heading in the full layout', () => {
    setQuery({ data: makeClimate() });
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: /^Climate control$/i })).toBeInTheDocument();
  });
});
