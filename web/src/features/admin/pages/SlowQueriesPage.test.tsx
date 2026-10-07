/**
 * SlowQueriesPage — behaviour + hardening coverage.
 *
 * The page is the only export; every branch is exercised through it by driving
 * the single `useSlowQueries` hook (mocked) per test, mirroring the sibling
 * AuditLogPage suite. Facets covered:
 *
 *   1. Populated view — honest KPI band derived from the rows (queries /
 *      calls / aggregate time / slowest-mean / peak-max / cache ratio), the
 *      worst-first cache-efficiency panel, the ranking-chart region, and the
 *      per-query detail table.
 *   2. Loading — skeletons, no fabricated KPI numbers, page scaffolding intact.
 *   3. First-load failure (data === undefined) — QueryError in every data
 *      section, Retry affordance, and NO fabricated KPI values.
 *   4. Subsystem-missing (503) — the "not configured" AlertBanner shows and the
 *      generic network QueryError does NOT (503 is routed to the banner).
 *   5. Empty (data present, zero rows) — each section owns an empty state and
 *      the KPI band honestly reads 0.
 *   6. Transient refetch failure (isError=true WHILE data is retained) must NOT
 *      blank the populated page — the regression guard for the
 *      `showError = isError && data === undefined` fix.
 *   7. Header controls — the Order-by / Limit selects drive the hook params
 *      (snake_case order keys, numeric limit) exactly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
import { getGlobalPrecision, setGlobalPrecision } from '@/lib/numberFormat';
import type {
  SlowQueriesResponse,
  SlowQueryRow,
} from '@/types/admin-operator-confidence';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ── framer-motion: strip animation props so FadeIn / MetricBar render sync ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safeRest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
              k === 'whileInView' ||
              k === 'viewport' ||
              k === 'variants'
            )
              continue;
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
  };
});

// ── The one hook the whole page reads — driven per test ──
vi.mock('@/api/hooks/useOperatorConfidence', () => ({
  useSlowQueries: vi.fn(),
}));

import { useSlowQueries } from '@/api/hooks/useOperatorConfidence';
import SlowQueriesPage from './SlowQueriesPage';

const mockUseSlowQueries = useSlowQueries as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}) {
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

// Read the canonical value and unit, not the legacy MetricCard markup.
function metricValue(label: string): string {
  const labelSpan = screen.getAllByText(label).find(node => node.closest('[data-operational-metric]'));
  const valueEl = labelSpan?.closest('[data-operational-metric]')?.querySelector('[data-operational-value]');
  return valueEl?.textContent ?? '';
}

// Three rows spanning every formatting/branch axis:
//  - r101: short fingerprint (verbatim everywhere), sub-10ms mean,
//          ≥1s peak (seconds), 90% cache (GOOD tier).
//  - r102: long fingerprint (truncated), 10–1000ms mean, 10% cache
//          (POOR tier, sorts first in the cache panel).
//  - r103: no shared-buffer stats → excluded from the cache panel, table-only.
const ROWS: SlowQueryRow[] = [
  {
    query_id: 101,
    fingerprint: 'SELECT * FROM drives',
    calls: 1200,
    total_time_ms: 4800,
    mean_time_ms: 4,
    max_time_ms: 1500,
    rows_returned: 3400,
    shared_blks_hit: 900,
    shared_blks_read: 100,
  },
  {
    query_id: 102,
    fingerprint: 'UPDATE charging_sessions SET soc',
    calls: 50,
    total_time_ms: 2000,
    mean_time_ms: 40,
    max_time_ms: 80,
    rows_returned: 50,
    shared_blks_hit: 20,
    shared_blks_read: 180,
  },
  {
    query_id: 103,
    fingerprint: 'VACUUM analyze',
    calls: 5,
    total_time_ms: 200,
    mean_time_ms: 40,
    max_time_ms: 60,
    rows_returned: 0,
    shared_blks_hit: null,
    shared_blks_read: null,
  },
];

function response(rows: SlowQueryRow[] = ROWS): SlowQueriesResponse {
  return { order_by: 'mean_time', slow_queries: rows };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SlowQueriesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

let savedPrecision = 2;
beforeEach(() => {
  savedPrecision = getGlobalPrecision();
  mockUseSlowQueries.mockReset();
  mockUseSlowQueries.mockReturnValue(makeQuery({ data: response() }));
});
afterEach(() => setGlobalPrecision(savedPrecision));

describe('SlowQueriesPage — populated view', () => {
  it('derives honest KPIs from the loaded rows', () => {
    renderPage();

    // Page scaffolding.
    expect(
      screen.getByRole('heading', { name: 'Slow queries', level: 1 }),
    ).toBeInTheDocument();

    // KPI band — real aggregates over the three rows.
    expect(metricValue('Queries analyzed')).toBe('3');
    expect(metricValue('Total calls')).toBe('1,255'); // 1200 + 50 + 5
    expect(metricValue('Aggregate time')).toBe('7.00 s'); // 7000ms promoted to s
    expect(metricValue('Slowest mean')).toBe('40.00 ms'); // max mean, Settings precision
    expect(metricValue('Peak max')).toBe('1.50 s'); // max peak promoted to s
    // Weighted cache ratio = (900 + 20) / (900 + 100 + 20 + 180).
    // Its label collides with the table
    // column header, so assert the value directly.
    expect(metricValue('Cache hit ratio')).toBe('76.67%');
    const strip = screen.getByTestId('slow-queries-summary');
    expect(strip).toHaveAttribute('data-operational-brief');
    expect([...strip.querySelectorAll('[data-operational-metric]')].map(tile => tile.getAttribute('data-operational-metric')))
      .toEqual(['queries-analyzed', 'total-calls', 'aggregate-time', 'slowest-mean', 'peak-max', 'cache-hit-ratio']);
    expect(strip).toHaveTextContent('Top 25 by Mean time');
    expect(strip).toHaveTextContent('Across shown queries');
  });

  it('renders the ranking chart region, cache panel and detail table', () => {
    renderPage();

    // Chart section exposes an accessible image role for the bar ranking.
    expect(
      screen.getByRole('img', {
        name: /Horizontal bar chart ranking the Top queries/i,
      }),
    ).toBeInTheDocument();

    // Cache-efficiency panel: hint copy + worst-first ratios (10% then 90%).
    expect(screen.getByText(/Lowest hit ratios first/i)).toBeInTheDocument();
    expect(screen.getAllByText('10.00%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('90.00%').length).toBeGreaterThanOrEqual(1);

    // Detail table: a row that only appears in the table (no cache stats).
    expect(
      within(screen.getByRole('region', { name: 'Top queries' })).getByText('VACUUM analyze'),
    ).toBeInTheDocument();
    // Column headers.
    expect(screen.getByText('Mean (ms)')).toBeInTheDocument();
    expect(screen.getByText('Query fingerprint')).toBeInTheDocument();
    const detail = within(screen.getByRole('region', { name: 'Top queries' }));
    expect(detail.getByText('1,200')).toBeInTheDocument();
    expect(detail.getByText('3,400')).toBeInTheDocument();
    expect(detail.queryByText('1,200.00')).toBeNull();
    expect(detail.queryByText('3,400.00')).toBeNull();
  });

  it('reacts to Settings precision without rounding source measurements or count cells', () => {
    renderPage();

    act(() => setGlobalPrecision(3));
    expect(metricValue('Slowest mean')).toBe('40.000 ms');
    expect(metricValue('Aggregate time')).toBe('7.000 s');
    expect(metricValue('Cache hit ratio')).toBe('76.667%');
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('3,400')).toBeInTheDocument();

    act(() => setGlobalPrecision(0));
    expect(metricValue('Slowest mean')).toBe('40 ms');
    expect(metricValue('Aggregate time')).toBe('7 s');
    expect(metricValue('Cache hit ratio')).toBe('77%');
    expect(ROWS[0].mean_time_ms).toBe(4);
    expect(ROWS[0].shared_blks_hit).toBe(900);
  });
});

describe('SlowQueriesPage — non-happy states', () => {
  it('shows skeletons and no fabricated KPI numbers while loading', () => {
    mockUseSlowQueries.mockReturnValue(
      makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 }),
    );

    const { container } = renderPage();

    // Scaffolding stays; KPI values do not exist yet.
    expect(
      screen.getByRole('heading', { name: 'Slow queries', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('slow-queries-summary')).toHaveAttribute('aria-busy', 'true');
    expect(metricValue('Queries analyzed')).toBe('');
    // At least one skeleton placeholder is on screen.
    expect(container.querySelector('[data-operational-brief][aria-busy="true"]')).toBeTruthy();
  });

  it('surfaces the error state on a first-load failure (no data to fall back on)', () => {
    mockUseSlowQueries.mockReturnValue(
      makeQuery({ isError: true, error: new Error('boom'), data: undefined }),
    );

    renderPage();

    // The generic-network QueryError copy appears in every data section…
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(1);
    // …with a working Retry affordance.
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThanOrEqual(1);
    // …and the KPI band never fabricates a "0".
    expect(metricValue('Queries analyzed')).toBe('—');
    expect(screen.getByTestId('slow-queries-summary').querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
  });

  it('routes a 503 to the "subsystem unavailable" banner, not the network error', () => {
    mockUseSlowQueries.mockReturnValue(
      makeQuery({
        isError: true,
        error: new ApiError('pg_stat_statements missing', 503),
        data: undefined,
      }),
    );

    renderPage();

    expect(screen.getByText('Feature not supported')).toBeInTheDocument();
    expect(screen.getByText(/pg_stat_statements is not installed/i)).toBeInTheDocument();
    // The generic QueryError must NOT show for the 503 branch.
    expect(screen.queryByText("Can't reach server")).toBeNull();
    // Unsupported/unmeasured is unknown, not a measured empty response.
    expect(metricValue('Queries analyzed')).toBe('—');
  });

  it('shows per-section empty states when the query returns zero rows', () => {
    mockUseSlowQueries.mockReturnValue(makeQuery({ data: response([]) }));

    renderPage();

    expect(screen.getByText('No queries to chart yet.')).toBeInTheDocument();
    expect(
      screen.getByText(/No shared-buffer statistics available/i),
    ).toBeInTheDocument();
    expect(screen.getByText('No slow queries')).toBeInTheDocument();
    // KPI band honestly reads 0 rather than hiding.
    expect(metricValue('Queries analyzed')).toBe('0');
    expect(metricValue('Total calls')).toBe('0');
    expect(metricValue('Aggregate time')).toBe('0.00 ms');
    const strip = screen.getByTestId('slow-queries-summary');
    expect(strip.querySelectorAll('[data-value-state="value"]')).toHaveLength(5);
    expect(strip.querySelector('[data-operational-metric="cache-hit-ratio"]')).toHaveAttribute('data-value-state', 'missing');
  });

  it('keeps the last-good data visible when a background refetch fails', () => {
    // isError=true WHILE data is still present (transient poll blip). The
    // populated page must stay — no error panel, no blanking.
    mockUseSlowQueries.mockReturnValue(
      makeQuery({
        data: response(),
        isError: true,
        error: new Error('transient blip'),
      }),
    );

    renderPage();

    expect(
      within(screen.getByRole('region', { name: 'Top queries' })).getByText('VACUUM analyze'),
    ).toBeInTheDocument();
    expect(metricValue('Queries analyzed')).toBe('3');
    expect(screen.queryByText("Can't reach server")).toBeNull();
    expect(screen.getByTestId('slow-queries-summary').closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
  });
});

describe('SlowQueriesPage — header controls', () => {
  it('drives the hook order-by and limit params from the selects', () => {
    renderPage();

    // Initial render asks for the defaults.
    expect(mockUseSlowQueries).toHaveBeenLastCalledWith('mean_time', 25);

    // Order-by select → snake_case order key, limit unchanged.
    fireEvent.change(screen.getByLabelText('Order by'), {
      target: { value: 'total_time' },
    });

    expect(mockUseSlowQueries).toHaveBeenLastCalledWith('total_time', 25);
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '50' } });
    expect(mockUseSlowQueries).toHaveBeenLastCalledWith('total_time', 50);
  });
});

describe('SlowQueriesPage — full evidence and retained refresh', () => {
      it('preserves the top-twelve ranking and full fingerprints in the data alternative, and the eight worst cache candidates', () => {
        const rows = Array.from({ length: 20 }, (_, index): SlowQueryRow => ({
          ...ROWS[0],
          query_id: index + 1,
          fingerprint: `SELECT ranked ${index + 1} ${'exact_full_fingerprint_'.repeat(12)}`,
          mean_time_ms: index + 1,
          shared_blks_hit: index * 10,
          shared_blks_read: 200 - index * 10,
        }));
        mockUseSlowQueries.mockReturnValue(makeQuery({ data: response(rows) }));
        renderPage();
        const alternative = screen.getByRole('table', { name: 'Top queries by Mean time — data table' });
        const ranked = within(alternative).getAllByRole('row').slice(1);
        expect(ranked).toHaveLength(12);
        expect(ranked.map(row => within(row).getAllByRole('cell')[0].textContent))
          .toEqual([...rows].reverse().slice(0, 12).map(row => row.fingerprint));
        const cache = screen.getByText('Cache efficiency').closest<HTMLElement>('[data-print-card]');
        if (!cache) throw new Error('Cache panel must retain its canonical card surface');
        for (const row of rows.slice(0, 8)) {
          expect(within(cache).getByText(row.fingerprint)).toBeInTheDocument();
        }
        expect(within(cache).queryByText(rows[8].fingerprint)).toBeNull();
        const table = screen.getByRole('region', { name: 'Top queries' });
        expect(within(table).getByText(rows[0].fingerprint)).toBeInTheDocument();
      });

      it('keeps measured query metrics, chart and complete table after a retained 503 and offers source recovery without reclassifying it as unsupported', () => {
        const refetch = vi.fn();
        mockUseSlowQueries.mockReturnValue(makeQuery({
          data: response(), isError: true, error: new ApiError('refresh unavailable', 503), refetch,
        }));
        renderPage();
        expect(metricValue('Queries analyzed')).toBe('3');
        expect(screen.getByRole('img', { name: /Horizontal bar chart ranking/ })).toBeInTheDocument();
        expect(within(screen.getByRole('region', { name: 'Top queries' })).getByText('VACUUM analyze')).toBeInTheDocument();
        expect(screen.getByText('Data may be stale')).toBeInTheDocument();
        expect(screen.queryByText('Feature not supported')).toBeNull();
        expect(refetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
        expect(refetch).toHaveBeenCalledTimes(1);
      });
});
