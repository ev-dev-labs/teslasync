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
 *     (driven by stats OR fsm, never by the historical timeline), the empty
 *     state when no stats have landed (never a blank panel), and that a genuine
 *     primary-source failure still paints a red freshness dot;
 *   - the historical `useFSMTransitions` secondary must NOT poison the widget's
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
 * `useVehicleStateMachine`, `useFSMTransitions`) live in mocked modules so no
 * network is touched and every query state is controllable per-test. i18n is a
 * passthrough that honours the English default so the visible copy is
 * deterministic and real. `formatRelative` is left un-mocked and fed timestamps
 * at fixed deltas so its output ("5m ago") is stable. The widget is rendered
 * inside a MemoryRouter because the shared feedback components it composes may
 * reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { MemoryRouter } from 'react-router-dom';

import type { DashboardStats } from '@/types/dashboard';
import type { VehicleState } from '@/types/admin';
import type { FSMTransition } from '@/types/fsm';
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
  timelineMock,
  retiredTimelineMock,
} = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useDashboardStatsMock: vi.fn(),
  useVehicleStateMachineMock: vi.fn(),
  timelineMock: vi.fn(),
  retiredTimelineMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('@/api/hooks/useDashboard', () => ({
  useDashboardStats: () => useDashboardStatsMock(),
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useVehicleStateMachine: (vehicleId: string) => useVehicleStateMachineMock(vehicleId),
  useStateTimeline: (...args: unknown[]) => retiredTimelineMock(...args),
}));
vi.mock('@/api/hooks/useFSM', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/hooks/useFSM')>(),
  useFSMTransitions: (...args: unknown[]) => timelineMock(...args),
}));
import { buildTransitionsPath } from '@/api/hooks/useFSM';

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

function makeTransition(over: Partial<FSMTransition> = {}): FSMTransition {
  return {
    id: 1,
    vehicle_id: 1,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    ts: new Date(Date.now() - 5 * 60_000).toISOString(),
    trigger: 'speed_changed',
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
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  useVehiclesMock.mockReset();
  useDashboardStatsMock.mockReset();
  useVehicleStateMachineMock.mockReset();
  timelineMock.mockReset();
  retiredTimelineMock.mockReset();

  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useDashboardStatsMock.mockReturnValue(makeQ(makeStats()));
  useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
  timelineMock.mockReturnValue(makeQ({ data: [] as FSMTransition[] }));
});

// ── Data-source resolution ───────────────────────────────────────────────────

describe.each([1, 2, 3])('DashboardStatsWidget — identifying heading at cols=%i', (cols) => {
  it.each(['populated', 'loading', 'empty', 'initial failure', 'retained failure'] as const)(
    'keeps exactly one visible shell heading when %s',
    (state) => {
      const populated = state === 'populated' || state === 'retained failure';
      const failed = state === 'initial failure' || state === 'retained failure';
      const flags = { isLoading: state === 'loading', isError: failed };
      useDashboardStatsMock.mockReturnValue({
        ...makeQ(populated ? makeStats() : undefined, flags),
        ...(state === 'empty' ? { data: null } : {}),
        error: failed ? new Error('offline') : null,
      });
      useVehicleStateMachineMock.mockReturnValue({
        ...makeQ(populated ? makeFsm() : undefined, flags),
        ...(state === 'empty' ? { data: null } : {}),
        error: failed ? new Error('offline') : null,
      });
      const { container } = renderWidget({ cols, rows: 2 });
      const headings = screen.getAllByRole('heading', { name: 'Dashboard stats', level: 3 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toBeVisible();
      if (populated) {
        expect(screen.getByText('1,234')).toBeInTheDocument();
        expect(screen.getByText('Trips')).toBeInTheDocument();
        if (cols > 1) expect(screen.getByText('Charge sessions')).toBeInTheDocument();
      }
      if (state === 'loading') expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
      if (state === 'empty') expect(screen.getByText('No dashboard stats available')).toBeInTheDocument();
      if (state === 'initial failure') expect(screen.getByRole('alert')).toBeInTheDocument();
      if (state === 'retained failure') expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
    },
  );
});

describe('DashboardStatsWidget — vehicle resolution', () => {
  it('queries FSM + timeline for the explicit vehicleId prop', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('42');
    expect(timelineMock).toHaveBeenCalledWith('42', 'vehicle', 168, 1, 5);
    expect(retiredTimelineMock).not.toHaveBeenCalled();
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('7');
    expect(timelineMock).toHaveBeenCalledWith('7', 'vehicle', 168, 1, 5);
  });

  it('passes an empty id (queries disabled) when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('');
    expect(timelineMock).toHaveBeenCalledWith('', 'vehicle', 168, 1, 5);
  });

  it('tolerates an undefined vehicles list without throwing', () => {
    useVehiclesMock.mockReturnValue({ data: undefined });
    expect(() => renderWidget()).not.toThrow();
    expect(useVehicleStateMachineMock).toHaveBeenCalledWith('');
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('DashboardStatsWidget — states', () => {
  it('retains FSM evidence as partial while the stats query is pending', () => {
    useDashboardStatsMock.mockReturnValue(makeQ<DashboardStats>(undefined, { isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull();
    expect(screen.queryByText('No dashboard stats available')).toBeNull();
    expect(screen.queryByText('Vehicles')).toBeInTheDocument();
  });

  it('retains fleet counts as partial while the FSM state query is pending', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ<VehicleState>(undefined, { isLoading: true }));
    const { container } = renderWidget();
    expect(container.querySelector('[data-data-state="partial"]')).not.toBeNull();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('shows the empty state (never a blank panel) when no stats have landed', () => {
    useDashboardStatsMock.mockReturnValue(makeQ<DashboardStats>(null as unknown as DashboardStats));
    useVehicleStateMachineMock.mockReturnValue(makeQ<VehicleState>(undefined));
    useVehiclesMock.mockReturnValue({ data: [] });
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
    expect(screen.getByText('FSM state')).toBeInTheDocument();
  });
});

// ── Historical-source freshness isolation ────

describe('DashboardStatsWidget — primary freshness does not follow historical transitions', () => {
  it('keeps a fresh (emerald) dot when only the historical transition source errors', () => {
    // Primary sources remain independently available.
    useDashboardStatsMock.mockReturnValue(makeQ(makeStats(), { dataUpdatedAt: Date.now() }));
    useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
    timelineMock.mockReturnValue(
      makeQ<{ data: FSMTransition[] }>(undefined, { isError: true, dataUpdatedAt: 0 }),
    );

    const { container } = renderWidget();
    // Regression guard: the merged health used to be poisoned red by the 404.
    expect(container.querySelector('.bg-red-400')).toBeNull();
    expect(container.querySelector('.bg-emerald-400')).not.toBeNull();
  });

  it('does not flip to the fetching tier when only the timeline is refetching', () => {
    useDashboardStatsMock.mockReturnValue(makeQ(makeStats(), { dataUpdatedAt: Date.now() }));
    timelineMock.mockReturnValue(
      makeQ<{ data: FSMTransition[] }>(undefined, { isFetching: true, dataUpdatedAt: 0 }),
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
    expect(screen.getByText('Charge sessions')).toBeInTheDocument();
    // fmtInt applies locale grouping — 1234 → "1,234", not "1234".
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows the current FSM state in both the grid and the StatusBadge row', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('FSM state')).toBeInTheDocument();
    expect(screen.getByText('Current state')).toBeInTheDocument();
    // The state appears once in the grid card and once in the StatusBadge.
    expect(screen.getAllByText('online')).toHaveLength(2);
  });

  it('falls back to an em-dash FSM state when no state has landed', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ<VehicleState>(undefined));
    renderWidget({ cols: 2, rows: 2 });
    // Grid "FSM State" card value + StatusBadge both render the '—' fallback.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps missing fleet counts unknown rather than manufacturing zero', () => {
    useDashboardStatsMock.mockReturnValue(
      makeQ({ ...makeStats(), totalVehicles: undefined } as unknown as DashboardStats),
    );
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).toBeNull();
  });

  it('does not render the wide "Recent Transitions" section at full (cols=2) size', () => {
    timelineMock.mockReturnValue(makeQ({ data: [makeTransition()] }));
    renderWidget({ cols: 2, rows: 2 });
    expect(screen.queryByText('Recent transitions')).toBeNull();
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('DashboardStatsWidget — compact', () => {
  it('renders the trips hero with its honest Trips label and suppresses the grid', () => {
    useDashboardStatsMock.mockReturnValue(makeQ(makeStats({ totalTrips: 1234 })));
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();
    // The stat grid and current-state row are hidden in the compact variant.
    expect(screen.queryByText('Vehicles')).toBeNull();
    expect(screen.queryByText('Current state')).toBeNull();
  });

  it('shows unknown for a missing trips count in the compact hero', () => {
    useDashboardStatsMock.mockReturnValue(
      makeQ({ ...makeStats(), totalTrips: undefined } as unknown as DashboardStats),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).toBeNull();
  });
});

// ── Wide (cols ≥ 3) variant — recent transitions ─────────────────────────────

describe('DashboardStatsWidget — wide (recent transitions)', () => {
  it('renders the transitions section with state badges and relative times', () => {
    useVehicleStateMachineMock.mockReturnValue(makeQ(makeFsm('online')));
    timelineMock.mockReturnValue(
      makeQ({
        data: [
          makeTransition({ to_state: 'driving', ts: new Date(Date.now() - 5 * 60_000).toISOString() }),
          makeTransition({ to_state: 'charging', ts: new Date(Date.now() - 2 * 3_600_000).toISOString() }),
          makeTransition({ to_state: 'parked', ts: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
        ],
      }),
    );
    renderWidget({ cols: 3, rows: 4 });

    expect(screen.getByText('Recent transitions')).toBeInTheDocument();
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
      makeTransition({ to_state: `st${i}`, ts: new Date(Date.now() - (i + 1) * 60_000).toISOString() }),
    );
    timelineMock.mockReturnValue(makeQ({ data: transitions }));
    renderWidget({ cols: 3, rows: 4 });

    expect(screen.getByText('st0')).toBeInTheDocument();
    expect(screen.getByText('st4')).toBeInTheDocument();
    // 6th and 7th are sliced off.
    expect(screen.queryByText('st5')).toBeNull();
    expect(screen.queryByText('st6')).toBeNull();
  });

  it('renders an em-dash for a transition missing its timestamp', () => {
    timelineMock.mockReturnValue(
      makeQ({
        data: [
          makeTransition({ to_state: 'sleeping', ts: '' }),
        ],
      }),
    );
    renderWidget({ cols: 3, rows: 4 });
    expect(screen.getByText('sleeping')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('preserves the transitions section with an empty state when the timeline is empty', () => {
    timelineMock.mockReturnValue(makeQ({ data: [] as FSMTransition[] }));
    renderWidget({ cols: 3, rows: 4 });
    expect(screen.getByText('Recent transitions')).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
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
    timelineMock.mockReturnValue(
      makeQ({ data: [] as FSMTransition[] }, { refetch: refetchTimeline }),
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
    useDashboardStatsMock.mockReturnValue(makeQ<DashboardStats>(null as unknown as DashboardStats));
    useVehicleStateMachineMock.mockReturnValue(makeQ<VehicleState>(undefined));
    useVehiclesMock.mockReturnValue({ data: [] });
    const { container } = renderWidget({ cols: 2, rows: 2 });
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('No dashboard stats available')).toBeInTheDocument();
  });

  describe('DashboardStatsWidget — trust and recovery regressions', () => {
    it.each([1, 2, 3])('retains fleet counts during refresh failure at %i columns', (cols) => {
      useDashboardStatsMock.mockReturnValue({ ...makeQ(makeStats()), error: new Error('offline'), isError: true });
      const { container } = renderWidget({ cols, rows: 3 });
      expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
      expect(screen.getByText('1,234')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    });

    it('owns fatal initial failure when both primary sources fail', () => {
      useDashboardStatsMock.mockReturnValue({ ...makeQ(undefined), error: new Error('stats') });
      useVehicleStateMachineMock.mockReturnValue({ ...makeQ(undefined), error: new Error('fsm') });
      renderWidget();
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByText('No dashboard stats available')).not.toBeInTheDocument();
    });

    it('renders a skeleton when neither primary source has resolved', () => {
      useDashboardStatsMock.mockReturnValue(makeQ(undefined, { isLoading: true }));
      useVehicleStateMachineMock.mockReturnValue(makeQ(undefined, { isLoading: true }));
      const { container } = renderWidget();
      expect(container.querySelector('[data-data-state="initial"] .animate-pulse')).not.toBeNull();
    });

    it('does not keep disabled FSM hooks in a permanent loading state for an empty fleet', () => {
      useVehiclesMock.mockReturnValue({ data: [] });
      useVehicleStateMachineMock.mockReturnValue(makeQ(undefined, { isLoading: true }));
      timelineMock.mockReturnValue(makeQ(undefined, { isLoading: true }));
      const { container } = renderWidget({ cols: 3, rows: 3 });
      expect(container.querySelector('[data-data-state="initial"]')).toBeNull();
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    it.each([0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('disables vehicle reads for invalid id %s', (id) => {
      renderWidget({ cols: 2, rows: 2 }, id);
      expect(useVehicleStateMachineMock).toHaveBeenCalledWith('');
      expect(timelineMock).toHaveBeenCalledWith('', 'vehicle', 168, 1, 5);
    });

    it('recovers failed discovery without invoking disabled vehicle reads', () => {
      const discovery = vi.fn();
      const fsm = vi.fn();
      useVehiclesMock.mockReturnValue({ data: undefined, error: new Error('discovery'), refetch: discovery });
      useVehicleStateMachineMock.mockReturnValue(makeQ(undefined, { refetch: fsm }));
      renderWidget();
      expect(screen.getByText('1,234')).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
      expect(discovery).toHaveBeenCalledOnce();
      expect(fsm).not.toHaveBeenCalled();
    });

    it('surfaces timeline failure only in its preserved wide section, with independent recovery', () => {
      const retry = vi.fn();
      timelineMock.mockReturnValue({ ...makeQ(undefined, { refetch: retry }), error: new Error('unavailable') });
      const { container } = renderWidget({ cols: 3, rows: 4 });
      expect(container.querySelector('[data-data-state="ok"]')).not.toBeNull();
      expect(screen.getByText('Recent transitions')).toBeInTheDocument();
      expect(screen.getByText('1,234')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledOnce();
    });

    it('safely accepts nullable transition arrays', () => {
      timelineMock.mockReturnValue(makeQ({ data: null }));
      renderWidget({ cols: 3, rows: 4 });
      expect(screen.getByText('Recent transitions')).toBeInTheDocument();
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });

    it('renders the actual CurrentState envelope without feeding an object to StatusBadge', () => {
      useVehicleStateMachineMock.mockReturnValue(makeQ({
        state: { vehicle_id: 1, state: 'driving' },
        live: true,
        observed_at: new Date().toISOString(),
      }));
      renderWidget();
      expect(screen.getAllByText('driving')).toHaveLength(2);
      expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
    });

    it('reactively formats memoized fleet counts without refetching', () => {
      renderWidget();
      expect(screen.getByText('1,234')).toBeInTheDocument();
      act(() => setGlobalLocale('de-DE'));
      expect(screen.getByText('1.234')).toBeInTheDocument();
    });

    it('uses the canonical vehicle-only seven-day FSM route and renders its actual paginated response', () => {
      timelineMock.mockReturnValue(makeQ({
        data: [makeTransition({ to_state: 'charging', ts: new Date(Date.now() - 300_000).toISOString() })],
        total: 1,
        page: 1,
        per_page: 5,
      }));
      renderWidget({ cols: 3, rows: 4 }, 42);
      expect(timelineMock).toHaveBeenCalledWith('42', 'vehicle', 168, 1, 5);
      expect(buildTransitionsPath('42', 'vehicle', 168, 1, 5)).toBe(
        '/fsm/transitions?vehicle_id=42&hours=168&page=1&per_page=5&fsm_name=vehicle',
      );
      expect(retiredTimelineMock).not.toHaveBeenCalled();
      expect(screen.getByText('charging')).toBeInTheDocument();
      expect(screen.getByText('5m ago')).toBeInTheDocument();
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    it('keeps all primary stats visible while historical transitions initially load', () => {
      timelineMock.mockReturnValue(makeQ(undefined, { isLoading: true }));
      const { container } = renderWidget({ cols: 3, rows: 4 });
      expect(screen.getByText('Recent transitions')).toBeInTheDocument();
      expect(screen.getByText('1,234')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(container.querySelector('[data-data-state="ok"] .animate-pulse')).not.toBeNull();
      expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    });

    it('retains real transition rows on refresh failure and independently retries their supported source', () => {
      const retry = vi.fn();
      timelineMock.mockReturnValue({
        ...makeQ({ data: [makeTransition({ to_state: 'sleeping' })] }, { refetch: retry }),
        error: new Error('refresh failed'),
      });
      renderWidget({ cols: 3, rows: 4 });
      expect(screen.getByText('sleeping')).toBeInTheDocument();
      expect(screen.getByText('1,234')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(retry).toHaveBeenCalledOnce();
    });

    it('offers a section-local retry when supported transition history is empty', () => {
      const retry = vi.fn();
      timelineMock.mockReturnValue(makeQ({ data: [] }, { refetch: retry }));
      renderWidget({ cols: 3, rows: 4 });
      const empty = screen.getByText('No data available').closest<HTMLElement>('[role="status"]')!;
      fireEvent.click(within(empty).getByRole('button', { name: 'Refresh' }));
      expect(retry).toHaveBeenCalledOnce();
      expect(useDashboardStatsMock.mock.results[0].value.refetch).not.toHaveBeenCalled();
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    it('offers fleet discovery rather than refetching a disabled transition source', () => {
      useVehiclesMock.mockReturnValue({ data: [] });
      timelineMock.mockReturnValue(makeQ(undefined, { isLoading: true }));
      renderWidget({ cols: 3, rows: 4 });
      const empty = screen.getByText('No data available').closest<HTMLElement>('[role="status"]')!;
      expect(within(empty).getByRole('link', { name: 'Fleet' })).toHaveAttribute('href', '/vehicles');
      expect(within(empty).queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    });
  });
});
