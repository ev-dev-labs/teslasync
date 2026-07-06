/**
 * VehicleCostTable — per-vehicle ingest-cost breakdown table.
 *
 * The sole export is a presentational, prop-driven section that owns its own
 * loading / empty / error rendering (it is wrapped in a SectionErrorBoundary so
 * a table crash never blanks the KPI band above it). The facets pinned here,
 * block by block:
 *
 *   chrome     — the "Per-vehicle breakdown" panel title always renders,
 *                regardless of async state, so the section never collapses.
 *   table      — one <tr> per vehicle, all six columns, every cell formatted
 *                through the shared number/byte/date helpers (rows, bytes, rate,
 *                DLQ, last-seen) using the exact strings the component emits.
 *   vehicle id — the ID sub-label is an *identifier*: it must render as a whole
 *                number ("ID 42"), never inheriting the user's decimal-precision
 *                setting ("ID 42.00"), and it flows through an i18n key.
 *   name       — a missing / blank display_name falls back to "Vehicle #{id}".
 *   DLQ column — a positive failure count is tinted amber; zero (and a missing
 *                count coerced to zero via `?? 0`) stays the muted secondary hue.
 *   states     — loading→skeleton (only while empty), loading-with-data keeps
 *                the table, empty→EmptyState, error→QueryError (error wins over
 *                data) with a working Retry wired to onRetry.
 *   null-safe  — an undefined `vehicles` prop degrades to the empty state and
 *                never throws on `.length`.
 *
 * react-i18next is stubbed to echo each call's default string (interpolating
 * `{{…}}`) so assertions match the shipped English copy without booting the real
 * backend. Network is never touched. Renders are wrapped in MemoryRouter because
 * QueryError calls useNavigate() (and EmptyState imports Link).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

// jsdom lacks matchMedia; guard against any transitive reader at module load.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
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

// i18n → echo the developer fallback string, interpolating `{{vars}}` from
// either the 3rd `opts` arg or a 2nd-arg options object (mirrors the sibling
// VehicleCostPage.test.tsx convention). Every other real export is preserved
// for transitive importers (SectionErrorBoundary, QueryError, DataTable, …).
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

import { VehicleCostTable } from './VehicleCostTable';
import { ApiError } from '@/lib/resilience';
import { fmtNumber, fmtInt, formatBytes } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';

afterEach(() => cleanup());

type Props = ComponentProps<typeof VehicleCostTable>;

function makeRow(overrides: Partial<VehicleCostRow> = {}): VehicleCostRow {
  return {
    vehicle_id: 1,
    display_name: 'Test Vehicle',
    signal_row_count: 100,
    signal_bytes_est: 1024,
    ingest_rate_per_minute_24h: 2,
    dlq_failures_24h: 0,
    last_seen_at: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderTable(overrides: Partial<Props> = {}) {
  const onRetry = vi.fn();
  const props: Props = {
    vehicles: [],
    loading: false,
    error: null,
    onRetry,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <VehicleCostTable {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

/** Data rows only (drop the header row). */
function dataRowCount(): number {
  return screen.getAllByRole('row').length - 1;
}

const PANEL_TITLE = { level: 3 as const, name: 'Per-vehicle breakdown' };

describe('VehicleCostTable — chrome', () => {
  it('always renders the "Per-vehicle breakdown" panel title, both with data and when empty', () => {
    renderTable({ vehicles: [makeRow()] });
    expect(screen.getByRole('heading', PANEL_TITLE)).toBeInTheDocument();
    cleanup();

    renderTable({ vehicles: [] });
    expect(screen.getByRole('heading', PANEL_TITLE)).toBeInTheDocument();
  });
});

describe('VehicleCostTable — table rendering', () => {
  const rowA = makeRow({
    vehicle_id: 42,
    display_name: 'Model 3 Perf',
    signal_row_count: 9000,
    signal_bytes_est: 2048,
    ingest_rate_per_minute_24h: 1.2,
    dlq_failures_24h: 5,
    last_seen_at: '2020-06-15T12:00:00Z',
  });
  const rowB = makeRow({
    vehicle_id: 7,
    display_name: 'Cybertruck',
    signal_row_count: 15000,
    signal_bytes_est: 1_048_576,
    ingest_rate_per_minute_24h: 3.4,
    dlq_failures_24h: 0,
    last_seen_at: '2021-03-10T08:00:00Z',
  });

  it('renders the six sortable columns as accessible column headers', () => {
    renderTable({ vehicles: [rowA] });
    expect(screen.getByRole('table')).toBeInTheDocument();
    for (const name of [
      'Vehicle',
      'Rows',
      'Bytes (est.)',
      'Rate (rows/min, 24h)',
      'DLQ (24h)',
      'Last seen',
    ]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('renders one row per vehicle with every cell formatted through the shared helpers', () => {
    renderTable({ vehicles: [rowA, rowB] });

    // One data row per vehicle (header row excluded).
    expect(dataRowCount()).toBe(2);

    // Names + whole-number ID sub-labels.
    expect(screen.getByText('Model 3 Perf')).toBeInTheDocument();
    expect(screen.getByText('Cybertruck')).toBeInTheDocument();
    expect(screen.getByText('ID 42')).toBeInTheDocument();
    expect(screen.getByText('ID 7')).toBeInTheDocument();

    // Rows / bytes / rate / last-seen — computed with the exact helpers the
    // component uses, so the assertions stay locale/precision agnostic.
    expect(screen.getByText(fmtNumber(9000))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(15000))).toBeInTheDocument();
    expect(screen.getByText(formatBytes(2048))).toBeInTheDocument();
    expect(screen.getByText(formatBytes(1_048_576))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(1.2, 1))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(3.4, 1))).toBeInTheDocument();
    expect(screen.getByText(formatRelative('2020-06-15T12:00:00Z'))).toBeInTheDocument();
    expect(screen.getByText(formatRelative('2021-03-10T08:00:00Z'))).toBeInTheDocument();
  });

  it('falls back to "Vehicle #{id}" when display_name is null or blank', () => {
    renderTable({
      vehicles: [
        makeRow({ vehicle_id: 7, display_name: null }),
        makeRow({ vehicle_id: 8, display_name: '   ' }),
      ],
    });
    expect(screen.getByText('Vehicle #7')).toBeInTheDocument();
    expect(screen.getByText('Vehicle #8')).toBeInTheDocument();
  });
});

describe('VehicleCostTable — DLQ failures column', () => {
  // Row values are chosen so the failures string ("5.00" / "0.00") is unique in
  // the row, letting getByText resolve the exact <Text> cell it styles.
  const base = { signal_row_count: 100, ingest_rate_per_minute_24h: 2, signal_bytes_est: 4096 };

  it('tints a positive DLQ failure count amber', () => {
    renderTable({ vehicles: [makeRow({ ...base, dlq_failures_24h: 5 })] });
    const cell = screen.getByText(fmtNumber(5)); // "5.00"
    expect(cell).toHaveClass('text-amber-300');
    expect(cell).toHaveClass('tabular-nums');
  });

  it('keeps a zero DLQ count in the muted secondary colour, never amber', () => {
    renderTable({ vehicles: [makeRow({ ...base, dlq_failures_24h: 0 })] });
    const cell = screen.getByText(fmtNumber(0)); // "0.00"
    expect(cell).toHaveClass('text-[var(--text-secondary)]');
    expect(cell).not.toHaveClass('text-amber-300');
  });

  it('coerces a missing DLQ count to zero (never NaN) and leaves it un-tinted', () => {
    renderTable({
      vehicles: [makeRow({ ...base, dlq_failures_24h: undefined as unknown as number })],
    });
    const cell = screen.getByText(fmtNumber(0)); // "0.00" via `?? 0`
    expect(cell).toBeInTheDocument();
    expect(cell).not.toHaveClass('text-amber-300');
  });
});

describe('VehicleCostTable — async states', () => {
  it('shows a skeleton (and no table / empty state) while the first fetch loads with no rows', () => {
    const { container } = renderTable({ loading: true, vehicles: [] });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicle cost data')).not.toBeInTheDocument();
    // The title still anchors the section even mid-load.
    expect(screen.getByRole('heading', PANEL_TITLE)).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('keeps the table visible during a background refetch (loading with existing rows)', () => {
    const { container } = renderTable({ loading: true, vehicles: [makeRow()] });
    expect(screen.getByRole('table')).toBeInTheDocument();
    // Not the skeleton branch — data stays on screen so the panel never flickers.
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('renders an EmptyState (not a skeleton) when settled with zero rows', () => {
    renderTable({ vehicles: [], loading: false });
    expect(screen.getByText('No vehicle cost data')).toBeInTheDocument();
    expect(
      screen.getByText('No vehicles have ingested signals during this window.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('VehicleCostTable — error handling', () => {
  it('renders QueryError over any data and wires Retry to onRetry on a 5xx', () => {
    const error = new ApiError('boom', 500);
    const { onRetry } = renderTable({
      error,
      vehicles: [makeRow()], // present, but the error branch must win
      loading: false,
    });

    expect(screen.getByText('Server error')).toBeInTheDocument();
    // Error takes priority — the table is not rendered even though rows exist.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('VehicleCostTable — null safety & id formatting', () => {
  it('degrades an undefined vehicles prop to the empty state without throwing', () => {
    expect(() =>
      renderTable({ vehicles: undefined as unknown as VehicleCostRow[] }),
    ).not.toThrow();
    expect(screen.getByText('No vehicle cost data')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('formats the vehicle id as a whole-number identifier, never with decimal precision', () => {
    renderTable({ vehicles: [makeRow({ vehicle_id: 42 })] });
    expect(screen.getByText('ID 42')).toBeInTheDocument();
    // Regression guard: an id must not inherit the user's decimal-precision
    // setting — fmtInt pins integer output where fmtNumber would emit "42.00".
    expect(screen.queryByText('ID 42.00')).not.toBeInTheDocument();
    expect(fmtInt(42)).toBe('42');
  });
});
