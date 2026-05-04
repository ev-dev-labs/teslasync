import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { FSMTransition, FSMTransitionResponse, FSMStats } from '@/types/fsm';

// ── i18n ─────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts) {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) {
            s = s.replace(`{{${k}}}`, String(v));
          }
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: stub useReducedMotion + motion.* tags ────────────
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get: () => ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
        const safeRest: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rest)) {
          if (
            k === 'animate' ||
            k === 'initial' ||
            k === 'exit' ||
            k === 'transition' ||
            k === 'whileHover' ||
            k === 'whileTap' ||
            k === 'variants'
          ) continue;
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

// ── Heavy children we don't care about for windowing tests ──────────
vi.mock('@/features/system/components/FSMHealthPanel', () => ({
  FSMHealthPanel: () => <div data-testid="mock-FSMHealthPanel" />,
  computeFlapIds: () => new Set<number>(),
}));
vi.mock('@/features/system/components/FSMStateDiagram', () => ({
  FSMStateDiagram: () => <div data-testid="mock-FSMStateDiagram" />,
}));
vi.mock('@/features/system/components/FSMTimelineChart', () => ({
  FSMTimelineChart: () => <div data-testid="mock-FSMTimelineChart" />,
}));
vi.mock('@/features/system/components/FSMSubFSMPanel', () => ({
  FSMSubFSMPanel: () => <div data-testid="mock-FSMSubFSMPanel" />,
}));
vi.mock('@/components/charts', () => ({
  ChartContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="mock-ChartContainer">{children}</div>
  ),
  PieChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => <div />,
  ChartTooltip: () => <div />,
  CHART_COLORS: ['#abc', '#def'],
}));

// ── Hook stubs (overridden per-test below) ─────────────────────────
const transitionsRef: { current: FSMTransition[] } = { current: [] };
const statsRef: { current: FSMStats | null } = { current: null };
const stateRef: { current: unknown } = { current: null };

vi.mock('@/api/hooks/useFSM', () => ({
  fsmKeys: { stats: () => [], transitions: () => [] },
  useFSMStats: () => ({ data: statsRef.current, isLoading: false }),
  useFSMTransitions: () => {
    const data: FSMTransitionResponse = {
      data: transitionsRef.current,
      total: transitionsRef.current.length,
      page: 1,
      per_page: 50,
    };
    return { data, isLoading: false };
  },
}));

vi.mock('@/api/hooks/useAdmin', () => ({
  useVehicleStateMachine: () => ({
    data: stateRef.current,
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: [{ id: 1, display_name: 'Tessie', vin: 'VIN123' }],
    isLoading: false,
  }),
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalSnapshot: () => ({ data: null, isFetching: false }),
}));

// ── Resize observer shim for any chart leftovers ────────────────────
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;

import StateMachineDebuggerPage from '../StateMachineDebuggerPage';

function makeTransition(overrides: Partial<FSMTransition>): FSMTransition {
  return {
    id: 1,
    vehicle_id: 1,
    fsm_type: 'vehicle',
    from_state: 'parked',
    to_state: 'driving',
    trigger: 'speed_changed',
    guard: '',
    mode: 'auto',
    duration_in_state_ms: 1000,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/system/fsm']}>
        <StateMachineDebuggerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StateMachineDebuggerPage — windowing reconciliation (Phase 45 / Prompt 35)', () => {
  beforeEach(() => {
    transitionsRef.current = [];
    statsRef.current = { enabled: true, stats: {}, active_subs: [] };
    stateRef.current = null;
  });

  it('reads "0 in window · 23 in 24 h" when 23 transitions exist outside the 10-min window', () => {
    transitionsRef.current = Array.from({ length: 23 }, (_, i) =>
      makeTransition({
        id: 100 + i,
        created_at: new Date(Date.now() - (60 + i) * 60_000).toISOString(),
      }),
    );

    renderPage();

    const counter = screen.getByTestId('live-controls-counter');
    expect(counter.textContent).toContain('0 in window · 23 in 24 h');

    const empty = screen.getByTestId('state-timeline-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toContain('Last transition');
    const widen = screen.getByTestId('state-timeline-widen');
    // Last transition is ~60 minutes old → 2 h preset (120) is the smallest fit.
    expect(widen.textContent).toContain('Widen window to 2 h');

    expect(screen.getByTestId('snapshot-inspector-outside-window')).toBeInTheDocument();
    expect(screen.getByTestId('snapshot-inspector-jump')).toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-inspector-empty')).toBeNull();
  });

  it('after clicking "Widen window", the counter renders ticks and reflects the new window size', () => {
    transitionsRef.current = Array.from({ length: 23 }, (_, i) =>
      makeTransition({
        id: 100 + i,
        created_at: new Date(Date.now() - (60 + i) * 60_000).toISOString(),
      }),
    );

    renderPage();

    fireEvent.click(screen.getByTestId('state-timeline-widen'));

    const counter = screen.getByTestId('live-controls-counter');
    // When in/out counts match (everything in window) the legacy single-scope
    // copy renders, keeping the steady-state wording stable.
    expect(counter.textContent).toMatch(/23 buffered|23 in window/);

    expect(screen.queryByTestId('state-timeline-empty')).toBeNull();
    expect(screen.getByTestId('state-timeline')).toBeInTheDocument();

    expect(screen.getByTestId('snapshot-inspector-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('snapshot-inspector-outside-window')).toBeNull();
  });

  it('renders the legacy "{{n}} buffered" copy when in-window equals total (steady state)', () => {
    transitionsRef.current = Array.from({ length: 5 }, (_, i) =>
      makeTransition({
        id: 200 + i,
        created_at: new Date(Date.now() - i * 30_000).toISOString(),
      }),
    );

    renderPage();

    const counter = screen.getByTestId('live-controls-counter');
    expect(counter.textContent).toContain('5 buffered');
    expect(within(counter).queryByText(/in window/)).toBeNull();
  });
});
