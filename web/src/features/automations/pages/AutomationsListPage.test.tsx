// Behavioural contract for the automations command-center page. Exercises the
// page's orchestration surface end-to-end plus its exported pure helpers:
//   - pure helpers: computeStats (active/disabled/auto-disabled precedence),
//     buildVehicleLookup, isRecord, isAutomationImportEnvelope
//   - KPI band: total/active/disabled/auto-disabled mapped to the right cards
//   - conditional auto-disabled danger banner (count interpolation)
//   - filter toolbar: status <select>, search box, live shown/total badge
//   - workspace states: loading skeletons, QueryError (+ retry), no-automations
//     empty state, no-match empty state (+ reset-filters), populated grid
//   - card wiring: vehicle-name resolution, isFiring flag, and the four
//     mutation callbacks (toggle / re-enable / delete / test-run)
//   - typed import: valid envelope → mutate, legacy/invalid JSON → window.alert,
//     pending → aria-busy button
//   - create navigation; recent activity moved to the dedicated history route
//
// Repo test conventions: framer-motion is mocked so FadeIn/Stagger render
// eagerly, react-i18next is mocked with an interpolating fallback `t`, the
// heavy child components (AutomationCard / PresetGallery) are replaced with
// lightweight probes, and every data/mutation
// hook is mocked so the page never touches the network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import * as apiClient from '@/api/client';
import type { Automation } from '@/api/types';
import { automationStatus, assertAutomationInventory, assertAutomationImportResult, type AutomationListItem } from '@/api/hooks/useAutomations';
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { AutomationCardStatistics } from '../components/automation-helper-source-closure/AutomationCardStatistics';
import AutomationsListPage, {
  computeStats,
  buildVehicleLookup,
  isRecord,
  isAutomationImportEnvelope,
} from './AutomationsListPage';

// ─── Hoisted shared mock fns ────────────────────────────────────────────────

const m = vi.hoisted(() => ({
  useAutomations: vi.fn(),
  useAutomationHistory: vi.fn(),
  useVehicles: vi.fn(),
  usePinned: vi.fn(),
  useAutomationEvents: vi.fn(),
  useImportAutomations: vi.fn(),
  toggleMutate: vi.fn(),
  deleteMutate: vi.fn(),
  testRunMutate: vi.fn(),
  reEnableMutate: vi.fn(),
  importMutate: vi.fn(),
  duplicateMutate: vi.fn(),
  navigate: vi.fn(),
  importSuccess: vi.fn(),
  importWarning: vi.fn(),
  importError: vi.fn(),
  operationalMode: vi.fn(),
}));

vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: m.importSuccess, warning: m.importWarning, error: m.importError }),
}));

// ─── framer-motion: render eagerly as plain divs (no matchMedia/IO). ─────────

function filterMotionProps(props: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      key === 'initial' || key === 'animate' || key === 'exit' || key === 'transition' ||
      key === 'whileHover' || key === 'whileTap' || key === 'whileInView' ||
      key === 'viewport' || key === 'variants' || key === 'layout' || key === 'layoutId'
    ) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
          <div {...filterMotionProps(props)}>{children}</div>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useInView: () => true,
  useReducedMotion: () => false,
}));

// ─── react-i18next: interpolating fallback `t`. ──────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ─── react-router-dom: keep the real router, stub useNavigate. ───────────────

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => m.navigate };
});

// ─── Data + mutation hooks. ──────────────────────────────────────────────────

vi.mock('@/api/hooks/useAutomations', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/hooks/useAutomations')>(),
  useAutomations: m.useAutomations,
  useAutomationList: m.useAutomations,
  usePinnedAutomations: m.usePinned,
  useAutomationHistory: m.useAutomationHistory,
  useToggleAutomation: () => ({ mutate: m.toggleMutate }),
  useDeleteAutomation: () => ({ mutate: m.deleteMutate }),
  useTestRunAutomation: () => ({ mutate: m.testRunMutate }),
  useReEnableAutomation: () => ({ mutate: m.reEnableMutate }),
  useImportAutomations: m.useImportAutomations,
  useDuplicateAutomation: () => ({mutate:m.duplicateMutate,isPending:false}),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: m.useVehicles }));
vi.mock('@/api/hooks/usePinned', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/hooks/usePinned')>(),
  usePinned: m.usePinned,
}));
vi.mock('@/hooks/useAutomationEvents', () => ({ useAutomationEvents: m.useAutomationEvents }));
vi.mock('@/hooks/useOperationalMode', () => ({ useOperationalMode: m.operationalMode }));

// ComfortPanel (embedded section) stays idle: its own contract tests cover
// behaviour; here it must only not fire live queries.
vi.mock('@/api/hooks/useComfort', () => ({
  useComfortNext: () => ({ data: undefined, isLoading: true, isError: false }),
  useComfortRuns: () => ({ data: [], isLoading: false, isError: false }),
  useSaveComfortConfig: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
  usePreconditionNow: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

// ─── Heavy child components → lightweight probes. ────────────────────────────

interface CardProbeProps {
  automation: Automation;
  isFiring: boolean;
  vehicleName?: string;
  onToggle: (id: number, enabled: boolean) => void;
  onReEnable: (id: number) => void;
  onDelete: (id: number) => void;
  onTestRun: (id: number) => void;
  onDuplicate: (id: number) => void;
}

vi.mock('./AutomationCard', () => ({
  AutomationCard: ({
    automation, isFiring, vehicleName, onToggle, onReEnable, onDelete, onTestRun, onDuplicate,
  }: CardProbeProps) => (
    <div data-testid="automation-card">
      <span>{automation.name}</span>
      {vehicleName ? <span>{`veh:${vehicleName}`}</span> : null}
      {isFiring ? <span>{`firing:${automation.id}`}</span> : null}
      <button type="button" onClick={() => onToggle(automation.id, !automation.enabled)}>
        {`toggle:${automation.id}`}
      </button>
      <button type="button" onClick={() => onReEnable(automation.id)}>{`reenable:${automation.id}`}</button>
      <button type="button" onClick={() => onDelete(automation.id)}>{`delete:${automation.id}`}</button>
      <button type="button" onClick={() => onDuplicate(automation.id)}>{`duplicate:${automation.id}`}</button>
      <button type="button" onClick={() => onTestRun(automation.id)}>{`testrun:${automation.id}`}</button>
    </div>
  ),
}));

vi.mock('./PresetGallery', () => ({
  PresetGallery: () => <div data-testid="preset-gallery">presets</div>,
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 1,
    name: 'Precondition Cabin',
    description: 'Warm the cabin before departure',
    enabled: true,
    vehicle_id: null,
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
    ...overrides,
  } as Automation;
}

const active = makeAutomation({ id: 1, name: 'Active One', enabled: true, auto_disabled: false });
const disabled = makeAutomation({ id: 2, name: 'Disabled One', enabled: false, auto_disabled: false });
const autoOff = makeAutomation({
  id: 3, name: 'Auto Off One', enabled: false, auto_disabled: true,
  auto_disabled_reason: 'too many failures',
});

let alertMock: ReturnType<typeof vi.fn>;

function setAutomations(
  data: AutomationListItem[] | undefined,
  extra: Partial<{
    isLoading: boolean;
    isError: boolean;
    isPending: boolean;
    isFetching: boolean;
    fetchStatus: 'fetching' | 'paused' | 'idle';
    error: unknown;
    refetch: () => void;
  }> = {},
) {
  m.useAutomations.mockReturnValue({
    data,
    isLoading: extra.isLoading ?? false,
    isError: extra.isError ?? false,
    error: extra.error ?? null,
    refetch: extra.refetch ?? vi.fn(),
    isPending: extra.isPending,
    isFetching: extra.isFetching,
    fetchStatus: extra.fetchStatus,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setAutomations([]);
  m.useAutomationHistory.mockReturnValue({ data: null, isLoading: false, error: undefined });
  m.useVehicles.mockReturnValue({ data: [] });
  m.usePinned.mockReturnValue({ data: [] });
  m.useAutomationEvents.mockReturnValue({
    events: [], connectionState: 'connected', firingNow: new Set<number>(), clearEvents: vi.fn(),
  });
  m.useImportAutomations.mockReturnValue({ mutate: m.importMutate, isPending: false });
  m.operationalMode.mockReturnValue({ mode: 'live', canWrite: true, isReadOnly: false, writeBlockReason: null });
  alertMock = vi.fn();
  window.alert = alertMock;
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AutomationsListPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(page());
  return { ...result, client, rerenderPage: () => result.rerender(page()) };
}

function kpiRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Automation summary' });
}

function metricValue(label: string): string {
  const labelEl = within(kpiRegion()).getByText(label);
  const card = labelEl.closest('[data-operational-metric]') as HTMLElement;
  return within(card).getByText(/^\d+$/).textContent ?? '';
}

// The embedded ComfortPanel shares the mocked vehicle query, so a vehicle
// refresh failure/paused state renders its own vehicle warning inside the
// comfort panel in addition to the page-level auxiliary warnings.
function pageAndComfortWarnings(): { pageWarnings: HTMLElement[]; comfortWarnings: HTMLElement[] } {
  const comfortPanel = screen.getByText('Cabin comfort Autopilot').closest('[data-surface-variant]');
  if (!(comfortPanel instanceof HTMLElement)) throw new Error('Missing comfort panel');
  const warnings = screen.getAllByTestId('stale-refresh-warning');
  return {
    pageWarnings: warnings.filter((w) => !comfortPanel.contains(w)),
    comfortWarnings: warnings.filter((w) => comfortPanel.contains(w)),
  };
}

describe('AutomationsListPage — validated query responses', () => {
  const pin = {
    id: 5, item_type: 'automation', item_id: '2', position: 0,
    pinned_at: '2026-10-01T00:00:00Z',
  };

  it.each([
    ['useAutomationList', null],
    ['useAutomationList', {}],
    ['useAutomationList', { items: [] }],
    ['useAutomationList', [null]],
    ['useAutomationList', [active, null]],
    ['useAutomationList', [{ ...active, enabled: 'true' }]],
    ['useAutomationList', [{ ...active, execution_count: '12' }]],
    ['usePinnedAutomations', null],
    ['usePinnedAutomations', {}],
    ['usePinnedAutomations', { items: [] }],
    ['usePinnedAutomations', [null]],
    ['usePinnedAutomations', [pin, null]],
    ['usePinnedAutomations', [{ ...pin, item_type: 'vehicle' }]],
    ['usePinnedAutomations', [{ ...pin, item_id: '' }]],
    ['usePinnedAutomations', [{ ...pin, item_id: '9007199254740992' }]],
    ['usePinnedAutomations', [{ ...pin, position: '0' }]],
    ['usePinnedAutomations', [{ ...pin, position: -1 }]],
    ['usePinnedAutomations', [{ ...pin, pinned_at: 'invalid' }]],
  ] as const)('%s rejects malformed payload %j as a query failure', async (hookName, payload) => {
    const hooks = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(payload);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, unmount } = renderHook(() => hooks[hookName](), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    try {
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
      expect(result.current.error?.message).toMatch(/Invalid .* response/);
      expect(request).toHaveBeenCalledWith(
        hookName === 'useAutomationList' ? '/automations' : '/pinned?type=automation',
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      unmount();
      client.clear();
      request.mockRestore();
    }
  });

  it.each(['useAutomationList', 'usePinnedAutomations'] as const)(
    '%s accepts an authoritative empty array',
    async (hookName) => {
      const hooks = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
      const request = vi.spyOn(apiClient, 'request').mockResolvedValue([]);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result, unmount } = renderHook(() => hooks[hookName](), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      });
      try {
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
        expect(result.current.error).toBeNull();
      } finally {
        unmount();
        client.clear();
        request.mockRestore();
      }
    },
  );

  it.each(['inventory', 'pins'] as const)(
    'shows a source-specific initial failure for malformed %s rather than a successful empty state',
    async (source) => {
      const hooks = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
      m.useAutomations.mockImplementation(hooks.useAutomationList);
      m.usePinned.mockImplementation(hooks.usePinnedAutomations);
      let failed = true;
      const request = vi.spyOn(apiClient, 'request').mockImplementation(async (path) => {
        if (path === '/automations') return source === 'inventory' && failed ? null : [active];
        if (path === '/pinned?type=automation') return source === 'pins' && failed ? null : [];
        throw new Error(`Unexpected request: ${path}`);
      });
      const { client, unmount } = renderPage();
      try {
        await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());
        expect(screen.queryByText(/No automations yet/)).not.toBeInTheDocument();
        expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
        if (source === 'inventory') {
          expect(screen.queryByTestId('automation-card')).not.toBeInTheDocument();
          expect(within(kpiRegion()).queryByText(/^\d+$/)).not.toBeInTheDocument();
        } else {
          expect(screen.getByText('Active One')).toBeInTheDocument();
          expect(within(screen.getByRole('region', { name: 'Pinned' })).getByRole('alert')).toBeInTheDocument();
        }
        failed = false;
        request.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument());
        expect(screen.getByText('Active One')).toBeInTheDocument();
        expect(metricValue('Total')).toBe('1');
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(
          source === 'inventory' ? '/automations' : '/pinned?type=automation',
          { signal: expect.any(AbortSignal) },
        );
      } finally {
        unmount();
        client.clear();
        request.mockRestore();
      }
    },
  );

  it.each(['inventory', 'pins'] as const)(
    'retains valid data on malformed %s refresh and retries only that source through recovery',
    async (source) => {
      const hooks = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
      m.useAutomations.mockImplementation(hooks.useAutomationList);
      m.usePinned.mockImplementation(hooks.usePinnedAutomations);
      let inventory: unknown = [active, disabled];
      let pins: unknown = [pin];
      const request = vi.spyOn(apiClient, 'request').mockImplementation(async (path) => {
        if (path === '/automations') return inventory;
        if (path === '/pinned?type=automation') return pins;
        throw new Error(`Unexpected request: ${path}`);
      });
      const { client, unmount } = renderPage();
      const key = source === 'inventory' ? ['automations'] : ['pinned', 'automation', null];
      try {
        await waitFor(() => expect(screen.getAllByTestId('automation-card')).toHaveLength(2));
        await waitFor(() => expect(within(screen.getAllByTestId('automation-card')[0]).getByText('Disabled One')).toBeInTheDocument());
        expect(metricValue('Total')).toBe('2');
        const validData = client.getQueryData(key);
        const updatedAt = client.getQueryState(key)?.dataUpdatedAt;
        if (source === 'inventory') inventory = [active, null];
        else pins = [null];
        await act(async () => { await client.invalidateQueries({ queryKey: key, exact: true }); });
        await waitFor(() => expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument());
        expect(client.getQueryData(key)).toEqual(validData);
        expect(client.getQueryState(key)?.dataUpdatedAt).toBe(updatedAt);
        expect(metricValue('Total')).toBe('2');
        expect(within(screen.getAllByTestId('automation-card')[0]).getByText('Disabled One')).toBeInTheDocument();
        expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
        expect(screen.queryByText(/No automations yet/)).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: 'One' } });

        inventory = source === 'inventory' ? [] : [active, disabled];
        pins = source === 'pins' ? [] : [pin];
        request.mockClear();
        fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
        await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument());
        expect(request).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(
          source === 'inventory' ? '/automations' : '/pinned?type=automation',
          { signal: expect.any(AbortSignal) },
        );
        expect(screen.getByLabelText('Search automations...')).toHaveValue('One');
        if (source === 'inventory') {
          expect(screen.getByText(/No automations yet/)).toBeInTheDocument();
          expect(metricValue('Total')).toBe('0');
        } else {
          expect(within(screen.getAllByTestId('automation-card')[0]).getByText('Active One')).toBeInTheDocument();
          expect(metricValue('Total')).toBe('2');
        }
      } finally {
        unmount();
        client.clear();
        request.mockRestore();
      }
    },
  );
});

// ═══ Pure helpers ════════════════════════════════════════════════════════════

describe('computeStats', () => {
  it('keeps unavailable classifications unknown without discarding the base row', () => {
    const row: AutomationListItem = {
      id: 10, name: 'Base row', description: null, enabled: true, vehicle_id: null,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      execution_count: null, failure_count: null, auto_disabled: null, last_triggered_at: null,
    };
    expect(assertAutomationInventory([row])).toEqual([row]);
    expect(automationStatus(row)).toBeNull();
    expect(computeStats([active, row, autoOff])).toEqual({
      total: 3, active: undefined, disabled: undefined, autoDisabled: undefined,
    });
    setAutomations([row]);
    renderPage();
    expect(screen.getByText('Base row')).toBeInTheDocument();
    expect(metricValue('Total')).toBe('1');
    assertOperationalMetricUnavailable(kpiRegion(), 'Active');
    assertOperationalMetricUnavailable(kpiRegion(), 'Disabled');
    assertOperationalMetricUnavailable(kpiRegion(), 'Auto-disabled');
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('3 empty fields are hidden.');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by status' }), { target: { value: 'active' } });
    expect(screen.queryByTestId('automation-card')).not.toBeInTheDocument();
  });
  it('returns all-zero stats for an empty list', () => {
    expect(computeStats([])).toEqual({ total: 0, active: 0, disabled: 0, autoDisabled: 0 });
  });

  describe('automation card history metadata', () => {
    it('does not invent zero counts or never-run history when metadata is unavailable', () => {
      const row: AutomationListItem = {
        id: 10, name: 'Base row', description: null, enabled: true, vehicle_id: null,
        created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
        execution_count: null, failure_count: null, last_triggered_at: null, auto_disabled: null,
      };
      render(<AutomationCardStatistics automation={row} />);
      expect(screen.getByText('Runs: Unknown')).toBeInTheDocument();
      expect(screen.getByText('Fails: Unknown')).toBeInTheDocument();
      expect(screen.getByText('Last: Unknown')).toBeInTheDocument();
      expect(screen.queryByText('Never run')).not.toBeInTheDocument();
    });

    it('preserves confirmed zero and populated counters', () => {
      const { rerender } = render(<AutomationCardStatistics automation={makeAutomation()} />);
      expect(screen.getByText('Never run')).toBeInTheDocument();
      expect(screen.getByText('Runs: 0')).toBeInTheDocument();
      rerender(<AutomationCardStatistics automation={makeAutomation({ execution_count: 12, failure_count: 2 })} />);
      expect(screen.getByText('Runs: 12')).toBeInTheDocument();
      expect(screen.getByText('Fails: 2')).toBeInTheDocument();
      expect(screen.queryByText('Never run')).not.toBeInTheDocument();
    });
  });

  it('classifies active, disabled and auto-disabled automations', () => {
    expect(computeStats([active, disabled, autoOff])).toEqual({
      total: 3, active: 1, disabled: 1, autoDisabled: 1,
    });
  });

  it('gives auto_disabled precedence over an enabled flag', () => {
    const conflicting = makeAutomation({ id: 9, enabled: true, auto_disabled: true });
    const stats = computeStats([conflicting]);
    expect(stats.autoDisabled).toBe(1);
    expect(stats.active).toBe(0);
  });
});

describe('buildVehicleLookup', () => {
  it('maps vehicle ids to display names', () => {
    const map = buildVehicleLookup([
      { id: 1, display_name: 'Roadster' },
      { id: 2, display_name: 'Plaid' },
    ]);
    expect(map.get(1)).toBe('Roadster');
    expect(map.get(2)).toBe('Plaid');
    expect(map.get(3)).toBeUndefined();
  });

  it('returns an empty map for no vehicles', () => {
    expect(buildVehicleLookup([]).size).toBe(0);
  });
});

describe('isRecord / isAutomationImportEnvelope', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('accepts a typed envelope and rejects legacy/malformed shapes', () => {
    expect(isAutomationImportEnvelope({ version: 1, automations: [] })).toBe(true);
    expect(isAutomationImportEnvelope({ automations: [] })).toBe(false); // no version
    expect(isAutomationImportEnvelope({ version: 1 })).toBe(false); // no automations array
    expect(isAutomationImportEnvelope({ version: '1', automations: [] })).toBe(false);
    expect(isAutomationImportEnvelope(null)).toBe(false);
    expect(isAutomationImportEnvelope([])).toBe(false);
  });
});

// ═══ KPI band ════════════════════════════════════════════════════════════════

describe('AutomationsListPage — KPI band', () => {
  it('opens the real review drawer with loaded unfiltered rule context without mutating a rule', () => {
    setAutomations([active, disabled, autoOff]);
    renderPage();
    fireEvent.click(within(kpiRegion()).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Rule inventory details' });
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Full loaded rule set, before status and search filters.').length).toBeGreaterThan(0);
    expect(m.toggleMutate).not.toHaveBeenCalled();
    expect(m.deleteMutate).not.toHaveBeenCalled();
    expect(m.testRunMutate).not.toHaveBeenCalled();
  });
  it('renders the page heading and subtitle', () => {
    renderPage();
    const heading = screen.getByRole('heading', { level: 1, name: 'Automations' });
    expect(heading).toHaveAttribute('data-route-focus-target', 'true');
    expect(heading.closest('header')).toHaveClass('border-0', 'bg-transparent');
    expect(screen.getByRole('button', { name: 'Manage rules' })
      .closest('[data-action-group]')).toHaveAttribute('data-action-group', 'secondary');
    expect(screen.getByRole('button', { name: 'Import' })
      .closest('[data-action-group]')).toHaveAttribute('data-action-group', 'overflow');
    expect(screen.getByRole('button', { name: 'Create' })
      .closest('[data-action-group]')).toHaveAttribute('data-action-group', 'primary');
    expect(
      screen.getByText(/Automate vehicle actions with typed triggers/),
    ).toBeInTheDocument();
  });

  it('maps each computed stat to the correct metric card', () => {
    // 3 active, 2 disabled, 1 auto-disabled → total 6 (distinct values).
    setAutomations([
      makeAutomation({ id: 1, enabled: true }),
      makeAutomation({ id: 2, enabled: true }),
      makeAutomation({ id: 3, enabled: true }),
      makeAutomation({ id: 4, enabled: false }),
      makeAutomation({ id: 5, enabled: false }),
      makeAutomation({ id: 6, enabled: false, auto_disabled: true }),
    ]);
    renderPage();
    expect(metricValue('Total')).toBe('6');
    expect(metricValue('Active')).toBe('3');
    expect(metricValue('Disabled')).toBe('2');
    expect(metricValue('Auto-disabled')).toBe('1');
  });
});

// ═══ Auto-disabled warning ═══════════════════════════════════════════════════

describe('AutomationsListPage — auto-disabled warning', () => {
  it('shows a danger banner with the count when automations are auto-disabled', () => {
    setAutomations([autoOff, makeAutomation({ id: 4, auto_disabled: true })]);
    renderPage();
    expect(screen.getByText('Attention needed')).toBeInTheDocument();
    expect(
      screen.getByText(/2 automation\(s\) have been auto-disabled due to repeated failures\./),
    ).toBeInTheDocument();
  });

  it('hides the banner when nothing is auto-disabled', () => {
    setAutomations([active, disabled]);
    renderPage();
    expect(screen.queryByText('Attention needed')).toBeNull();
  });
});

// ═══ Filters ═════════════════════════════════════════════════════════════════

describe('AutomationsListPage — filter toolbar', () => {
  it('shows every automation before any filter is applied', () => {
    setAutomations([active, disabled, autoOff]);
    renderPage();
    expect(screen.getAllByTestId('automation-card')).toHaveLength(3);
  });

  // One fresh render per status value: a repeated fireEvent.change on the same
  // controlled <select> does not re-fire React's onChange in jsdom, so each
  // transition is exercised in isolation rather than chained.
  it.each([
    ['active', 'Active One', ['Disabled One', 'Auto Off One']],
    ['disabled', 'Disabled One', ['Active One', 'Auto Off One']],
    ['auto-disabled', 'Auto Off One', ['Active One', 'Disabled One']],
  ] as const)('status filter %s keeps only the matching automations', (value, shown, hidden) => {
    setAutomations([active, disabled, autoOff]);
    renderPage();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value } });
    expect(screen.getByText(shown)).toBeInTheDocument();
    for (const h of hidden) {
      expect(screen.queryByText(h)).toBeNull();
    }
  });

  it('filters by search text matching the automation name', () => {
    setAutomations([
      makeAutomation({ id: 1, name: 'Charge Overnight', description: 'grid off-peak' }),
      makeAutomation({ id: 2, name: 'Cabin Warmup', description: 'preheat' }),
    ]);
    renderPage();
    fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: 'overnight' } });
    expect(screen.getByText('Charge Overnight')).toBeInTheDocument();
    expect(screen.queryByText('Cabin Warmup')).toBeNull();
  });

  it('filters by search text matching the description field', () => {
    setAutomations([
      makeAutomation({ id: 1, name: 'Charge Overnight', description: 'grid off-peak' }),
      makeAutomation({ id: 2, name: 'Cabin Warmup', description: 'preheat' }),
    ]);
    renderPage();
    fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: 'preheat' } });
    expect(screen.getByText('Cabin Warmup')).toBeInTheDocument();
    expect(screen.queryByText('Charge Overnight')).toBeNull();
  });

  it('ignores surrounding whitespace in the search query', () => {
    setAutomations([
      makeAutomation({ id: 1, name: 'Charge Overnight', description: 'grid off-peak' }),
      makeAutomation({ id: 2, name: 'Cabin Warmup', description: 'preheat' }),
    ]);
    renderPage();
    // A leading/trailing space must not defeat the match (query is trimmed).
    fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: '  cabin  ' } });
    expect(screen.getByText('Cabin Warmup')).toBeInTheDocument();
    expect(screen.queryByText('Charge Overnight')).toBeNull();
  });

  it('shows a shown/total badge only while a filter is active', () => {
    setAutomations([active, disabled, autoOff]);
    renderPage();
    expect(screen.queryByText(/^\d+ \/ \d+$/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'active' } });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('renders a no-match empty state and resets filters on demand', () => {
    setAutomations([active, disabled]);
    renderPage();

    fireEvent.change(screen.getByLabelText('Search automations...'), {
      target: { value: 'zzz-nothing-matches' },
    });
    expect(screen.getByText('No automations match your filters')).toBeInTheDocument();
    expect(screen.queryByTestId('automation-card')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getAllByTestId('automation-card')).toHaveLength(2);
    expect(screen.queryByText('No automations match your filters')).toBeNull();
  });
});

// ═══ Workspace loading / error / empty ═══════════════════════════════════════

describe('AutomationsListPage — workspace states', () => {
  function expectUnresolvedInventory() {
    expect(screen.queryByText(/No automations yet/)).not.toBeInTheDocument();
    expect(screen.queryByText('No automations match your filters')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+ \/ \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('automation-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
    expect(screen.getByText('Cabin comfort Autopilot')).toBeInTheDocument();
  }

  it.each([
    { isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching' as const },
    { isLoading: false, isPending: true, isFetching: true, fetchStatus: 'fetching' as const },
  ])('does not infer empty counts during active initial loading: %j', (state) => {
    setAutomations(undefined, state);
    const { container } = renderPage();
    fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: 'cabin' } });
    expectUnresolvedInventory();
    expect(container.querySelectorAll('[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]').length).toBeGreaterThanOrEqual(4);
  });

  it.each(['paused', 'idle'] as const)('keeps %s without data distinct from successful empty and recovers', (fetchStatus) => {
    const refetch = vi.fn();
    setAutomations(undefined, { isPending: true, fetchStatus, refetch });
    const { rerenderPage } = renderPage();
    fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: 'Active' } });
    expectUnresolvedInventory();
    const notice = screen.getByText('No requested source has returned usable data yet.').closest('[role="status"]');
    if (!(notice instanceof HTMLElement)) throw new Error('Missing unresolved inventory notice');
    expect(within(notice).getByText(fetchStatus === 'paused' ? 'Refresh paused' : 'Pending')).toBeInTheDocument();
    expect(notice?.textContent).not.toMatch(/offline|failed|previously loaded/i);
    fireEvent.click(within(notice).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    setAutomations([active]);
    rerenderPage();
    expect(screen.queryByText('No requested source has returned usable data yet.')).not.toBeInTheDocument();
    expect(screen.getByText('Active One')).toBeInTheDocument();
    expect(screen.getByText('Showing 1')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('shows genuine empty and zero counts only after a successful response', () => {
    setAutomations([]);
    renderPage();
    fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: 'cabin' } });
    expect(screen.getByText(/No automations yet/)).toBeInTheDocument();
    expect(screen.getByText('Showing 0')).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
    for (const label of ['Total', 'Active', 'Disabled', 'Auto-disabled']) {
      expect(metricValue(label)).toBe('0');
    }
  });

  it('retains filtered rules during refresh failure and updates only after recovery', () => {
    const refetch = vi.fn();
    setAutomations([active, disabled], { isError: true, error: new ApiError('refresh failed', 500), refetch });
    const { rerenderPage } = renderPage();
    fireEvent.change(screen.getByLabelText('Search automations...'), { target: { value: 'Active' } });
    expect(screen.getByText('Active One')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Showing 1')).toBeInTheDocument();
    expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
    expect(screen.getByText('Cabin comfort Autopilot')).toBeInTheDocument();
    const warning = screen.getByTestId('stale-refresh-warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    setAutomations([active, disabled], { isFetching: true, fetchStatus: 'fetching', error: new ApiError('refresh failed', 500), refetch });
    rerenderPage();
    expect(screen.getByText('Active One')).toBeInTheDocument();
    expect(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Updating…' })).toBeDisabled();

    setAutomations([]);
    rerenderPage();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText(/No automations yet/)).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
    expect(screen.getByLabelText('Search automations...')).toHaveValue('Active');
  });

  it('renders skeleton placeholders while loading and no cards', () => {
    setAutomations(undefined, { isLoading: true });
    const { container } = renderPage();
    expect(container.querySelectorAll('[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]').length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByTestId('automation-card')).toBeNull();
  });

  it('renders a QueryError with a working retry when the list request fails', () => {
    const refetch = vi.fn();
    setAutomations(undefined, { isError: true, error: new ApiError('boom', 500), refetch });
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Server error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the create-first-automation empty state when there are none', () => {
    setAutomations([]);
    renderPage();
    expect(screen.getByText(/No automations yet/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Create automation' });
    expect(cta).toHaveAttribute('href', '/automations/new');
  });
});

// ═══ Cards + callback wiring ═════════════════════════════════════════════════

describe('AutomationsListPage — card wiring', () => {
  it('resolves the vehicle display name and firing flag per card', () => {
    m.useVehicles.mockReturnValue({ data: [{ id: 7, display_name: 'Model 3' }] });
    m.useAutomationEvents.mockReturnValue({
      events: [], connectionState: 'connected', firingNow: new Set<number>([1]), clearEvents: vi.fn(),
    });
    setAutomations([makeAutomation({ id: 1, vehicle_id: 7 })]);
    renderPage();
    expect(screen.getByText('veh:Model 3')).toBeInTheDocument();
    expect(screen.getByText('firing:1')).toBeInTheDocument();
  });

  it('invokes the toggle / re-enable / delete / test-run mutations with the automation id', () => {
    setAutomations([makeAutomation({ id: 42, enabled: true })]);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'toggle:42' }));
    expect(m.toggleMutate).toHaveBeenCalledWith({ id: 42, enabled: false });

    fireEvent.click(screen.getByRole('button', { name: 'reenable:42' }));
    expect(m.reEnableMutate).toHaveBeenCalledWith(42);

    fireEvent.click(screen.getByRole('button', { name: 'delete:42' }));
    expect(m.deleteMutate).toHaveBeenCalledWith(42);

    fireEvent.click(screen.getByRole('button', { name: 'testrun:42' }));
    expect(m.testRunMutate).toHaveBeenCalledWith(42);
  });

  it('opens the newly created copy only after the create mutation succeeds', () => {
    setAutomations([makeAutomation({id:42,name:'Morning charge'})]);renderPage();
    fireEvent.click(screen.getByRole('button',{name:'duplicate:42'}));
    expect(m.duplicateMutate).toHaveBeenCalledWith(42,expect.objectContaining({onSuccess:expect.any(Function)}));
    expect(m.navigate).not.toHaveBeenCalled();
    const options=m.duplicateMutate.mock.calls[0][1];
    options.onSuccess({id:99,enabled:false});
    expect(m.navigate).toHaveBeenCalledWith('/automations/99/edit');
  });

  it('orders pinned automations ahead of the rest', () => {
    m.usePinned.mockReturnValue({ data: [{ item_id: '2', position: 0 }] });
    setAutomations([
      makeAutomation({ id: 1, name: 'First By Default' }),
      makeAutomation({ id: 2, name: 'Pinned Winner' }),
    ]);
    renderPage();
    const names = screen.getAllByTestId('automation-card').map(
      (card) => within(card).getByText(/By Default|Winner/).textContent,
    );
    expect(names[0]).toBe('Pinned Winner');
    expect(names[1]).toBe('First By Default');
  });
});

// ═══ Typed import ════════════════════════════════════════════════════════════

function uploadFile(name: string, content: string) {
  const file = new File([content], name, { type: 'application/json' });
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  }
  const input = screen.getByLabelText('Choose automation export file');
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('AutomationsListPage — typed import', () => {
  it('blocks file import outside live mode even for a dispatched input change', () => {
    m.operationalMode.mockReturnValue({
      mode: 'cached', canWrite: false, isReadOnly: true,
      writeBlockReason: 'Reconnect before making operational changes.',
    });
    renderPage();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    const input = screen.getByLabelText('Choose automation export file');
    expect(input).toBeDisabled();
    uploadFile('export.json', JSON.stringify({ version: 1, automations: [{ name: 'Rule' }] }));
    expect(m.importMutate).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it.each([
    { imported: [{ id: 8, name: 'Imported rule' }], errors: [], outcome: 'success' },
    { imported: [{ id: 8, name: 'Imported rule' }], errors: [{ index: 1, name: 'Invalid rule', error: 'unsupported trigger' }], outcome: 'partial' },
    { imported: [], errors: [{ index: 0, name: 'Invalid rule', error: 'unsupported trigger' }], outcome: 'failed' },
  ])('uses the real hook arrays for a $outcome outcome and keeps the live guard', async ({ imported, errors, outcome }) => {
    const hooks = await vi.importActual<typeof import('@/api/hooks/useAutomations')>('@/api/hooks/useAutomations');
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ imported, errors });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result, unmount } = renderHook(() => hooks.useImportAutomations(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    const envelope = { version: 1, automations: [{ name: 'Rule' }] };
    try {
      let data: unknown;
      await act(async () => { data = await result.current.mutateAsync(envelope); });
      expect(request).toHaveBeenCalledWith('/automations/import', expect.objectContaining({
        method: 'POST', requiresLiveMode: true, acceptedStatuses: [422],
        body: JSON.stringify(envelope),
      }));
      // mutateAsync resolves with the validated per-item arrays (a malformed
      // response would reject here); the observer snapshot no longer retains it.
      expect(data).toEqual({ imported, errors });
      expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['automations'] }));
      expect(m.importSuccess).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
      expect(m.importWarning).toHaveBeenCalledTimes(outcome === 'partial' ? 1 : 0);
      expect(m.importError).toHaveBeenCalledTimes(outcome === 'failed' ? 1 : 0);
    } finally {
      unmount();
      request.mockRestore();
      client.clear();
    }
  });

  it('validates real per-item import outcomes rather than synthetic counts', () => {
    const result = {
      imported: [{ id: 8, name: 'Imported rule' }],
      errors: [{ index: 1, name: 'Invalid rule', error: 'unsupported trigger' }],
    };
    expect(assertAutomationImportResult(result)).toEqual(result);
    expect(assertAutomationImportResult({ imported: [], errors: [] })).toEqual({ imported: [], errors: [] });
    expect(() => assertAutomationImportResult({ imported: 1, skipped: 1 })).toThrow('Invalid automation import response');
    expect(() => assertAutomationImportResult({ imported: [], errors: [{ index: -1 }] })).toThrow();
  });

  it('exposes partial outcomes and guides retry of only the failed entries', () => {
    m.useImportAutomations.mockReturnValue({
      mutate: m.importMutate, isPending: false,
      data: {
        imported: [{ id: 8, name: 'Imported rule' }],
        errors: [{ index: 1, name: 'Invalid rule', error: 'unsupported trigger' }],
      },
    });
    renderPage();
    const result = screen.getByRole('status', { name: 'Import' });
    expect(within(result).getByText('1 succeeded, 1 failed')).toBeInTheDocument();
    expect(within(result).getByText('Entry 2 (Invalid rule): unsupported trigger')).toBeInTheDocument();
    expect(within(result).getByText(/import only the failed entries/)).toBeInTheDocument();
    expect(within(result).getByText(/creates duplicates/)).toBeInTheDocument();
    expect(m.importMutate).not.toHaveBeenCalled();
  });

  it.each([0, 2])('renders a successful import with %i actual imported rows', (count) => {
    m.useImportAutomations.mockReturnValue({
      mutate: m.importMutate, isPending: false,
      data: { imported: Array.from({ length: count }, (_, i) => ({ id: i + 1, name: 'Rule' })), errors: [] },
    });
    renderPage();
    const result = screen.getByRole('status', { name: 'Import' });
    expect(within(result).getByText(`${count} succeeded, 0 failed`)).toBeInTheDocument();
    expect(within(result).queryByText(/import only the failed entries/)).not.toBeInTheDocument();
  });

  it('sends a valid typed envelope to the import mutation', async () => {
    renderPage();
    // Version 2 tests client forwarding only; the real server accepts version 1.
    const envelope = { version: 2, exported_at: '2024-01-01', automations: [{ name: 'x' }] };
    uploadFile('export.json', JSON.stringify(envelope));
    await waitFor(() => expect(m.importMutate).toHaveBeenCalledWith(envelope));
    expect(alertMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Choose automation export file')).toHaveValue('');
  });

  it('rejects a legacy (untyped) export and alerts instead of importing', async () => {
    renderPage();
    uploadFile('legacy.json', JSON.stringify({ automations: [{ name: 'x' }] }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    expect(m.importMutate).not.toHaveBeenCalled();
    expect(String(alertMock.mock.calls[0][0])).toMatch(/Typed automation import failed/);
    expect(screen.getByLabelText('Choose automation export file')).toHaveValue('');
  });

  it('surfaces a parse error for malformed JSON', async () => {
    renderPage();
    uploadFile('broken.json', '{ not json ');
    await waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    expect(m.importMutate).not.toHaveBeenCalled();
  });

  it('marks the import button busy while a request is pending', () => {
    m.useImportAutomations.mockReturnValue({ mutate: m.importMutate, isPending: true });
    renderPage();
    const importBtn = screen.getByRole('button', { name: 'Import' });
    expect(importBtn).toBeDisabled();
    expect(importBtn).toHaveAttribute('aria-busy', 'true');
  });
});

// ═══ Navigation + dedicated activity route ══════════════════════════════════

describe('AutomationsListPage — navigation & activity', () => {
  it('navigates to the builder when Create is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(m.navigate).toHaveBeenCalledWith('/automations/new');
    fireEvent.click(screen.getByRole('button', { name: 'Manage rules' }));
    expect(m.navigate).toHaveBeenCalledWith('/automations/list');
  });

  it('does not mount the recent-activity widget or fetch its limited history', () => {
    renderPage();
    expect(screen.queryByTestId('activity-feed')).not.toBeInTheDocument();
    expect(m.useAutomationHistory).not.toHaveBeenCalled();
  });
});

describe('AutomationsListPage reserved phase5 presentation and source trust', () => {
  it('keeps all header actions reachable with mobile targets and wrapping labels', () => {
    renderPage();
    for (const name of ['Manage rules', 'Import', 'Create']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9');
    }
    expect(screen.getByLabelText('Filter by status')).toHaveClass('min-h-11');
    expect(screen.getByLabelText('Search automations...')).toHaveClass('min-h-11');
  });

  it('preserves preset disclosure with neutral decoration and visible theme-aware focus', () => {
    renderPage();
    const summary = screen.getByLabelText('Show or hide quick start templates');
    expect(summary).toHaveClass(
      'min-h-11', 'flex-wrap', 'hover:bg-[var(--control-bg-hover)]',
      'focus-visible:outline-[var(--focus-ring)]', 'motion-reduce:transition-none',
    );
    expect(summary.className).not.toMatch(/cyan|white|glow/);
    expect(summary.querySelectorAll('svg')).toHaveLength(2);
    for (const icon of summary.querySelectorAll('svg')) {
      expect(icon).toHaveClass('text-[var(--text-muted)]');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
  });

  it.each([
    ['missing lookup', []],
    ['blank name', [{ id: 7, display_name: '' }]],
    ['whitespace name', [{ id: 7, display_name: '   ' }]],
  ])('marks a scoped vehicle unknown for %s instead of fleet-wide', (_name, vehicles) => {
    setAutomations([makeAutomation({ id: 91, vehicle_id: 7 })]);
    m.useVehicles.mockReturnValue({ data: vehicles });
    renderPage();
    expect(screen.getByText('veh:Unknown')).toBeInTheDocument();
    expect(screen.queryByText('veh:All vehicles')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'toggle:91' })).toBeInTheDocument();
  });

  it('leaves fleet-wide scope unset and preserves the exact resolved vehicle name', () => {
    setAutomations([
      makeAutomation({ id: 1, name: 'Fleet rule', vehicle_id: null }),
      makeAutomation({ id: 2, name: 'Scoped rule', vehicle_id: 7 }),
    ]);
    m.useVehicles.mockReturnValue({ data: [{ id: 7, display_name: '  Source Name  ' }] });
    renderPage();
    const cards = screen.getAllByTestId('automation-card');
    expect(within(cards[0]).queryByText(/^veh:/)).not.toBeInTheDocument();
    expect(within(cards[1]).getByText(/^veh:/).textContent).toBe('veh:  Source Name  ');
  });

  it('keeps rules and presets visible while independent auxiliary sources load', () => {
    setAutomations([active]);
    m.useVehicles.mockReturnValue({ data: undefined, isLoading: true });
    m.usePinned.mockReturnValue({ data: undefined, isLoading: true });
    renderPage();
    expect(within(screen.getByRole('region', { name: 'Vehicle' })).getByText('Loading...')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Pinned' })).getByText('Loading...')).toBeInTheDocument();
    expect(screen.getByText('Active One')).toBeInTheDocument();
    expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
    expect(metricValue('Total')).toBe('1');
  });

  it('provides separate vehicle and pin retries without replacing the rule inventory', () => {
    const retryVehicles = vi.fn();
    const retryPins = vi.fn();
    setAutomations([makeAutomation({ vehicle_id: 7 })]);
    m.useVehicles.mockReturnValue({ data: undefined, error: new ApiError('vehicle failed', 500), refetch: retryVehicles });
    m.usePinned.mockReturnValue({ data: undefined, error: new ApiError('pin failed', 500), refetch: retryPins });
    renderPage();
    fireEvent.click(within(screen.getByRole('region', { name: 'Vehicle' })).getByRole('button', { name: 'Retry' }));
    expect(retryVehicles).toHaveBeenCalledTimes(1);
    expect(retryPins).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('region', { name: 'Pinned' })).getByRole('button', { name: 'Retry' }));
    expect(retryPins).toHaveBeenCalledTimes(1);
    expect(screen.getByText('veh:Unknown')).toBeInTheDocument();
    expect(screen.getAllByTestId('automation-card')).toHaveLength(1);
    expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
  });

  it('retains vehicle identity and pin ordering through independent refresh failures', () => {
    const retryVehicles = vi.fn();
    const retryPins = vi.fn();
    setAutomations([
      makeAutomation({ id: 1, name: 'Source first' }),
      makeAutomation({ id: 2, name: 'Retained pin', vehicle_id: 7 }),
    ]);
    m.useVehicles.mockReturnValue({
      data: [{ id: 7, display_name: 'Retained name' }],
      error: new ApiError('vehicle refresh failed', 500), refetch: retryVehicles,
    });
    m.usePinned.mockReturnValue({
      data: [{ item_id: '2', position: 0 }],
      error: new ApiError('pin refresh failed', 500), refetch: retryPins,
    });
    renderPage();
    const cards = screen.getAllByTestId('automation-card');
    expect(within(cards[0]).getByText('Retained pin')).toBeInTheDocument();
    expect(within(cards[0]).getByText('veh:Retained name')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Source first')).toBeInTheDocument();
    const { pageWarnings, comfortWarnings } = pageAndComfortWarnings();
    expect(pageWarnings).toHaveLength(2);
    expect(comfortWarnings).toHaveLength(1);
    expect(comfortWarnings[0]).toHaveTextContent('Vehicle may be out of date');
    fireEvent.click(within(pageWarnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(retryVehicles).toHaveBeenCalledTimes(1);
    expect(retryPins).not.toHaveBeenCalled();
    fireEvent.click(within(pageWarnings[1]).getByRole('button', { name: 'Refresh' }));
    expect(retryPins).toHaveBeenCalledTimes(1);
    fireEvent.click(within(comfortWarnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(retryVehicles).toHaveBeenCalledTimes(2);
  });

  it('retains paused sources without claiming the vehicle is offline', () => {
    setAutomations([makeAutomation({ vehicle_id: 7 })]);
    m.useVehicles.mockReturnValue({ data: [{ id: 7, display_name: 'Paused name' }], fetchStatus: 'paused' });
    m.usePinned.mockReturnValue({ data: [], fetchStatus: 'paused' });
    renderPage();
    expect(screen.getByText('veh:Paused name')).toBeInTheDocument();
    const { pageWarnings, comfortWarnings } = pageAndComfortWarnings();
    expect(pageWarnings).toHaveLength(2);
    expect(comfortWarnings).toHaveLength(1);
    for (const warning of [...pageWarnings, ...comfortWarnings]) {
      expect(warning).toHaveAttribute('data-refresh-blocked', 'true');
      expect(warning.textContent).not.toMatch(/offline/i);
    }
    expect(comfortWarnings[0]).toHaveTextContent('Vehicle may be out of date');
  });

  it('shows stream reconnection without inventing rule activity or triggering mutations', () => {
    setAutomations([active]);
    m.useAutomationEvents.mockReturnValue({
      events: [], connectionState: 'reconnecting', firingNow: new Set<number>(), clearEvents: vi.fn(),
    });
    renderPage();
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(screen.getByText('Active One')).toBeInTheDocument();
    expect(screen.queryByText('firing:1')).not.toBeInTheDocument();
    expect(m.toggleMutate).not.toHaveBeenCalled();
    expect(m.reEnableMutate).not.toHaveBeenCalled();
    expect(m.testRunMutate).not.toHaveBeenCalled();
    expect(m.deleteMutate).not.toHaveBeenCalled();
    expect(m.importMutate).not.toHaveBeenCalled();
  });

  it('keeps retained rules, summary, presets and filters after an inventory refresh failure', () => {
    setAutomations([active, disabled], { error: new ApiError('inventory refresh failed', 500) });
    renderPage();
    expect(screen.getAllByTestId('automation-card')).toHaveLength(2);
    expect(metricValue('Total')).toBe('2');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('preset-gallery')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'disabled' } });
    expect(screen.getByText('Disabled One')).toBeInTheDocument();
    expect(screen.queryByText('Active One')).not.toBeInTheDocument();
    expect(metricValue('Total')).toBe('2');
  });
});
