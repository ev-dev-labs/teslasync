/**
 * BatteryGaugeWidget — behaviour, branch, null-safety and a11y coverage for the
 * dashboard's state-of-charge gauge widget.
 *
 * What this file pins:
 *   - the exported pure helper `batteryColor` — the green / amber / red charge
 *     tiers, their EXACT boundaries (50 is amber, 51 is green; 20 is red, 21 is
 *     amber), and the neutral-grey "unknown level" guard for null/undefined;
 *   - the widget's data-source resolution (explicit `vehicleId` prop vs. the
 *     first fleet vehicle vs. an empty fleet → id 0 so the query stays disabled);
 *   - every render state fanned out by `WidgetShell` — loading skeleton, the
 *     error affordance (red freshness dot + working Refresh control), and the
 *     empty state when no snapshot has landed;
 *   - the populated gauge — the level / label / unit content, that the arc
 *     colour is wired through from `batteryColor`, and the regression fix that a
 *     raw state MISSING `battery_level` remains unknown instead of rendering 0;
 *   - the charging line — "Charging · +N% to limit" while charging with a
 *     known limit, plain "Charging" without one, hidden otherwise, including
 *     compact variants;
 *   - the After-spec meter — thick bar, charge-limit marker with its "80%"
 *     label, and the "172 mi range" line from the SI rated range;
 *   - the freshness "Refresh" control wiring back to `refetch`.
 *
 * Strategy: the two data hooks (`useVehicles`, `useVehicleState`) live in the
 * same module and are mocked together so no network is touched and every query
 * state is controllable per-test. i18n is a passthrough that honours the English
 * default so the visible copy is deterministic and real. The widget is rendered
 * inside a MemoryRouter because the shared feedback components it composes may
 * reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { VehicleState } from '@/api/types';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default so the widget's copy
// ("Battery", "Charging", "No battery data", "Refresh") is asserted verbatim.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useVehiclesMock, useVehicleStateMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useVehicleStateMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
  useVehicleState: (id: number, options?: { refetchInterval?: number }) =>
    useVehicleStateMock(id, options),
}));

// Distance preference pinned to miles so the SI (metres) rated range renders
// deterministically as "172 mi range".
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'mi' } }),
}));

import BatteryGaugeWidget, { batteryColor } from './BatteryGaugeWidget';
import { hasGaugeColor } from '@/test/gaugeTestUtils';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 72,
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

/** A raw state payload where the backend omitted `battery_level` entirely. */
function makeStateMissingLevel(): VehicleState {
  return { ...makeState(), battery_level: undefined } as unknown as VehicleState;
}

/** A state object with an extra (untyped) `charge_limit_soc` field attached. */
function makeStateWithLimit(limit: unknown, over: Partial<VehicleState> = {}): VehicleState {
  return { ...makeState(over), charge_limit_soc: limit } as unknown as VehicleState;
}

/** Metres in one mile, for building SI rated-range fixtures. */
const MI_M = 1609.344;

interface VehicleStateResult {
  data: { state?: VehicleState; live: boolean } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  error?: unknown;
  fetchStatus?: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeResult(over: Partial<VehicleStateResult> = {}): VehicleStateResult {
  return {
    data: { state: makeState(), live: true },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <BatteryGaugeWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useVehicleStateMock.mockReset();
  useVehiclesMock.mockReturnValue({ data: [] });
  useVehicleStateMock.mockReturnValue(makeResult());
});

it.each([1, 2, 3])('keeps an accessible heading at %s columns', cols => {
  renderWidget({ cols, rows: 2 });
  expect(screen.getByRole('heading', { name: 'Battery', level: 3 })).toBeVisible();
});

// ── Pure helper: batteryColor ────────────────────────────────────────────────

describe('batteryColor', () => {
  it('renders neutral grey when the level is unknown (null/undefined)', () => {
    expect(batteryColor(null)).toBe('var(--text-secondary)');
    expect(batteryColor(undefined)).toBe('var(--text-secondary)');
    expect(batteryColor(Number.NaN)).toBe('var(--text-secondary)');
  });

  it('maps the charge tiers to green / amber / red', () => {
    expect(batteryColor(80)).toBe('var(--semantic-success)'); // healthy
    expect(batteryColor(35)).toBe('var(--semantic-warning)'); // medium
    expect(batteryColor(10)).toBe('var(--semantic-danger)'); // low
  });

  it('applies the thresholds at the exact boundaries', () => {
    expect(batteryColor(51)).toBe('var(--semantic-success)');
    expect(batteryColor(50)).toBe('var(--semantic-warning)'); // 50 is NOT > 50 → amber
    expect(batteryColor(21)).toBe('var(--semantic-warning)');
    expect(batteryColor(20)).toBe('var(--semantic-danger)'); // 20 is NOT > 20 → red
    expect(batteryColor(0)).toBe('var(--semantic-danger)');
  });
});

// ── Data-source resolution ───────────────────────────────────────────────────

describe('BatteryGaugeWidget — vehicle resolution', () => {
  it('reads state for the explicit vehicleId prop', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(useVehicleStateMock).toHaveBeenCalledWith(42, undefined);
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(useVehicleStateMock).toHaveBeenCalledWith(7, undefined);
  });

  it('falls back to id 0 (query disabled) when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useVehicleStateMock).toHaveBeenCalledWith(0, undefined);
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('BatteryGaugeWidget — states', () => {
  it('retains the meter on refresh failure and exposes the existing retry warning', () => {
    const refetch = vi.fn();
    useVehicleStateMock.mockReturnValue(makeResult({ isError: true, error: new Error('offline'), refetch }));
    renderWidget();
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '72');
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveTextContent('Previously loaded data remains visible');
    expect(warning.querySelector('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('distinguishes a paused offline refresh from a failed request', () => {
    useVehicleStateMock.mockReturnValue(makeResult({ fetchStatus: 'paused' }));
    renderWidget();
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '72');
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
    expect(warning).toHaveTextContent('The latest values are temporarily unavailable. Previously loaded data remains visible.');
    expect(warning).not.toHaveTextContent('device is offline');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a genuine zero battery reading on the percentage meter', () => {
    useVehicleStateMock.mockReturnValue(makeResult({ data: { state: makeState({ battery_level: 0 }), live: true } }));
    renderWidget();
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders a loading skeleton while the state query is pending', () => {
    useVehicleStateMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    const shell = container.querySelector('[data-data-state="initial"]');
    expect(shell).toHaveAttribute('aria-busy', 'true');
    const skeleton = shell?.querySelector('[aria-hidden="true"].min-h-24');
    expect(skeleton).toHaveClass('h-full', 'min-h-24', 'rounded-xl', 'bg-[var(--skeleton-bg)]');
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('No battery data')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Battery', level: 3 })).toBeVisible();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('shows the empty state when no vehicle snapshot has landed', () => {
    const refetch = vi.fn();
    useVehicleStateMock.mockReturnValue(makeResult({ data: { state: undefined, live: false }, refetch }));
    renderWidget();
    expect(screen.getByText('No battery data')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Battery', level: 3 })).toBeVisible();
    expect(screen.queryByRole('meter')).toBeNull();
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error affordance (red freshness dot + Refresh) on failure', () => {
    const refetch = vi.fn();
    useVehicleStateMock.mockReturnValue(
      makeResult({ isError: true, dataUpdatedAt: 0, data: undefined, refetch }),
    );
    const { container } = renderWidget();
    expect(container.querySelector('[data-data-state="initialFailure"]')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No battery data')).toBeNull();
  });
});

// ── Populated gauge (full size) ──────────────────────────────────────────────

describe('BatteryGaugeWidget — populated', () => {
  it('renders the gauge with the battery level and unit without repeating its widget title', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 72 }), live: true } }),
    );
    renderWidget();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Battery', level: 3 })).toBeVisible();
    expect(screen.getAllByText('Battery', { exact: true })).toHaveLength(1);
    expect(screen.getByRole('meter', { name: 'Battery' })).toHaveAttribute('aria-valuenow', '72');
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('renders the After-spec limit marker, charging headroom and range lines', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({
        data: {
          state: makeStateWithLimit(80, { battery_level: 64, is_charging: true, rated_range: 172 * MI_M }),
          live: true,
        },
      }),
    );
    const { container } = renderWidget();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('Charging · +16% to limit')).toBeInTheDocument();
    expect(screen.getByText('172 mi range')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    const marker = container.querySelector('[data-testid="gauge-marker"]');
    expect(marker).not.toBeNull();
    expect(marker).toHaveStyle({ left: '80%' });
  });

  it('omits the limit marker and headroom when charge_limit_soc is absent or invalid', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeStateWithLimit('high', { battery_level: 64, is_charging: true }), live: true } }),
    );
    const { container } = renderWidget();
    expect(container.querySelector('[data-testid="gauge-marker"]')).toBeNull();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.queryByText(/to limit/)).toBeNull();
  });

  it('retains an out-of-scale reading as the headline without a clipped meter', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 125 }), live: true } }),
    );
    renderWidget();
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('shows the range line without a charging line when not charging', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({
        data: { state: makeState({ battery_level: 64, is_charging: false, rated_range: 172 * MI_M }), live: true },
      }),
    );
    renderWidget();
    expect(screen.getByText('172 mi range')).toBeInTheDocument();
    expect(screen.queryByText(/Charging/)).toBeNull();
  });

  it('wires a high-charge green arc through from batteryColor', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 72 }), live: true } }),
    );
    const { container } = renderWidget();
    expect(hasGaugeColor(container, 'var(--semantic-success)')).toBe(true);
  });

  it('shows an unknown reading rather than a fabricated zero or critical arc', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeStateMissingLevel(), live: true } }),
    );
    const { container } = renderWidget();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('NaN')).toBeNull();
    expect(hasGaugeColor(container, 'var(--semantic-danger)')).toBe(false);
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('shows the charging line while charging', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 60, is_charging: true }), live: true } }),
    );
    renderWidget();
    expect(screen.getByText('Charging')).toBeInTheDocument();
  });

  it('hides the charging indicator when the vehicle is not charging', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ is_charging: false }), live: true } }),
    );
    renderWidget();
    expect(screen.queryByText('Charging')).toBeNull();
  });

  it('refetches when the freshness control is activated', () => {
    const refetch = vi.fn();
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState(), live: true }, refetch }),
    );
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('BatteryGaugeWidget — compact', () => {
  it('keeps the charging state visible in the compact variant', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 88, is_charging: true }), live: true } }),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
  });
});
