/**
 * EnergyFlowWidget — behavioural, branch, null-safety and a11y coverage for the
 * dashboard "Energy Flow" widget.
 *
 * The widget resolves a vehicle (from the `vehicleId` prop, else the first
 * vehicle, else id `0`), subscribes to `useVehicleState` on a 5s poll, and folds
 * the live power/charging snapshot into a `WidgetFlowDiagram` of nodes + arrows:
 *   • a `battery` node (SoC %) — always present;
 *   • a `motor` node whose label flips Consuming / Regenerating / Standby with the
 *     sign of `power`, formatted as "N.N kW" (or "—" at standby);
 *   • an optional `charger` node + `charger → battery` arrow while charging;
 *   • directional `battery → motor` (discharge) and `motor → battery` (regen)
 *     arrows, each active only on its matching power sign.
 *
 * What this file pins:
 *   - the LOADING gate — a fix hardened here so the widget shows a skeleton while
 *     the *vehicle list itself* loads (previously `loading` only watched the state
 *     query, so the widget flashed the "No energy data" empty state before any
 *     vehicle resolved and the state query was still disabled at id 0);
 *   - the EMPTY state when the state snapshot has not resolved (never a blank
 *     panel), vs. the diagram once it has;
 *   - the VEHICLE-ID RESOLUTION ladder (prop → first → 0) and the exact hook
 *     contract (`(id, { refetchInterval: 5000 })`);
 *   - the MOTOR branch (consuming / regenerating / standby) with its "N.N kW" /
 *     "—" formatting, and the abs-power magnitude fed to the diagram;
 *   - the ARROW activation branches (discharge vs regen) and the optional charger
 *     node + arrow;
 *   - the NULL-SAFETY guards (`power`/`is_charging`/`charger_power`/`battery_level`
 *     all absent) collapsing to a safe battery 0% / standby / no-charger state;
 *   - the REFRESH wiring (accessible chip → the memoised `refetch` callback), the
 *     title heading, and the localized empty-message handed to the diagram.
 *
 * Strategy: `@/api/hooks/useVehicles` is the network boundary and is fully
 * controllable via hoisted mocks. `WidgetFlowDiagram` is stubbed with a
 * prop-recording spy that also mirrors nodes/arrows into the DOM, so the widget's
 * own derivation is observable both structurally (via the spy) and visually (via
 * queries) without rendering the animated SVG / `AnimatedNumber` (which tween
 * from 0 and would make value assertions racy). `react-i18next` echoes each
 * `t(key, fallback)` fallback so assertions read against English copy.
 * `DataFreshness`'s display hooks are stubbed so the freshness/refresh chip
 * renders without a Settings provider. A `<MemoryRouter>` wraps every render
 * because `EmptyState` reaches for `<Link>`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { Vehicle, VehicleState } from '@/api/types';
import type { FlowNode, FlowArrow } from './shared';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { vehiclesMock, stateMock, flowSpy } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  stateMock: vi.fn(),
  flowSpy: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleState: (...args: unknown[]) => stateMock(...args),
}));

// WidgetFlowDiagram — a prop-recording stub. It records the derived nodes/arrows
// (the real unit under test) and mirrors them into the DOM so both the structure
// and the rendered copy are assertable, without the animated SVG scene.
vi.mock('./shared', () => ({
  WidgetFlowDiagram: (props: { nodes: FlowNode[]; arrows: FlowArrow[]; emptyMessage?: string }) => {
    flowSpy(props);
    return (
      <div data-testid="flow-diagram" data-empty={props.emptyMessage}>
        {props.nodes.map((n) => (
          <div key={n.id} data-testid={`node-${n.id}`} data-value={String(n.value)}>
            <span data-testid={`node-${n.id}-label`}>{n.label}</span>
            <span data-testid={`node-${n.id}-value`}>{n.formattedValue}</span>
          </div>
        ))}
        {props.arrows.map((a) => (
          <div
            key={`${a.from}-${a.to}`}
            data-testid={`arrow-${a.from}-${a.to}`}
            data-active={String(a.active)}
            data-value={String(a.value)}
          />
        ))}
      </div>
    );
  },
}));

// i18n → return the developer fallback so copy reads as English.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
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

import EnergyFlowWidget from './EnergyFlowWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';
const SIZE = { cols: 2, rows: 2 };

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    vehicle_id: 7,
    vin: '5YJ3E1EA7KF000007',
    display_name: 'Model 3',
    state: 'online',
    healthy: true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Vehicle;
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 7,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 60,
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
  } as VehicleState;
}

interface StateOverrides {
  state?: VehicleState;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setVehicles(list: Vehicle[] | undefined, isLoading = false) {
  vehiclesMock.mockReturnValue({ data: list, isLoading });
}

function setState(over: StateOverrides = {}) {
  const q = {
    data: over.state !== undefined ? { state: over.state, live: false } : undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  stateMock.mockReturnValue(q);
  return q;
}

function renderWidget(vehicleId?: number) {
  return render(
    <MemoryRouter>
      <EnergyFlowWidget size={SIZE} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

/** The nodes/arrows the widget handed to the (mocked) diagram on its last render. */
function lastFlowProps() {
  return flowSpy.mock.calls.at(-1)?.[0] as {
    nodes: FlowNode[];
    arrows: FlowArrow[];
    emptyMessage?: string;
  };
}
function nodeById(id: string): FlowNode | undefined {
  return lastFlowProps().nodes.find((n) => n.id === id);
}
function arrowByEnds(from: string, to: string): FlowArrow | undefined {
  return lastFlowProps().arrows.find((a) => a.from === from && a.to === to);
}

beforeEach(() => {
  vi.clearAllMocks();
  setVehicles([makeVehicle()]);
  setState({ state: makeState() });
});

// ── Loading & empty states ──────────────────────────────────────────────────────

describe('EnergyFlowWidget — loading & empty states', () => {
  it('renders only a skeleton (no diagram, no empty state) while the vehicle list loads', () => {
    // Bug pin: `loading` must fold in the vehicle-list load, else the widget
    // flashes the empty state while the state query is still disabled at id 0.
    setVehicles(undefined, true);
    setState({ state: undefined });
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('flow-diagram')).toBeNull();
    expect(screen.queryByText('No energy data available')).toBeNull();
    expect(flowSpy).not.toHaveBeenCalled();
  });

  it('renders a skeleton (not the empty state) while the vehicle state loads', () => {
    setState({ isLoading: true, state: undefined });
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('flow-diagram')).toBeNull();
  });

  it('shows the "No energy data available" empty state when the state has not resolved', () => {
    setState({ state: undefined });
    renderWidget();

    expect(screen.getByRole('status')).toHaveTextContent('No energy data available');
    expect(screen.queryByTestId('flow-diagram')).toBeNull();
    expect(flowSpy).not.toHaveBeenCalled();
  });

  it('renders the flow diagram (not the empty state) once the state resolves', () => {
    setState({ state: makeState() });
    renderWidget();

    expect(screen.getByTestId('flow-diagram')).toBeInTheDocument();
    expect(screen.queryByText('No energy data available')).toBeNull();
  });
});

// ── Vehicle-id resolution & hook contract ────────────────────────────────────────

describe('EnergyFlowWidget — vehicle resolution & hook contract', () => {
  it('resolves the vehicleId prop and subscribes with a 5s poll', () => {
    setVehicles([makeVehicle({ id: 7 }), makeVehicle({ id: 9, vehicle_id: 9 })]);
    renderWidget(9);

    expect(stateMock).toHaveBeenCalledWith(9, { refetchInterval: 5000 });
  });

  it('falls back to the first vehicle id when no vehicleId prop is provided', () => {
    setVehicles([makeVehicle({ id: 42, vehicle_id: 42 })]);
    renderWidget(undefined);

    expect(stateMock).toHaveBeenCalledWith(42, { refetchInterval: 5000 });
  });

  it('subscribes with id 0 (query disabled) when no vehicles are available', () => {
    setVehicles([]);
    renderWidget(undefined);

    expect(stateMock).toHaveBeenCalledWith(0, { refetchInterval: 5000 });
  });
});

// ── Node derivation ──────────────────────────────────────────────────────────────

describe('EnergyFlowWidget — node derivation', () => {
  it('always emits a battery node carrying the raw SoC value and a "N%" label', () => {
    setState({ state: makeState({ battery_level: 72 }) });
    renderWidget();

    const battery = nodeById('battery');
    expect(battery?.value).toBe(72);
    expect(battery?.formattedValue).toBe('72%');
    expect(screen.getByTestId('node-battery-label')).toHaveTextContent('Battery');
  });

  it('labels the motor "Consuming" and formats abs power as "N.N kW" when discharging', () => {
    setState({ state: makeState({ power: 12.3 }) });
    renderWidget();

    const motor = nodeById('motor');
    expect(motor?.label).toBe('Consuming');
    expect(motor?.value).toBe(12.3);
    expect(motor?.formattedValue).toBe('12.3 kW');
  });

  it('labels the motor "Regenerating" and uses the magnitude of a negative power', () => {
    setState({ state: makeState({ power: -8.5 }) });
    renderWidget();

    const motor = nodeById('motor');
    expect(motor?.label).toBe('Regenerating');
    expect(motor?.value).toBe(8.5); // abs()
    expect(screen.getByTestId('node-motor-value')).toHaveTextContent('8.5 kW');
  });

  it('labels the motor "Standby" and shows an em dash at zero power', () => {
    setState({ state: makeState({ power: 0 }) });
    renderWidget();

    const motor = nodeById('motor');
    expect(motor?.label).toBe('Standby');
    expect(motor?.formattedValue).toBe('—');
  });

  it('adds a charger node with "N.N kW" only while charging', () => {
    setState({ state: makeState({ is_charging: true, charger_power: 48 }) });
    renderWidget();

    const charger = nodeById('charger');
    expect(charger?.value).toBe(48);
    expect(charger?.formattedValue).toBe('48.0 kW');
    expect(screen.getByTestId('node-charger')).toBeInTheDocument();
  });

  it('omits the charger node when the vehicle is not charging', () => {
    setState({ state: makeState({ is_charging: false }) });
    renderWidget();

    expect(nodeById('charger')).toBeUndefined();
    expect(screen.queryByTestId('node-charger')).toBeNull();
  });
});

// ── Arrow derivation ─────────────────────────────────────────────────────────────

describe('EnergyFlowWidget — arrow derivation', () => {
  it('activates only battery → motor (with abs power) while discharging', () => {
    setState({ state: makeState({ power: 15 }) });
    renderWidget();

    const discharge = arrowByEnds('battery', 'motor');
    const regen = arrowByEnds('motor', 'battery');
    expect(discharge?.active).toBe(true);
    expect(discharge?.value).toBe(15);
    expect(regen?.active).toBe(false);
    expect(regen?.value).toBe(0);
  });

  it('activates only motor → battery (with abs power) while regenerating', () => {
    setState({ state: makeState({ power: -6 }) });
    renderWidget();

    const discharge = arrowByEnds('battery', 'motor');
    const regen = arrowByEnds('motor', 'battery');
    expect(regen?.active).toBe(true);
    expect(regen?.value).toBe(6);
    expect(discharge?.active).toBe(false);
    expect(discharge?.value).toBe(0);
  });

  it('adds an active charger → battery arrow carrying the charger power while charging', () => {
    setState({ state: makeState({ is_charging: true, charger_power: 11 }) });
    renderWidget();

    const chargeArrow = arrowByEnds('charger', 'battery');
    expect(chargeArrow?.active).toBe(true);
    expect(chargeArrow?.value).toBe(11);
    expect(screen.getByTestId('arrow-charger-battery')).toHaveAttribute('data-active', 'true');
  });

  it('emits no charger arrow when idle and not charging', () => {
    setState({ state: makeState({ power: 0, is_charging: false }) });
    renderWidget();

    expect(arrowByEnds('charger', 'battery')).toBeUndefined();
    expect(screen.queryByTestId('arrow-charger-battery')).toBeNull();
  });
});

// ── Null safety ──────────────────────────────────────────────────────────────────

describe('EnergyFlowWidget — null safety', () => {
  it('collapses missing power/charging/soc fields to a safe standby state', () => {
    setState({
      state: makeState({
        power: undefined as unknown as number,
        is_charging: undefined as unknown as boolean,
        charger_power: undefined as unknown as number,
        battery_level: undefined as unknown as number,
      }),
    });
    renderWidget();

    expect(nodeById('battery')?.formattedValue).toBe('0%');
    expect(nodeById('motor')?.label).toBe('Standby');
    expect(nodeById('motor')?.formattedValue).toBe('—');
    expect(nodeById('charger')).toBeUndefined();
    expect(arrowByEnds('battery', 'motor')?.active).toBe(false);
    expect(arrowByEnds('motor', 'battery')?.active).toBe(false);
  });
});

// ── Interactions & accessibility ─────────────────────────────────────────────────

describe('EnergyFlowWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setState({ state: makeState() });
    renderWidget();

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the widget title as a heading', () => {
    renderWidget();

    expect(screen.getByRole('heading', { name: /Energy Flow/i })).toBeInTheDocument();
  });

  it('hands the localized empty message to the flow diagram', () => {
    setState({ state: makeState() });
    renderWidget();

    expect(lastFlowProps().emptyMessage).toBe('No energy data available');
    expect(screen.getByTestId('flow-diagram')).toHaveAttribute('data-empty', 'No energy data available');
  });
});
