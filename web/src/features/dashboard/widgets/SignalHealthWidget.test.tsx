/**
 * SignalHealthWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that summarises the health of
 * a vehicle's live signal stream. Its whole shape is a function of four inputs:
 * the resolved vehicle id (`vehicleId` prop, else the first fleet vehicle, else
 * 0), the `useSignalStats` query (drives ONLY the <WidgetShell> chrome —
 * loading / freshness / refresh), the `useSignalGaps` live snapshot
 * (`Record<name, { value, timestamp }>` — the source of the active/stale
 * classification), and the `useSignals` catalogue (the "total signals" count),
 * intersected with the widget `size`:
 *
 *   - size.cols <= 1 → CompactView (ratio badge + total + freshness).
 *   - size.cols >= 3 → StandardView + a scrollable "Stale / Gap Signals" list.
 *   - otherwise      → StandardView (four StatCards + a status badge).
 *   - no data at all → the accessible <EmptyState>.
 *   - stats.isLoading → <Skeleton> chrome only.
 *
 * The suite locks, facet by facet:
 *   1. Lifecycle: loading → skeleton only; all-undefined data → empty state;
 *      no vehicle → id resolves to 0 and every hook is called with it.
 *   2. Health classification off the live snapshot: all-fresh → green/"Healthy";
 *      a minority stale → amber/"Degraded"; a majority stale → red/"Critical";
 *      an empty snapshot → neutral/"Unknown" + an em-dash freshness.
 *   3. Freshness label branches (formatAge): "Ns ago" / "Nm ago" / "Nh ago" and
 *      "—" when there is no valid timestamp.
 *   4. Compact view: the enabled/total ratio badge, the total-signal count, and
 *      the freshness chip; the header title is suppressed.
 *   5. Wide view: the stale/gap list renders one row per gap, sorts
 *      null-last-seen first, dashes a missing last-seen, and never lists an
 *      active signal.
 *   6. Hardening regression guard: a gap whose timestamp is unparseable must be
 *      counted as a GAP (not "active") and must NOT leak "NaN" into the
 *      freshness reading — the exact bug this elevation fixes.
 *   7. Refresh: the accessible "Refresh" freshness control refetches stats.
 *   8. Vehicle resolution: prop wins over the fleet head, which wins over 0.
 *
 * i18n is stubbed to echo the English fallback (interpolating {{count}}) so
 * every copy assertion is real; `Date.now` is pinned so relative-time output is
 * deterministic; and the three telemetry hooks + `useVehicles` are mocked so no
 * network is ever touched. The real <WidgetShell> / <DataFreshness> /
 * <StatCard> / <EmptyState> render so chrome + a11y are exercised end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback and interpolate {{count}} so
// every count/copy assertion is real.
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

// Fleet list injected per-test through a mutable holder.
let MOCK_VEHICLES: { data: { id: number }[] | undefined };
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => MOCK_VEHICLES,
}));

// The three telemetry queries are injected per-test through mutable holders,
// and the id each hook is called with is captured so vehicle resolution can be
// asserted. `MOCK_`/`mock` prefixes let vitest hoist the factory safely.
let MOCK_STATS: StatsQuery;
let MOCK_GAPS: { data: GapMap | undefined };
let MOCK_SIGNALS: { data: string[] | undefined };
const mockStatsIds: number[] = [];
const mockGapsIds: number[] = [];
const mockSignalsIds: number[] = [];
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalStats: (id: number) => {
    mockStatsIds.push(id);
    return MOCK_STATS;
  },
  useSignalGaps: (id: number) => {
    mockGapsIds.push(id);
    return MOCK_GAPS;
  },
  useSignals: (id: number) => {
    mockSignalsIds.push(id);
    return MOCK_SIGNALS;
  },
}));

import SignalHealthWidget from './SignalHealthWidget';
import type { WidgetSize } from './types';

/** Only the fields the widget reads off the stats query result. */
interface StatsQuery {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

type GapEntry = { value?: unknown; timestamp?: string | null };
type GapMap = Record<string, GapEntry>;

// Pinned "now"; every fixture timestamp is expressed relative to it.
const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const S = 1_000;
const MIN = 60 * S;
const HR = 60 * MIN;

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };

function makeStats(overrides: Partial<StatsQuery> = {}): StatsQuery {
  return {
    data: { count: 1 },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize, opts: { vehicleId?: number } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SignalHealthWidget vehicleId={opts.vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Read the bold value rendered inside the StatCard with the given label. */
function statValue(label: string): string {
  const card = screen.getByText(label).closest('div.rounded-lg');
  if (!card) throw new Error(`StatCard "${label}" not found`);
  return card.querySelector('.text-2xl')?.textContent ?? '';
}

/** The `.min-h-[28px]` row that wraps a single stale/gap signal (name + time). */
function gapRowOf(name: string): HTMLElement {
  const el = screen.getByText(name).closest('.min-h-\\[28px\\]');
  if (!el) throw new Error(`gap row for "${name}" not found`);
  return el as HTMLElement;
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  MOCK_VEHICLES = { data: [{ id: 1 }] };
  MOCK_STATS = makeStats();
  MOCK_GAPS = { data: {} };
  MOCK_SIGNALS = { data: [] };
  mockStatsIds.length = 0;
  mockGapsIds.length = 0;
  mockSignalsIds.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SignalHealthWidget — lifecycle states', () => {
  it('renders a skeleton (and no content) while stats are loading', () => {
    MOCK_STATS = makeStats({ isLoading: true });
    MOCK_SIGNALS = { data: ['A', 'B'] };
    MOCK_GAPS = { data: { A: { timestamp: ago(10 * S) } } };
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    // Loading short-circuits the shell: title, content and empty state are gone.
    expect(screen.queryByText('Signal Health')).toBeNull();
    expect(screen.queryByText('Total Signals')).toBeNull();
    expect(screen.queryByText('No signal health data')).toBeNull();
  });

  it('renders an accessible empty state when no source data has arrived', () => {
    MOCK_STATS = makeStats({ data: undefined, dataUpdatedAt: 0 });
    MOCK_GAPS = { data: undefined };
    MOCK_SIGNALS = { data: undefined };
    renderWidget(STANDARD);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No signal health data')).toBeInTheDocument();
    // No StatCards leak through the empty branch.
    expect(screen.queryByText('Total Signals')).toBeNull();
  });

  it('resolves to vehicle id 0 and still calls every hook when the fleet is empty', () => {
    MOCK_VEHICLES = { data: [] };
    MOCK_STATS = makeStats({ data: undefined, dataUpdatedAt: 0 });
    MOCK_GAPS = { data: undefined };
    MOCK_SIGNALS = { data: undefined };
    renderWidget(STANDARD); // no vehicleId prop + empty fleet → id 0

    expect(mockStatsIds).toContain(0);
    expect(mockGapsIds).toContain(0);
    expect(mockSignalsIds).toContain(0);
    // Still shows the empty state rather than crashing on undefined data.
    expect(screen.getByText('No signal health data')).toBeInTheDocument();
  });
});

describe('SignalHealthWidget — health classification (standard view)', () => {
  it('reports "Healthy" (green) when every live signal is fresh', () => {
    MOCK_SIGNALS = { data: ['a', 'b', 'c', 'd', 'e'] };
    MOCK_GAPS = {
      data: {
        PackVoltage: { timestamp: ago(30 * S) },
        PackCurrent: { timestamp: ago(60 * S) },
      },
    };
    renderWidget(STANDARD);

    expect(statValue('Total Signals')).toBe('5');
    expect(statValue('Active')).toBe('2');
    expect(statValue('With Gaps')).toBe('0');
    expect(statValue('Freshness')).toBe('30s ago');
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('reports "Degraded" (amber) when a minority of signals are stale', () => {
    MOCK_SIGNALS = { data: ['a', 'b', 'c', 'd'] };
    MOCK_GAPS = {
      data: {
        A: { timestamp: ago(10 * S) },
        B: { timestamp: ago(20 * S) },
        C: { timestamp: ago(30 * S) },
        D: { timestamp: ago(10 * MIN) }, // > 5m stale threshold
      },
    };
    renderWidget(STANDARD);

    expect(statValue('Active')).toBe('3');
    expect(statValue('With Gaps')).toBe('1');
    expect(statValue('Freshness')).toBe('10s ago'); // newest is 10s
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).toBeNull();
  });

  it('reports "Critical" (red) when at least half the signals are stale', () => {
    MOCK_SIGNALS = { data: ['a', 'b', 'c'] };
    MOCK_GAPS = {
      data: {
        Fresh: { timestamp: ago(30 * S) },
        Stale: { timestamp: ago(10 * MIN) },
        Missing: { value: 1 }, // no timestamp → gap
      },
    };
    renderWidget(STANDARD);

    expect(statValue('Active')).toBe('1');
    expect(statValue('With Gaps')).toBe('2');
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('reports "Unknown" (neutral) and an em-dash freshness with no live signals', () => {
    MOCK_SIGNALS = { data: ['a', 'b'] };
    MOCK_GAPS = { data: {} };
    renderWidget(STANDARD);

    expect(statValue('Total Signals')).toBe('2');
    expect(statValue('Active')).toBe('0');
    expect(statValue('With Gaps')).toBe('0');
    expect(statValue('Freshness')).toBe('—');
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});

describe('SignalHealthWidget — freshness label branches', () => {
  it.each([
    ['seconds', 30 * S, '30s ago'],
    ['minutes', 90 * S, '1m ago'],
    ['hours', 2 * HR, '2h ago'],
  ])('formats the newest-signal age in %s as "%s"', (_label, age, expected) => {
    MOCK_SIGNALS = { data: ['a'] };
    MOCK_GAPS = { data: { Only: { timestamp: ago(age) } } };
    renderWidget(STANDARD);

    expect(statValue('Freshness')).toBe(expected as string);
  });
});

describe('SignalHealthWidget — compact view', () => {
  it('shows the active/total ratio, the catalogue count and the freshness chip', () => {
    MOCK_SIGNALS = { data: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
    MOCK_GAPS = {
      data: {
        A: { timestamp: ago(30 * S) },
        B: { timestamp: ago(40 * S) },
        C: { timestamp: ago(10 * MIN) },
      },
    };
    renderWidget(COMPACT);

    // 2 of 3 live signals active.
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('signals')).toBeInTheDocument();
    expect(screen.getByText('30s ago')).toBeInTheDocument();
    // Compact tiles suppress the header title AND the StatCard grid.
    expect(screen.queryByText('Signal Health')).toBeNull();
    expect(screen.queryByText('Total Signals')).toBeNull();
  });
});

describe('SignalHealthWidget — wide view stale list', () => {
  it('lists every gap, sorts null-last-seen first, and never lists active signals', () => {
    MOCK_SIGNALS = { data: ['x', 'y', 'z', 'w'] };
    MOCK_GAPS = {
      data: {
        AlphaFresh: { timestamp: ago(20 * S) }, // active → excluded from the list
        BetaStale: { timestamp: ago(15 * MIN) },
        GammaGap: { value: 1 }, // no timestamp → null last-seen
      },
    };
    renderWidget(WIDE);

    expect(screen.getByText('Stale / Gap Signals')).toBeInTheDocument();
    expect(screen.getByText('GammaGap')).toBeInTheDocument();
    expect(screen.getByText('BetaStale')).toBeInTheDocument();
    // The active signal is not a gap.
    expect(screen.queryByText('AlphaFresh')).toBeNull();

    // Null last-seen sorts before a dated one.
    const gamma = screen.getByText('GammaGap');
    const beta = screen.getByText('BetaStale');
    expect(gamma.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Missing last-seen dashes; a dated one renders a relative label.
    expect(within(gapRowOf('GammaGap')).getByText('—')).toBeInTheDocument();
    expect(within(gapRowOf('BetaStale')).getByText('15m ago')).toBeInTheDocument();

    // The standard StatCards still render alongside the list.
    expect(statValue('Active')).toBe('1');
    expect(statValue('With Gaps')).toBe('2');
  });
});

describe('SignalHealthWidget — unparseable timestamp hardening', () => {
  it('counts an unparseable timestamp as a gap and never leaks "NaN" into freshness', () => {
    MOCK_SIGNALS = { data: ['a', 'b', 'c', 'd', 'e'] };
    MOCK_GAPS = {
      data: {
        GoodSig: { timestamp: ago(30 * S) },
        BadSig: { timestamp: 'not-a-real-date' }, // unparseable
        MissingSig: { value: 1 }, // no timestamp
      },
    };
    const { container } = renderWidget(STANDARD);

    // The unparseable + missing entries are gaps, NOT active. (Before the fix
    // BadSig was miscounted as active → Active=2, and freshness collapsed to
    // "NaNh ago" because the bad string won the max-timestamp comparison.)
    expect(statValue('Active')).toBe('1');
    expect(statValue('With Gaps')).toBe('2');
    expect(statValue('Freshness')).toBe('30s ago');

    // A majority-stale snapshot is Critical, never the pre-fix "Degraded".
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.queryByText('Degraded')).toBeNull();

    // Hard guard: no "NaN" text anywhere in the rendered tile.
    expect(container.textContent ?? '').not.toContain('NaN');
  });
});

describe('SignalHealthWidget — refresh interaction', () => {
  it('refetches stats when the accessible "Refresh" control is activated', () => {
    const refetch = vi.fn();
    MOCK_STATS = makeStats({ refetch });
    MOCK_SIGNALS = { data: ['a', 'b'] };
    MOCK_GAPS = { data: { A: { timestamp: ago(30 * S) } } };
    renderWidget(STANDARD);

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('SignalHealthWidget — vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the fleet head', () => {
    MOCK_VEHICLES = { data: [{ id: 7 }] };
    renderWidget(STANDARD, { vehicleId: 42 });

    expect(mockStatsIds).toContain(42);
    expect(mockStatsIds).not.toContain(7);
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    MOCK_VEHICLES = { data: [{ id: 7 }, { id: 9 }] };
    renderWidget(STANDARD);

    expect(mockStatsIds).toContain(7);
    expect(mockGapsIds).toContain(7);
    expect(mockSignalsIds).toContain(7);
  });
});
