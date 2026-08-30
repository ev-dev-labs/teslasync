/**
 * MotorPerformanceWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that surfaces a vehicle's live
 * motor telemetry from `/motor/latest`. Its whole shape is a function of three
 * inputs: the resolved vehicle id (`vehicleId` prop, else the first fleet
 * vehicle, else none/0), the `useMotorLatest` query result, and the widget
 * `size`:
 *
 *   - size.cols <= 1 → compact tile: gear + torque only, no title.
 *   - otherwise      → full tile: titled header + a signed torque BipolarBar +
 *                      a 2×2 StatCard grid (stator temp / gear / lateral +
 *                      longitudinal G).
 *   - no motor data  → the accessible "No motor data" empty state.
 *   - isLoading / error → skeleton / QueryError chrome.
 *
 * Two layers are locked here:
 *
 *  A. The pure `torqueColor` classifier (exported for testability) — every
 *     colour band plus its exact boundaries (200 → amber, 400 → red).
 *
 *  B. The component behaviour: full vs compact vs empty/loading/error views;
 *     the SI-Celsius → display-unit temperature conversion (°C and °F); the
 *     stator-temp and gear fallback chains; the regen (negative-torque) bar
 *     that renders the sign as direction rather than clamping it away; the
 *     null-safe em-dash placeholders; the id-resolution fallback chain wired to
 *     the 5s live-refresh interval; and the accessible refresh control.
 *
 * i18n is stubbed to echo the English fallback so every copy assertion is real,
 * `@/hooks/useUnits` is stubbed so the temperature preference is injectable, and
 * `@/api/hooks/useVehicles` is partially mocked (real module kept, only the two
 * hooks the widget reads are overridden) so no network is ever touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The temperature preference is injected per-test through a mutable holder so
// the SI → display conversion can be exercised for both °C and °F. The widget
// only reads `unitPrefs.temperature`, so a partial stub is sufficient.
let MOCK_TEMP_UNIT: '°C' | '°F';
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: MOCK_TEMP_UNIT } }),
}));

// The fleet list + motor query result are injected per-test through these
// mutable holders (the `MOCK_`/`mock` prefixes let vitest hoist the factory
// above them safely). Only the two hooks the widget reads are overridden — the
// rest of the real module is preserved so transitive importers keep working.
const mockUseMotorLatest = vi.fn((_id: number, _interval?: number) => MOCK_MOTOR);
let MOCK_VEHICLES: { data: Vehicle[] | undefined };
let MOCK_MOTOR: MotorQuery;
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => MOCK_VEHICLES,
    useMotorLatest: (id: number, interval?: number) => mockUseMotorLatest(id, interval),
  };
});

import MotorPerformanceWidget, { torqueColor } from './MotorPerformanceWidget';
import type { WidgetSize } from './types';
import type { MotorSnapshot } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';

/** Only the fields the widget reads off the `useMotorLatest` result. */
interface MotorQuery {
  data: MotorSnapshot | null | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

// `lateral_accel` / `longitudinal_accel` are served by the endpoint but are not
// (yet) on the `MotorSnapshot` interface — the widget reads them via an unknown
// cast, so the factory has to allow them as extra keys.
type MotorOverrides = Partial<MotorSnapshot> & {
  lateral_accel?: number | null;
  longitudinal_accel?: number | null;
};

/** Build a fully-typed MotorSnapshot; all telemetry defaults to null/absent. */
function makeMotor(overrides: MotorOverrides = {}): MotorSnapshot {
  const base: MotorSnapshot = {
    ts: '2026-07-05T12:00:00Z',
    created_at: '2026-07-05T12:00:00Z',
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: null,
    vbat_front: null,
    vbat_rear: null,
    di_stator_temp: null,
    gear: null,
  };
  return { ...base, ...overrides } as MotorSnapshot;
}

function makeQuery(overrides: Partial<MotorQuery> = {}): MotorQuery {
  return {
    data: makeMotor(),
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function fleet(...ids: number[]): Vehicle[] {
  return ids.map((id) => ({ id })) as unknown as Vehicle[];
}

interface RenderOpts {
  query?: MotorQuery;
  vehicles?: Vehicle[];
  vehicleId?: number;
  tempUnit?: '°C' | '°F';
}

function renderWidget(size: WidgetSize, opts: RenderOpts = {}) {
  MOCK_MOTOR = opts.query ?? makeQuery();
  MOCK_VEHICLES = { data: opts.vehicles ?? [] };
  MOCK_TEMP_UNIT = opts.tempUnit ?? '°C';
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MotorPerformanceWidget vehicleId={opts.vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The StatCard root `<div>` that groups a label with its value/unit. */
function statCardOf(label: string): HTMLElement {
  // getByText(label) → the label span; its .closest('div') is the label row,
  // whose parent is the StatCard root that also holds the value row.
  const labelRow = screen.getByText(label).closest('div');
  const card = labelRow?.parentElement;
  if (!card) throw new Error(`stat card "${label}" not found`);
  return card as HTMLElement;
}

beforeEach(() => {
  MOCK_VEHICLES = { data: [] };
  MOCK_MOTOR = makeQuery();
  MOCK_TEMP_UNIT = '°C';
  mockUseMotorLatest.mockClear();
});

afterEach(() => {
  cleanup();
});

// ── A. Pure helper ──────────────────────────────────────────────────────────

describe('torqueColor', () => {
  it('maps low torque to green, mid to amber, high to red', () => {
    expect(torqueColor(0)).toBe('#10b981');
    expect(torqueColor(150)).toBe('#10b981');
    expect(torqueColor(250)).toBe('#f59e0b');
    expect(torqueColor(500)).toBe('#ef4444');
  });

  it('pins the exact band boundaries (200 → amber, 400 → red)', () => {
    // Just under / on the first boundary.
    expect(torqueColor(199)).toBe('#10b981');
    expect(torqueColor(200)).toBe('#f59e0b');
    // Just under / on the second boundary.
    expect(torqueColor(399)).toBe('#f59e0b');
    expect(torqueColor(400)).toBe('#ef4444');
  });
});

// ── B. Component behaviour ──────────────────────────────────────────────────

describe('MotorPerformanceWidget — full view', () => {
  it('renders the titled gauge + stat grid with converted, formatted values', () => {
    renderWidget(FULL, {
      query: makeQuery({
        data: makeMotor({
          di_torque: 150,
          di_stator_temp: 30,
          gear: 'D',
          lateral_accel: 0.35,
          longitudinal_accel: -0.12,
        }),
      }),
    });

    // Full tile shows the header title.
    expect(screen.getByText('Motor Performance')).toBeInTheDocument();

    // The torque bar renders the reading once and carries the "Nm" unit.
    expect(screen.getByRole('meter', { name: 'Torque' })).toHaveAttribute(
      'aria-valuenow',
      '150',
    );
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Nm')).toBeInTheDocument();

    // Stator temp: 30 °C stays 30 under a °C preference, tagged with the unit.
    const stator = within(statCardOf('Stator Temp'));
    expect(stator.getByText('30')).toBeInTheDocument();
    expect(stator.getByText('°C')).toBeInTheDocument();

    // Gear state echoes the reported gear.
    expect(within(statCardOf('Gear State')).getByText('D')).toBeInTheDocument();

    // G-forces are formatted to two decimals and share the "g" unit.
    expect(within(statCardOf('Lateral G')).getByText('0.35')).toBeInTheDocument();
    expect(within(statCardOf('Longitudinal G')).getByText('-0.12')).toBeInTheDocument();
    expect(screen.getAllByText('g')).toHaveLength(2);
  });

  it('converts the SI-Celsius stator temp to °F when that is the preference', () => {
    renderWidget(FULL, {
      tempUnit: '°F',
      query: makeQuery({ data: makeMotor({ di_stator_temp: 30 }) }),
    });

    // 30 °C → 86 °F, tagged with the Fahrenheit unit, never the Celsius one.
    const stator = within(statCardOf('Stator Temp'));
    expect(stator.getByText('86')).toBeInTheDocument();
    expect(stator.getByText('°F')).toBeInTheDocument();
    expect(screen.queryByText('°C')).toBeNull();
  });

  it('falls back to the front motor temp / shift state when the primaries are absent', () => {
    renderWidget(FULL, {
      query: makeQuery({
        data: makeMotor({
          di_stator_temp: null,
          motor_temp_c_front: 45,
          gear: null,
          shift_state: 'R',
        }),
      }),
    });

    expect(within(statCardOf('Stator Temp')).getByText('45')).toBeInTheDocument();
    expect(within(statCardOf('Gear State')).getByText('R')).toBeInTheDocument();
  });

  it('renders an em-dash placeholder for every missing datum (null-safety)', () => {
    // Everything null: torque falls back to 0, and gear / stator / both
    // G-forces each render the "—" placeholder — four in total.
    renderWidget(FULL, { query: makeQuery({ data: makeMotor() }) });

    expect(screen.getAllByText('—')).toHaveLength(4);
    // Torque coalesces to a real 0 in the bar rather than a dash.
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders regen as a signed reading rather than clamping the sign away', () => {
    // Regen produces negative torque. The old dial fed it |torque|, so regen
    // and an equal drive torque drew an identical arc and the centre number
    // disagreed with the caption. The bar carries the sign directly.
    renderWidget(FULL, { query: makeQuery({ data: makeMotor({ di_torque: -150 }) }) });

    const meter = screen.getByRole('meter', { name: 'Torque' });
    expect(meter).toHaveAttribute('aria-valuenow', '-150');
    expect(screen.getByText('-150')).toBeInTheDocument();
    // The unsigned magnitude must NOT also be on screen — that was the
    // confusing double readout.
    expect(screen.queryByText('150')).toBeNull();
  });

  it('scales regen and drive independently and labels both directions', () => {
    renderWidget(FULL, { query: makeQuery({ data: makeMotor({ di_torque: 100 }) }) });

    const meter = screen.getByRole('meter', { name: 'Torque' });
    expect(meter).toHaveAttribute('aria-valuemax', '600');
    expect(meter).toHaveAttribute('aria-valuemin', '-250');
    expect(screen.getByText('Regen')).toBeInTheDocument();
    expect(screen.getByText('Drive')).toBeInTheDocument();
  });

  it('distinguishes regen from an equal drive torque (the clamping regression)', () => {
    const regen = renderWidget(FULL, {
      query: makeQuery({ data: makeMotor({ di_torque: -150 }) }),
    });
    const regenNow = screen
      .getByRole('meter', { name: 'Torque' })
      .getAttribute('aria-valuenow');
    regen.unmount();

    renderWidget(FULL, { query: makeQuery({ data: makeMotor({ di_torque: 150 }) }) });
    const driveNow = screen
      .getByRole('meter', { name: 'Torque' })
      .getAttribute('aria-valuenow');

    expect(regenNow).toBe('-150');
    expect(driveNow).toBe('150');
    expect(regenNow).not.toBe(driveNow);
  });
});

describe('MotorPerformanceWidget — compact view', () => {
  it('renders gear + torque only, dropping the header title', () => {
    renderWidget(COMPACT, {
      query: makeQuery({ data: makeMotor({ di_torque: 150, gear: 'D' }) }),
    });

    expect(screen.getByText('Gear')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('Torque')).toBeInTheDocument();
    expect(screen.getByText('150 Nm')).toBeInTheDocument();
    // A 1×1 tile suppresses the header title entirely.
    expect(screen.queryByText('Motor Performance')).toBeNull();
  });

  it('shows an accessible empty state when there is no motor data', () => {
    renderWidget(COMPACT, { query: makeQuery({ data: null }) });

    expect(screen.getByText('No motor data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Gear')).toBeNull();
  });
});

describe('MotorPerformanceWidget — lifecycle states', () => {
  it('renders only a skeleton while loading', () => {
    const { container } = renderWidget(FULL, { query: makeQuery({ isLoading: true }) });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Motor Performance')).toBeNull();
    expect(screen.queryByText('No motor data')).toBeNull();
  });

  it('surfaces a query error instead of the gauge', () => {
    renderWidget(FULL, {
      query: makeQuery({ error: new Error('boom'), isError: true }),
    });

    // jsdom reports navigator.onLine === true → QueryError's network branch.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Motor Performance')).toBeNull();
    expect(screen.queryByText('Stator Temp')).toBeNull();
  });

  it('shows an accessible empty state (not a gauge) when data is null', () => {
    renderWidget(FULL, { query: makeQuery({ data: null }) });

    expect(screen.getByText('No motor data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Stator Temp')).toBeNull();
  });
});

describe('MotorPerformanceWidget — vehicle resolution + refresh', () => {
  it('queries the explicit vehicleId at the 5s live interval', () => {
    renderWidget(FULL, { vehicleId: 7 });
    expect(mockUseMotorLatest).toHaveBeenCalledWith(7, 5000);
  });

  it('falls back to the first fleet vehicle when no vehicleId is given', () => {
    renderWidget(FULL, { vehicles: fleet(3, 9) });
    expect(mockUseMotorLatest).toHaveBeenCalledWith(3, 5000);
  });

  it('resolves to id 0 (disabled) when neither a prop nor a fleet vehicle exists', () => {
    renderWidget(FULL, { vehicles: [] });
    expect(mockUseMotorLatest).toHaveBeenCalledWith(0, 5000);
  });

  it('refetches when the accessible "Refresh" freshness control is activated', () => {
    const refetch = vi.fn();
    renderWidget(FULL, { query: makeQuery({ refetch, isFetching: false }) });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
