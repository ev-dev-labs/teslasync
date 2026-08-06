/**
 * DBHealthPage — behaviour + hardening coverage.
 *
 * The page is the single export; every branch is exercised through it by
 * driving the three admin hooks it reads (`useDBStats`, `useMigrations`,
 * `useConnectionPool`) per test. Facets covered:
 *
 *   1. Populated view — honest KPI band derived from the tables + migration +
 *      pool payloads, the top-15 table-size chart, the migration-status panel
 *      (version, clean/dirty, recent-migrations list), the per-table detail
 *      grid, and the connection-pool panel (stats + usage progressbar).
 *   2. Interactions — the Size/Rows/Name sort control re-orders the grid and
 *      toggles `aria-pressed`; the header "Refresh now" button fans out to all
 *      three query `refetch` callbacks.
 *   3. Loading — skeletons, no fabricated KPI numbers.
 *   4. Error — a failed stats query routes QueryError into the chart AND table
 *      sections with a working Retry; migration / pool failures surface their
 *      own panel error independently and wire Retry to the right refetch.
 *   5. Empty — chart + table + migration + pool each own an honest empty state
 *      and the KPI band reads 0 rather than hiding.
 *   6. Hardening — the pool-usage bar is NaN-safe when `inUse` is missing (the
 *      `(pool.inUse ?? 0)` fix); a ≥80% pool flips the bar to the danger color;
 *      the backend's numeric `version` field wins over `currentVersion`; and
 *      `formatBytes` renders every unit boundary (B / KB / MB / GB, plus the
 *      0-byte dash) through the rendered cells.
 *
 * The three hooks are mocked directly (mirroring the sibling SlowQueriesPage
 * suite) so the page runs end-to-end without a network. i18n is stubbed to
 * return the English `defaultValue` with `{{var}}` interpolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/feedback/Toast';
import { ApiError } from '@/lib/resilience';
import type {
  ConnectionPool,
  DBStats,
  MigrationStatus,
  TableInfo,
} from '@/types/admin';

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

// ── The three hooks the whole page reads — driven per test ──
vi.mock('@/api/hooks/useAdmin', () => ({
  useDBStats: vi.fn(),
  useMigrations: vi.fn(),
  useConnectionPool: vi.fn(),
}));

import { useDBStats, useMigrations, useConnectionPool } from '@/api/hooks/useAdmin';
import DBHealthPage from './DBHealthPage';

const mockUseDBStats = useDBStats as unknown as ReturnType<typeof vi.fn>;
const mockUseMigrations = useMigrations as unknown as ReturnType<typeof vi.fn>;
const mockUseConnectionPool = useConnectionPool as unknown as ReturnType<typeof vi.fn>;

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;

 
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

// Three tables engineered so the Size / Rows / Name orderings each put a
// DIFFERENT row first, letting the sort control be verified unambiguously:
//   size desc → zebra_events (300 MB) ; rows desc → mid_charging (900k) ;
//   name asc  → alpha_drives.
const TABLES: TableInfo[] = [
  { name: 'zebra_events', schema: 'public', rowCount: 100, sizeBytes: 300 * MB, indexCount: 2, lastVacuum: '2025-01-10T00:00:00Z' },
  { name: 'alpha_drives', schema: 'public', rowCount: 5_000, sizeBytes: 10 * MB, indexCount: 3, lastVacuum: null },
  { name: 'mid_charging', schema: 'public', rowCount: 900_000, sizeBytes: 50 * MB, indexCount: 1, lastVacuum: '2025-01-09T00:00:00Z' },
];

function dbStats(over: Partial<DBStats> = {}): DBStats {
  return {
    tables: TABLES,
    tableCount: TABLES.length,
    databaseSize: String(360 * MB),
    ...over,
  };
}

function migration(over: Partial<MigrationStatus> = {}): MigrationStatus {
  return {
    currentVersion: '185',
    dirty: false,
    pending: 0,
    migrations: [
      { version: '183', name: 'add_regen_index', appliedAt: '2025-01-01T00:00:00Z' },
      { version: '184', name: 'drop_legacy_col', appliedAt: '2025-01-02T00:00:00Z' },
      { version: '185', name: 'si_canonical', appliedAt: '2025-01-03T00:00:00Z' },
    ],
    ...over,
  };
}

function pool(over: Partial<ConnectionPool> = {}): ConnectionPool {
  return {
    maxOpen: 25,
    open: 10,
    inUse: 5,
    idle: 5,
    waitCount: 2,
    waitDurationMs: 120,
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <DBHealthPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// The KPI band is a labelled <section> → role="region". Scoping every KPI
// lookup here avoids collisions with the identically-worded panel titles /
// progressbar label further down the page ("Tables", "Pool Usage", …).
function kpiRegion() {
  return within(screen.getByRole('region', { name: 'Summary metrics' }));
}
function metricValue(label: string): string {
  const labelSpan = kpiRegion().getByText(label);
  return labelSpan.closest('p')?.nextElementSibling?.textContent ?? '';
}

// The chart renders a visually-hidden fallback <table>; the detail grid is the
// only <table> carrying the "Indexes" header, so use that to disambiguate.
function tablesGrid(): HTMLElement {
  const grid = screen
    .getAllByRole('table')
    .find((tbl) => within(tbl).queryByText('Indexes'));
  if (!grid) throw new Error('detail tables grid not found');
  return grid;
}
function firstBodyRowName(): string {
  const rows = within(tablesGrid()).getAllByRole('row');
  return (
    within(rows[1])
      .getByText(/^(zebra_events|alpha_drives|mid_charging)$/)
      .textContent ?? ''
  );
}

beforeEach(() => {
  mockUseDBStats.mockReset();
  mockUseMigrations.mockReset();
  mockUseConnectionPool.mockReset();
  mockUseDBStats.mockReturnValue(makeQuery({ data: dbStats() }));
  mockUseMigrations.mockReturnValue(makeQuery({ data: migration() }));
  mockUseConnectionPool.mockReturnValue(makeQuery({ data: pool() }));
});

describe('DBHealthPage — populated view', () => {
  it('derives honest KPIs from the loaded tables, migration and pool payloads', () => {
    renderPage();

    // Page scaffolding.
    expect(
      screen.getByRole('heading', { name: 'DB Health Dashboard', level: 1 }),
    ).toBeInTheDocument();

    // KPI band — real aggregates.
    expect(metricValue('Total DB Size')).toBe('360.0 MB');
    expect(metricValue('Tables')).toBe('3');
    expect(metricValue('Total Rows')).toBe('905,100'); // 100 + 5,000 + 900,000
    expect(metricValue('Large Tables')).toBe('1'); // only zebra_events > 100 MB
    expect(metricValue('Migration')).toBe('185');
    expect(metricValue('Pool Usage')).toBe('20%'); // 5 / 25
  });

  it('renders the chart region and the migration-status panel', () => {
    renderPage();

    // The bar chart exposes its accessible name via role="img".
    expect(
      screen.getByRole('img', {
        name: /database table sizes/i,
      }),
    ).toBeInTheDocument();

    // Migration panel: current version + clean status + recent list entry.
    const versionRow = screen.getByText('Current Version').closest('div')!;
    expect(within(versionRow).getByText('185')).toBeInTheDocument();
    expect(screen.getByText('Recent Migrations')).toBeInTheDocument();
    expect(screen.getByText(/v185 si_canonical/)).toBeInTheDocument();
    // "Clean" appears both as the KPI subtitle and the panel status.
    expect(screen.getAllByText('Clean').length).toBeGreaterThanOrEqual(1);
  });

  it('renders every table row + the connection-pool stats and usage bar', () => {
    renderPage();

    // Detail grid carries the full column set + all three rows.
    const grid = tablesGrid();
    expect(within(grid).getByText('Last Vacuum')).toBeInTheDocument();
    expect(within(grid).getByText('zebra_events')).toBeInTheDocument();
    expect(within(grid).getByText('alpha_drives')).toBeInTheDocument();
    expect(within(grid).getByText('mid_charging')).toBeInTheDocument();
    // Byte formatting in the Size column (300 MB row).
    expect(within(grid).getByText('300.0 MB')).toBeInTheDocument();

    // Connection-pool panel: labelled stats + the usage progressbar.
    expect(screen.getByText('Max Open')).toBeInTheDocument();
    expect(screen.getByText('120ms')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Pool Usage' });
    expect(bar).toHaveAttribute('aria-valuenow', '20');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });
});

describe('DBHealthPage — interactions', () => {
  it('re-orders the detail grid and toggles aria-pressed as the sort changes', () => {
    renderPage();

    // Default sort is by size → largest-on-disk row first.
    expect(firstBodyRowName()).toBe('zebra_events');
    expect(screen.getByRole('button', { name: 'Size' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rows' })).toHaveAttribute('aria-pressed', 'false');

    // Sort by rows → the busiest table leads.
    fireEvent.click(screen.getByRole('button', { name: 'Rows' }));
    expect(firstBodyRowName()).toBe('mid_charging');
    expect(screen.getByRole('button', { name: 'Rows' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Size' })).toHaveAttribute('aria-pressed', 'false');

    // Sort by name → alphabetical.
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(firstBodyRowName()).toBe('alpha_drives');
    expect(screen.getByRole('button', { name: 'Name' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('fans the header refresh button out to all three query refetch callbacks', () => {
    const refetchStats = vi.fn();
    const refetchMigration = vi.fn();
    const refetchPool = vi.fn();
    mockUseDBStats.mockReturnValue(makeQuery({ data: dbStats(), refetch: refetchStats }));
    mockUseMigrations.mockReturnValue(makeQuery({ data: migration(), refetch: refetchMigration }));
    mockUseConnectionPool.mockReturnValue(makeQuery({ data: pool(), refetch: refetchPool }));

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));

    expect(refetchStats).toHaveBeenCalledTimes(1);
    expect(refetchMigration).toHaveBeenCalledTimes(1);
    expect(refetchPool).toHaveBeenCalledTimes(1);
  });
});

describe('DBHealthPage — loading', () => {
  it('shows skeletons and no fabricated KPI numbers while stats load', () => {
    mockUseDBStats.mockReturnValue(
      makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 }),
    );
    mockUseMigrations.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    mockUseConnectionPool.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));

    const { container } = renderPage();

    // Page heading still renders; the KPI labels do not exist yet.
    expect(
      screen.getByRole('heading', { name: 'DB Health Dashboard', level: 1 }),
    ).toBeInTheDocument();
    expect(kpiRegion().queryByText('Total DB Size')).toBeNull();
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });
});

describe('DBHealthPage — error states', () => {
  it('routes a failed stats query into both the chart and table sections with Retry', () => {
    const refetchStats = vi.fn();
    mockUseDBStats.mockReturnValue(
      makeQuery({ isError: true, error: new Error('boom'), data: undefined, refetch: refetchStats }),
    );

    renderPage();

    // Both the chart panel and the tables panel surface the network error.
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(2);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(retries[0]);
    expect(refetchStats).toHaveBeenCalledTimes(1);
  });

  it('surfaces a migration failure in its own panel and wires Retry to refetchMigration', () => {
    const refetchMigration = vi.fn();
    mockUseMigrations.mockReturnValue(
      makeQuery({ isError: true, error: new ApiError('down', 500), data: undefined, refetch: refetchMigration }),
    );

    renderPage();

    // 5xx routes to the "Server error" branch of QueryError.
    expect(screen.getByText('Server error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchMigration).toHaveBeenCalledTimes(1);
    // The stats-driven grid is unaffected.
    expect(within(tablesGrid()).getByText('zebra_events')).toBeInTheDocument();
  });

  it('surfaces a pool failure in its own panel and wires Retry to refetchPool', () => {
    const refetchPool = vi.fn();
    mockUseConnectionPool.mockReturnValue(
      makeQuery({ isError: true, error: new Error('pool down'), data: undefined, refetch: refetchPool }),
    );

    renderPage();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchPool).toHaveBeenCalledTimes(1);
  });
});

describe('DBHealthPage — empty states', () => {
  it('shows honest per-section empty states + zeroed KPIs when there are no tables', () => {
    mockUseDBStats.mockReturnValue(
      makeQuery({ data: dbStats({ tables: [], tableCount: 0, databaseSize: '0' }) }),
    );

    renderPage();

    // Chart empty state + table empty message (distinct copy).
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByText('No tables found')).toBeInTheDocument();
    // KPI band reads 0 rather than hiding.
    expect(metricValue('Tables')).toBe('0');
    expect(metricValue('Total Rows')).toBe('0');
    expect(metricValue('Large Tables')).toBe('0');
    expect(metricValue('Total DB Size')).toBe('0 B');
  });

  it('shows the migration + pool "unavailable" placeholders when their data is missing', () => {
    mockUseMigrations.mockReturnValue(makeQuery({ data: undefined }));
    mockUseConnectionPool.mockReturnValue(makeQuery({ data: undefined }));

    renderPage();

    expect(screen.getByText('Migration data unavailable')).toBeInTheDocument();
    expect(screen.getByText('Connection pool data unavailable')).toBeInTheDocument();
  });

  it('shows the "no history" placeholder when a migration payload has zero entries', () => {
    mockUseMigrations.mockReturnValue(
      makeQuery({ data: migration({ migrations: [] }) }),
    );

    renderPage();

    // The panel still renders its version/status; only the list is empty.
    expect(screen.getByText('Current Version')).toBeInTheDocument();
    expect(screen.getByText('No migration history available')).toBeInTheDocument();
  });
});

describe('DBHealthPage — hardening', () => {
  it('keeps the pool-usage bar NaN-safe when inUse is missing', () => {
    // Regression guard for the `(pool.inUse ?? 0)` fix: a payload with a
    // maxOpen but no inUse must yield 0%, never "NaN%".
    mockUseConnectionPool.mockReturnValue(
      makeQuery({
        data: { ...pool(), inUse: undefined } as unknown as ConnectionPool,
      }),
    );

    renderPage();

    const bar = screen.getByRole('progressbar', { name: 'Pool Usage' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    const fill = bar.querySelector('div');
    expect(fill).toHaveStyle({ width: '0%' });
    expect(metricValue('Pool Usage')).toBe('0%');
  });

  it('flips the usage bar to the danger color once the pool is ≥80% busy', () => {
    mockUseConnectionPool.mockReturnValue(
      makeQuery({ data: pool({ inUse: 22, maxOpen: 25 }) }), // 88%
    );

    renderPage();

    const bar = screen.getByRole('progressbar', { name: 'Pool Usage' });
    expect(bar).toHaveAttribute('aria-valuenow', '88');
    expect(bar.querySelector('div')?.className).toContain('bg-rose-400');
    expect(metricValue('Pool Usage')).toBe('88%');
  });

  it('honors the backend numeric `version` field over currentVersion, plus dirty + pending', () => {
    mockUseMigrations.mockReturnValue(
      makeQuery({
        // Backend wire shape: { version, dirty } — no camelCase currentVersion.
        data: {
          version: 190,
          currentVersion: '999',
          dirty: true,
          pending: 3,
          migrations: [],
        } as unknown as MigrationStatus,
      }),
    );

    renderPage();

    // `version` (190) wins over the `currentVersion` (999) fallback.
    expect(metricValue('Migration')).toBe('190');
    expect(screen.queryByText('999')).toBeNull();
    // Dirty status + pending count both surface.
    expect(screen.getAllByText('Dirty').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(kpiRegion().getByText('Dirty')).toBeInTheDocument();
  });

  it('formats byte sizes across the KB / GB boundaries and dashes zero-byte tables', () => {
    mockUseDBStats.mockReturnValue(
      makeQuery({
        data: dbStats({
          databaseSize: String(2 * GB), // GB branch
          tables: [
            { name: 'tiny_bytes', schema: 'public', rowCount: 1, sizeBytes: 512, indexCount: 0, lastVacuum: null },
            { name: 'kilo_table', schema: 'public', rowCount: 2, sizeBytes: 2 * 1024, indexCount: 0, lastVacuum: null },
            { name: 'zero_table', schema: 'public', rowCount: 3, sizeBytes: 0, indexCount: 0, lastVacuum: null },
          ],
        }),
      }),
    );

    renderPage();

    expect(metricValue('Total DB Size')).toBe('2.00 GB');
    const grid = tablesGrid();
    expect(within(grid).getByText('512 B')).toBeInTheDocument();
    expect(within(grid).getByText('2.0 KB')).toBeInTheDocument();
    // A 0-byte table renders the "—" placeholder in the Size column.
    const zeroRow = within(grid).getByText('zero_table').closest('tr')!;
    expect(within(zeroRow).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});
