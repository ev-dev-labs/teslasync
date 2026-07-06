/**
 * EnergyFlowAnimatedWidget — behaviour + hardening coverage.
 *
 * The widget resolves the active vehicle (explicit `vehicleId` prop, else the
 * first vehicle, else id 0 which disables the query), reads live vehicle state
 * via `useVehicleState` at the 5s cadence, and renders one of two layouts
 * inside a `<WidgetShell>`:
 *   - a compact readout (`size.cols < 2`) showing battery % plus a single
 *     charging / consuming / regen / idle line, and
 *   - a full `<WidgetFlowDiagram>` (battery ⇄ drive/regen + charger) otherwise.
 * The single public export is the default component, so every branch —
 * including the internal `CompactView` — is exercised through it.
 *
 * The suite doubles as the regression guard for the two real bugs this
 * elevation fixes:
 *   - Loading gap: `useVehicles().isLoading` was ignored, so during the initial
 *     vehicle-list fetch the resolved id was 0, the (disabled) state query
 *     reported `isLoading === false`, and the widget flashed the "No energy
 *     data available" empty state instead of a skeleton. The fix folds the
 *     vehicle-list load into the shell's loading state.
 *   - Error honesty: a genuine initial-load failure (no state yet) rendered the
 *     misleading "No energy data available" empty state instead of a real error
 *     panel. The fix routes `isError && !state` to the shell's `error` prop,
 *     while a background-refetch error with cached state stays a subtle
 *     freshness signal so valid data is never blanked out.
 *
 * Network is never touched: the two data hooks the widget calls are mocked and
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
import EnergyFlowAnimatedWidget from './EnergyFlowAnimatedWidget';

const mockUseVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockUseVehicleState = useVehicleState as unknown as ReturnType<typeof vi.fn>;

// The 5s polling cadence the widget always requests from useVehicleState.
const STATE_OPTS = { refetchInterval: 5_000 };

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

/** Build a `useVehicleState`-shaped query result carrying `{ state, live }`. */
function stateQuery(state: VehicleState | undefined, over: Record<string, unknown> = {}) {
  const data = state === undefined ? { state: undefined, live: false } : { state, live: true };
  return makeQuery({ data, ...over });
}

/** cols>=2 → the full flow-diagram layout; cols<2 → the compact readout. */
function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <EnergyFlowAnimatedWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const diagram = () => screen.queryByRole('img', { name: /energy flow diagram/i });

beforeEach(() => {
  mockUseVehicles.mockReset();
  mockUseVehicleState.mockReset();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }], isLoading: false });
  mockUseVehicleState.mockReturnValue(stateQuery(makeState()));
});

describe('EnergyFlowAnimatedWidget — vehicle-id resolution', () => {
  it('queries state for the vehicleId prop (with the 5s cadence) when provided', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 3 }, { id: 5 }], isLoading: false });
    renderWidget({ vehicleId: 5 });

    expect(mockUseVehicleState).toHaveBeenCalledWith(5, STATE_OPTS);
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 42 }], isLoading: false });
    renderWidget();

    expect(mockUseVehicleState).toHaveBeenCalledWith(42, STATE_OPTS);
  });

  it('passes id 0 (disabling the query) when no vehicle is available', () => {
    mockUseVehicles.mockReturnValue({ data: [], isLoading: false });
    renderWidget();

    expect(mockUseVehicleState).toHaveBeenCalledWith(0, STATE_OPTS);
  });
});

describe('EnergyFlowAnimatedWidget — loading states', () => {
  it('shows a skeleton (no diagram, no empty state) while the state query is loading', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(undefined, { data: undefined, isLoading: true }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
    expect(diagram()).not.toBeInTheDocument();
  });

  it('shows a skeleton (not the empty state) while the vehicle list itself is loading', () => {
    // Regression guard: with id still unresolved (0), the state query is
    // disabled and reports isLoading=false — the widget must lean on the
    // vehicle-list load and render a skeleton, not "No energy data available".
    mockUseVehicles.mockReturnValue({ data: undefined, isLoading: true });
    mockUseVehicleState.mockReturnValue(stateQuery(undefined));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
  });
});

describe('EnergyFlowAnimatedWidget — empty state', () => {
  it('shows the no-data empty state (role=status) when no state has arrived', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(undefined));
    renderWidget();

    expect(screen.getByText('No energy data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(diagram()).not.toBeInTheDocument();
  });
});

describe('EnergyFlowAnimatedWidget — error honesty', () => {
  it('surfaces a real error panel instead of the empty state on initial-load failure', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(undefined, { data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWidget();

    // Honest error panel from WidgetShell (QueryError), not the empty state.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
  });

  it('keeps the flow diagram on screen when a background refetch errors with cached state', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ power: 25 }), { isError: true, error: new Error('boom') }),
    );
    renderWidget();

    // Data present → the error is a subtle freshness signal, not a full panel.
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(diagram()).toBeInTheDocument();
  });
});

describe('EnergyFlowAnimatedWidget — flow diagram (cols ≥ 2)', () => {
  it('renders the accessible diagram with battery + charger nodes and a "Drive" label when consuming', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ power: 25 })));
    renderWidget();

    expect(screen.getByRole('img', { name: /energy flow diagram/i })).toBeInTheDocument();
    expect(screen.getByText('Battery')).toBeInTheDocument();
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('Drive')).toBeInTheDocument();
    expect(screen.queryByText('Regen')).not.toBeInTheDocument();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
  });

  it('labels the drive node "Regen" when power is negative (regenerating)', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ power: -15 })));
    renderWidget();

    expect(screen.getByText('Regen')).toBeInTheDocument();
    expect(screen.queryByText('Drive')).not.toBeInTheDocument();
  });

  it('labels the drive node "Idle" within the ±0.5 kW dead-band', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ power: 0.4 })));
    renderWidget();

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.queryByText('Drive')).not.toBeInTheDocument();
    expect(screen.queryByText('Regen')).not.toBeInTheDocument();
  });

  it('exposes the widget title as an accessible heading', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ power: 25 })));
    renderWidget();

    expect(screen.getByRole('heading', { name: 'Energy Flow' })).toBeInTheDocument();
  });
});

describe('EnergyFlowAnimatedWidget — compact readout (cols < 2)', () => {
  const compact = { size: { cols: 1, rows: 1 } };

  it('shows the battery percentage and no flow diagram in the compact layout', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ battery_level: 80 })));
    renderWidget(compact);

    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(diagram()).not.toBeInTheDocument();
  });

  it('shows the charger power (formatted to 1 decimal) while charging', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ is_charging: true, charger_power: 11, power: 0 })),
    );
    renderWidget(compact);

    expect(screen.getByText('11.0 kW')).toBeInTheDocument();
    expect(screen.queryByText('Idle')).not.toBeInTheDocument();
  });

  it('shows the drive draw while consuming', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ is_charging: false, power: 25 })),
    );
    renderWidget(compact);

    expect(screen.getByText('25.0 kW')).toBeInTheDocument();
  });

  it('shows the absolute regen power while regenerating', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ is_charging: false, power: -15 })),
    );
    renderWidget(compact);

    // Math.abs(-15) → "15.0 kW", never a negative reading.
    expect(screen.getByText('15.0 kW')).toBeInTheDocument();
  });

  it('shows an "Idle" label (and no kW reading) when parked and not charging', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ is_charging: false, power: 0 })),
    );
    renderWidget(compact);

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.queryByText(/kW/)).not.toBeInTheDocument();
  });
});

describe('EnergyFlowAnimatedWidget — refresh', () => {
  it('refetches vehicle state when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ power: 25 }), { refetch }));
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
