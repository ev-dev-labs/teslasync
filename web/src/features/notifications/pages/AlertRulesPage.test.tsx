/**
 * AlertRulesPage — comprehensive unit + integration coverage.
 *
 * Two layers:
 *   1. Pure helpers (`subjectOf`, `isSnoozed`) — exhaustive branch coverage of
 *      the module's exported utilities.
 *   2. The page component — loading / error / empty / data states for every
 *      data-driven surface (KPI band, insight bento, rules table), plus the
 *      selection → bulk-action orchestration (enable success AND the hardened
 *      failure path that must NOT leak an unhandled rejection), confirm-gated
 *      delete (both branches), the header refresh + studio CTA, default sort
 *      order, and icon-only-control accessibility.
 *
 * Network is never touched: the five notification hooks are replaced with
 * controllable doubles, and useConfirm / useEditLease / useNavigate are stubbed
 * for determinism.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

vi.mock('../components/AlertRuleEditor', () => ({
  AlertRuleEditor: ({ rule, onCancel }: { rule: AlertRule; onCancel: () => void }) => (
    <div data-testid="full-rule-editor">
      {rule.name}
      <button onClick={onCancel}>Cancel edit</button>
    </div>
  ),
}));

import type { AlertRule } from '@/api/types';
import AlertRulesPage, { subjectOf, isSnoozed } from './AlertRulesPage';

// framer-motion's useMotionPreference (reached via <FadeIn>) reads matchMedia,
// which jsdom does not implement. Install a minimal stub before any module that
// touches it is evaluated.
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

// Shared, hoisted doubles so the mock factories and the specs reach the same
// instances.
interface ChannelsQuery {
  data?: Array<{ id: number; name: string }>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
}

const H = vi.hoisted(() => ({
  rules: { current: null as unknown },
  channels: { current: { data: [{ id: 2, name: 'Team' }], isLoading: false, isError: false, error: null, refetch: vi.fn() } as ChannelsQuery },
  bulkEnable: vi.fn(),
  bulkDisable: vi.fn(),
  del: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
  navigate: vi.fn(),
  confirm: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating {{vars}}. Supports
// both the `t(key, 'Default', { vars })` and `t(key, { defaultValue })` styles
// the tree uses.
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

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
    '@/api/hooks/useNotifications',
  );
  return {
    ...actual,
    useAlertRules: () => H.rules.current,
    useNotificationChannels: () => H.channels.current,
    useBulkEnableRules: () => ({ mutateAsync: H.bulkEnable, isPending: false }),
    useBulkDisableRules: () => ({ mutateAsync: H.bulkDisable, isPending: false }),
    useDeleteAlertRule: () => ({ mutateAsync: H.del, isPending: false }),
    useSaveAlertRule: () => ({ mutateAsync: H.save, isPending: false }),
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => H.navigate };
});

// Deterministic edit-lease — jsdom has no BroadcastChannel, so bypass the
// election timers entirely and present this tab as the (non-conflicting) owner.
vi.mock('@/hooks/useEditLease', () => ({
  useEditLease: () => ({ isOwner: true, otherTab: null, claim: vi.fn(), release: vi.fn() }),
}));

// Deterministic confirm — each spec sets the resolved value; the real
// ConfirmDialog rendering is covered by its own component test.
vi.mock('@/hooks/useConfirm', () => ({
  useConfirm: () => ({ confirm: H.confirm, dialogProps: null }),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 0,
    name: 'Rule',
    enabled: true,
    signal_name: 'VehicleSpeed',
    op: '>',
    severity: 'warn',
    cooldown_min: 15,
    trigger_mode: 'repeat',
    kind: 'signal',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

interface RulesQuery {
  data?: AlertRule[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: typeof H.refetch;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt?: number;
}

function makeQuery(overrides: Partial<RulesQuery> = {}): RulesQuery {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: H.refetch,
    ...overrides,
  };
}

function setRules(q: Partial<RulesQuery>) {
  H.rules.current = makeQuery(q);
}

function renderPage(path = '/notifications/rules') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AlertRulesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const DATA: AlertRule[] = [
  makeRule({ id: 1, name: 'Zebra', enabled: true, severity: 'critical', signal_name: 'VehicleSpeed' }),
  makeRule({ id: 2, name: 'Alpha', enabled: true, severity: 'warn', signal_name: 'BatteryLevel' }),
  makeRule({
    id: 3,
    name: 'Mango',
    enabled: false,
    severity: 'info',
    kind: 'computed_metric',
    metric_id: 'efficiency',
    signal_name: '',
    snoozed_until: FUTURE,
  }),
];

beforeEach(() => {
  H.bulkEnable.mockReset().mockResolvedValue({ updated: 1 });
  H.bulkDisable.mockReset().mockResolvedValue({ updated: 1 });
  H.del.mockReset().mockResolvedValue(undefined);
  H.save.mockReset().mockResolvedValue(undefined);
  H.refetch.mockReset().mockResolvedValue(undefined);
  H.navigate.mockReset();
  H.confirm.mockReset().mockResolvedValue(true);
  H.channels.current = {
    data: [{ id: 2, name: 'Team' }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
  setRules({ data: [] });
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── 1. Pure helpers ──────────────────────────────────────────────────────────
describe('subjectOf', () => {
  it('returns the metric id for computed-metric rules', () => {
    expect(subjectOf(makeRule({ kind: 'computed_metric', metric_id: 'efficiency' }))).toBe(
      'efficiency',
    );
  });

  it('falls back to an em dash when a computed-metric rule has no metric id', () => {
    expect(subjectOf(makeRule({ kind: 'computed_metric', metric_id: null }))).toBe('—');
    expect(subjectOf(makeRule({ kind: 'computed_metric', metric_id: undefined }))).toBe('—');
  });

  it('returns the signal name for signal rules', () => {
    expect(subjectOf(makeRule({ kind: 'signal', signal_name: 'BatteryLevel' }))).toBe(
      'BatteryLevel',
    );
  });
});

describe('isSnoozed', () => {
  const now = Date.now();

  it('is false when snoozed_until is absent', () => {
    expect(isSnoozed(makeRule({ snoozed_until: null }), now)).toBe(false);
    expect(isSnoozed(makeRule({ snoozed_until: undefined }), now)).toBe(false);
  });

  it('is true only when snoozed_until is in the future', () => {
    expect(isSnoozed(makeRule({ snoozed_until: FUTURE }), now)).toBe(true);
    expect(isSnoozed(makeRule({ snoozed_until: PAST }), now)).toBe(false);
  });

  it('is false for an unparseable snoozed_until', () => {
    expect(isSnoozed(makeRule({ snoozed_until: 'not-a-date' }), now)).toBe(false);
  });
});

// ── 2. Component — data state ─────────────────────────────────────────────────
describe('AlertRulesPage — data state', () => {
  beforeEach(() => setRules({ data: DATA }));

  it('renders the KPI band with derived counts', () => {
    renderPage();
    const kpis = screen.getByLabelText('Alert rule metrics');
    expect(within(kpis).getByText('Total rules')).toBeInTheDocument();
    expect(within(kpis).getByText('Computed')).toBeInTheDocument();
    expect(within(kpis).getByText('3')).toBeInTheDocument(); // total
    expect(within(kpis).getByText('2')).toBeInTheDocument(); // enabled
  });

  it('reviews all six counts with unfiltered scope and overlapping snooze semantics without losing rules controls', () => {
    renderPage();
    const brief = screen.getByTestId('alert-rules-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(brief.querySelector('[data-operational-metric="rules-total"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('before search and channel filtering');
    expect(drawer).toHaveTextContent('Snoozed rules can overlap enabled or disabled rules');
    for (const label of ['Total rules', 'Enabled', 'Disabled', 'Critical', 'Snoozed', 'Computed']) {
      expect(drawer).toHaveTextContent(label);
    }
    fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeInTheDocument();
  });

  it('renders all three insight panels and the rules table', () => {
    renderPage();
    expect(screen.getByText('Severity distribution')).toBeInTheDocument();
    expect(screen.getByText('Status breakdown')).toBeInTheDocument();
    expect(screen.getByText('Top monitored signals')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Zebra')).toBeInTheDocument();
    expect(screen.getByText('Mango')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    expect(screen.getByRole('menuitem', { name: 'Download as CSV' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as JSON' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reorder or hide columns' }),
    ).toBeInTheDocument();
  });

  it('moves Studio search and channel filtering into the Rules page', async () => {
    setRules({ data: [
      makeRule({ id: 1, name: 'Automatic battery', channel_ids: null }),
      makeRule({ id: 2, name: 'Team charging', channel_ids: [2] }),
      makeRule({ id: 3, name: 'Inbox only', channel_ids: [] }),
    ] });
    renderPage();
    const filter = screen.getByRole('combobox', { name: 'Filter by notification channel' });
    fireEvent.change(filter, { target: { value: 'none' } });
    expect(screen.getByRole('link', { name: 'Inbox only' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team charging' })).toBeNull();
    fireEvent.change(filter, { target: { value: '2' } });
    expect(screen.getByRole('link', { name: 'Team charging' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Automatic battery' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search rules...' }), { target: { value: 'battery' } });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Automatic battery' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Team charging' })).toBeNull();
    });
  });

  it('opens full editing on the Rules route and returns to the list', () => {
    const { container } = renderPage();
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/notifications/rules?rule=2');
    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));
    expect(within(container).getByTestId('full-rule-editor')).toHaveTextContent('Alpha');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('handles a removed rule deep link without redirecting to Studio', () => {
    renderPage('/notifications/rules?rule=999');
    expect(screen.getAllByText('Rule not found').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Back to rules' })).toHaveAttribute('href', '/notifications/rules');
  });

  it('shows the severity legend with the computed critical count', () => {
    renderPage();
    // `{label} · {value}` — critical bucket has exactly one rule (Zebra). Match
    // the leaf node (no element children) so the ancestor wrappers, whose
    // textContent is identical, don't count as duplicate hits.
    const leaf = screen.getByText(
      (_content, el) => el?.textContent === 'Critical · 1' && (el?.children.length ?? 1) === 0,
    );
    expect(leaf).toBeInTheDocument();
  });

  it('orders rows by name ascending by default', () => {
    renderPage();
    const names = screen.getAllByRole('link').map((a) => a.textContent);
    expect(names).toEqual(['Alpha', 'Mango', 'Zebra']);
  });
});

// ── 3. Component — loading / error / empty ────────────────────────────────────
describe('AlertRulesPage — loading / error / empty', () => {
  it('shows skeletons and no table while loading', () => {
    setRules({ data: undefined, isLoading: true });
    renderPage();
    expect(screen.queryByRole('table')).toBeNull();
    // Panel + table titles still render — the surface is never blank.
    expect(screen.getByText('All rules')).toBeInTheDocument();
    expect(screen.queryByText('Zebra')).toBeNull();
  });

  it('shows retryable error banners that call refetch', () => {
    setRules({ data: undefined, isError: true, error: new Error('boom') });
    renderPage();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThan(0);
    fireEvent.click(retries[0]);
    expect(H.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state with an Alert Studio CTA when there are no rules', () => {
    setRules({ data: [] });
    renderPage();
    expect(screen.getByText('No alert rules yet')).toBeInTheDocument();
    // Empty-state CTA link + header button both create a rule in Studio.
    expect(screen.getAllByText('Create rule').length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
  });
});

// ── 4. Component — bulk actions ───────────────────────────────────────────────
describe('AlertRulesPage — bulk actions', () => {
  beforeEach(() => setRules({ data: DATA }));

  function selectFirstRow() {
    const boxes = screen.getAllByLabelText('Select row');
    fireEvent.click(boxes[0]);
  }

  it('enables the selected rules and clears the selection on success', async () => {
    renderPage();
    selectFirstRow();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(H.bulkEnable).toHaveBeenCalledTimes(1));
    expect(H.bulkEnable).toHaveBeenCalledWith([expect.any(Number)]);
    // Selection cleared → the bulk bar (and its Enable button) disappears.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull(),
    );
  });

  it('disables the selected rules on success', async () => {
    renderPage();
    selectFirstRow();
    fireEvent.click(await screen.findByRole('button', { name: 'Disable' }));

    await waitFor(() => expect(H.bulkDisable).toHaveBeenCalledTimes(1));
    expect(H.bulkDisable).toHaveBeenCalledWith([expect.any(Number)]);
  });

  it('keeps the selection and does not throw when bulk-enable rejects', async () => {
    H.bulkEnable.mockRejectedValueOnce(new Error('server down'));
    renderPage();
    selectFirstRow();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable' }));

    await waitFor(() => expect(H.bulkEnable).toHaveBeenCalledTimes(1));
    // The rejection is swallowed (no unhandled rejection) and the selection —
    // and therefore the Enable button — is retained so the user can retry.
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('deletes each selected rule when the confirm dialog is accepted', async () => {
    H.confirm.mockResolvedValue(true);
    renderPage();
    selectFirstRow();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(H.confirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(H.del).toHaveBeenCalledWith(expect.any(Number)));
  });

  it('does not delete anything when the confirm dialog is dismissed', async () => {
    H.confirm.mockResolvedValue(false);
    renderPage();
    selectFirstRow();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(H.confirm).toHaveBeenCalledTimes(1));
    expect(H.del).not.toHaveBeenCalled();
  });
});

// ── 5. Component — header actions & accessibility ─────────────────────────────
describe('AlertRulesPage — header actions & a11y', () => {
  beforeEach(() => setRules({ data: DATA }));

  it('refetches when the icon-only refresh control is activated', () => {
    renderPage();
    const studio = screen.getByRole('button', { name: 'Create rule' });
    const actions = studio.closest('[data-role="page-actions"]')
      ?.querySelector<HTMLElement>('[data-action-group="secondary"]');
    if (!actions) throw new Error('Alert-rule header secondary actions are missing');
    fireEvent.click(within(actions).getByRole('button', { name: 'Refresh' }));
    expect(H.refetch).toHaveBeenCalledTimes(1);
  });

  it('navigates to the studio from the header CTA', () => {
    renderPage();
    const createRule = screen.getByRole('button', { name: 'Create rule' });
    expect(createRule.closest('[data-action-group]')).toHaveAttribute('data-action-group', 'primary');
    const heading = screen.getByRole('heading', { level: 1, name: 'Alert rules' });
    expect(heading).toHaveAttribute('data-route-focus-target', 'true');
    expect(heading.closest('header')).toHaveClass('border-0', 'bg-transparent');
    fireEvent.click(createRule);
    expect(H.navigate).toHaveBeenCalledWith('/notifications/studio');
  });

  it('exposes accessible names for every selection checkbox', () => {
    renderPage();
    expect(screen.getByLabelText('Select all rows')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Select row')).toHaveLength(DATA.length);
  });

  it('gives each rule an accessible rename control', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Rename alert rule Alpha' }),
    ).toBeInTheDocument();
  });
});

describe('AlertRulesPage — restrained presentation and retained sources', () => {
  beforeEach(() => setRules({ data: DATA }));

  it('uses solid semantic status fills and a neutral top-subject series without changing counts', () => {
    const { container } = renderPage();
    for (const [label, count, color] of [
      ['Enabled', '2', 'var(--semantic-success)'],
      ['Disabled', '1', 'var(--text-secondary)'],
      ['Snoozed', '1', 'var(--semantic-warning)'],
    ]) {
      const bar = screen.getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuenow', count);
      expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({ background: color });
      expect(bar.querySelector('[data-metric-track]')).toHaveClass('h-1');
    }
    for (const subject of ['VehicleSpeed', 'BatteryLevel', 'efficiency']) {
      const bar = screen.getByRole('progressbar', { name: subject });
      expect(bar).toHaveAttribute('aria-valuenow', '1');
      expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({ background: 'var(--text-secondary)' });
    }
    expect(container.querySelectorAll('[data-metric-fill]')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveClass('underline', 'text-[var(--text-primary)]');
    expect(screen.getByRole('button', { name: 'Rename alert rule Alpha' })).toHaveClass('min-h-11', 'min-w-11');
  });

  it('keeps retained channel options usable after a refresh failure and retries only that source', () => {
    H.channels.current = {
      ...H.channels.current,
      isError: true,
      error: new Error('Channel refresh failed'),
    };
    const { container } = renderPage();
    const filter = screen.getByRole('combobox', { name: 'Filter by notification channel' });
    expect(filter).toBeEnabled();
    expect(within(filter).getByRole('option', { name: 'Team' })).toHaveValue('2');
    expect(screen.getByRole('table')).toBeInTheDocument();
    const warning = container.querySelector('[data-testid="stale-refresh-warning"]');
    if (!warning) throw new Error('Retained channel warning is missing');
    expect(warning).toHaveTextContent('Filter by notification channel may be out of date');
    fireEvent.click(within(warning as HTMLElement).getByRole('button', { name: 'Refresh' }));
    expect(H.channels.current.refetch).toHaveBeenCalledTimes(1);
    expect(H.refetch).not.toHaveBeenCalled();
    fireEvent.change(filter, { target: { value: 'none' } });
    expect(screen.getByText('No alert rules match')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rules-brief')).toHaveTextContent('Total rules');
  });

  it('disables a never-loaded channel filter without hiding independently loaded rules', () => {
    H.channels.current = {
      ...H.channels.current,
      data: undefined,
      isError: true,
      error: new Error('Channels unavailable'),
    };
    renderPage();
    expect(screen.getByRole('combobox', { name: 'Filter by notification channel' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(H.channels.current.refetch).toHaveBeenCalledTimes(1);
    expect(H.refetch).not.toHaveBeenCalled();
  });

  it('keeps all rule sections and editing available through a retained refresh error', () => {
    setRules({ data: DATA, isError: true, error: new Error('Rules refresh failed'), dataUpdatedAt: Date.now() });
    renderPage();
    for (const title of ['Severity distribution', 'Status breakdown', 'Top monitored signals', 'All rules']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByTestId('alert-rules-brief')).toHaveTextContent('Data may be stale');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Alpha' }));
    expect(screen.getByTestId('full-rule-editor')).toHaveTextContent('Alpha');
  });

  it('preserves retained channel routing during paused refresh without claiming the vehicle is offline', () => {
    H.channels.current = { ...H.channels.current, fetchStatus: 'paused' };
    const { container } = renderPage();
    expect(screen.getByRole('combobox', { name: 'Filter by notification channel' })).toBeEnabled();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(container.querySelector('[data-refresh-blocked="true"]')).toBeInTheDocument();
    expect(screen.queryByText(/paused offline/i)).toBeNull();
  });

  it('keeps every mobile rule field and rename edit selection and export actions reachable', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 375, 100));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    setRules({ data: [makeRule({
      id: 42, name: 'Redis recovery', kind: 'system_component',
      component_name: 'redis', transition: 'recovered', severity: 'critical',
      vehicle_ids: [4], snoozed_until: FUTURE,
    })] });
    const { container } = renderPage();
    const mobile = container.querySelector<HTMLElement>('[data-mobile-table]');
    if (!mobile) throw new Error('Mobile rule presentation is missing');
    const view = within(mobile);
    expect(view.getByRole('link', { name: 'Redis recovery' })).toHaveAttribute('href', '/notifications/rules?rule=42');
    expect(view.getByRole('button', { name: 'Rename alert rule Redis recovery' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    for (const value of ['Type', 'System service', 'Subject', 'redis · recovered', 'Severity', 'Critical', 'Scope', '1 vehicles', 'Status', 'Enabled', 'Snoozed']) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('link', { name: 'Redis recovery' })).toHaveAttribute('href', '/notifications/rules?rule=42');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    fireEvent.click(view.getByRole('button', { name: 'Select' }));
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Redis recovery' }));
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    expect(screen.getByRole('menuitem', { name: 'Download as JSON' })).toBeInTheDocument();
    expect(H.bulkEnable).not.toHaveBeenCalled();
    expect(H.bulkDisable).not.toHaveBeenCalled();
    expect(H.del).not.toHaveBeenCalled();
    expect(H.save).not.toHaveBeenCalled();
  });
});
