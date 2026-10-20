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
 *   DLQ column — a positive failure count is tinted amber; zero and unknown
 *                readings stay the muted secondary hue with distinct labels.
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
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

const datePreferences = vi.hoisted(() => ({
  locale: 'en-US',
  tz: undefined as string | undefined,
}));

vi.mock('@/hooks/useDateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return {
    useDateFormat: () => ({
      formatRelative: (value: string | Date | null | undefined) =>
        actual.formatRelative(value, datePreferences),
    }),
  };
});

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

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];

beforeEach(() => {
  localStorage.clear();
  datePreferences.locale = 'en-US';
  datePreferences.tz = undefined;
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}

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
    expect(screen.getByText(fmtInt(9000))).toBeInTheDocument();
    expect(screen.getByText(fmtInt(15000))).toBeInTheDocument();
    expect(screen.getByText(formatBytes(2048))).toBeInTheDocument();
    expect(screen.getByText(formatBytes(1_048_576))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(1.2))).toBeInTheDocument();
    expect(screen.getByText(fmtNumber(3.4))).toBeInTheDocument();
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

describe('VehicleCostTable — locale-aware last seen', () => {
  it('updates relative labels after a locale change on desktop and in mobile details', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-04T12:00:00Z'));
    const user = userEvent.setup();
    const vehicles = [makeRow({ last_seen_at: '2026-07-04T10:00:00Z' })];
    const { rerender } = renderTable({ vehicles });
    expect(screen.getByText(formatRelative(vehicles[0].last_seen_at, datePreferences))).toBeInTheDocument();

    datePreferences.locale = 'de-DE';
    rerender(
      <MemoryRouter>
        <VehicleCostTable vehicles={vehicles} loading={false} error={null} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    const expected = new Intl.RelativeTimeFormat('de-DE', { style: 'narrow', numeric: 'always' })
      .format(-2, 'hour');
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText('2h ago')).not.toBeInTheDocument();

    resize(375);
    expect(screen.getByText(expected)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(within(screen.getByRole('dialog')).getByText(expected)).toBeInTheDocument();
  });

  it('formats old timestamps in the selected locale and zone without changing their instant', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-04T12:00:00Z'));
    datePreferences.locale = 'de-DE';
    datePreferences.tz = 'America/Los_Angeles';
    const instant = '2020-01-01T00:30:00Z';
    const vehicles = [
      makeRow({ last_seen_at: instant }),
      makeRow({ vehicle_id: 2, last_seen_at: '2019-12-31T16:30:00-08:00' }),
    ];
    const { rerender } = renderTable({ vehicles });
    const expected = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(instant));
    expect(screen.getAllByText(expected)).toHaveLength(2);

    datePreferences.tz = 'UTC';
    rerender(
      <MemoryRouter>
        <VehicleCostTable vehicles={vehicles} loading={false} error={null} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    const utcExpected = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(instant));
    expect(utcExpected).not.toBe(expected);
    expect(screen.getAllByText(utcExpected)).toHaveLength(2);
  });

  it.each([null, undefined, '', 'not-a-date'])('keeps last-seen %s unknown on desktop and mobile', async (value) => {
    const user = userEvent.setup();
    const row = makeRow();
    Object.assign(row, { last_seen_at: value });
    renderTable({ vehicles: [row] });
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[5]).toHaveTextContent('—');
    resize(375);
    expect(screen.getByText('—')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(within(screen.getByRole('dialog')).getByText('—')).toBeInTheDocument();
  });
});

describe('VehicleCostTable — DLQ failures column', () => {
  // Row values are chosen so the failure count ("5" / "0") is unique in
  // the row, letting getByText resolve the exact <Text> cell it styles.
  const base = { signal_row_count: 100, ingest_rate_per_minute_24h: 2, signal_bytes_est: 4096 };

  it('tints a positive DLQ failure count amber', () => {
    renderTable({ vehicles: [makeRow({ ...base, dlq_failures_24h: 5 })] });
    const cell = screen.getByText(fmtInt(5)); // discrete DLQ count
    expect(cell).toHaveClass('text-[var(--semantic-warning)]');
    expect(cell).toHaveClass('tabular-nums');
  });

  it('keeps a zero DLQ count in the muted secondary colour, never amber', () => {
    renderTable({ vehicles: [makeRow({ ...base, dlq_failures_24h: 0 })] });
    const cell = screen.getByText(fmtInt(0)); // discrete DLQ count
    expect(cell).toHaveClass('text-[var(--text-secondary)]');
    expect(cell).not.toHaveClass('text-[var(--semantic-warning)]');
  });

  it('displays a missing DLQ count as unknown and leaves it un-tinted', () => {
    renderTable({
      vehicles: [makeRow({ ...base, dlq_failures_24h: undefined as unknown as number })],
    });
    const cell = screen.getByText('—');
    expect(cell).toBeInTheDocument();
    expect(cell).not.toHaveClass('text-[var(--semantic-warning)]');
  });
});

describe('VehicleCostTable — unknown readings', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity])(
    'renders %s readings as unknown without discarding the vehicle',
    (value) => {
      const row = makeRow();
      Object.assign(row, {
        signal_row_count: value,
        signal_bytes_est: value,
        ingest_rate_per_minute_24h: value,
        dlq_failures_24h: value,
      });
      renderTable({ vehicles: [row] });
      expect(dataRowCount()).toBe(1);
      const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
      expect(cells.slice(1, 5).map(cell => cell.textContent)).toEqual(['—', '—', '—', '—']);
    },
  );

  it.each([0, -12, 0.25, -0.25])('formats measured value %s using the existing display precision', (value) => {
    renderTable({ vehicles: [makeRow({
      signal_row_count: value,
      signal_bytes_est: value,
      ingest_rate_per_minute_24h: value,
      dlq_failures_24h: value,
    })] });
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells.slice(1, 5).map(cell => cell.textContent)).toEqual([
      fmtInt(value), formatBytes(value), fmtNumber(value), fmtInt(value),
    ]);
  });
});

describe('VehicleCostTable — async states', () => {
  it('shows a skeleton (and no table / empty state) while the first fetch loads with no rows', () => {
    const { container } = renderTable({ loading: true, vehicles: [] });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No vehicle cost data')).not.toBeInTheDocument();
    // The title still anchors the section even mid-load.
    expect(screen.getByRole('heading', PANEL_TITLE)).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"][style="height: 240px;"]')).not.toBeNull();
  });

  it('keeps the table visible during a background refetch (loading with existing rows)', () => {
    const { container } = renderTable({ loading: true, vehicles: [makeRow()] });
    expect(screen.getByRole('table')).toBeInTheDocument();
    // Not the skeleton branch — data stays on screen so the panel never flickers.
    expect(container.querySelector('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]')).toBeNull();
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

  describe('VehicleCostTable — lossless mobile presentation', () => {
    it('keeps source order and exposes all six fields and row IDs through keyboard-operated details', async () => {
      const user = userEvent.setup();
      const first = makeRow({ vehicle_id: 42, display_name: 'First vehicle', dlq_failures_24h: 5 });
      const second = makeRow({ vehicle_id: 7, display_name: 'Second vehicle' });
      const { container } = renderTable({ vehicles: [first, second] });
      resize(375);

      const mobile = container.querySelector('[data-mobile-table]');
      expect(mobile).not.toBeNull();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      const quickViews = screen.getAllByRole('button', { name: 'Quick view' });
      expect(quickViews).toHaveLength(2);
      quickViews[0].focus();
      await user.keyboard('{Enter}');

      const dialog = screen.getByRole('dialog', { name: 'First vehicle' });
      for (const label of ['Vehicle', 'Rows', 'Bytes (est.)', 'Rate (rows/min, 24h)', 'DLQ (24h)', 'Last seen']) {
        expect(within(dialog).getByText(label)).toBeInTheDocument();
      }
      for (const value of ['ID 42', fmtInt(100), formatBytes(1024), fmtNumber(2), fmtInt(5), formatRelative(first.last_seen_at)]) {
        expect(within(dialog).getByText(value)).toBeInTheDocument();
      }
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(quickViews[0]).toHaveFocus();
      quickViews[1].focus();
      await user.keyboard(' ');
      expect(screen.getByRole('dialog', { name: 'Second vehicle' })).toHaveTextContent('ID 7');
      await user.click(screen.getAllByRole('button', { name: 'Close', exact: true }).at(-1)!);

      resize(1280);
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.map(row => within(row).getByText(/ID \d+/).textContent)).toEqual(['ID 42', 'ID 7']);
      expect(rows[0].querySelectorAll('td')).toHaveLength(6);
    });

    it('retains persisted hidden fields in mobile details without rewriting column preferences', async () => {
      const user = userEvent.setup();
      const key = 'teslasync.table.admin:vehicle-cost.columns';
      const preference = JSON.stringify({ order: ['vehicle', 'last', 'failures', 'rate', 'bytes', 'rows'], hidden: ['rate', 'bytes'], widths: {} });
      localStorage.setItem(key, preference);
      renderTable({ vehicles: [makeRow()] });
      resize(375);
      await user.click(screen.getByRole('button', { name: 'Quick view' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Bytes (est.)')).toBeInTheDocument();
      expect(within(dialog).getByText('Rate (rows/min, 24h)')).toBeInTheDocument();
      expect(localStorage.getItem(key)).toBe(preference);
    });
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
