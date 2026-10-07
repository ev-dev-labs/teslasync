/**
 * FSMDistributionWidget — behaviour, branch + hardening coverage.
 *
 * The widget is the dashboard's FSM state-distribution tile. It merges two data
 * sources — the per-state duration stats (`useFSMStats`) and the recent
 * transition log (`useFSMTransitions`) — into a donut chart + legend + a
 * transition feed, with a condensed compact variant. Its surface under test:
 *
 *   1. `buildDonutData`: it drops zero-duration states, computes each state's
 *      share of the total, and orders segments by descending duration. The Pie
 *      double echoes its `data` so the fold is directly inspectable.
 *   2. The per-state colour map (`stateColor`): each donut Cell + legend dot is
 *      painted from the state name, falling back to grey for an unknown state.
 *   3. Responsive layout: standard renders a titled shell + donut + legend +
 *      transition feed; compact (cols ≤ 1) drops the title/legend/feed and shows
 *      only the current (largest) state badge + `fmtDuration` time-in-state.
 *   4. The transition feed: from → to badges + timestamps, windowed to 5 rows.
 *   5. `DonutTooltip`: state label + `fmtDuration` + one-dp percentage.
 *   6. Loading / error / empty branches (never a blank panel), including the
 *      hardening that keeps the skeleton up while the default vehicle is still
 *      resolving from `useVehicles` (rather than flashing "No state data"), and
 *      the hardening that surfaces the shared error panel on a stats-fetch
 *      failure (rather than the misleading empty state).
 *   7. Freshness-control refresh → BOTH sources refetch.
 *   8. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles` is used, otherwise the queries are disabled
 *      (called with an empty id).
 *   9. Null-safety: an undefined `stats` map and a non-array transitions payload
 *      must degrade cleanly instead of throwing at `Object.entries` / `.slice`.
 *
 * Strategy (mirrors CostForecastWidget.test.tsx / DrivetrainHealthWidget.test.tsx):
 *   - The data hooks + useVehicles are mocked with hoisted vi.fn()s so the
 *     network is never touched and every render is deterministic. The widget
 *     keeps the REAL number formatter so the displayed values are genuinely
 *     exercised.
 *   - `@/components/charts` is replaced with prop-echoing DOM doubles so the
 *     donut path renders under jsdom (recharts' ResponsiveContainer measures
 *     0×0 otherwise); the Tooltip double clones the widget's real
 *     `<DonutTooltip>` with a synthetic active payload so that code path runs.
 *   - `TimeStamp` is replaced with a value-echoing double (its own settings
 *     hooks are out of scope here and have dedicated tests).
 *   - react-i18next resolves the developer fallback string.
 *   - matchMedia is shimmed to report reduced motion so framer-motion (read by
 *     the freshness chip) settles deterministically.
 *   - Renders are wrapped in <MemoryRouter> because the error/empty branches
 *     mount <QueryError>/<EmptyState>, which use react-router.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode, ReactElement } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { statsMock, transitionsMock, vehiclesMock } = vi.hoisted(() => ({
  statsMock: vi.fn(),
  transitionsMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useFSM', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useFSM')>('@/api/hooks/useFSM');
  return {
    ...actual,
    useFSMStats: (...args: unknown[]) => statsMock(...args),
    useFSMTransitions: (...args: unknown[]) => transitionsMock(...args),
  };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return { ...actual, useVehicles: () => vehiclesMock() };
});

// Replace the shared charts barrel with prop-echoing doubles. The Pie echoes
// its `data` array as JSON so buildDonutData's fold/sort/pct are inspectable;
// each Cell echoes its `fill` so the state→colour mapping is assertable; the
// Tooltip clones the widget's real <DonutTooltip> with a synthetic active
// payload so that render path (fmtDuration + percentage) is genuinely exercised.
vi.mock('@/components/charts', async () => {
  const { cloneElement, isValidElement } = await import('react');
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    PieChart: ({ children }: { children?: ReactNode }) => (
      <div data-testid="pie-chart">{children}</div>
    ),
    Pie: ({ data, children }: { data?: unknown[]; children?: ReactNode }) => (
      <div data-testid="pie" data-json={JSON.stringify(data ?? [])}>
        {children}
      </div>
    ),
    Cell: ({ fill }: { fill?: string }) => (
      <div data-testid="cell" data-fill={String(fill ?? '')} />
    ),
    Tooltip: ({ content }: { content?: ReactNode }) =>
      isValidElement(content) ? (
        <div data-testid="donut-tooltip">
          {cloneElement(content as ReactElement<Record<string, unknown>>, {
            active: true,
            payload: [{ payload: { state: 'idle', value: 3_600_000, pct: 50 } }],
          })}
        </div>
      ) : null,
  };
});

// TimeStamp pulls settings via TanStack Query — out of scope here. Echo the raw
// value so the widget's "which timestamp flows to which row" wiring is testable.
vi.mock('@/components/data-display', async () => {
  const actual =
    await vi.importActual<typeof import('@/components/data-display')>('@/components/data-display');
  return {
    ...actual,
    TimeStamp: ({ value, className }: { value?: unknown; className?: string }) => (
      <span data-testid="timestamp" className={className}>
        {String(value ?? '')}
      </span>
    ),
  };
});

import FSMDistributionWidget from './FSMDistributionWidget';
import type { WidgetSize } from './types';
import type { FSMStats, FSMTransition, FSMTransitionResponse } from '@/types/fsm';

/* ── Fixtures ─────────────────────────────────────────────────────── */

// 1h driving, 30m charging, 10m asleep → 60 / 30 / 10 % of a 100-minute total.
const DONUT_STATS: Record<string, number> = {
  driving: 3_600_000,
  charging: 1_800_000,
  asleep: 600_000,
};

function makeStats(stats: Record<string, number>): FSMStats {
  return { enabled: true, stats };
}

function makeTransition(overrides: Partial<FSMTransition> = {}): FSMTransition {
  return {
    id: 1,
    vehicle_id: 7,
    ts: '2024-06-01T10:00:00.000Z',
    fsm_name: 'vehicle',
    from_state: 'asleep',
    to_state: 'driving',
    trigger: 'signal',
    ...overrides,
  };
}

const TRANSITIONS: FSMTransition[] = [
  makeTransition({ id: 11, from_state: 'asleep', to_state: 'driving', ts: '2024-06-01T10:00:00.000Z' }),
  makeTransition({ id: 12, from_state: 'driving', to_state: 'charging', ts: '2024-06-01T11:30:00.000Z' }),
];

function makeTransitions(rows: FSMTransition[]): FSMTransitionResponse {
  return { data: rows, total: rows.length, page: 1, per_page: 5 };
}

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <FSMDistributionWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

interface Segment {
  state: string;
  value: number;
  pct: number;
}

function pieData(): Segment[] {
  return JSON.parse(screen.getByTestId('pie').getAttribute('data-json') ?? '[]');
}

/** The recent-transitions feed container (scopes assertions off the legend). */
function transitionFeed(): HTMLElement {
  const heading = screen.getByText('Recent Transitions');
  const feed = heading.closest('div');
  expect(feed).not.toBeNull();
  return feed as HTMLElement;
}

beforeEach(() => {
  statsMock.mockReset();
  transitionsMock.mockReset();
  vehiclesMock.mockReset();

  statsMock.mockReturnValue(makeQuery({ data: makeStats(DONUT_STATS) }));
  transitionsMock.mockReturnValue(makeQuery({ data: makeTransitions(TRANSITIONS) }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }], isLoading: false });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('FSMDistributionWidget', () => {
  it('standard layout renders the titled shell, donut segments and a legend', () => {
    transitionsMock.mockReturnValue(makeQuery({ data: makeTransitions([]) }));
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('State Distribution')).toBeInTheDocument();

    // buildDonutData folds the stats map into ordered {state, value, pct}.
    expect(pieData()).toEqual([
      { state: 'driving', value: 3_600_000, pct: 60 },
      { state: 'charging', value: 1_800_000, pct: 30 },
      { state: 'asleep', value: 600_000, pct: 10 },
    ]);

    // Legend: one label + integer-percent per segment.
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.getByText('charging')).toBeInTheDocument();
    expect(screen.getByText('asleep')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('paints each donut Cell from the per-state colour map', () => {
    transitionsMock.mockReturnValue(makeQuery({ data: makeTransitions([]) }));
    renderWidget();

    const fills = screen.getAllByTestId('cell').map((c) => c.getAttribute('data-fill'));
    // cyan (driving), green (charging), purple (asleep) — in segment order.
    expect(fills).toEqual(['#22d3ee', '#22c55e', '#a855f7']);
  });

  it('drops zero-duration states and orders segments by descending duration', () => {
    statsMock.mockReturnValue(
      makeQuery({ data: makeStats({ offline: 0, driving: 1000, charging: 3000, idle: 0 }) }),
    );
    transitionsMock.mockReturnValue(makeQuery({ data: makeTransitions([]) }));
    renderWidget();

    // offline/idle (0ms) filtered out; charging (3000) sorts above driving (1000).
    expect(pieData()).toEqual([
      { state: 'charging', value: 3000, pct: 75 },
      { state: 'driving', value: 1000, pct: 25 },
    ]);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    // The filtered-out state never reaches the legend.
    expect(screen.queryByText('offline')).not.toBeInTheDocument();
  });

  it('compact layout shows the current state + time-in-state, no title/legend/feed', () => {
    renderWidget({ cols: 1, rows: 1 });

    // Largest segment (driving, 1h) becomes the current-state headline.
    expect(screen.getByText('driving')).toBeInTheDocument();
    expect(screen.getByText('1h 0m')).toBeInTheDocument();

    // Compact drops the title, the donut and the transition feed.
    expect(screen.queryByText('State Distribution')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pie')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Transitions')).not.toBeInTheDocument();
  });

  it('renders the recent-transitions feed with from → to states and timestamps', () => {
    renderWidget();

    const feed = transitionFeed();
    const stamps = within(feed).getAllByTestId('timestamp');
    expect(stamps).toHaveLength(2);
    expect(stamps[0]).toHaveTextContent('2024-06-01T10:00:00.000Z');
    expect(stamps[1]).toHaveTextContent('2024-06-01T11:30:00.000Z');

    // asleep→driving then driving→charging: driving appears twice within the feed.
    expect(within(feed).getByText('asleep')).toBeInTheDocument();
    expect(within(feed).getAllByText('driving')).toHaveLength(2);
    expect(within(feed).getByText('charging')).toBeInTheDocument();
  });

  it('windows the transition feed to the five most recent rows', () => {
    const many = Array.from({ length: 8 }, (_v, i) =>
      makeTransition({ id: 100 + i, ts: `2024-06-02T0${i}:00:00.000Z` }),
    );
    transitionsMock.mockReturnValue(makeQuery({ data: makeTransitions(many) }));
    renderWidget();

    expect(within(transitionFeed()).getAllByTestId('timestamp')).toHaveLength(5);
  });

  it('renders the donut tooltip with the state label, duration and percentage', () => {
    transitionsMock.mockReturnValue(makeQuery({ data: makeTransitions([]) }));
    renderWidget();

    const tip = screen.getByTestId('donut-tooltip');
    // Synthetic payload: idle, 1h, 50% → fmtDuration + one-dp fmtNumber.
    expect(within(tip).getByText('idle')).toBeInTheDocument();
    expect(within(tip).getByText(/1h 0m/)).toBeInTheDocument();
    expect(within(tip).getByText(/50\.0%/)).toBeInTheDocument();
  });

  it('renders a skeleton placeholder while a source query is loading', () => {
    statsMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No header/donut while loading.
    expect(screen.queryByText('State Distribution')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pie')).not.toBeInTheDocument();
  });

  it('keeps the skeleton up while the default vehicle is still resolving', () => {
    // No vehicleId prop + vehicles still loading: the FSM queries are disabled
    // (data undefined, not loading), so without the vehicles-loading gate the
    // widget would flash "No state data available".
    vehiclesMock.mockReturnValue({ data: undefined, isLoading: true });
    statsMock.mockReturnValue(makeQuery({ data: undefined, dataUpdatedAt: 0 }));
    transitionsMock.mockReturnValue(makeQuery({ data: undefined, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('No state data available')).not.toBeInTheDocument();
  });

  it('surfaces the shared error panel (not the empty state) when the stats query fails', () => {
    statsMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // The misleading "no data" empty state must NOT appear on a fetch failure,
    // and the error branch replaces the header (so there is no refresh control).
    expect(screen.queryByText('No state data available')).not.toBeInTheDocument();
    expect(screen.queryByText('State Distribution')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).not.toBeInTheDocument();
  });

  it('shows the empty state (keeping the titled shell) when there is no distribution', () => {
    statsMock.mockReturnValue(makeQuery({ data: makeStats({}) }));
    transitionsMock.mockReturnValue(makeQuery({ data: makeTransitions([]) }));
    renderWidget();

    expect(screen.getByText('State Distribution')).toBeInTheDocument();
    expect(screen.getByText('No state data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The donut is not rendered while empty.
    expect(screen.queryByTestId('pie')).not.toBeInTheDocument();
  });

  it('compact layout shows the empty state when there is no distribution', () => {
    statsMock.mockReturnValue(makeQuery({ data: makeStats({}) }));
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No state data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('State Distribution')).not.toBeInTheDocument();
  });

  it('refetches BOTH sources when the freshness control is activated', () => {
    const refetchStats = vi.fn().mockResolvedValue(undefined);
    const refetchTransitions = vi.fn().mockResolvedValue(undefined);
    statsMock.mockReturnValue(makeQuery({ data: makeStats(DONUT_STATS), refetch: refetchStats }));
    transitionsMock.mockReturnValue(
      makeQuery({ data: makeTransitions(TRANSITIONS), refetch: refetchTransitions }),
    );
    renderWidget();

    const refresh = screen.getByRole('button', { name: /Refresh data/ });
    expect(refetchStats).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(refetchStats).toHaveBeenCalledTimes(1);
    expect(refetchTransitions).toHaveBeenCalledTimes(1);
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();

    expect(statsMock).toHaveBeenCalledWith('7');
    expect(transitionsMock).toHaveBeenCalledWith('7', 'vehicle', 24, 1, 5);
  });

  it('uses the explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);

    expect(statsMock).toHaveBeenCalledWith('42');
    expect(transitionsMock).toHaveBeenCalledWith('42', 'vehicle', 24, 1, 5);
  });

  it('disables the queries with an empty id when no vehicle can be resolved', () => {
    vehiclesMock.mockReturnValue({ data: [], isLoading: false });
    statsMock.mockReturnValue(makeQuery({ data: undefined }));
    transitionsMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget();

    expect(statsMock).toHaveBeenCalledWith('');
    // Resolved to no vehicle, not loading → the empty state (not a skeleton).
    expect(screen.getByText('No state data available')).toBeInTheDocument();
  });

  it('is null-safe: undefined stats + a non-array transitions payload degrade without crashing', () => {
    statsMock.mockReturnValue(
      makeQuery({ data: { enabled: true, stats: undefined } as unknown as FSMStats }),
    );
    transitionsMock.mockReturnValue(
      makeQuery({
        data: { data: 'not-an-array', total: 0, page: 1, per_page: 5 } as unknown as FSMTransitionResponse,
      }),
    );

    expect(() => renderWidget()).not.toThrow();

    // Undefined stats → no segments → the empty state, no crash at Object.entries.
    expect(screen.getByText('No state data available')).toBeInTheDocument();
    expect(screen.queryByTestId('pie')).not.toBeInTheDocument();
    // The non-array transitions payload never reaches a `.map`/feed render.
    expect(screen.queryByText('Recent Transitions')).not.toBeInTheDocument();
  });
});
