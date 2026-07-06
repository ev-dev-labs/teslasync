/**
 * DashboardStatsWidget — behaviour, branch, null-safety and a11y coverage for
 * the dashboard's fleet-stats + FSM-state summary widget.
 *
 * What this file pins:
 *   - the widget's data-source resolution: an explicit `vehicleId` prop wins,
 *     otherwise the first fleet vehicle, otherwise no vehicle (idStr '' → the
 *     FSM + timeline queries stay disabled). The resolved id string is what the
 *     admin hooks are queried with;
 *   - every render state fanned out by `WidgetShell` — the loading skeleton
 *     (driven by stats OR fsm, never by the deprecated timeline), the empty
 *     state when no stats have landed (never a blank panel), and that a genuine
 *     primary-source failure still paints a red freshness dot;
 *   - the REGRESSION FIX at the heart of this elevation: the deprecated,
 *     always-404 `useStateTimeline` secondary must NOT poison the widget's
 *     health indicator. A timeline `isError` / `isFetching` while stats + FSM
 *     are healthy now renders a *fresh* (emerald) dot, not a red/sky one;
 *   - the populated full-size body — the stat grid (vehicles / trips / charge
 *     sessions with `fmtInt` locale formatting, FSM state), the "Current State"
 *     row + `StatusBadge`, and the `'—'` FSM fallback when no state has landed;
 *   - the compact (1×1) variant — the trips hero + "active" label, and that the
 *     stat grid / current-state row / transitions are all suppressed;
 *   - the wide (cols≥3) variant — the "Recent Transitions" section, its
 *     most-recent-first rows (state badge + relative time), the 5-row cap, and
 *     that it hides both when not wide and when there are no transitions;
 *   - the "Refresh" freshness control wiring back to every source's `refetch`;
 *   - a11y — the decorative header/empty icons are hidden from the a11y tree.
 *
 * Strategy: the four data hooks (`useVehicles`, `useDashboardStats`,
 * `useVehicleStateMachine`, `useStateTimeline`) live in mocked modules so no
 * network is touched and every query state is controllable per-test. i18n is a
 * passthrough that honours the English default so the visible copy is
 * deterministic and real. `formatRelative` is left un-mocked and fed timestamps
 * at fixed deltas so its output ("5m ago") is stable. The widget is rendered
 * inside a MemoryRouter because the shared feedback components it composes may
 * reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { DashboardStats } from '@/types/dashboard';
import type { VehicleState, StateTransition } from '@/types/admin';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default so the widget's copy
// ("Vehicles", "Current State", "Recent Transitions", "No dashboard stats
// available", "Refresh") is asserted verbatim.
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

const {
  useVehiclesMock,
  useDashboardStatsMock,
  useVehicleStateMachineMock,
  useStateTimelineMock,
} = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useDashboardStatsMock: vi.fn(),
  useVehicleStateMachineMock: vi.fn(),
  useStateTimelineMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('@/api/hooks/useDashboard', () => ({
  useDashboardStats: () => useDashboardStatsMock(),
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useVehicleStateMachine: (vehicleId: string) => useVehicleStateMachineMock(vehicleId),
  useStateTimeline: (...args: unknown[]) => useStateTimelineMock(...args),
}));

import DashboardStatsWidget from './DashboardStatsWidget';

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface QResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQ<T>(data: T | undefined, over: Partial<QResult<T>> = {}): QResult<T> {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeStats(over: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalVehicles: 3,
    totalM: 0,
    totalEnergyWh: 0,
    totalChargingSessions: 42,
    totalTrips: 1234,
    avgEfficiency: 0,
    totalCostCents: 0,
    ...over,
  };
}

function makeFsm(state = 'online'): VehicleState {
  return { state, since: new Date().toISOString(), vehicleId: '1' };
}

function makeTransition(over: Partial<StateTransition> = {}): StateTransition {
  return {
    state: 'driving',
    startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endedAt: null,
    durationSeconds: 300,
    ...over,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <DashboardStatsWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useDashboardStatsMock.mockReset();
  useVehicleStateMachineMock.mockReset();
  useStateTimelineMock.mockReset();

  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useDashboardStatsMock.mockReturnValue(makeQ(makeStats()));
  useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
  useStateTimelineMock.mockReturnValue(makeQ({ transitions: [] as StateTransition[] }));
});

// ── Data-source resolution ───────────────────────────────────────────────────

describe('DashboardStatsWidget — vehicle resolution', () => {
  it('queries FSM + timeline for the explicit vehicleId prop', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('42');
    expect(useStateTimelineMock).toHaveBeenCalledWith('42');
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('7');
    expect(useStateTimelineMock).toHaveBeenCalledWith('7');
  });

  it('passes an empty id (queries disabled) when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('');
    expect(useStateTimelineMock).toHaveBeenCalledWith('');
  });

  it('tolerates an undefined vehicles list without throwing', () => {
    useVehiclesMock.mockReturnValue({ data: undefined });
    expect(() => renderWidget()).not.toThrow();
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('');
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('DashboardStatsWidget — states', () => {
  it('renders a loading skeleton while the stats query is pending', () => {
    useDashboardStatsMock.mockReturnValue(makeQ<DashboardStats>(undefined, { isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No dashboard stats available')).toBeNull();
    expect(screen.queryByText('Vehicles')).toBeNull();
  });

  it('also shows the skeleton while the FSM state query is pending', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ<VehicleState>(undefined, { isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the empty state (never a blank panel) when no stats have landed', () => {
    useDashboardStatsMock.mockReturnValue(makeQ<DashboardStats>(undefined));
    renderWidget();
    expect(screen.getByText('No dashboard stats available')).toBeInTheDocument();
    expect(screen.queryByText('Vehicles')).toBeNull();
  });

  it('surfaces a red freshness dot when the primary stats query fails', () => {
    useDashboardStatsMock.mockReturnValue(
      makeQ<DashboardStats>(undefined, { isError: true, dataUpdatedAt: 0 }),
    );
    const { container } = renderWidget();
    // Error tier dot on the freshness chip, and an empty panel (never blank).
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
    expect(screen.getByText('No dashboard stats available')).toBeInTheDocument();
  });
});

// ── Freshness merge — deprecated-timeline poison guard (the elevation fix) ────

describe('DashboardStatsWidget — freshness does not follow the deprecated timeline', () => {
  it('keeps a fresh (emerald) dot when only the always-404 timeline errors', () => {
    // Primary sources healthy; the deprecated timeline 404s.
    useDashboardStatsMock.mockReturnValue(makeQ(makeStats(), { dataUpdatedAt: Date.now() }));
    useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
    useStateTimelineMock.mockReturnValue(
      makeQ<{ transitions: StateTransition[] }>(undefined, { isError: true, dataUpdatedAt: 0 }),
    );

    const { container } = renderWidget();
    // Regression guard: the merged health used to be poisoned red by the 404.
    expect(container.querySelector('.bg-red-400')).toBeNull();
    expect(container.querySelector('.bg-emerald-400')).not.toBeNull();
  });

  it('does not flip to the fetching tier when only the timeline is refetching', () => {
    useDashboardStatsMock.mockReturnValue(makeQ(makeStats(), { dataUpdatedAt: Date.now() }));
    useStateTimelineMock.mockReturnValue(
      makeQ<{ transitions: StateTransition[] }>(undefined, { isFetching: true, dataUpdatedAt: 0 }),
    );

    const { container } = renderWidget();
    expect(container.querySelector('.bg-sky-400')).toBeNull();
    expect(container.querySelector('.bg-emerald-400')).not.toBeNull();
  });

  it('still shows the error tier when the FSM state (a live source) fails', () => {
    useVehicleStateMachineMock.mockReturnValue(
      makeQ<VehicleState>(undefined, { isError: true, dataUpdatedAt: 0 }),
    );
    const { container } = renderWidget();
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
  });
});

// ── Populated body (full size, cols = 2) ─────────────────────────────────────

describe('DashboardStatsWidget — populated (full size)', () => {
  it('renders the stat grid with fmtInt-formatted fleet counts', () => {
    useDashboardStatsMock.mockReturnValue(
      makeQ(makeStats({ totalVehicles: 3, totalTrips: 1234, totalChargingSessions: 42 })),
    );
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Vehicles')).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByText('Charge Sessions')).toBeInTheDocument();
    // fmtInt applies locale grouping — 1234 → "1,234", not "1234".
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows the current FSM state in both the grid and the StatusBadge row', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('FSM State')).toBeInTheDocument();
    expect(screen.getByText('Current State')).toBeInTheDocument();
    // The state appears once in the grid card and once in the StatusBadge.
    expect(screen.getAllByText('online')).toHaveLength(2);
  });

  it('falls back to an em-dash FSM state when no state has landed', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ<VehicleState>(undefined));
    renderWidget({ cols: 2, rows: 2 });
    // Grid "FSM State" card value + StatusBadge both render the '—' fallback.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('floors missing fleet counts to 0 rather than rendering NaN', () => {
    useDashboardStatsMock.mockReturnValue(
      makeQ({ ...makeStats(), totalVehicles: undefined } as unknown as DashboardStats),
    );
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).toBeNull();
  });

  it('does not render the wide "Recent Transitions" section at full (cols=2) size', () => {
    useStateTimelineMock.mockReturnValue(makeQ({ transitions: [makeTransition()] }));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.queryByText('Recent Transitions')).toBeNull();
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('DashboardStatsWidget — compact', () => {
  it('renders the trips hero + "active" label and suppresses the grid', () => {
    useDashboardStatsMock.mockReturnValue(makeQ(makeStats({ totalTrips: 1234 })));
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    // The stat grid and current-state row are hidden in the compact variant.
    expect(screen.queryByText('Vehicles')).toBeNull();
    expect(screen.queryByText('Current State')).toBeNull();
  });

  it('floors a missing trips count to 0 in the compact hero', () => {
    useDashboardStatsMock.mockReturnValue(
      makeQ({ ...makeStats(), totalTrips: undefined } as unknown as DashboardStats),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).toBeNull();
  });
});

// ── Wide (cols ≥ 3) variant — recent transitions ─────────────────────────────

describe('DashboardStatsWidget — wide (recent transitions)', () => {
  it('renders the transitions section with state badges and relative times', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
    useStateTimelineMock.mockReturnValue(
      makeQ({
        transitions: [
          makeTransition({ state: 'driving', startedAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
          makeTransition({ state: 'charging', startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }),
          makeTransition({ state: 'parked', startedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
        ],
      }),
    );
    renderWidget({ cols: 3, rows: 4 });

    expect(screen.getByText('Recent Transitions')).toBeInTheDocument();
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
    expect(screen.getByText('parked')).toBeInTheDocument();
    // formatRelative renders deterministic deltas for fixed timestamps.
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    expect(screen.getByText('3d ago')).toBeInTheDocument();
  });

  it('caps the visible transitions at five rows', () => {
    const transitions = Array.from({ length: 7 }, (_, i) =>
      makeTransition({ state: `st${i}`, startedAt: new Date(Date.now() - (i + 1) * 60_000).toISOString() }),
    );
    useStateTimelineMock.mockReturnValue(makeQ({ transitions }));
    renderWidget({ cols: 3, rows: 4 });

    expect(screen.getByText('st0')).toBeInTheDocument();
    expect(screen.getByText('st4')).toBeInTheDocument();
    // 6th and 7th are sliced off.
    expect(screen.queryByText('st5')).toBeNull();
    expect(screen.queryByText('st6')).toBeNull();
  });

  it('renders an em-dash for a transition missing its timestamp', () => {
    useStateTimelineMock.mockReturnValue(
      makeQ({
        transitions: [
          makeTransition({ state: 'sleeping', startedAt: '' as unknown as string }),
        ],
      }),
    );
    renderWidget({ cols: 3, rows: 4 });
    expect(screen.getByText('sleeping')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('hides the transitions section when the timeline is empty', () => {
    useStateTimelineMock.mockReturnValue(makeQ({ transitions: [] as StateTransition[] }));
    renderWidget({ cols: 3, rows: 4 });
    expect(screen.queryByText('Recent Transitions')).toBeNull();
  });
});

// ── Refresh wiring ───────────────────────────────────────────────────────────

describe('DashboardStatsWidget — refresh', () => {
  it('refetches every source when the freshness control is activated', () => {
    const refetchStats = vi.fn();
    const refetchFsm = vi.fn();
    const refetchTimeline = vi.fn();
    useDashboardStatsMock.mockReturnValue(makeQ(makeStats(), { refetch: refetchStats }));
    useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online'), { refetch: refetchFsm }));
    useStateTimelineMock.mockReturnValue(
      makeQ({ transitions: [] as StateTransition[] }, { refetch: refetchTimeline }),
    );

    renderWidget({ cols: 2, rows: 2 });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetchStats).toHaveBeenCalledTimes(1);
    expect(refetchFsm).toHaveBeenCalledTimes(1);
    expect(refetchTimeline).toHaveBeenCalledTimes(1);
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('DashboardStatsWidget — a11y', () => {
  it('hides the decorative header icon from the accessibility tree', () => {
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('hides the decorative empty-state icon from the accessibility tree', () => {
    useDashboardStatsMock.mockReturnValue(makeQ<DashboardStats>(undefined));
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('No dashboard stats available')).toBeInTheDocument();
  });
});
