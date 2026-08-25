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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/resilience';
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

// Read the value <p> that sits immediately after a MetricCard's label span.
function metricValue(label: string): string {
  const labelSpan = screen.getByText(label);
  const valueEl = labelSpan.closest('p')?.nextElementSibling;
  return valueEl?.textContent ?? '';
}

// Three rows spanning every formatting/branch axis:
//  - r101: short fingerprint (verbatim everywhere), sub-10ms mean (2dp),
//          ≥1s peak (seconds), 90% cache (GOOD tier).
//  - r102: long fingerprint (truncated), 10–1000ms mean (1dp), 10% cache
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

beforeEach(() => {
  mockUseSlowQueries.mockReset();
  mockUseSlowQueries.mockReturnValue(makeQuery({ data: response() }));
});

describe('SlowQueriesPage — populated view', () => {
  it('derives honest KPIs from the loaded rows', () => {
    renderPage();

    // Page scaffolding.
    expect(
      screen.getByRole('heading', { name: 'Slow Queries', level: 1 }),
    ).toBeInTheDocument();

    // KPI band — real aggregates over the three rows.
    expect(metricValue('Queries analyzed')).toBe('3');
    expect(metricValue('Total calls')).toBe('1,255'); // 1200 + 50 + 5
    expect(metricValue('Aggregate time')).toBe('7.00 s'); // 7000ms promoted to s
    expect(metricValue('Slowest mean')).toBe('40.0 ms'); // max mean, 1dp branch
    expect(metricValue('Peak max')).toBe('1.50 s'); // max peak promoted to s
    // Cache ratio KPI is unique (76.7%); its label collides with the table
    // column header, so assert the value directly.
    expect(screen.getByText('76.7%')).toBeInTheDocument();
  });

  it('renders the ranking chart region, cache panel and detail table', () => {
    renderPage();

    // Chart section exposes an accessible image role for the bar ranking.
    expect(
      screen.getByRole('img', {
        name: /Horizontal bar chart ranking the top queries/i,
      }),
    ).toBeInTheDocument();

    // Cache-efficiency panel: hint copy + worst-first ratios (10% then 90%).
    expect(screen.getByText(/Lowest hit ratios first/i)).toBeInTheDocument();
    expect(screen.getAllByText('10.0%').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('90.0%').length).toBeGreaterThanOrEqual(1);

    // Detail table: a row that only appears in the table (no cache stats).
    expect(screen.getByText('VACUUM analyze')).toBeInTheDocument();
    // Column headers.
    expect(screen.getByText('Mean (ms)')).toBeInTheDocument();
    expect(screen.getByText('Query fingerprint')).toBeInTheDocument();
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
      screen.getByRole('heading', { name: 'Slow Queries', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Queries analyzed')).toBeNull();
    // At least one skeleton placeholder is on screen.
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
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
    expect(screen.queryByText('Queries analyzed')).toBeNull();
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
    // KPI band renders (empty subsystem → honest 0), not the error panel.
    expect(metricValue('Queries analyzed')).toBe('0');
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

    expect(screen.getByText('VACUUM analyze')).toBeInTheDocument();
    expect(metricValue('Queries analyzed')).toBe('3');
    expect(screen.queryByText("Can't reach server")).toBeNull();
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

    // Limit select → numeric limit, order key preserved.
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '50' } });
    expect(mockUseSlowQueries).toHaveBeenLastCalledWith('total_time', 50);
  });
});
