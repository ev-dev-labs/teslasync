/**
 * AutomationListPage — orchestration, filtering, selection + bulk-op coverage.
 *
 * The page is a bulk-management orchestrator that fans out into a KPI band,
 * a status/search toolbar, a sticky bulk-action bar and a bento of two child
 * sections. Its own behaviour (the surface under test here) is:
 *
 *   1. `stats` reducer over the FULL unfiltered set (active / disabled /
 *      auto-disabled buckets + run/failure totals).
 *   2. `filtered` derivation — status filter + case-insensitive name/description
 *      search, combined.
 *   3. `vehicleLookup` build with display-name-or-VIN fallback.
 *   4. Selection pruning — `effectiveSelected` drops keys no longer visible
 *      after a filter change, and drives the bulk toolbar count.
 *   5. `runBulk` — numeric-id mutation, clear-on-success, keep-on-failure
 *      (and no unhandled rejection when the mutation rejects).
 *   6. Confirm-gated delete, loading / error propagation, retry + navigation.
 *
 * Strategy: render the REAL page shell (PageContainer + header Select/Input +
 * the real BulkActionToolbar with its ConfirmDialog + the real MetricCard KPI
 * band) and stub ONLY the two data sections so the exact props the page
 * computed can be captured. Network is never touched — the three data hooks are
 * mocked to return controllable results. This keeps assertions crisp and the
 * render deterministic.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { Automation } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';

// jsdom lacks matchMedia; framer-motion / useMotionPreference (reached via the
// page's <FadeIn> + PageContainer freshness chip) read it at module load.
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

// Shared, hoisted test doubles so the mock factories below and the specs can
// both reach them.
const { useAutomationsMock, useBulkMock, useVehiclesMock, navigateMock, captured } =
  vi.hoisted(() => ({
    useAutomationsMock: vi.fn(),
    useBulkMock: vi.fn(),
    useVehiclesMock: vi.fn(),
    navigateMock: vi.fn(),
    captured: {} as Record<string, Record<string, unknown>>,
  }));

const operationalMode = vi.hoisted(() => ({
  canWrite: true,
  writeBlockReason: null as string | null,
}));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => operationalMode,
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
// Supports both the `t(key, 'Default', { vars })` and the
// `t(key, { defaultValue, ...vars })` call styles the tree uses.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translate = (key: string, second?: unknown, third?: unknown): string => {
    let template = key;
    let vars: Record<string, unknown> | undefined;
    if (typeof second === 'string') {
      template = second;
      if (third && typeof third === 'object') vars = third as Record<string, unknown>;
    } else if (second && typeof second === 'object') {
      vars = second as Record<string, unknown>;
      if (typeof (second as { defaultValue?: unknown }).defaultValue === 'string') {
        template = (second as { defaultValue: string }).defaultValue;
      }
    }
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars! ? String(vars![name]) : `{{${name}}}`,
    );
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Drive the three data hooks deterministically without any network.
vi.mock('@/api/hooks/useAutomations', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAutomations')>(
    '@/api/hooks/useAutomations',
  );
  return {
    ...actual,
    useAutomations: () => useAutomationsMock(),
    useBulkAutomationsUpdate: () => useBulkMock(),
  };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
    '@/api/hooks/useVehicles',
  );
  return {
    ...actual,
    useVehicles: () => useVehiclesMock(),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

// Stub ONLY the two bento sections; keep the real page shell, header controls,
// KPI MetricCards and BulkActionToolbar so the page's real derivation logic runs.
vi.mock('./AutomationListTable', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AutomationListTable: function Stub(props: Record<string, unknown>) {
      captured.table = props;
      return React.createElement('div', { 'data-testid': 'stub-table' });
    },
  };
});

vi.mock('./AutomationStatusPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AutomationStatusPanel: function Stub(props: Record<string, unknown>) {
      captured.status = props;
      return React.createElement('div', { 'data-testid': 'stub-status' });
    },
  };
});

import AutomationListPage from './AutomationListPage';

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface FakeQuery {
  data?: Automation[];
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  const base = {
    id: 0,
    name: 'Automation',
    description: null as string | null,
    enabled: true,
    vehicle_id: null as number | null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    stop_on_failure: false,
    notify_on_run: false,
    notify_on_failure: false,
    seasonal_start: null,
    seasonal_end: null,
    last_triggered_at: null,
    last_success_at: null,
    last_failure_at: null,
    execution_count: 0,
    failure_count: 0,
    consecutive_failures: 0,
    auto_disabled: false,
    auto_disabled_reason: null,
    preset_id: null,
  };
  return { ...base, ...overrides } as unknown as Automation;
}

function makeVehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: 0,
    vehicle_id: 0,
    vin: 'VIN',
    display_name: 'Car',
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Vehicle;
}

// active(1) · disabled(1) · auto-disabled(2). Runs 360, failures 28.
const AUTOMATIONS: Automation[] = [
  makeAutomation({
    id: 1,
    name: 'Morning Precondition',
    description: 'Warm cabin before departure',
    enabled: true,
    auto_disabled: false,
    vehicle_id: 1,
    execution_count: 100,
    failure_count: 0,
  }),
  makeAutomation({
    id: 2,
    name: 'Night Charge',
    description: 'Charge to 80% overnight',
    enabled: false,
    auto_disabled: false,
    vehicle_id: 2,
    execution_count: 50,
    failure_count: 5,
  }),
  makeAutomation({
    id: 3,
    name: 'Sentry Guard',
    description: 'battery guard threshold',
    enabled: true,
    auto_disabled: true,
    vehicle_id: null,
    execution_count: 200,
    failure_count: 20,
  }),
  makeAutomation({
    id: 4,
    name: 'Trip Log',
    description: null,
    enabled: false,
    auto_disabled: true,
    vehicle_id: 99,
    execution_count: 10,
    failure_count: 3,
  }),
];

const VEHICLES: Vehicle[] = [
  makeVehicle({ id: 1, display_name: 'Model 3', vin: 'VIN-1' }),
  makeVehicle({ id: 2, display_name: '', vin: 'VIN-2' }),
];

function ids(rows: unknown): number[] {
  return (rows as Automation[]).map((a) => a.id);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AutomationListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function kpiRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Automation summary' });
}

// Drive the table's controlled multi-select from a spec. Block-body arrow so
// `act` receives an undefined (sync) return, never a thenable.
function selectRows(keys: number[]) {
  act(() => {
    (captured.table.onSelectionChange as (k: number[]) => void)(keys);
  });
}

beforeEach(() => {
  useAutomationsMock.mockReset();
  useBulkMock.mockReset();
  useVehiclesMock.mockReset();
  navigateMock.mockReset();
  operationalMode.canWrite = true;
  operationalMode.writeBlockReason = null;
  for (const key of Object.keys(captured)) delete captured[key];

  // Sensible defaults; individual specs override as needed.
  useAutomationsMock.mockReturnValue(makeQuery({ data: AUTOMATIONS }));
  useVehiclesMock.mockReturnValue({ data: VEHICLES });
  useBulkMock.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ updated: 0, deleted: 0, failed: [] }),
  });
});

describe('AutomationListPage', () => {
  it('renders the page shell, KPI band and both bento sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Automations (list)' }),
    ).toBeInTheDocument();

    // KPI band present with all six tiles (scoped so the "Active"/"Disabled"
    // <option>s in the header Select don't collide with the tile labels).
    const kpi = kpiRegion();
    expect(within(kpi).getByText('Total')).toBeInTheDocument();
    expect(within(kpi).getByText('Active')).toBeInTheDocument();
    expect(within(kpi).getByText('Disabled')).toBeInTheDocument();
    expect(within(kpi).getByText('Auto-disabled')).toBeInTheDocument();
    expect(within(kpi).getByText('Total runs')).toBeInTheDocument();
    expect(within(kpi).getByText('Failures')).toBeInTheDocument();
    // Real values render (total=4, auto-disabled=2, failures=28).
    expect(within(kpi).getByText('4')).toBeInTheDocument();
    expect(within(kpi).getByText('2')).toBeInTheDocument();
    expect(within(kpi).getByText('28')).toBeInTheDocument();

    // Both data sections are mounted — no gutted / hidden panels.
    expect(screen.getByTestId('stub-table')).toBeInTheDocument();
    expect(screen.getByTestId('stub-status')).toBeInTheDocument();

    // Header controls present.
    expect(
      screen.getByRole('combobox', { name: 'Filter automations by status' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search automations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('renders the read-only explanation outside the disabled create action', () => {
    operationalMode.canWrite = false;
    operationalMode.writeBlockReason =
      'Reconnect before making operational changes.';
    renderPage();

    const createButton = screen.getByRole('button', { name: 'New' });
    const noticeTitle = screen.getByText(
      'Bulk automation controls are read-only',
    );

    expect(createButton).toBeDisabled();
    expect(createButton).toHaveAttribute(
      'title',
      'Reconnect before making operational changes.',
    );
    expect(noticeTitle.closest('button')).toBeNull();
    expect(
      screen.getByText('Reconnect before making operational changes.'),
    ).toBeInTheDocument();
  });

  it('computes summary stats from the full, unfiltered set', () => {
    renderPage();

    expect(captured.status.stats).toEqual({
      total: 4,
      active: 1,
      disabled: 1,
      autoDisabled: 2,
      totalRuns: 360,
      totalFailures: 28,
    });
  });

  it('builds a vehicle lookup with a display-name-or-VIN fallback', () => {
    renderPage();

    const lookup = captured.table.vehicleLookup as Map<number, string>;
    expect(lookup.get(1)).toBe('Model 3');
    // display_name is empty → falls back to the VIN.
    expect(lookup.get(2)).toBe('VIN-2');
    expect(captured.table.totalCount).toBe(4);
  });

  it('passes the whole (unfiltered) set to the table by default', () => {
    renderPage();
    expect(ids(captured.table.automations)).toEqual([1, 2, 3, 4]);
  });

  it('filters the table rows by the status Select', async () => {
    renderPage();
    const select = screen.getByRole('combobox', { name: 'Filter automations by status' });

    fireEvent.change(select, { target: { value: 'active' } });
    await waitFor(() => expect(ids(captured.table.automations)).toEqual([1]));

    fireEvent.change(select, { target: { value: 'disabled' } });
    await waitFor(() => expect(ids(captured.table.automations)).toEqual([2]));

    fireEvent.change(select, { target: { value: 'auto-disabled' } });
    await waitFor(() => expect(ids(captured.table.automations)).toEqual([3, 4]));

    fireEvent.change(select, { target: { value: 'all' } });
    await waitFor(() => expect(ids(captured.table.automations)).toEqual([1, 2, 3, 4]));
  });

  it('filters by a case-insensitive search across name AND description', async () => {
    renderPage();
    const box = screen.getByRole('searchbox', { name: 'Search automations' });

    // Matches a name.
    fireEvent.change(box, { target: { value: 'NIGHT' } });
    await waitFor(() => expect(ids(captured.table.automations)).toEqual([2]));

    // Matches a description only ("Warm cabin…"; no name contains "cabin").
    fireEvent.change(box, { target: { value: 'cabin' } });
    await waitFor(() => expect(ids(captured.table.automations)).toEqual([1]));

    // No match → empty rows, but totalCount still reflects the full set so the
    // table can distinguish "no matches" from "no automations".
    fireEvent.change(box, { target: { value: 'zzz-nope' } });
    await waitFor(() => expect(ids(captured.table.automations)).toEqual([]));
    expect(captured.table.totalCount).toBe(4);
  });

  it('shows skeletons (not KPI tiles) while loading and flags children loading', () => {
    useAutomationsMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    renderPage();

    expect(captured.table.isLoading).toBe(true);
    expect(captured.status.isLoading).toBe(true);
    expect(captured.table.totalCount).toBe(0);
    // KPI tiles are replaced by skeletons during the first load.
    expect(within(kpiRegion()).queryByText('Total runs')).not.toBeInTheDocument();
  });

  it('propagates an error to both sections without hiding them', () => {
    const err = new Error('boom');
    useAutomationsMock.mockReturnValue(makeQuery({ error: err, isError: true, data: undefined }));
    renderPage();

    expect(captured.table.error).toBe(err);
    expect(captured.status.error).toBe(err);
    expect(captured.table.isLoading).toBe(false);
    // Sections stay mounted on error — never a blank / removed panel.
    expect(screen.getByTestId('stub-table')).toBeInTheDocument();
    expect(screen.getByTestId('stub-status')).toBeInTheDocument();
    // KPI band still renders (zeroed) rather than vanishing.
    expect(within(kpiRegion()).getByText('Total')).toBeInTheDocument();
  });

  it('wires each section retry handler to the query refetch', () => {
    const query = makeQuery({ data: AUTOMATIONS });
    useAutomationsMock.mockReturnValue(query);
    renderPage();

    expect(query.refetch).not.toHaveBeenCalled();
    (captured.table.onRetry as () => void)();
    expect(query.refetch).toHaveBeenCalledTimes(1);
    (captured.status.onRetry as () => void)();
    expect(query.refetch).toHaveBeenCalledTimes(2);
  });

  it('navigates to the builder when the New button is pressed', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(navigateMock).toHaveBeenCalledWith('/automations/new');
  });

  it('drives the bulk toolbar from selection and prunes to visible rows on filter', async () => {
    renderPage();

    // No toolbar until something is selected.
    expect(screen.queryByRole('region', { name: /bulk actions/i })).not.toBeInTheDocument();

    selectRows([1, 2, 3]);

    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument();
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    expect(captured.table.selectedKeys).toEqual([1, 2, 3]);

    // Narrow to "active" (only #1 visible) — selection prunes to the visible id.
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter automations by status' }), {
      target: { value: 'active' },
    });

    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());
    expect(captured.table.selectedKeys).toEqual([1]);
  });

  it('runs a bulk enable with numeric ids and clears the selection on success', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ updated: 2, failed: [] });
    useBulkMock.mockReturnValue({ mutateAsync });
    renderPage();

    selectRows([1, 2]);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ ids: [1, 2], op: 'enable' }),
    );
    // Selection cleared once the server confirms → toolbar unmounts.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /bulk actions/i })).not.toBeInTheDocument(),
    );
  });

  it('routes a bulk delete through the confirm dialog before mutating', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ deleted: 1, failed: [] });
    useBulkMock.mockReturnValue({ mutateAsync });
    renderPage();

    selectRows([3]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete automations?')).toBeInTheDocument();
    // Nothing mutates until the destructive action is confirmed.
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ ids: [3], op: 'delete' }),
    );
  });

  it('cancelling the delete confirmation leaves the selection untouched', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ deleted: 0, failed: [] });
    useBulkMock.mockReturnValue({ mutateAsync });
    renderPage();

    selectRows([3]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mutateAsync).not.toHaveBeenCalled();
    // Selection survives a cancelled confirm.
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
  });

  it('keeps the selection and raises no unhandled rejection when a bulk op fails', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      const mutateAsync = vi.fn().mockRejectedValue(new Error('bulk failed'));
      useBulkMock.mockReturnValue({ mutateAsync });
      renderPage();

      selectRows([1, 2]);
      fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledWith({ ids: [1, 2], op: 'enable' }),
      );
      // Flush any pending microtasks so a stray rejection would have surfaced.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rejections).toHaveLength(0);
      // Failure keeps the rows selected so the user can retry.
      expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
