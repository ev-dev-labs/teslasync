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
//   - create navigation + activity-feed prop plumbing
//
// Repo test conventions: framer-motion is mocked so FadeIn/Stagger render
// eagerly, react-i18next is mocked with an interpolating fallback `t`, the
// three heavy child components (AutomationCard / AutomationActivityFeed /
// PresetGallery) are replaced with lightweight probes, and every data/mutation
// hook is mocked so the page never touches the network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import type { Automation } from '@/api/types';
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
  navigate: vi.fn(),
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

vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomations: m.useAutomations,
  useAutomationHistory: m.useAutomationHistory,
  useToggleAutomation: () => ({ mutate: m.toggleMutate }),
  useDeleteAutomation: () => ({ mutate: m.deleteMutate }),
  useTestRunAutomation: () => ({ mutate: m.testRunMutate }),
  useReEnableAutomation: () => ({ mutate: m.reEnableMutate }),
  useImportAutomations: m.useImportAutomations,
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: m.useVehicles }));
vi.mock('@/api/hooks/usePinned', () => ({ usePinned: m.usePinned }));
vi.mock('@/hooks/useAutomationEvents', () => ({ useAutomationEvents: m.useAutomationEvents }));

// ─── Heavy child components → lightweight probes. ────────────────────────────

interface CardProbeProps {
  automation: Automation;
  isFiring: boolean;
  vehicleName?: string;
  onToggle: (id: number, enabled: boolean) => void;
  onReEnable: (id: number) => void;
  onDelete: (id: number) => void;
  onTestRun: (id: number) => void;
}

vi.mock('./AutomationCard', () => ({
  AutomationCard: ({
    automation, isFiring, vehicleName, onToggle, onReEnable, onDelete, onTestRun,
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
      <button type="button" onClick={() => onTestRun(automation.id)}>{`testrun:${automation.id}`}</button>
    </div>
  ),
}));

interface FeedProbeProps {
  history?: unknown[];
  historyStats?: unknown;
  isLoading?: boolean;
  error?: unknown;
  liveEvents?: unknown[];
  connectionState?: string;
}

vi.mock('./AutomationActivityFeed', () => ({
  AutomationActivityFeed: ({
    history, historyStats, isLoading, error, liveEvents, connectionState,
  }: FeedProbeProps) => (
    <div data-testid="activity-feed">
      <span data-testid="feed-history-count">{(history ?? []).length}</span>
      <span data-testid="feed-live-count">{(liveEvents ?? []).length}</span>
      <span data-testid="feed-conn">{connectionState}</span>
      <span data-testid="feed-loading">{isLoading ? 'loading' : 'idle'}</span>
      <span data-testid="feed-error">{error ? 'error' : 'ok'}</span>
      <span data-testid="feed-stats">{historyStats ? 'stats' : 'nostats'}</span>
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
  data: Automation[] | undefined,
  extra: Partial<{ isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }> = {},
) {
  m.useAutomations.mockReturnValue({
    data,
    isLoading: extra.isLoading ?? false,
    isError: extra.isError ?? false,
    error: extra.error ?? null,
    refetch: extra.refetch ?? vi.fn(),
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
  alertMock = vi.fn();
  window.alert = alertMock;
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AutomationsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function kpiRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Automation summary' });
}

function metricValue(label: string): string {
  const labelEl = within(kpiRegion()).getByText(label);
  const card = labelEl.closest('div.p-3') as HTMLElement;
  return within(card).getByText(/^\d+$/).textContent ?? '';
}

// ═══ Pure helpers ════════════════════════════════════════════════════════════

describe('computeStats', () => {
  it('returns all-zero stats for an empty list', () => {
    expect(computeStats([])).toEqual({ total: 0, active: 0, disabled: 0, autoDisabled: 0 });
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
  it('renders the page heading and subtitle', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Automations' })).toBeInTheDocument();
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
    expect(metricValue('Auto-Disabled')).toBe('1');
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
  it('renders skeleton placeholders while loading and no cards', () => {
    setAutomations(undefined, { isLoading: true });
    const { container } = renderPage();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4);
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
  it('sends a valid typed envelope to the import mutation', async () => {
    renderPage();
    const envelope = { version: 2, exported_at: '2024-01-01', automations: [{ name: 'x' }] };
    uploadFile('export.json', JSON.stringify(envelope));
    await waitFor(() => expect(m.importMutate).toHaveBeenCalledWith(envelope));
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('rejects a legacy (untyped) export and alerts instead of importing', async () => {
    renderPage();
    uploadFile('legacy.json', JSON.stringify({ automations: [{ name: 'x' }] }));
    await waitFor(() => expect(alertMock).toHaveBeenCalledTimes(1));
    expect(m.importMutate).not.toHaveBeenCalled();
    expect(String(alertMock.mock.calls[0][0])).toMatch(/Typed automation import failed/);
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

// ═══ Navigation + activity feed ══════════════════════════════════════════════

describe('AutomationsListPage — navigation & activity feed', () => {
  it('navigates to the builder when Create is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(m.navigate).toHaveBeenCalledWith('/automations/new');
  });

  it('passes history, live events, connection state and stats to the feed', () => {
    m.useAutomationHistory.mockReturnValue({
      data: { items: [{ id: 1 }, { id: 2 }], summary: { total_executions: 5 } },
      isLoading: false,
      error: undefined,
    });
    m.useAutomationEvents.mockReturnValue({
      events: [{ id: 'e1' }], connectionState: 'reconnecting', firingNow: new Set<number>(), clearEvents: vi.fn(),
    });
    renderPage();
    expect(screen.getByTestId('feed-history-count').textContent).toBe('2');
    expect(screen.getByTestId('feed-live-count').textContent).toBe('1');
    expect(screen.getByTestId('feed-conn').textContent).toBe('reconnecting');
    expect(screen.getByTestId('feed-stats').textContent).toBe('stats');
  });

  it('defaults the feed to empty history and null stats when the response is absent', () => {
    m.useAutomationHistory.mockReturnValue({ data: null, isLoading: false, error: undefined });
    renderPage();
    expect(screen.getByTestId('feed-history-count').textContent).toBe('0');
    expect(screen.getByTestId('feed-stats').textContent).toBe('nostats');
  });
});
