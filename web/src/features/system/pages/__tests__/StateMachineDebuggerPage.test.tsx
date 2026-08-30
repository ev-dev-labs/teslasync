/**
 * StateMachineDebuggerPage — behavioural contract tests.
 *
 * The windowing/reconciliation slice already has dedicated coverage in
 * `StateMachineDebuggerPage.windowing.test.tsx`. This file covers the rest
 * of the page surface end-to-end against the real shared components
 * (StatCard, DataTable, StateBadge, Select, CopyButton, PageContainer) with
 * only the network hooks + heavy chart/diagram children stubbed:
 *
 *   1. KPI band renders the derived page/total/flap/current metrics.
 *   2. Live-state hero renders the resolved state + mode (charging / drive /
 *      idle / sleep) and the "no state" empty branch.
 *   3. Empty fleet hides the page-specific filters and shows the empty copy.
 *   4. Transition Log renders rows, triggers, badges + per-row detail toggles.
 *   5. Clicking a row's detail toggle expands the Transition Detail panel and
 *      formats `duration_in_state_ms` — exercising the `formatDuration`
 *      hours/minutes rollover fix (7199s → "2h", never "1h 60m").
 *   6. Distribution legend + Transition Counts summarise by `to_state` and the
 *      avg-interval cell rolls a 7199s gap up to "2h".
 *   7. FSM-type + per-page selects are user-operable.
 *   8. The share-permalink control copies the URL to the clipboard.
 *   9. A full-page spinner is shown while every data source is loading.
 *
 * i18n is stubbed so visible copy is the English `defaultValue` (with
 * `{{range}}`-style interpolation), and framer-motion is neutralised so the
 * FadeIn sections mount synchronously in jsdom.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import type { ReactNode } from 'react';
import type { FSMTransition } from '@/types/fsm';

// ── Mutable per-test fixture (referenced inside hoisted vi.mock factories) ──
const mockStore = {
  transitions: [] as FSMTransition[],
  total: 0,
  transLoading: false,
  stats: { enabled: true, stats: {}, active_subs: [] } as unknown,
  statsLoading: false,
  state: undefined as unknown,
  stateLoading: false,
  stateFetching: false,
  vehicles: [{ id: 1, display_name: 'Tessie', vin: 'VIN123' }] as Array<{
    id: number;
    display_name: string;
    vin: string;
  }>,
  flapIds: new Set<number>(),
  snapshot: null as unknown,
  snapshotFetching: false,
};

// ── i18n: return the English defaultValue, interpolating {{placeholders}} ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
      const interpolate = (base: string, opts?: Record<string, unknown>) => {
        if (!opts) return base;
        let s = base;
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'defaultValue') continue;
          s = s.split(`{{${k}}}`).join(String(v));
        }
        return s;
      };
      if (typeof fallbackOrOpts === 'string') {
        return interpolate(fallbackOrOpts, maybeOpts as Record<string, unknown> | undefined);
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const opts = fallbackOrOpts as Record<string, unknown>;
        const base = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
        return interpolate(base, opts);
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props, render children synchronously ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get: () => ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
        const safeRest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rest)) {
          if (['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'variants'].includes(k)) continue;
          safeRest[k] = v;
        }
        return <div {...(safeRest as Record<string, unknown>)}>{children}</div>;
      },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
    useMotionValue: () => ({ get: () => 0, set: () => undefined, on: () => () => undefined }),
    useTransform: () => ({ get: () => 0, set: () => undefined, on: () => () => undefined }),
    useSpring: () => ({ get: () => 0, set: () => undefined, on: () => () => undefined }),
  };
});

// ── Heavy children not under test here ──
vi.mock('@/features/system/components/FSMHealthPanel', () => ({
  FSMHealthPanel: () => <div data-testid="mock-fsm-health" />,
  computeFlapIds: () => mockStore.flapIds,
}));
vi.mock('@/features/system/components/FSMStateDiagram', () => ({
  FSMStateDiagram: () => <div data-testid="mock-fsm-diagram" />,
}));
vi.mock('@/features/system/components/FSMTimelineChart', () => ({
  FSMTimelineChart: () => <div data-testid="mock-fsm-timeline" />,
}));
vi.mock('@/features/system/components/FSMSubFSMPanel', () => ({
  FSMSubFSMPanel: () => <div data-testid="mock-fsm-subfsm" />,
}));
vi.mock('@/components/charts', () => ({
  ChartContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="mock-chart-container">{children}</div>
  ),
  PieChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => <div />,
  ChartTooltip: () => <div />,
  CHART_COLORS: ['#abc', '#def', '#345', '#678'],
}));

// ── Network hooks ──
vi.mock('@/api/hooks/useFSM', () => ({
  fsmKeys: { stats: () => [], transitions: () => [] },
  useFSMStats: () => ({ data: mockStore.stats, isLoading: mockStore.statsLoading }),
  useFSMTransitions: () => ({
    data: { data: mockStore.transitions, total: mockStore.total, page: 1, per_page: 50 },
    isLoading: mockStore.transLoading,
  }),
}));
vi.mock('@/api/hooks/useAdmin', () => ({
  useVehicleStateMachine: () => ({
    data: mockStore.state,
    isLoading: mockStore.stateLoading,
    isFetching: mockStore.stateFetching,
  }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: mockStore.vehicles, isLoading: false }),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalSnapshot: () => ({ data: mockStore.snapshot, isFetching: mockStore.snapshotFetching }),
}));

import StateMachineDebuggerPage from '../StateMachineDebuggerPage';

// ── Fixture builders ──
function makeTransition(overrides: Partial<FSMTransition> = {}): FSMTransition {
  return {
    id: 1,
    vehicle_id: 1,
    fsm_name: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    ts: new Date('2026-06-01T12:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function wrapVehicleState(state: Record<string, unknown>) {
  return { state, live: true, data_source: 'signal_store' };
}

function renderPage(initialEntries: string[] = ['/system/fsm']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <SelectedVehicleProvider>
          <StateMachineDebuggerPage />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Resolve a StatCard root element from its unique label. */
function kpiCard(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  const card = labelEl.closest('div')?.parentElement;
  if (!card) throw new Error(`StatCard not found for label "${label}"`);
  return card as HTMLElement;
}

beforeEach(() => {
  mockStore.transitions = [];
  mockStore.total = 0;
  mockStore.transLoading = false;
  mockStore.stats = { enabled: true, stats: {}, active_subs: [] };
  mockStore.statsLoading = false;
  mockStore.state = undefined;
  mockStore.stateLoading = false;
  mockStore.stateFetching = false;
  mockStore.vehicles = [{ id: 1, display_name: 'Tessie', vin: 'VIN123' }];
  mockStore.flapIds = new Set<number>();
  mockStore.snapshot = null;
  mockStore.snapshotFetching = false;
});

describe('StateMachineDebuggerPage — KPI band', () => {
  it('renders the derived page/total/flap/current-state metrics', () => {
    mockStore.transitions = [
      makeTransition({ id: 1, to_state: 'driving' }),
      makeTransition({ id: 2, to_state: 'parked' }),
      makeTransition({ id: 3, to_state: 'charging' }),
    ];
    mockStore.total = 233;
    mockStore.flapIds = new Set<number>([1, 2, 3]);
    mockStore.state = wrapVehicleState({ state: 'driving', is_charging: false, speed: 42, since: '2026-06-01T00:00:00Z' });

    renderPage();

    expect(within(kpiCard('Transitions (Page)')).getByText('3 / 233')).toBeInTheDocument();
    expect(within(kpiCard('Total Transitions')).getByText('233')).toBeInTheDocument();
    expect(within(kpiCard('Flap Warnings')).getByText('3')).toBeInTheDocument();
    expect(within(kpiCard('Current State')).getByText('driving')).toBeInTheDocument();
  });

  it('falls back to an em dash for the current state when no live state is loaded', () => {
    mockStore.state = undefined;

    renderPage();

    expect(within(kpiCard('Current State')).getByText('—')).toBeInTheDocument();
  });
});

describe('StateMachineDebuggerPage — live-state hero', () => {
  it('shows the resolved state name and "Charging" mode when charging', () => {
    mockStore.state = wrapVehicleState({
      state: 'charging',
      is_charging: true,
      speed: 0,
      since: '2026-06-01T00:00:00Z',
    });

    renderPage();

    const hero = screen.getByText('Vehicle Live State').closest('div')?.parentElement as HTMLElement;
    expect(within(hero).getByText('charging')).toBeInTheDocument();
    expect(within(hero).getByText('Charging')).toBeInTheDocument();
  });

  it('resolves "Drive" mode from a positive speed even when not charging', () => {
    mockStore.state = wrapVehicleState({
      state: 'driving',
      is_charging: false,
      speed: 55,
      since: '2026-06-01T00:00:00Z',
    });

    renderPage();

    expect(screen.getByText('Drive')).toBeInTheDocument();
  });

  it('resolves "Sleep" mode for an asleep vehicle with no speed', () => {
    mockStore.state = wrapVehicleState({
      state: 'asleep',
      is_charging: false,
      speed: 0,
      since: '2026-06-01T00:00:00Z',
    });

    renderPage();

    expect(screen.getByText('Sleep')).toBeInTheDocument();
  });

  it('resolves "Idle" mode for a parked vehicle with no speed', () => {
    mockStore.state = wrapVehicleState({
      state: 'parked',
      is_charging: false,
      speed: 0,
      since: '2026-06-01T00:00:00Z',
    });

    renderPage();

    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('shows the empty branch when no live state data is available', () => {
    mockStore.state = undefined;

    renderPage();

    expect(screen.getByText('No state data available')).toBeInTheDocument();
  });
});

describe('StateMachineDebuggerPage — empty fleet', () => {
  it('hides the FSM-type filter and shows the no-vehicles empty copy', () => {
    mockStore.vehicles = [];

    renderPage();

    expect(screen.getByText('No vehicles available')).toBeInTheDocument();
    expect(screen.queryByLabelText('FSM Type')).toBeNull();
    expect(screen.queryByLabelText('Select vehicle')).toBeNull();
  });
});

describe('StateMachineDebuggerPage — transition log', () => {
  it('renders rows, triggers, and one detail toggle per row', () => {
    mockStore.transitions = [
      makeTransition({ id: 10, from_state: 'parked', to_state: 'driving', trigger: 'speed_changed' }),
      makeTransition({ id: 11, from_state: 'driving', to_state: 'parked', trigger: 'gear_changed' }),
    ];
    mockStore.total = 2;

    renderPage();

    expect(screen.getByText('Transition Log')).toBeInTheDocument();
    expect(screen.getByText('speed_changed')).toBeInTheDocument();
    expect(screen.getByText('gear_changed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View detail' })).toHaveLength(2);
  });

  it('shows the range-aware empty copy across sections when there are no transitions', () => {
    mockStore.transitions = [];
    mockStore.total = 0;
    mockStore.state = wrapVehicleState({ state: 'parked', is_charging: false, speed: 0, since: '2026-06-01T00:00:00Z' });

    renderPage();

    // The page's range-aware empty copy is unique (StateTimeline has its own
    // "No transitions in window" copy, so we target the range hint instead).
    const emptyCopies = screen.getAllByText(/Try expanding the time range/);
    expect(emptyCopies.length).toBeGreaterThanOrEqual(1);
    expect(emptyCopies[0].textContent).toContain('No transitions in');
  });
});

describe('StateMachineDebuggerPage — transition detail panel', () => {
  it('expands the detail panel and formats duration_in_state_ms without a "1h 60m" artefact', () => {
    mockStore.transitions = [
      makeTransition({
        id: 42,
        vehicle_id: 7,
        from_state: 'parked',
        to_state: 'driving',
        trigger: 'speed_changed',
        details: { guard: 'speed_gt_0', duration_in_state_ms: 7_199_000 },
      }),
    ];
    mockStore.total = 1;

    renderPage();

    // Detail is collapsed until the toggle is clicked.
    expect(screen.queryByText('Transition Detail')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View detail' }));

    expect(screen.getByText('Transition Detail')).toBeInTheDocument();
    // Transition ID field (id=42) is unique to the detail panel.
    expect(screen.getByText('42')).toBeInTheDocument();
    // Guard field renders the raw guard string.
    expect(screen.getByText('speed_gt_0')).toBeInTheDocument();
    // 7199s rounds up to a full 2h — the fix ensures it is never "1h 60m".
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.queryByText('1h 60m')).toBeNull();
    expect(screen.queryByText('1h 59m')).toBeNull();
  });

  it('collapses the detail panel again when the toggle is clicked twice', () => {
    mockStore.transitions = [makeTransition({ id: 5, trigger: 'speed_changed' })];
    mockStore.total = 1;

    renderPage();

    // Re-query the toggle each time: selecting a row re-memoises the column
    // defs (selectedId is a dep), which replaces the button node.
    fireEvent.click(screen.getByRole('button', { name: 'View detail' }));
    expect(screen.getByText('Transition Detail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View detail' }));
    expect(screen.queryByText('Transition Detail')).toBeNull();
  });
});

describe('StateMachineDebuggerPage — distribution + counts', () => {
  it('summarises transitions by to_state and rolls a 7199s avg interval up to 2h', () => {
    // Two transitions into `driving` spaced exactly 7199s apart → avg 7199s.
    const base = new Date('2026-06-01T00:00:00.000Z').getTime();
    mockStore.transitions = [
      makeTransition({ id: 1, to_state: 'driving', ts: new Date(base).toISOString() }),
      makeTransition({ id: 2, to_state: 'driving', ts: new Date(base + 7_199_000).toISOString() }),
      makeTransition({ id: 3, to_state: 'parked', ts: new Date(base + 100_000).toISOString() }),
    ];
    mockStore.total = 3;

    renderPage();

    // Distribution legend + counts table both surface the two states.
    expect(screen.getAllByText('driving').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('parked').length).toBeGreaterThanOrEqual(1);
    // Avg-interval cell: 7199s must render as "2h", never the "1h 60m" artefact.
    expect(screen.getByText('2h')).toBeInTheDocument();
    expect(screen.queryByText('1h 60m')).toBeNull();
  });
});

describe('StateMachineDebuggerPage — filter controls', () => {
  it('lets the user pick a different FSM type', () => {
    mockStore.transitions = [makeTransition({ id: 1 })];
    mockStore.total = 1;

    renderPage();

    const select = screen.getByLabelText('FSM Type') as HTMLSelectElement;
    expect(select.value).toBe('all');

    fireEvent.change(select, { target: { value: 'vehicle' } });

    expect((screen.getByLabelText('FSM Type') as HTMLSelectElement).value).toBe('vehicle');
  });

  it('lets the user change the per-page size', () => {
    mockStore.transitions = [makeTransition({ id: 1 })];
    mockStore.total = 1;

    renderPage();

    const select = screen.getByLabelText('Per Page') as HTMLSelectElement;
    expect(select.value).toBe('50');

    fireEvent.change(select, { target: { value: '100' } });

    expect((screen.getByLabelText('Per Page') as HTMLSelectElement).value).toBe('100');
  });
});

describe('StateMachineDebuggerPage — share permalink', () => {
  it('copies the permalink URL to the clipboard when the share control is used', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPage();

    const shareBtn = screen.getByRole('button', { name: 'Share permalink' });
    expect(shareBtn).toBeInTheDocument();

    fireEvent.click(shareBtn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toContain('http');
  });
});

describe('StateMachineDebuggerPage — loading', () => {
  it('shows a full-page spinner while every data source is loading', () => {
    mockStore.stateLoading = true;
    mockStore.transLoading = true;
    mockStore.statsLoading = true;

    renderPage();

    expect(screen.getByRole('heading', { name: 'FSM Debugger' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Loading/i })).toBeInTheDocument();
    // The KPI band is replaced by the spinner while loading.
    expect(screen.queryByText('Total Transitions')).toBeNull();
  });
});
