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
 *     raw state MISSING `battery_level` floors to 0 instead of rendering NaN;
 *   - the charging indicator — shown only while charging, hidden otherwise and
 *     in the compact variant, with the decorative bolt hidden from a11y;
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
import { render, screen, fireEvent } from '@testing-library/react';
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

import BatteryGaugeWidget, { batteryColor } from './BatteryGaugeWidget';

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

interface VehicleStateResult {
  data: { state?: VehicleState; live: boolean } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
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

// ── Pure helper: batteryColor ────────────────────────────────────────────────

describe('batteryColor', () => {
  it('renders neutral grey when the level is unknown (null/undefined)', () => {
    expect(batteryColor(null)).toBe('#374151');
    expect(batteryColor(undefined)).toBe('#374151');
  });

  it('maps the charge tiers to green / amber / red', () => {
    expect(batteryColor(80)).toBe('#10b981'); // healthy
    expect(batteryColor(35)).toBe('#f59e0b'); // medium
    expect(batteryColor(10)).toBe('#ef4444'); // low
  });

  it('applies the thresholds at the exact boundaries', () => {
    expect(batteryColor(51)).toBe('#10b981');
    expect(batteryColor(50)).toBe('#f59e0b'); // 50 is NOT > 50 → amber
    expect(batteryColor(21)).toBe('#f59e0b');
    expect(batteryColor(20)).toBe('#ef4444'); // 20 is NOT > 20 → red
    expect(batteryColor(0)).toBe('#ef4444');
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
  it('renders a loading skeleton while the state query is pending', () => {
    useVehicleStateMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No battery data')).toBeNull();
    expect(screen.queryByText('Battery')).toBeNull();
  });

  it('shows the empty state when no vehicle snapshot has landed', () => {
    useVehicleStateMock.mockReturnValue(makeResult({ data: { state: undefined, live: false } }));
    renderWidget();
    expect(screen.getByText('No battery data')).toBeInTheDocument();
    expect(screen.queryByText('Battery')).toBeNull();
  });

  it('surfaces an error affordance (red freshness dot + Refresh) on failure', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ isError: true, dataUpdatedAt: 0, data: undefined }),
    );
    const { container } = renderWidget();
    // The freshness chip flips to its error tier (red dot) and stays actionable.
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    // No data yet → an empty panel, never a blank one.
    expect(screen.getByText('No battery data')).toBeInTheDocument();
  });
});

// ── Populated gauge (full size) ──────────────────────────────────────────────

describe('BatteryGaugeWidget — populated', () => {
  it('renders the gauge with the battery level, label and unit', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 72 }), live: true } }),
    );
    renderWidget();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('wires a high-charge green arc through from batteryColor', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 72 }), live: true } }),
    );
    const { container } = renderWidget();
    expect(container.querySelector('circle[stroke="#10b981"]')).not.toBeNull();
  });

  it('floors a missing battery_level to 0 (no NaN) and shows the red arc', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeStateMissingLevel(), live: true } }),
    );
    const { container } = renderWidget();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).toBeNull();
    expect(container.querySelector('circle[stroke="#ef4444"]')).not.toBeNull();
  });

  it('shows the charging indicator with an a11y-hidden bolt while charging', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 60, is_charging: true }), live: true } }),
    );
    const { container } = renderWidget();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    const bolt = container.querySelector('span[aria-hidden="true"]');
    expect(bolt).not.toBeNull();
    expect(bolt?.textContent).toContain('⚡');
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
  it('renders the gauge but suppresses the charging chip in the 1×1 variant', () => {
    useVehicleStateMock.mockReturnValue(
      makeResult({ data: { state: makeState({ battery_level: 88, is_charging: true }), live: true } }),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('88')).toBeInTheDocument();
    // WidgetGaugeHero drops its children (the ⚡ chip) in compact mode.
    expect(screen.queryByText('Charging')).toBeNull();
  });
});
