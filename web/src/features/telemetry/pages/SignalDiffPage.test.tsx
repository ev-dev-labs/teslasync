/**
 * SignalDiffPage — behaviour + hardening coverage.
 *
 * The page default-exports the compare-diff orchestrator plus two pure helpers
 * that are unit-tested directly:
 *   - `toNum`      — coerce an arbitrary signal value to a finite number/null.
 *   - `formatSpan` — compact human window span ("45s", "1m 5s", "1h 5m").
 *
 * Page render coverage: READY (every KPI card + the derived counts, both child
 * bands, the diff-table band), LOADING (KPI diff cards read "—", table band
 * shows skeletons, no table stub leaks), ERROR (regression: the KPI band used
 * to report a misleading "0 changed / 0 numeric" on a failed diff — it now reads
 * "—" while pinned + window-span stay live, and the table band degrades to a
 * QueryError whose Retry refetches), EMPTY (a valid diff with no changes shows
 * the page EmptyState, not the table), FILTER (search + category chips shrink
 * the visible/derived counts), BULK (selection surfaces the toolbar and wires
 * CSV export, alert-rule navigation, and pin — pinning only the not-yet-pinned
 * rows), VEHICLE (the local picker re-drives the diff hook), and a11y (KPI
 * landmark, labelled vehicle picker, page heading).
 *
 * Network is never hit: every data hook and the two heavy child bands are
 * stubbed; framer-motion is stubbed so FadeIn renders eagerly; i18n is stubbed
 * so visible copy is the English fallback with {{placeholder}} interpolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback/Toast';
import { downloadCSV, objectsToCSV } from '@/lib/csvExport';
import type { SignalDiffRow, SignalDiffServerResponse } from '@/api/hooks/useTelemetry';

// ── Hoisted, per-test controllable state ─────────────────────────────
const h = vi.hoisted(() => ({
  vehicles: [] as Array<{ id: number; display_name: string; vin: string }>,
  signals: [] as string[],
  pinnedItems: [] as Array<{ item_id: string }>,
  diff: undefined as unknown,
}));

const mockNavigate = vi.fn();
const mockRefetch = vi.fn();
const mockToggleMutateAsync = vi.fn();
const diffArgs = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Keep MemoryRouter / useSearchParams / useLocation real; only intercept the
// imperative navigate the alert-rule bulk action uses.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// FadeIn renders eagerly (no IntersectionObserver / matchMedia dance).
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => ({ children, className }: { children?: ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
      ),
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

vi.mock('@/api/hooks/useVehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: () => ({ data: h.vehicles }) };
});

vi.mock('@/api/hooks/useTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useTelemetry')>();
  return {
    ...actual,
    useSignals: () => ({ data: h.signals }),
    useSignalDiffServer: (
      vehicleId: number,
      atA: string,
      atB: string,
      signalsCsv: string,
      options?: unknown,
    ) => {
      diffArgs({ vehicleId, atA, atB, signalsCsv, options });
      return h.diff;
    },
  };
});

vi.mock('@/api/hooks/usePinned', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/usePinned')>();
  return {
    ...actual,
    usePinned: () => ({ data: h.pinnedItems }),
    useTogglePin: () => ({ mutateAsync: mockToggleMutateAsync }),
  };
});

// SavedViewMenu fires its own saved-views query; stub it so the header stays
// network-free. MetricCard + BulkActionsToolbar stay real.
vi.mock('@/components/data-display', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return { ...actual, SavedViewMenu: () => <div data-testid="saved-view-menu" /> };
});

// The two heavy child bands are stubbed to thin harnesses that surface the
// props the page threads into them (row counts, filter/selection/error state)
// and expose buttons to drive the page's selection + retry callbacks.
vi.mock('../components/SignalDiffTable', () => ({
  SignalDiffTable: (props: {
    rows: SignalDiffRow[];
    filterActive?: boolean;
    selectedSignals: string[];
    onSelectionChange: (s: string[]) => void;
  }) => (
    <div
      data-testid="signal-diff-table"
      data-rows={props.rows.length}
      data-filter-active={String(Boolean(props.filterActive))}
      data-selected={props.selectedSignals.join(',')}
    >
      <button type="button" onClick={() => props.onSelectionChange(['battery_level'])}>
        stub-select-one
      </button>
      <button type="button" onClick={() => props.onSelectionChange(['battery_level', 'vehicle_speed'])}>
        stub-select-two
      </button>
    </div>
  ),
}));

vi.mock('../components/SignalDiffBreakdown', () => ({
  SignalDiffBreakdown: (props: {
    rows: SignalDiffRow[];
    loading?: boolean;
    error?: unknown;
    onRetry?: () => void;
  }) => (
    <div
      data-testid="signal-diff-breakdown"
      data-rows={props.rows.length}
      data-loading={String(Boolean(props.loading))}
      data-error={String(Boolean(props.error))}
    >
      <button type="button" onClick={() => props.onRetry?.()}>
        stub-breakdown-retry
      </button>
    </div>
  ),
}));

vi.mock('@/lib/csvExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csvExport')>();
  return { ...actual, downloadCSV: vi.fn(), objectsToCSV: vi.fn(() => 'MOCK_CSV') };
});

import SignalDiffPage, { toNum, formatSpan } from './SignalDiffPage';

// ── Fixtures ─────────────────────────────────────────────────────────
const ROWS: SignalDiffRow[] = [
  { name: 'battery_level', value_a: 80, value_b: 75, source_b: 'l1', changed: true },
  { name: 'vehicle_speed', value_a: 0, value_b: 30, source_b: 'l1', changed: true },
  { name: 'charge_state', value_a: 'Disconnected', value_b: 'Charging', source_b: 'log', changed: true },
  { name: 'climate_keeper_mode', value_a: 'Off', value_b: 'On', source_b: 'l2', changed: true },
];

interface QueryStub {
  data: SignalDiffServerResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeQuery(overrides: Partial<QueryStub> = {}): QueryStub {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: mockRefetch,
    ...overrides,
  };
}

function diffResponse(rows: SignalDiffRow[]): SignalDiffServerResponse {
  return { vehicle_id: 7, at_a: '2024-01-01T00:00:00Z', at_b: '2024-01-01T01:00:00Z', count: rows.length, data: rows };
}

// Window A/B fixed in the URL → deterministic 1h span, valid ISO both ends so
// the diff query is "enabled" and the empty-state guard can fire.
const ROUTE = '/telemetry/signal-diff?vehicle=7&a=2024-01-01T00:00&b=2024-01-01T01:00';

function renderPage(route = ROUTE) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <SignalDiffPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Read the value paragraph of the MetricCard whose label is `label`. */
function kpiValueText(label: string): string {
  const card = screen.getByText(label).closest('div.flex-1');
  if (!card) throw new Error(`no metric card for "${label}"`);
  const paragraphs = card.querySelectorAll('p');
  return paragraphs[1]?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  mockToggleMutateAsync.mockResolvedValue(undefined);
  vi.mocked(objectsToCSV).mockReturnValue('MOCK_CSV');
  h.vehicles = [
    { id: 7, display_name: 'Model 3', vin: '5YJ3E1EA' },
    { id: 9, display_name: 'Model Y', vin: '5YJYGDEE' },
  ];
  h.signals = ['battery_level', 'vehicle_speed', 'charge_state', 'climate_keeper_mode'];
  h.pinnedItems = [{ item_id: 'signal:battery_level' }];
  h.diff = makeQuery({ data: diffResponse(ROWS) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── Page render ─────────────────────────────────────────────────── */

describe('SignalDiffPage', () => {
  it('renders the header, KPI band, and derived counts when the diff resolves', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Signal Diff' })).toBeInTheDocument();
    expect(
      screen.getByText('Compare signal values between two snapshots in time'),
    ).toBeInTheDocument();

    // KPI landmark + every card label present (structural completeness).
    const kpis = screen.getByRole('region', { name: 'Diff summary' });
    for (const label of [
      'Changed signals',
      'Visible after filter',
      'Numeric changes',
      'Categories affected',
      'Pinned',
      'Window span',
    ]) {
      expect(within(kpis).getByText(label)).toBeInTheDocument();
    }

    // Derived values: 4 changed, 4 visible, 2 numeric (80≠75, 0≠30),
    // 3 categories (battery, drive, climate), 1 pinned, 1h window.
    expect(kpiValueText('Changed signals')).toBe('4');
    expect(kpiValueText('Visible after filter')).toBe('4');
    expect(kpiValueText('Numeric changes')).toBe('2');
    expect(kpiValueText('Categories affected')).toBe('3');
    expect(kpiValueText('Pinned')).toBe('1');
    expect(kpiValueText('Window span')).toBe('1h');

    // Both child bands receive the filtered rows; the diff-table band renders.
    expect(screen.getByTestId('signal-diff-breakdown')).toHaveAttribute('data-rows', '4');
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute('data-rows', '4');
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute('data-filter-active', 'false');
    expect(screen.getByText('Signal differences')).toBeInTheDocument();
  });

  it('shows "—" for diff KPIs and skeletons in the table band while loading', () => {
    h.diff = makeQuery({ isLoading: true, isFetching: true, data: undefined, dataUpdatedAt: 0 });

    const { container } = renderPage();

    expect(kpiValueText('Changed signals')).toBe('—');
    expect(kpiValueText('Numeric changes')).toBe('—');
    // Independent sources stay visible even while the diff is loading.
    expect(kpiValueText('Pinned')).toBe('1');
    expect(kpiValueText('Window span')).toBe('1h');

    // Table band shows the six skeleton rows; no table stub leaks through.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(6);
    expect(screen.queryByTestId('signal-diff-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('signal-diff-breakdown')).toHaveAttribute('data-loading', 'true');
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it('reads "—" (not a misleading 0) on a failed diff and wires Retry to refetch', () => {
    // Regression: the KPI band previously used `initialLoading ? '—' : count`,
    // so an errored diff (isLoading false, no data) reported "0 changed / 0
    // numeric / 0 categories" — a dangerous "nothing changed" on what is an
    // outright failure. It now reads "—" for the diff-derived cards.
    h.diff = makeQuery({ isError: true, error: new Error('boom'), data: undefined, dataUpdatedAt: 0 });

    renderPage();

    for (const label of ['Changed signals', 'Visible after filter', 'Numeric changes', 'Categories affected']) {
      expect(kpiValueText(label)).toBe('—');
    }
    // Pinned + window span come from independent sources → still live.
    expect(kpiValueText('Pinned')).toBe('1');
    expect(kpiValueText('Window span')).toBe('1h');

    // Table band degrades to QueryError; the breakdown stub gets the error too.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByTestId('signal-diff-breakdown')).toHaveAttribute('data-error', 'true');
    expect(screen.queryByTestId('signal-diff-table')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows the page EmptyState (not the table) when a valid diff has no changes', () => {
    h.diff = makeQuery({ data: diffResponse([]) });

    renderPage();

    expect(
      screen.getByText('No signals changed between the two snapshots'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('signal-diff-table')).not.toBeInTheDocument();
    // Not loading and not errored → the real count 0 is shown, not "—".
    expect(kpiValueText('Changed signals')).toBe('0');
    expect(screen.getByTestId('signal-diff-breakdown')).toHaveAttribute('data-rows', '0');
  });

  it('narrows the visible + derived counts when a search filter is typed', async () => {
    renderPage();

    expect(kpiValueText('Visible after filter')).toBe('4');

    fireEvent.change(screen.getByPlaceholderText('Filter signals…'), {
      target: { value: 'battery' },
    });

    await waitFor(() => expect(kpiValueText('Visible after filter')).toBe('1'));
    // "Changed signals" tracks the unfiltered total; numerics track the filter.
    expect(kpiValueText('Changed signals')).toBe('4');
    expect(kpiValueText('Numeric changes')).toBe('1');
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute('data-rows', '1');
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute('data-filter-active', 'true');
  });

  it('filters by category chip and restores the full set on Clear', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Battery' }));

    // Battery matches battery_level (battery) + charge_state (charge) = 2.
    await waitFor(() => expect(kpiValueText('Visible after filter')).toBe('2'));
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute('data-filter-active', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(kpiValueText('Visible after filter')).toBe('4'));
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute('data-filter-active', 'false');
  });

  it('surfaces the bulk toolbar on selection and wires CSV export + alert-rule nav', async () => {
    renderPage();

    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'stub-select-two' }));

    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute(
      'data-selected',
      'battery_level,vehicle_speed',
    );

    // CSV export builds the two-row payload and downloads it for this vehicle.
    fireEvent.click(screen.getByRole('button', { name: 'Copy CSV' }));
    await waitFor(() =>
      expect(vi.mocked(downloadCSV)).toHaveBeenCalledWith('signal-diff-vehicle-7.csv', 'MOCK_CSV'),
    );
    expect(vi.mocked(objectsToCSV)).toHaveBeenCalledWith([
      { signal: 'battery_level', window_a: '80', window_b: '75', source_a: '', source_b: 'l1' },
      { signal: 'vehicle_speed', window_a: '0', window_b: '30', source_a: '', source_b: 'l1' },
    ]);

    // Alert-rule action hands the selection to Alert Studio via navigation.
    fireEvent.click(screen.getByRole('button', { name: 'Add as alert rule' }));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        '/alert-studio?signals=battery_level%2Cvehicle_speed&from=signal-diff',
      ),
    );
  });

  it('pins only the not-yet-pinned selected signals', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'stub-select-two' }));
    await screen.findByText('2 selected');

    fireEvent.click(screen.getByRole('button', { name: 'Pin selected' }));

    // battery_level is already pinned → skipped; only vehicle_speed is pinned.
    await waitFor(() =>
      expect(mockToggleMutateAsync).toHaveBeenCalledWith({
        itemId: 'signal:vehicle_speed',
        context: 'signal-diff:vehicle:7',
        pin: true,
      }),
    );
    expect(mockToggleMutateAsync).toHaveBeenCalledTimes(1);
  });

  it('clears the selection when Clear selection is pressed', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'stub-select-two' }));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
    expect(screen.getByTestId('signal-diff-table')).toHaveAttribute('data-selected', '');
  });

  it('re-drives the diff hook when the local vehicle picker changes', async () => {
    renderPage();

    const picker = screen.getByRole('combobox', { name: 'Vehicle' });
    expect(picker).toHaveValue('7');
    expect(diffArgs.mock.calls.at(-1)?.[0]).toMatchObject({ vehicleId: 7 });

    fireEvent.change(picker, { target: { value: '9' } });

    await waitFor(() =>
      expect(diffArgs.mock.calls.at(-1)?.[0]).toMatchObject({ vehicleId: 9 }),
    );
  });

  it('exposes accessible landmarks and a labelled vehicle picker', () => {
    renderPage();

    expect(screen.getByRole('region', { name: 'Diff summary' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Signal Diff' })).toBeInTheDocument();
  });
});

/* ── toNum ───────────────────────────────────────────────────────── */

describe('toNum', () => {
  it('returns finite numbers as-is and rejects non-finite numbers', () => {
    expect(toNum(42)).toBe(42);
    expect(toNum(0)).toBe(0);
    expect(toNum(-3.5)).toBe(-3.5);
    expect(toNum(Number.NaN)).toBeNull();
    expect(toNum(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('parses numeric strings but rejects blank / non-numeric strings', () => {
    expect(toNum('12')).toBe(12);
    expect(toNum('  3.5 ')).toBe(3.5);
    expect(toNum('')).toBeNull();
    expect(toNum('   ')).toBeNull();
    expect(toNum('12abc')).toBeNull();
  });

  it('maps booleans to 1/0 and everything else to null', () => {
    expect(toNum(true)).toBe(1);
    expect(toNum(false)).toBe(0);
    expect(toNum(null)).toBeNull();
    expect(toNum(undefined)).toBeNull();
    expect(toNum({})).toBeNull();
    expect(toNum([1, 2])).toBeNull();
  });
});

/* ── formatSpan ──────────────────────────────────────────────────── */

describe('formatSpan', () => {
  it('formats sub-minute spans in seconds', () => {
    expect(formatSpan(0)).toBe('0s');
    expect(formatSpan(45)).toBe('45s');
    expect(formatSpan(59.4)).toBe('59s');
  });

  it('formats minute spans, dropping a zero seconds remainder', () => {
    expect(formatSpan(60)).toBe('1m');
    expect(formatSpan(65)).toBe('1m 5s');
    expect(formatSpan(3599)).toBe('59m 59s');
  });

  it('formats hour spans, dropping a zero minutes remainder', () => {
    expect(formatSpan(3600)).toBe('1h');
    expect(formatSpan(3660)).toBe('1h 1m');
    expect(formatSpan(7200)).toBe('2h');
  });
});
