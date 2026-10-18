/**
 * DBHealthPage — behaviour + hardening coverage.
 *
 * The page is the single export; every branch is exercised through it by
 * driving the three admin hooks it reads (`useDBStats`, `useMigrations`,
 * `useConnectionPool`) per test. Facets covered:
 *
 *   1. Populated view — honest KPI band derived from the tables + migration +
 *      pool payloads, the top-15 table-row chart, the migration-status panel
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
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/feedback/Toast';
import { ApiError } from '@/lib/resilience';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
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
  const tile = kpiRegion().getAllByText(label)[0].closest('[data-operational-metric]');
  return tile?.querySelector('[data-operational-value]')?.textContent ?? '';
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

function closeTableDetails() {
  const footer = screen.getByRole('dialog', { name: 'Tables' })
    .querySelector<HTMLElement>('[data-modal-footer]');
  if (!footer) throw new Error('table detail footer not found');
  fireEvent.click(within(footer).getByRole('button', { name: /^Close$/ }));
}

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mockUseDBStats.mockReset();
  mockUseMigrations.mockReset();
  mockUseConnectionPool.mockReset();
  mockUseDBStats.mockReturnValue(makeQuery({ data: dbStats() }));
  mockUseMigrations.mockReturnValue(makeQuery({ data: migration() }));
  mockUseConnectionPool.mockReturnValue(makeQuery({ data: pool() }));
});

afterEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('DBHealthPage — row chart context and count preferences', () => {
  it('discloses the top fifteen returned tables by rows while keeping all sixteen details and independent sorting', () => {
    const tables = Array.from({ length: 16 }, (_, index): TableInfo => ({
      ...TABLES[0],
      name: `table_${String(index).padStart(2, '0')}_complete_identity`,
      rowCount: index * 1_000,
      sizeBytes: (16 - index) * MB,
    }));
    mockUseDBStats.mockReturnValue(makeQuery({ data: dbStats({ tables, tableCount: 16 }) }));
    renderPage();

    const scope = 'Showing 15 of 16 returned tables by row count. The complete table list is below.';
    expect(screen.getAllByText(scope).length).toBeGreaterThan(0);
    expect(screen.getByRole('figure', { name: 'Rows' }))
      .toHaveAccessibleDescription(new RegExp(scope.replace(/\./g, '\\.')));
    const chartTable = screen.getAllByRole('table').find((table) => table !== tablesGrid())!;
    const rankedNames = within(chartTable).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(rankedNames).toEqual(tables.slice(1).reverse().map((table) => table.name));
    expect(within(chartTable).queryByText(tables[0].name)).toBeNull();
    expect(within(tablesGrid()).getAllByRole('row')).toHaveLength(17);
    expect(within(tablesGrid()).getByText(tables[0].name)).toBeInTheDocument();
    expect(within(tablesGrid()).getAllByRole('row')[1]).toHaveTextContent(tables[0].name);

    fireEvent.click(screen.getByRole('button', { name: 'Rows' }));
    expect(within(tablesGrid()).getAllByRole('row')[1]).toHaveTextContent(tables[15].name);
    expect(within(chartTable).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual(rankedNames);
    expect(tables[0].rowCount).toBe(0);
    expect(tables[15].rowCount).toBe(15_000);
  });

  it('describes all returned tables when fewer than fifteen are present without claiming an omitted subset', () => {
    mockUseDBStats.mockReturnValue(makeQuery({ data: dbStats({ tableCount: 100 }) }));
    renderPage();
    const scope = 'Showing 3 of 3 returned tables by row count. The complete table list is below.';
    expect(screen.getByRole('figure', { name: 'Rows' }))
      .toHaveAccessibleDescription(new RegExp(scope.replace(/\./g, '\\.')));
    expect(screen.getAllByText(scope).length).toBeGreaterThan(0);
    expect(within(tablesGrid()).getAllByRole('row')).toHaveLength(4);
  });

  it('does not invent a returned-table count while statistics are unavailable', () => {
    mockUseDBStats.mockReturnValue(makeQuery({ data: undefined }));
    renderPage();
    expect(screen.queryByText(/returned tables by row count/)).toBeNull();
    expect(screen.getByText('No tables found')).toBeInTheDocument();
    expect(screen.getByText('Current version')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Pool usage' })).toHaveAttribute('aria-valuenow', '20');
  });

  it('updates desktop index cells and chart count alternatives with locale preferences while preserving zero and unknown gaps', () => {
    const tables: TableInfo[] = [
      { ...TABLES[0], name: 'localized_counts', rowCount: 12_345, indexCount: 1_234 },
      { ...TABLES[1], name: 'zero_counts', rowCount: 0, indexCount: 0 },
      { ...TABLES[2], name: 'unknown_counts', rowCount: null as unknown as number, indexCount: null as unknown as number },
    ];
    mockUseDBStats.mockReturnValue(makeQuery({ data: dbStats({ tables }) }));
    const { unmount } = renderPage();
    const chartTable = screen.getAllByRole('table').find((table) => table !== tablesGrid())!;
    const indexCell = (name: string) => within(within(tablesGrid()).getByText(name).closest('tr')!)
      .getAllByRole('cell')[3];
    const chartCountCell = (name: string) => within(within(chartTable).getByText(name).closest('tr')!)
      .getAllByRole('cell')[1];
    expect(indexCell('localized_counts')).toHaveTextContent(/^1,234$/);
    expect(chartCountCell('localized_counts')).toHaveTextContent(/^12,345$/);

    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(4);
    });
    expect(indexCell('localized_counts')).toHaveTextContent(/^1\.234$/);
    expect(chartCountCell('localized_counts')).toHaveTextContent(/^12\.345$/);
    expect(indexCell('zero_counts')).toHaveTextContent(/^0$/);
    expect(chartCountCell('zero_counts')).toHaveTextContent(/^0$/);
    expect(indexCell('unknown_counts')).toHaveTextContent(/^—$/);
    expect(chartCountCell('unknown_counts')).toHaveTextContent(/^—$/);
    expect(tables[0]).toMatchObject({ rowCount: 12_345, indexCount: 1_234 });
    expect(tables[2]).toMatchObject({ rowCount: null, indexCount: null });
    unmount();
  });

  it('uses the same localized integer index count in narrow table details without losing vacuum evidence', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(4);
    mockUseDBStats.mockReturnValue(makeQuery({
      data: dbStats({ tables: [{ ...TABLES[0], indexCount: 1_234 }] }),
    }));
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 375, 400));
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
      const details = within(screen.getByRole('dialog', { name: 'Tables' }));
      expect(details.getByText('1.234')).toBeInTheDocument();
      expect(details.queryByText('1234')).toBeNull();
      expect(details.getByText('Last vacuum')).toBeInTheDocument();
      expect(details.getByText('zebra_events')).toBeInTheDocument();
      closeTableDetails();
      expect(screen.queryByRole('dialog', { name: 'Tables' })).toBeNull();
    } finally {
      bounds.mockRestore();
    }
  });

  it('retains accurate chart scope and all returned details when only the statistics refresh fails', () => {
    mockUseDBStats.mockReturnValue(makeQuery({
      data: dbStats(), isError: true, error: new Error('statistics refresh'),
    }));
    renderPage();
    expect(screen.getByRole('figure', { name: 'Rows' })).toHaveAccessibleDescription(
      /Showing 3 of 3 returned tables by row count\. The complete table list is below\./,
    );
    expect(within(tablesGrid()).getByText('zebra_events')).toBeInTheDocument();
    expect(screen.getByText('Current version')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Pool usage' })).toHaveAttribute('aria-valuenow', '20');
  });
});

describe('DBHealthPage — populated view', () => {
  it('derives honest KPIs from the loaded tables, migration and pool payloads', () => {
    renderPage();

    // Page scaffolding.
    expect(
      screen.getByRole('heading', { name: 'DB health', level: 1 }),
    ).toBeInTheDocument();

    // KPI band — real aggregates.
    expect(metricValue('Total DB size')).toBe('360.00 MB');
    expect(metricValue('Tables')).toBe('3');
    expect(metricValue('Total rows')).toBe('905,100'); // 100 + 5,000 + 900,000
    expect(metricValue('Large tables')).toBe('1'); // only zebra_events > 100 MB
    expect(metricValue('Migration')).toBe('185');
    expect(metricValue('Pool usage')).toBe('20.00%'); // 5 / 25
  });

  it('renders the chart region and the migration-status panel', () => {
    renderPage();

    // The bar chart exposes its accessible name via role="img".
    expect(
      screen.getByRole('img', {
        name: 'Rows',
      }),
    ).toBeInTheDocument();

    // Migration panel: current version + clean status + recent list entry.
    const versionRow = screen.getByText('Current version').closest('div')!;
    expect(within(versionRow).getByText('185')).toBeInTheDocument();
    expect(screen.getByText('Recent migrations')).toBeInTheDocument();
    expect(screen.getByText(/v185 si_canonical/)).toBeInTheDocument();
    // "Clean" appears both as the KPI subtitle and the panel status.
    expect(screen.getAllByText('Clean').length).toBeGreaterThanOrEqual(1);
  });

  it('renders every table row + the connection-pool stats and usage bar', () => {
    renderPage();

    // Detail grid carries the full column set + all three rows.
    const grid = tablesGrid();
    expect(within(grid).getByText('Last vacuum')).toBeInTheDocument();
    expect(within(grid).getByText('zebra_events')).toBeInTheDocument();
    expect(within(grid).getByText('alpha_drives')).toBeInTheDocument();
    expect(within(grid).getByText('mid_charging')).toBeInTheDocument();
    // Byte formatting in the Size column (300 MB row).
    expect(within(grid).getByText('300.00 MB')).toBeInTheDocument();

    // Connection-pool panel: labelled stats + the usage progressbar.
    expect(screen.getByText('Max open')).toBeInTheDocument();
    expect(screen.getByText('120.00ms')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Pool usage' });
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

    // Canonical strip shells and labels remain mounted during loading.
    expect(
      screen.getByRole('heading', { name: 'DB health', level: 1 }),
    ).toBeInTheDocument();
    expect(kpiRegion().getAllByText('Total DB size')[0]).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-operational-brief][aria-busy="true"]')).toHaveLength(3);
    expect(kpiRegion().queryByText('0')).toBeNull();
  });

  it('does not let pending statistics mask a successful migration or pool snapshot', () => {
    mockUseDBStats.mockReturnValue(makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 }));
    renderPage();
    expect(screen.getByTestId('db-health-summary-0').querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByTestId('db-health-summary-0')).toHaveAttribute('aria-busy', 'true');
    expect(metricValue('Migration')).toBe('185');
    expect(metricValue('Pool usage')).toBe('20.00%');
    expect(screen.getByTestId('db-health-summary-1')).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('db-health-summary-2')).not.toHaveAttribute('aria-busy', 'true');
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
    expect(screen.getAllByText(
      'Showing 0 of 0 returned tables by row count. The complete table list is below.',
    ).length).toBeGreaterThan(0);
    // KPI band reads 0 rather than hiding.
    expect(metricValue('Tables')).toBe('0');
    expect(metricValue('Total rows')).toBe('0');
    expect(metricValue('Large tables')).toBe('0');
    expect(metricValue('Total DB size')).toBe('0.00 B');
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
    expect(screen.getByText('Current version')).toBeInTheDocument();
    expect(screen.getByText('No migration history available')).toBeInTheDocument();
  });
});

describe('DBHealthPage — hardening', () => {
  it('keeps incomplete row totals and missing migration health unknown', () => {
    mockUseDBStats.mockReturnValue(makeQuery({
      data: dbStats({ tables: [{ ...TABLES[0], rowCount: null as unknown as number }] }),
    }));
    mockUseMigrations.mockReturnValue(makeQuery({
      data: migration({ dirty: undefined }),
    }));
    renderPage();
    // Unknown metrics are omitted from the face; the drawer counts them.
    assertOperationalMetricUnavailable(screen.getByTestId('db-health-summary-0'), 'Total rows');
    expect(screen.queryByText('Clean')).toBeNull();
    expect(within(tablesGrid()).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('keeps missing pool readings unknown, without a fabricated zero fill', () => {
    mockUseConnectionPool.mockReturnValue(
      makeQuery({
        data: { ...pool(), inUse: undefined } as unknown as ConnectionPool,
      }),
    );

    renderPage();

    const bar = screen.getByRole('progressbar', { name: 'Pool usage' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuetext', 'No reading');
    expect(bar.querySelector('[data-metric-fill]')).toBeNull();
    assertOperationalMetricUnavailable(screen.getByTestId('db-health-summary-2'), 'Pool usage');
  });

  it('flips the usage bar to the danger color once the pool is ≥80% busy', () => {
    mockUseConnectionPool.mockReturnValue(
      makeQuery({ data: pool({ inUse: 22, maxOpen: 25 }) }), // 88%
    );

    renderPage();

    const bar = screen.getByRole('progressbar', { name: 'Pool usage' });
    expect(bar).toHaveAttribute('aria-valuenow', '88');
    expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({ background: 'var(--semantic-danger)' });
    expect(metricValue('Pool usage')).toBe('88.00%');
  });

  describe('DBHealthPage — retained independent sources', () => {
    it('marks only the failed retained source stale while preserving all six canonical tiles', () => {
      mockUseMigrations.mockReturnValue(makeQuery({
        data: migration(), isError: true, error: new Error('migration refresh'),
      }));
      const { container } = renderPage();
      expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
      assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-0'), 'Source loaded', { contains: true });
      assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-1'), 'Retained source', { contains: true });
      assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-2'), 'Source loaded', { contains: true });
      expect(metricValue('Migration')).toBe('185');
      expect(metricValue('Total DB size')).toBe('360.00 MB');
      assertOperationalBriefDisclosure(screen.getByTestId('db-health-summary-1'), 'Migration status snapshot', { contains: true });
    });
    it('retains table details, migration evidence and pool metrics after refresh errors', () => {
      mockUseDBStats.mockReturnValue(makeQuery({ data: dbStats(), isError: true, error: new Error('stats refresh') }));
      mockUseMigrations.mockReturnValue(makeQuery({ data: migration(), isError: true, error: new Error('migration refresh') }));
      mockUseConnectionPool.mockReturnValue(makeQuery({ data: pool(), isError: true, error: new Error('pool refresh') }));

      renderPage();

      expect(within(tablesGrid()).getByText('zebra_events')).toBeInTheDocument();
      expect(screen.getByText(/v185 si_canonical/)).toBeInTheDocument();
      const bar = screen.getByRole('progressbar', { name: 'Pool usage' });
      expect(bar).toHaveAttribute('aria-valuenow', '20');
      expect(bar.querySelector('[data-metric-track]')).toHaveClass('h-1');
      expect(screen.queryByText("Can't reach server")).toBeNull();
      expect(metricValue('Total rows')).toBe('905,100');
    });

    it('distinguishes a real zero pool reading from an unknown one', () => {
      mockUseConnectionPool.mockReturnValue(makeQuery({ data: pool({ inUse: 0 }) }));
      renderPage();
      const bar = screen.getByRole('progressbar', { name: 'Pool usage' });
      expect(bar).toHaveAttribute('aria-valuenow', '0');
      expect(bar.querySelector('[data-metric-fill]')).not.toBeNull();
      expect(metricValue('Pool usage')).toBe('0.00%');
    });
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
    // Dirty status + pending count both surface (the badge context lives in
    // the drawer group now; the panel keeps its own Pending row).
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(kpiRegion().queryByText('Dirty')).toBeNull();
    const migrationBrief = screen.getByTestId('db-health-summary-1');
    fireEvent.click(within(migrationBrief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    const group = within(dialog).getByRole('group', { name: 'Migration' });
    expect(within(group).getByText('Dirty')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    expect(metricValue('Total DB size')).toBe('2.00 GB');
    const grid = tablesGrid();
    expect(within(grid).getByText('512.00 B')).toBeInTheDocument();
    expect(within(grid).getByText('2.00 KB')).toBeInTheDocument();
    // A 0-byte table renders the "—" placeholder in the Size column.
    const zeroRow = within(grid).getByText('zero_table').closest('tr')!;
    expect(within(zeroRow).getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps missing byte sizes after measured sizes without treating row counts as bytes', () => {
    mockUseDBStats.mockReturnValue(makeQuery({
      data: dbStats({ tables: [
        { ...TABLES[0], sizeBytes: undefined as unknown as number, rowCount: 10_000_000 },
        { ...TABLES[1], sizeBytes: 0 },
        { ...TABLES[2], sizeBytes: 50 * MB },
      ] }),
    }));
    renderPage();
    const names = within(tablesGrid()).getAllByRole('row').slice(1)
      .map((row) => within(row).getByText(/^(zebra_events|alpha_drives|mid_charging)$/).textContent);
    expect(names).toEqual(['mid_charging', 'alpha_drives', 'zebra_events']);
    fireEvent.click(screen.getByRole('button', { name: 'Rows' }));
    expect(firstBodyRowName()).toBe('zebra_events');
    assertOperationalMetricUnavailable(screen.getByTestId('db-health-summary-0'), 'Large tables');
  });

  it('retains full table identities in chart alternatives and names the persistent detail table', () => {
    const name = 'database_table_with_a_complete_long_identity';
    mockUseDBStats.mockReturnValue(makeQuery({
      data: dbStats({ tables: [{ ...TABLES[0], name }] }),
    }));
    renderPage();
    const tables = screen.getAllByRole('table');
    const chartTable = tables.find((table) => !within(table).queryByText('Indexes'));
    expect(chartTable).toBeDefined();
    expect(within(chartTable!).getByText(name)).toBeInTheDocument();
    expect(tablesGrid()).toHaveAccessibleName('Tables');
    expect(within(tablesGrid()).getByText(name)).toBeInTheDocument();
  });

  it('reflects an independently refreshing pool source and preserves mobile-sized refresh and sort actions', () => {
    mockUseConnectionPool.mockReturnValue(makeQuery({ data: pool(), isFetching: true }));
    renderPage();
    const refresh = screen.getByRole('button', { name: 'Refresh now' });
    expect(refresh).toHaveAttribute('aria-busy', 'true');
    expect(refresh).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9');
    expect(screen.queryByText('Auto-refresh 30s')).toBeNull();
    for (const label of ['Size', 'Rows', 'Name']) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('min-h-11', 'min-w-11');
    }
    expect(metricValue('Pool usage')).toBe('20.00%');
  });

  it('keeps indexes and vacuum evidence reachable through the narrow table detail action', () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 375, 400));
    try {
      const { container } = renderPage();
      expect(container.querySelector('[data-mobile-table]')).toHaveAccessibleName('Tables');
      fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0]);
      const details = within(screen.getByRole('dialog', { name: 'Tables' }));
      expect(details.getByText('zebra_events')).toBeInTheDocument();
      expect(details.getByText('Indexes')).toBeInTheDocument();
      expect(details.getByText('2')).toBeInTheDocument();
      expect(details.getByText('Last vacuum')).toBeInTheDocument();
      expect(details.getByText('300.00 MB')).toBeInTheDocument();
      closeTableDetails();
      expect(screen.queryByRole('dialog', { name: 'Tables' })).toBeNull();
    } finally {
      bounds.mockRestore();
    }
  });
});
