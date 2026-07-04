/**
 * GasPriceHistoryTable — EIA price-history detail band.
 *
 * The component takes a single `query` (the gas-price history
 * `UseQueryResult`) and renders it through the shared `DataTable`, owning its
 * own sort state via `useSortToggle`. It is otherwise presentational — no
 * network of its own — so these tests drive it purely by handing in mock query
 * results. Coverage for the sole export (`GasPriceHistoryTable`):
 *
 *   1. Full render — every column (date, price+unit, unit badge, efficiency,
 *      "Current"/effective-to) plus the panel heading and a real <table>.
 *   2. Default sort — effective_from descending (newest first), applied even
 *      though the incoming array is in a different order.
 *   3. Price sort — clicking the Price header sorts desc, then toggles asc,
 *      and marks the active column with aria-sort (the bug this fix closes:
 *      the columns were `sortable` but no sort was ever wired up).
 *   4. Unit sort — clicking the Unit header sorts the string column.
 *   5. Error — QueryError alert + a working Retry that re-fires the query.
 *   6. Loading (first load) — a skeleton, never a blank panel and never a table.
 *   7. Loading (background refetch with cached rows) — keep showing the table.
 *   8. Empty — the table's empty message, no data rows.
 *   9. Null-safety — zero efficiency → "—", null effective_to → "Current",
 *      zero price → "$0.00", and a set effective_to renders a date not "Current".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

// Deterministic i18n: `t(key, default)` returns the default string (with any
// `{{token}}` interpolated) so assertions never depend on the shipped catalogue.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
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

import { GasPriceHistoryTable } from './GasPriceHistoryTable';
import type { GasPriceHistory } from '@/api/types';

type Query = UseQueryResult<GasPriceHistory[], Error>;

function makeRow(over: Partial<GasPriceHistory> & { id: number }): GasPriceHistory {
  return {
    id: over.id,
    price_per_unit: over.price_per_unit ?? 3.0,
    unit: over.unit ?? 'gal',
    efficiency_mpg: over.efficiency_mpg ?? 25,
    effective_from: over.effective_from ?? '2026-01-10T00:00:00Z',
    effective_to: over.effective_to ?? null,
    created_at: over.created_at ?? '2026-01-10T00:00:00Z',
  };
}

interface QueryOverrides {
  data?: GasPriceHistory[] | undefined;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  refetch?: () => void;
}

function makeQuery(over: QueryOverrides = {}): Query {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as Query;
}

function renderTable(query: Query) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <GasPriceHistoryTable query={query} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The data <tr> rows in the table body (empty-state has no <td>-per-column). */
function bodyRows(): HTMLTableRowElement[] {
  return Array.from(document.querySelectorAll('tbody tr')) as HTMLTableRowElement[];
}

/** Price strings ("$3.50") in DOM (render) order — price is the only $ cell. */
function priceOrder(): string[] {
  return bodyRows().map((tr) => {
    const cell = Array.from(tr.querySelectorAll('td')).find((td) =>
      td.textContent?.trim().startsWith('$'),
    );
    return (cell?.textContent ?? '').split('/')[0].trim();
  });
}

/** Trimmed text of the Nth column cell for every row, in render order. */
function columnOrder(colIndex: number): string[] {
  return bodyRows().map((tr) => tr.querySelectorAll('td')[colIndex]?.textContent?.trim() ?? '');
}

// r1 Jan-08 $3.50 · r2 Jan-22 $3.10 (current) · r3 Jan-03 $3.29 — distinct dates
// AND distinct prices so date-sort and price-sort produce different orders.
const r1 = makeRow({ id: 1, price_per_unit: 3.5, effective_from: '2026-01-08T00:00:00Z', effective_to: '2026-01-22T00:00:00Z' });
const r2 = makeRow({ id: 2, price_per_unit: 3.1, effective_from: '2026-01-22T00:00:00Z', effective_to: null });
const r3 = makeRow({ id: 3, price_per_unit: 3.29, effective_from: '2026-01-03T12:00:00Z', effective_to: '2026-01-08T00:00:00Z' });

beforeEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.clearAllMocks();
});

describe('GasPriceHistoryTable — rendering', () => {
  it('renders the heading and every column for each record', () => {
    renderTable(makeQuery({ data: [r1, r2, r3] }));

    // Panel heading (i18n default).
    expect(screen.getByRole('heading', { name: 'Price History' })).toBeInTheDocument();

    // A real accessible table with the three records.
    const table = screen.getByRole('table');
    expect(within(table).getByText('$3.50')).toBeInTheDocument();
    expect(within(table).getByText('$3.10')).toBeInTheDocument();
    expect(within(table).getByText('$3.29')).toBeInTheDocument();

    // Unit badge (its own cell) renders once per row — distinct from the
    // "/gal" suffix inside the price cell.
    expect(within(table).getAllByText('gal')).toHaveLength(3);

    // Efficiency column renders "<n> mpg".
    expect(within(table).getAllByText('25 mpg')).toHaveLength(3);

    // The open record (effective_to === null) shows the "Current" badge;
    // exactly one of the three is current.
    expect(within(table).getAllByText('Current')).toHaveLength(1);
  });
});

describe('GasPriceHistoryTable — sorting', () => {
  it('defaults to effective_from descending (newest first), reordering the input', () => {
    // Input order is [r1(Jan-08), r2(Jan-22), r3(Jan-03)]; newest-first sort
    // must surface r2, then r1, then r3 → prices $3.10, $3.50, $3.29.
    renderTable(makeQuery({ data: [r1, r2, r3] }));

    expect(priceOrder()).toEqual(['$3.10', '$3.50', '$3.29']);
    // The active sort column advertises aria-sort for assistive tech.
    const dateHeader = screen.getByRole('button', { name: 'Effective From' }).closest('th');
    expect(dateHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts by price descending on first Price click, then ascending on the second', () => {
    renderTable(makeQuery({ data: [r1, r2, r3] }));

    // First click on a new column → descending.
    fireEvent.click(screen.getByRole('button', { name: 'Price' }));
    expect(priceOrder()).toEqual(['$3.50', '$3.29', '$3.10']);
    expect(screen.getByRole('button', { name: 'Price' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    // Second click on the same column → toggle to ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Price' }));
    expect(priceOrder()).toEqual(['$3.10', '$3.29', '$3.50']);
    expect(screen.getByRole('button', { name: 'Price' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('sorts the Unit string column when its header is clicked', () => {
    const u1 = makeRow({ id: 1, unit: 'gal', effective_from: '2026-01-08T00:00:00Z' });
    const u2 = makeRow({ id: 2, unit: 'therm', effective_from: '2026-01-22T00:00:00Z' });
    const u3 = makeRow({ id: 3, unit: 'kwh', effective_from: '2026-01-03T12:00:00Z' });
    renderTable(makeQuery({ data: [u1, u2, u3] }));

    // Unit is the 3rd column (index 2). First click → descending string order.
    fireEvent.click(screen.getByRole('button', { name: 'Unit' }));
    expect(columnOrder(2)).toEqual(['therm', 'kwh', 'gal']);

    // Toggle → ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Unit' }));
    expect(columnOrder(2)).toEqual(['gal', 'kwh', 'therm']);
  });
});

describe('GasPriceHistoryTable — error / loading / empty', () => {
  it('surfaces a QueryError alert with a Retry that re-fires the query', () => {
    const refetch = vi.fn();
    renderTable(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // No table is rendered while the query is errored.
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows a skeleton (never a blank panel or table) on the first load', () => {
    const { container } = renderTable(makeQuery({ isLoading: true, data: undefined }));

    // Heading stays mounted; body is a skeleton placeholder.
    expect(screen.getByRole('heading', { name: 'Price History' })).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('keeps showing the table (not a skeleton) while refetching with cached rows', () => {
    const { container } = renderTable(makeQuery({ isLoading: true, data: [r1, r2] }));

    // Background refetch must not blank the already-rendered data.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('$3.50')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders the empty message and no data rows when there is no history', () => {
    renderTable(makeQuery({ data: [] }));

    expect(screen.getByText('No price history recorded yet.')).toBeInTheDocument();
    // Table shell exists but has no price rows (only the empty-message row).
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(priceOrder().filter((p) => p.startsWith('$'))).toEqual([]);
  });
});

describe('GasPriceHistoryTable — null safety', () => {
  it('renders placeholders for zero efficiency, zero price, and open records', () => {
    const zeroEff = makeRow({ id: 10, price_per_unit: 0, efficiency_mpg: 0, effective_to: null });
    const withEnd = makeRow({ id: 11, price_per_unit: 4.2, efficiency_mpg: 30, effective_to: '2026-02-01T00:00:00Z' });
    renderTable(makeQuery({ data: [zeroEff, withEnd] }));

    const table = screen.getByRole('table');
    // Zero price still formats as currency, not a dash.
    expect(within(table).getByText('$0.00')).toBeInTheDocument();
    // Zero efficiency collapses to the em-dash placeholder.
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(1);
    // Open record → "Current"; closed record → a formatted date, not "Current".
    expect(within(table).getAllByText('Current')).toHaveLength(1);
    expect(within(table).getByText('30 mpg')).toBeInTheDocument();
    // A closed record's effective_to renders a real (2026) date.
    expect(within(table).getAllByText(/2026/).length).toBeGreaterThanOrEqual(1);
  });
});
