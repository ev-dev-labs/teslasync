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
 *   4. Selection retains loaded IDs across filters and reviews them before writes.
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
import { render, renderHook, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { Automation } from '@/api/types';
import { automationNumber, automationTimestamp, automationStatus, assertAutomationInventory } from '@/api/hooks/useAutomations';
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { request } from '@/api/client';
import type { Vehicle } from '@/types/vehicle';

vi.mock('@/api/client', () => ({ request: vi.fn() }));

describe('automation inventory hook boundary', () => {
  const base = {
    id: 1, name: 'Supported base row', enabled: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };

  it('accepts base rows without nonexistent extension counters and measured zero', () => {
    expect(assertAutomationInventory([base])).toEqual([base]);
    expect(assertAutomationInventory([])).toEqual([]);
    expect(assertAutomationInventory([{ ...base, execution_count: 0, failure_count: 0 }])).toHaveLength(1);
  });

  it('preserves nullable status and finite signed and fractional values at the hook boundary', () => {
    const rows = [
      { ...base, enabled: null, auto_disabled: null, execution_count: -2, failure_count: 0.25 },
      { ...base, id: 2, enabled: undefined, execution_count: -0.5, failure_count: 0 },
    ];
    expect(assertAutomationInventory(rows)).toEqual(rows);
    for (const row of rows) expect(automationStatus(row)).toBeNull();
  });

  it.each([
    null, {}, { items: [] }, [null], [{ ...base, enabled: 'false' }],
    [{ ...base, name: 3 }], [{ ...base, vehicle_id: '1' }],
    [{ ...base, execution_count: NaN }], [{ ...base, failure_count: Infinity }],
    [{ ...base, execution_count: '0' }], [{ ...base, last_triggered_at: 'bad' }],
  ])('rejects malformed inventory %j', (payload) => {
    expect(() => assertAutomationInventory(payload)).toThrow('Invalid automation inventory response');
  });

  it('keeps valid cache data on invalid refresh and recovers with successful empty data', async () => {
    const actual = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(request).mockResolvedValueOnce([base]).mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce([]);
    const { result, unmount } = renderHook(() => actual.useAutomationList(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    // Refreshes are driven through invalidation (the production refresh path);
    // the observer snapshot does not follow observer.refetch() failures.
    const key = actual.automationKeys.all;
    await waitFor(() => expect(result.current.data).toEqual([base]));
    await act(async () => { await client.invalidateQueries({ queryKey: key, exact: true }); });
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('error'));
    expect(client.getQueryState(key)?.error).toMatchObject({ message: 'Invalid automation inventory response' });
    expect(client.getQueryData(key)).toEqual([base]);
    await act(async () => { await client.invalidateQueries({ queryKey: key, exact: true }); });
    await waitFor(() => expect(client.getQueryData(key)).toEqual([]));
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe('success'));
    unmount();
    client.clear();
  });
});

vi.mock('../components/RoutineWizard', () => ({
  RoutineWizard: ({ actionsDisabled }: { actionsDisabled?: boolean }) => (
    <div data-testid="routine-wizard" data-disabled={String(actionsDisabled)} />
  ),
}));

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

describe('AutomationListPage source recovery and partial bulk outcomes', () => {
  it('keeps initial inventory totals unknown when fetching is paused without data', () => {
    useAutomationsMock.mockReturnValue({
      ...makeQuery(), isPending: true, fetchStatus: 'paused',
    });
    renderPage();
    expect(captured.table.hasData).toBe(false);
    expect(captured.table.isLoading).toBe(false);
    expect(captured.status.stats).toMatchObject({ total: undefined });
    expect(captured.table.dataState).toMatchObject({ hasData: false, isRefreshBlocked: true });
    expect(captured.status.dataState).toMatchObject({ hasData: false, isRefreshBlocked: true });
  });

  it('explains paused vehicle names independently and restores their lookup after recovery', () => {
    const refetch = vi.fn();
    useVehiclesMock.mockReturnValue({ ...makeQuery(), fetchStatus: 'paused', refetch });
    const view = renderPage();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Vehicles' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(captured.table.isLoading).toBe(false);
    useVehiclesMock.mockReturnValue(makeQuery({ data: VEHICLES }));
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><AutomationListPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(captured.table.vehicleLookup.size).toBeGreaterThan(0);
  });

  it('distinguishes invalid inputs from measured zero, signed and fractional values', () => {
    for (const input of [null, undefined, '', '0', NaN, Infinity, -Infinity, false]) {
      expect(automationNumber(input)).toBeNull();
    }
    for (const input of [0, -2, 0.25, -0.5]) expect(automationNumber(input)).toBe(input);
    for (const input of [null, undefined, '', 'not-a-date', 0]) expect(automationTimestamp(input)).toBeNull();
    expect(automationTimestamp('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z');
    expect(automationStatus({ ...AUTOMATIONS[0], auto_disabled: undefined })).toBeNull();
  });

  it('keeps incomplete inventory counters and status totals unknown', () => {
    useAutomationsMock.mockReturnValue(makeQuery({
      data: [{ ...AUTOMATIONS[0], execution_count: undefined, failure_count: NaN, auto_disabled: undefined }],
    }));
    renderPage();
    expect(captured.status.stats).toMatchObject({
      total: 1, active: undefined, disabled: undefined, autoDisabled: undefined,
      totalRuns: undefined, totalFailures: undefined,
    });
  });
  it('retains failed bulk IDs with their reasons and retries only those IDs', async () => {
    const mutateAsync = vi.fn()
      .mockResolvedValueOnce({ updated: 1, failed: [{ id: 2, reason: 'Rule unavailable' }] })
      .mockResolvedValueOnce({ updated: 1, failed: [] });
    useBulkMock.mockReturnValue({ mutateAsync });
    renderPage();
    selectRows([1, 2]);
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(captured.table.selectedKeys).toEqual([2]));
    expect(mutateAsync).toHaveBeenNthCalledWith(1, { ids: [1, 2], op: 'enable' });
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('#2: Rule unavailable')).toBeInTheDocument();
    expect(ids(captured.table.automations)).toEqual([1, 2, 3, 4]);

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenNthCalledWith(2, { ids: [2], op: 'enable' }));
    await waitFor(() => expect(captured.table.selectedKeys).toEqual([]));
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
  });

  it('preserves newly selected IDs outside the submitted bulk operation', async () => {
    let finish: (result: { updated: number; failed: { id: number; reason: string }[] }) => void = () => {};
    const mutateAsync = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    useBulkMock.mockReturnValue({ mutateAsync });
    renderPage();
    selectRows([1]);
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ ids: [1], op: 'enable' }));
    selectRows([1, 3]);

    await act(async () => finish({ updated: 1, failed: [] }));
    expect(captured.table.selectedKeys).toEqual([3]);
    expect(screen.getByRole('region', { name: /bulk actions/i })).toHaveTextContent('1 selected');
  });

  it('keeps all inventory sections while vehicle names are loading', () => {
    useVehiclesMock.mockReturnValue(makeQuery({ isLoading: true }));
    renderPage();

    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading');
    expect(ids(captured.table.automations)).toEqual([1, 2, 3, 4]);
    expect(captured.table.isLoading).toBe(false);
    expect(captured.table.vehicleLookup).toEqual(new Map());
    expect(screen.getByTestId('stub-status')).toBeInTheDocument();
    expect(screen.getByTestId('routine-wizard')).toBeInTheDocument();
  });

  it('retries failed vehicle names independently without replacing automation rows', () => {
    const refetchVehicles = vi.fn();
    const query = makeQuery({ data: AUTOMATIONS });
    useAutomationsMock.mockReturnValue(query);
    useVehiclesMock.mockReturnValue(makeQuery({
      isError: true, error: new Error('Vehicle names unavailable'), refetch: refetchVehicles,
    }));
    renderPage();
    selectRows([2]);

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchVehicles).toHaveBeenCalledTimes(1);
    expect(query.refetch).not.toHaveBeenCalled();
    expect(captured.table.error).toBeNull();
    expect(captured.table.selectedKeys).toEqual([2]);
    expect(ids(captured.table.automations)).toEqual([1, 2, 3, 4]);
    expect(screen.getByTestId('routine-wizard')).toBeInTheDocument();
  });

  it('keeps retained vehicle names and independently refreshes their stale source', () => {
    const refetchVehicles = vi.fn();
    useVehiclesMock.mockReturnValue({
      data: VEHICLES, isLoading: false, isError: true, error: new Error('Vehicle refresh failed'),
      isFetching: false, dataUpdatedAt: Date.now(), refetch: refetchVehicles,
    });
    renderPage();
    selectRows([2]);

    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Vehicles may be out of date');
    expect((captured.table.vehicleLookup as Map<number, string>).get(1)).toBe('Model 3');
    expect((captured.table.vehicleLookup as Map<number, string>).get(2)).toBe('VIN-2');
    expect(captured.table.selectedKeys).toEqual([2]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetchVehicles).toHaveBeenCalledTimes(1);
    expect(captured.table.error).toBeNull();
  });
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
const realTable = vi.hoisted(() => ({ enabled: false }));

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
    useAutomationList: () => useAutomationsMock(),
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
  const actual = await vi.importActual<typeof import('./AutomationListTable')>('./AutomationListTable');
  return {
    AutomationListTable: function Stub(props: React.ComponentProps<typeof actual.AutomationListTable>) {
      captured.table = { ...props };
      if (realTable.enabled) return React.createElement(actual.AutomationListTable, props);
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
  realTable.enabled = false;
  window.localStorage.clear();
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
  it('reviews every retained selection hidden by table value filters before disabling', async () => {
    realTable.enabled = true;
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Night Charge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Runs filter' }));
    const filter = screen.getByRole('dialog', { name: 'Runs filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: '50' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('link', { name: 'Night Charge' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(captured.table.selectedKeys).toEqual([2, 1, 3, 4]);
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    const review = await screen.findByRole('dialog');
    for (const row of AUTOMATIONS) expect(review).toHaveTextContent(`#${row.id}: ${row.name}`);
    expect(useBulkMock().mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(useBulkMock().mutateAsync).toHaveBeenCalledWith({ ids: [2, 1, 3, 4], op: 'disable' }));
  });

  it('reviews cumulative counters without claiming a known window or changing selected rules', () => {
    const mutation = vi.fn();
    useBulkMock.mockReturnValue({ mutateAsync: mutation });
    renderPage();
    selectRows([2]);
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Rule inventory details' });
    expect(within(drawer).getAllByText('Cumulative counters on loaded rules; their start time is not supplied.').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('360')).toBeInTheDocument();
    expect(within(drawer).getByText('28')).toBeInTheDocument();
    expect(captured.table.selectedKeys).toEqual([2]);
    expect(mutation).not.toHaveBeenCalled();
  });
  it('states unfiltered loaded selection scope without treating a filter as select-all', async () => {
    renderPage();
    selectRows([1, 2, 3]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter automations by status' }), {
      target: { value: 'active' },
    });
    const toolbar = screen.getByRole('region', { name: /bulk actions/i });
    expect(toolbar).toHaveAttribute('data-selection-scope', 'loaded');
    expect(toolbar).toHaveTextContent('3 selected · All loaded rules · unfiltered');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Enable' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(useBulkMock().mutateAsync).toHaveBeenCalledWith({ ids: [1, 2, 3], op: 'enable' }));
  });

  it('retains the KPI, table, status and selected IDs during failed background recovery', () => {
    useAutomationsMock.mockReturnValue(makeQuery({
      data: AUTOMATIONS, isError: true, error: new Error('Refresh offline'),
    }));
    const { container } = renderPage();
    selectRows([2]);
    expect(container.querySelector('[data-layout-reference]')).not.toBeNull();
    expect(within(kpiRegion()).getByText('Total runs')).toBeInTheDocument();
    expect(captured.table.error).toBeNull();
    expect(captured.status.error).toBeNull();
    expect(captured.table.selectedKeys).toEqual([2]);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('renders the page shell, KPI band and both bento sections', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Automation rules' }),
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
    expect(screen.getByTestId('routine-wizard')).toHaveAttribute('data-disabled', 'false');

    // Header controls present.
    expect(
      screen.getByRole('combobox', { name: 'Filter automations by status' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search automations' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search automations' })
      .closest('[data-action-group]')).toHaveAttribute('data-action-group', 'context');
    expect(screen.getByRole('combobox', { name: 'Filter automations by status' })
      .closest('[data-action-group]')).toHaveAttribute('data-action-group', 'context');
    expect(screen.getByRole('button', { name: 'New' })
      .closest('[data-action-group]')).toHaveAttribute('data-action-group', 'primary');
    const heading = screen.getByRole('heading', { level: 1, name: 'Automation rules' });
    expect(heading).toHaveAttribute('data-route-focus-target', 'true');
    expect(heading.closest('header')).toHaveClass('border-0', 'bg-transparent');
  });

  it('renders the read-only explanation outside the disabled create action', () => {
    operationalMode.canWrite = false;
    operationalMode.writeBlockReason =
      'Reconnect before making operational changes.';
    renderPage();

    const createButton = screen.getByRole('button', { name: 'New' });
    expect(screen.getByTestId('routine-wizard')).toHaveAttribute('data-disabled', 'true');
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

    selectRows([1]);
    expect(screen.getByRole('button', { name: 'Enable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
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
    expect(within(kpiRegion()).getByText('Total runs')).toBeInTheDocument();
    expect(screen.getByTestId('automation-rules-brief')).toHaveAttribute('aria-busy', 'true');
    expect(kpiRegion().querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });

  it('propagates an error to both sections without hiding them', () => {
    const err = new Error('boom');
    const query = makeQuery({ error: err, isError: true, data: undefined });
    useAutomationsMock.mockReturnValue(query);
    renderPage();

    expect(captured.table.error).toBe(err);
    expect(captured.status.error).toBe(err);
    expect(captured.table.isLoading).toBe(false);
    // Sections stay mounted on error — never a blank / removed panel.
    expect(screen.getByTestId('stub-table')).toBeInTheDocument();
    expect(screen.getByTestId('stub-status')).toBeInTheDocument();
    // KPI band shows the error with retry — never fabricated zeros.
    expect(kpiRegion().querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of ['Total', 'Active', 'Disabled', 'Auto-disabled', 'Total runs', 'Failures']) {
      assertOperationalMetricUnavailable(kpiRegion(), label);
    }
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('6 empty fields are hidden.');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    const retry = within(kpiRegion()).getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(query.refetch).toHaveBeenCalledTimes(1);
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

  it('retains and reviews loaded selections hidden by header filters before enabling', async () => {
    renderPage();

    // No toolbar until something is selected.
    expect(screen.queryByRole('region', { name: /bulk actions/i })).not.toBeInTheDocument();

    selectRows([1, 2, 3]);

    expect(screen.getByRole('region', { name: /bulk actions/i })).toBeInTheDocument();
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    expect(captured.table.selectedKeys).toEqual([1, 2, 3]);

    // Only #1 is visible, but the review still includes every selected loaded rule.
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter automations by status' }), {
      target: { value: 'active' },
    });

    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    expect(captured.table.selectedKeys).toEqual([1, 2, 3]);
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('#1: Morning Precondition');
    expect(dialog).toHaveTextContent('#2: Night Charge');
    expect(dialog).toHaveTextContent('#3: Sentry Guard');
    expect(useBulkMock().mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(useBulkMock().mutateAsync).toHaveBeenCalledWith({ ids: [1, 2, 3], op: 'enable' }));
  });

  it('runs a bulk enable with numeric ids and clears the selection on success', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ updated: 2, failed: [] });
    useBulkMock.mockReturnValue({ mutateAsync });
    renderPage();

    selectRows([1, 2]);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }));
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

      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Enable' }));
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
