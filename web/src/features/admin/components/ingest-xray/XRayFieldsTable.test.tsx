/**
 * XRayFieldsTable — behaviour + contract tests.
 *
 * XRayFieldsTable is a prop-driven table: it owns the *sort derivation* over
 * the per-field stats and the *column contract* it hands to the shared
 * <DataTable>. The behaviour that matters (and that we lock in here):
 *
 *   1. Sorting — the default order (sample_count desc), plus every sortable
 *      column, driven through the REAL `useSortToggle` so clicking a header
 *      re-runs the component's comparator and toggles asc/desc.
 *   2. State branches — the empty message flips between the "loading…" copy
 *      and the actionable "no samples" guidance, and an accidental
 *      `undefined` rows list degrades to the empty state instead of throwing.
 *   3. Cell contract — field (mono <Text>), sample_count (locale-grouped via
 *      fmtInt), last_seen_at (handed to <TimeStamp> as `relative`), and
 *      value_kind (label via formatValueKind in a <Badge>).
 *   4. Null-safety / hardening — a missing field renders "—" (never a blank
 *      mono cell), a missing/blank value_kind reads "unknown" (not
 *      "kind undefined"), an unparseable `last_seen_at` sorts deterministically
 *      as the oldest row instead of poisoning the comparator with NaN.
 *
 * <DataTable> is stubbed to a prop-capturing element so the assertions are on
 * XRayFieldsTable's OWN output (sorted row order, empty message, per-column
 * render) without dragging in DataTable's virtualization / pagination / column
 * menu internals — it has its own tests. The REAL `useSortToggle`, `Text`, and
 * `Badge` come through via `importActual`, so the sort toggle and the cell
 * primitives are exercised for real. <TimeStamp> is stubbed to a value-capturing
 * span because its date-format hooks reach a react-query `useSettings` that
 * would need a QueryClient. react-i18next is stubbed to return the English
 * fallback so the copy we assert on is decoupled from the locale bundle.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { IngestXRayFieldStat } from '@/types/admin-diagnostics';

// ── i18n: return the English fallback (2nd arg) for every t() call ───────────
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ── <TimeStamp>: value-capturing span (avoids the react-query date hooks) ────
vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value, format }: { value: unknown; format?: string }) => (
    <span
      data-testid="timestamp"
      data-value={value == null ? '' : String(value)}
      data-format={format ?? ''}
    />
  ),
}));

// ── <DataTable>: prop-capturing double. Keeps the REAL useSortToggle / Text /
// Badge from the barrel so the sort toggle + cell primitives run for real. ───
interface StubColumn {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: IngestXRayFieldStat) => ReactNode;
}
interface StubProps {
  data: IngestXRayFieldStat[];
  columns: StubColumn[];
  keyExtractor: (row: IngestXRayFieldStat) => string | number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
}

vi.mock('@/components/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@/components/ui')>('@/components/ui');
  const DataTable = ({
    data,
    columns,
    keyExtractor,
    sortKey,
    sortDir,
    onSort,
    emptyMessage,
  }: StubProps) => (
    <div data-testid="datatable">
      <div data-testid="sort-state" data-key={sortKey} data-dir={sortDir} />
      <div>
        {columns
          .filter((c) => c.sortable)
          .map((c) => (
            <button
              key={c.key}
              type="button"
              data-testid={`sort-${c.key}`}
              onClick={() => onSort?.(c.key)}
            >
              {c.header}
            </button>
          ))}
      </div>
      {data.length === 0 ? (
        <div data-testid="empty">{emptyMessage}</div>
      ) : (
        <ul>
          {data.map((row) => (
            <li
              key={keyExtractor(row)}
              data-testid="xray-row"
              data-key={String(keyExtractor(row))}
            >
              {columns.map((c) => (
                <span key={c.key} data-testid={`cell-${c.key}`}>
                  {c.render(row)}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return { ...actual, DataTable };
});

import { XRayFieldsTable } from './XRayFieldsTable';

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Distinct sample_count / last_seen_at / value_kind so every sort key produces
// an unambiguous, mutually-distinguishable order.
const ALPHA: IngestXRayFieldStat = {
  field: 'alpha',
  sample_count: 100,
  last_seen_at: '2026-07-03T21:00:00.000Z',
  value_kind: 6, // float64
};
const BRAVO: IngestXRayFieldStat = {
  field: 'bravo',
  sample_count: 300,
  last_seen_at: '2026-07-03T23:00:00.000Z',
  value_kind: 1, // string
};
const CHARLIE: IngestXRayFieldStat = {
  field: 'charlie',
  sample_count: 200,
  last_seen_at: '2026-07-03T22:00:00.000Z',
  value_kind: 3, // int32
};

const THREE = [ALPHA, BRAVO, CHARLIE];

function renderTable(
  rows: IngestXRayFieldStat[] | undefined = THREE,
  loading = false,
) {
  return render(
    <XRayFieldsTable
      rows={rows as IngestXRayFieldStat[]}
      loading={loading}
    />,
  );
}

/** Row keys (= field) in current DOM order. */
function rowOrder(): (string | null)[] {
  return screen.getAllByTestId('xray-row').map((r) => r.getAttribute('data-key'));
}

function sortState() {
  const el = screen.getByTestId('sort-state');
  return { key: el.getAttribute('data-key'), dir: el.getAttribute('data-dir') };
}

// ── Sorting ──────────────────────────────────────────────────────────────────

describe('XRayFieldsTable — sorting', () => {
  it('defaults to sample_count descending (loudest field first)', () => {
    renderTable();

    expect(sortState()).toEqual({ key: 'sample_count', dir: 'desc' });
    expect(rowOrder()).toEqual(['bravo', 'charlie', 'alpha']);
  });

  it('sorts alphabetically and toggles asc/desc when the field header is clicked', () => {
    renderTable();

    // First click on a new key selects it descending (Z→A).
    fireEvent.click(screen.getByTestId('sort-field'));
    expect(sortState()).toEqual({ key: 'field', dir: 'desc' });
    expect(rowOrder()).toEqual(['charlie', 'bravo', 'alpha']);

    // Second click on the same key toggles to ascending (A→Z).
    fireEvent.click(screen.getByTestId('sort-field'));
    expect(sortState()).toEqual({ key: 'field', dir: 'asc' });
    expect(rowOrder()).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('sorts by recency (most recent first) on the last-seen column', () => {
    renderTable();

    fireEvent.click(screen.getByTestId('sort-last_seen_at'));
    expect(sortState().key).toBe('last_seen_at');
    // 23:00 > 22:00 > 21:00
    expect(rowOrder()).toEqual(['bravo', 'charlie', 'alpha']);
  });

  it('sorts by value_kind independently of sample_count', () => {
    renderTable();

    fireEvent.click(screen.getByTestId('sort-value_kind'));
    // kinds desc: 6 (alpha) > 3 (charlie) > 1 (bravo)
    expect(rowOrder()).toEqual(['alpha', 'charlie', 'bravo']);
  });
});

// ── State branches ───────────────────────────────────────────────────────────

describe('XRayFieldsTable — empty & loading states', () => {
  it('shows the "loading…" copy while loading with no rows yet', () => {
    renderTable([], true);

    const empty = screen.getByTestId('empty');
    expect(empty).toHaveTextContent('Loading…');
    expect(screen.queryAllByTestId('xray-row')).toHaveLength(0);
  });

  it('shows the actionable empty guidance once loaded with zero rows', () => {
    renderTable([], false);

    expect(screen.getByTestId('empty')).toHaveTextContent(
      /No samples in this window/i,
    );
  });

  it('degrades to the empty state (no throw) when rows is undefined', () => {
    // Render `undefined` directly — routing it through renderTable()'s default
    // parameter would silently substitute the fixture and defeat the guard.
    const doRender = () =>
      render(
        <XRayFieldsTable
          rows={undefined as unknown as IngestXRayFieldStat[]}
          loading={false}
        />,
      );
    expect(doRender).not.toThrow();

    expect(screen.getByTestId('empty')).toHaveTextContent(
      /No samples in this window/i,
    );
    expect(screen.queryAllByTestId('xray-row')).toHaveLength(0);
  });
});

// ── Cell contract ────────────────────────────────────────────────────────────

describe('XRayFieldsTable — cell contract', () => {
  it('exposes exactly the four sortable columns', () => {
    renderTable();

    expect(screen.getByTestId('sort-field')).toBeInTheDocument();
    expect(screen.getByTestId('sort-sample_count')).toBeInTheDocument();
    expect(screen.getByTestId('sort-last_seen_at')).toBeInTheDocument();
    expect(screen.getByTestId('sort-value_kind')).toBeInTheDocument();
  });

  it('renders field, locale-grouped sample count, kind label and the timestamp value per row', () => {
    renderTable([BRAVO]);

    const row = screen.getByTestId('xray-row');

    // field → mono <Text>
    expect(within(row).getByTestId('cell-field')).toHaveTextContent('bravo');
    // sample_count 300 → fmtInt → thousands separator absent below 1,000; use a
    // bigger number to prove grouping is applied.
    expect(within(row).getByTestId('cell-sample_count')).toHaveTextContent('300');
    // value_kind 1 → "string" via formatValueKind in a <Badge>
    expect(within(row).getByTestId('cell-value_kind')).toHaveTextContent('string');
    // last_seen_at is forwarded to <TimeStamp> verbatim with format="relative".
    const ts = within(row).getByTestId('timestamp');
    expect(ts).toHaveAttribute('data-value', BRAVO.last_seen_at);
    expect(ts).toHaveAttribute('data-format', 'relative');
  });

  it('formats large sample counts with locale grouping', () => {
    renderTable([{ ...BRAVO, sample_count: 1234567 }]);

    expect(screen.getByTestId('cell-sample_count')).toHaveTextContent('1,234,567');
  });
});

// ── Null-safety / hardening ──────────────────────────────────────────────────

describe('XRayFieldsTable — null-safety & hardening', () => {
  it('renders an em-dash for a missing field instead of a blank cell', () => {
    const holed = { ...ALPHA, field: undefined } as unknown as IngestXRayFieldStat;
    renderTable([holed]);

    expect(screen.getByTestId('cell-field')).toHaveTextContent('—');
  });

  it('reads a missing value_kind as "unknown" and an unmapped kind as "kind N"', () => {
    const missing = {
      ...ALPHA,
      field: 'no-kind',
      value_kind: undefined,
    } as unknown as IngestXRayFieldStat;
    const exotic = { ...BRAVO, field: 'weird', value_kind: 99 };

    renderTable([missing, exotic]);

    const cells = screen
      .getAllByTestId('cell-value_kind')
      .map((c) => c.textContent);
    expect(cells).toContain('unknown'); // value_kind 0 fallback
    expect(cells).toContain('kind 99'); // unmapped enum surfaces raw
  });

  it('sorts an unparseable last_seen_at as the oldest row without NaN chaos', () => {
    const good = { ...ALPHA, field: 'good', last_seen_at: '2026-07-03T23:00:00.000Z' };
    const broken = {
      ...BRAVO,
      field: 'broken',
      last_seen_at: 'not-a-date',
    };

    renderTable([broken, good]);

    // Descending by recency: the parseable (newest) row leads, the unparseable
    // one collapses to epoch 0 and sinks to the bottom — deterministically.
    fireEvent.click(screen.getByTestId('sort-last_seen_at'));
    expect(rowOrder()).toEqual(['good', 'broken']);
  });

  it('coalesces a missing sample_count to 0 in the rendered cell', () => {
    const holed = {
      ...ALPHA,
      field: 'no-samples',
      sample_count: undefined,
    } as unknown as IngestXRayFieldStat;

    renderTable([holed]);

    expect(screen.getByTestId('cell-sample_count')).toHaveTextContent('0');
  });
});
