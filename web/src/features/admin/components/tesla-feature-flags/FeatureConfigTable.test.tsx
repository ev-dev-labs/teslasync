/**
 * FeatureConfigTable — Tesla account feature-config detail band.
 *
 * The component is presentational: it takes the already-parsed `entries`
 * plus `isLoading` / `error` / `onRetry`, owns its own search + status-filter
 * state, sorts locally via `useSortToggle`, and renders everything through the
 * shared `DataTable`. It never touches the network of its own, so these tests
 * drive it purely by handing in props. Coverage for the sole export
 * (`FeatureConfigTable`):
 *
 *   1. Full render — heading, "Showing N of M" caption, a real <table>, every
 *      column (Feature code, Type badge, Status badge, Details) for each row.
 *   2. Default sort — key ascending, applied even though the input array is in
 *      a different order; the Feature header advertises aria-sort=ascending.
 *   3. Status sort — clicking the Status header sorts by enabled desc (enabled
 *      first) with a stable key tiebreak, then toggles to asc, and marks the
 *      active column with aria-sort. This is the bug the source fix closes: the
 *      columns were `sortable` but no sortKey/onSort was ever wired to DataTable.
 *   4. Type sort — clicking the Type header groups by kind.
 *   5. Free-text search — filters on key AND on details, updates the caption.
 *   6. Status filter — the <select> narrows to enabled / disabled rows.
 *   7. Loading — a skeleton, never a blank panel and never a table.
 *   8. Error — QueryError alert + a working Retry that re-fires onRetry.
 *   9. Empty — the "no data yet" empty state, no table.
 *  10. Null-safety — null details render an em-dash, and an undefined `entries`
 *      prop degrades to the empty state instead of throwing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Deterministic i18n: `t(key, default, opts)` returns the default string with
// any `{{token}}` interpolated, so assertions never depend on the shipped
// translation catalogue.
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

import { FeatureConfigTable } from './FeatureConfigTable';
import type { FeatureFlagEntry } from './parseFeatureFlags';

function makeEntry(over: Partial<FeatureFlagEntry> & { key: string }): FeatureFlagEntry {
  return {
    key: over.key,
    enabled: over.enabled ?? false,
    details: over.details ?? null,
    kind: over.kind ?? 'flag',
  };
}

// Four rows chosen so key-order, status-order and type-order are all distinct:
//   alpha   enabled  flag        (no details)
//   bravo   disabled configured  details "level"
//   charlie enabled  configured  details "count"
//   delta   disabled flag        (no details)
const alpha = makeEntry({ key: 'alpha', enabled: true, kind: 'flag', details: null });
const bravo = makeEntry({ key: 'bravo', enabled: false, kind: 'configured', details: 'level: "high"' });
const charlie = makeEntry({ key: 'charlie', enabled: true, kind: 'configured', details: 'count: 3' });
const delta = makeEntry({ key: 'delta', enabled: false, kind: 'flag', details: null });

// Deliberately unsorted input so a passing default-sort proves the component
// reorders rather than relying on the caller's ordering.
const ALL = [charlie, alpha, delta, bravo];

interface Props {
  entries?: FeatureFlagEntry[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderTable(props: Props = {}) {
  const onRetry = props.onRetry ?? vi.fn();
  const entries = 'entries' in props ? props.entries : ALL;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <FeatureConfigTable
          entries={entries as FeatureFlagEntry[]}
          isLoading={props.isLoading ?? false}
          error={props.error ?? null}
          onRetry={onRetry}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

/** Feature keys in DOM (render) order — the key column is the only <code>. */
function keyOrder(): string[] {
  return Array.from(document.querySelectorAll('tbody td code')).map((el) => el.textContent ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('FeatureConfigTable — rendering', () => {
  it('renders the heading, the showing-count caption, and every column for each row', () => {
    renderTable();

    // Panel heading (i18n default).
    expect(screen.getByRole('heading', { name: 'Feature Flags' })).toBeInTheDocument();
    // "Showing N of M" caption reflects the full, unfiltered set.
    expect(screen.getByText('Showing 4 of 4')).toBeInTheDocument();

    const table = screen.getByRole('table');
    // Feature key column renders one <code> per row.
    expect(keyOrder()).toEqual(['alpha', 'bravo', 'charlie', 'delta']);

    // Type badges — two boolean flags (alpha, delta), two configured (bravo, charlie).
    expect(within(table).getAllByText('Boolean flags')).toHaveLength(2);
    expect(within(table).getAllByText('Configured')).toHaveLength(2);

    // Status badges — two enabled (alpha, charlie), two disabled (bravo, delta).
    expect(within(table).getAllByText('Enabled')).toHaveLength(2);
    expect(within(table).getAllByText('Disabled')).toHaveLength(2);

    // Details column: configured rows show their summary text.
    expect(within(table).getByText('level: "high"')).toBeInTheDocument();
    expect(within(table).getByText('count: 3')).toBeInTheDocument();
  });
});

describe('FeatureConfigTable — sorting (the bug this fix closes)', () => {
  it('defaults to key ascending and advertises aria-sort on the Feature header', () => {
    renderTable();

    expect(keyOrder()).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    const featureHeader = screen.getByRole('button', { name: 'Feature' }).closest('th');
    expect(featureHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sorts by status (enabled first) on the first Status click, then toggles to disabled first', () => {
    renderTable();

    // First click on a new column → descending → enabled rows first, each group
    // still key-ascending via the tiebreak: alpha, charlie (on), bravo, delta (off).
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(keyOrder()).toEqual(['alpha', 'charlie', 'bravo', 'delta']);
    expect(screen.getByRole('button', { name: 'Status' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    // The previously-active Feature column drops back to the neutral
    // `aria-sort="none"` that marks it sortable-but-inactive.
    expect(screen.getByRole('button', { name: 'Feature' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'none',
    );

    // Second click on the same column → ascending → disabled first.
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(keyOrder()).toEqual(['bravo', 'delta', 'alpha', 'charlie']);
    expect(screen.getByRole('button', { name: 'Status' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('groups rows by type when the Type header is clicked', () => {
    renderTable();

    // First click → descending kind → flag group first (alpha, delta), then
    // configured (bravo, charlie); each group key-ascending.
    fireEvent.click(screen.getByRole('button', { name: 'Type' }));
    expect(keyOrder()).toEqual(['alpha', 'delta', 'bravo', 'charlie']);
    expect(screen.getByRole('button', { name: 'Type' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });
});

describe('FeatureConfigTable — search + status filter', () => {
  it('filters on the feature key and updates the showing-count caption', () => {
    renderTable();

    const searchbox = screen.getByRole('searchbox', { name: 'Search features' });
    fireEvent.change(searchbox, { target: { value: 'charlie' } });

    expect(keyOrder()).toEqual(['charlie']);
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
  });

  it('also matches against the details text, not just the key', () => {
    renderTable();

    // "high" only appears in bravo's details summary, never in a key.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search features' }), {
      target: { value: 'high' },
    });

    expect(keyOrder()).toEqual(['bravo']);
  });

  it('shows the table empty message when the search matches nothing', () => {
    renderTable();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search features' }), {
      target: { value: 'no-such-feature' },
    });

    expect(keyOrder()).toEqual([]);
    expect(screen.getByText('No features match your filters.')).toBeInTheDocument();
  });

  it('narrows to enabled or disabled rows via the status filter select', () => {
    renderTable();

    const select = screen.getByRole('combobox', { name: 'Filter by status' });

    fireEvent.change(select, { target: { value: 'enabled' } });
    expect(keyOrder()).toEqual(['alpha', 'charlie']);
    expect(screen.getByText('Showing 2 of 4')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'disabled' } });
    expect(keyOrder()).toEqual(['bravo', 'delta']);
  });
});

describe('FeatureConfigTable — loading / error / empty / null-safety', () => {
  it('renders a skeleton (never a table or blank panel) while loading', () => {
    renderTable({ entries: [], isLoading: true });

    // Heading stays mounted; the body is the table skeleton placeholder.
    expect(screen.getByRole('heading', { name: 'Feature Flags' })).toBeInTheDocument();
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('surfaces a QueryError alert with a Retry that re-fires onRetry', () => {
    const onRetry = vi.fn();
    renderTable({ entries: [], error: new Error('boom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // No table and no search controls while the query is errored.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state (not a table) when there are no entries', () => {
    renderTable({ entries: [] });

    expect(
      screen.getByText('No feature config data yet. Click Refresh to fetch from Tesla.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    // The showing-count caption is suppressed when there is nothing to count.
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('renders an em-dash for rows without details', () => {
    renderTable({ entries: [alpha, delta] });

    const table = screen.getByRole('table');
    // Both flag rows have null details → two em-dash placeholders.
    expect(within(table).getAllByText('—')).toHaveLength(2);
  });

  it('degrades to the empty state instead of throwing when entries is undefined', () => {
    // Defensive: the parent always passes an array, but the null-guard must
    // hold if an undefined slips through (types cast away deliberately).
    expect(() =>
      renderTable({ entries: undefined as unknown as FeatureFlagEntry[] }),
    ).not.toThrow();
    expect(
      screen.getByText('No feature config data yet. Click Refresh to fetch from Tesla.'),
    ).toBeInTheDocument();
  });
});
