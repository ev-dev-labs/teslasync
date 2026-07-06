/**
 * FeatureFlagsPage contract tests.
 *
 * The page orchestrates four self-sufficient sections (KPI band, registry
 * table, value-composition breakdown, change-audit log) plus two overlays
 * (the create/edit Drawer and the delete-confirm Modal). These tests pin the
 * behaviour that actually matters to an operator:
 *
 *   1. Loaded state fans the two feeds out into every section + derives the
 *      KPI band counts (total / boolean / structured / deletes / contributors)
 *      and the value-composition buckets from the flag values.
 *   2. "Add flag" opens the Drawer in CREATE mode (empty, editable key).
 *   3. Filling + saving forwards the parsed JSON value to `setFlag` and closes
 *      the drawer on success.
 *   4. A save rejection keeps the drawer open so the operator can retry.
 *   5. Row "Edit" opens the Drawer in EDIT mode with a disabled, pre-filled key.
 *   6. Row "Delete" opens the confirm Modal, keeps the destructive CTA disabled
 *      until a reason is typed, then forwards `{ key, reason }` to `deleteFlag`.
 *   7. A flags-query error surfaces retryable QueryError panels wired to refetch.
 *   8. A changes-query error surfaces a retryable QueryError in the audit panel.
 *   9. Loading renders per-section affordances (never a page-level block).
 *  10. Empty renders per-section empty messaging.
 *
 * The four `useFeatureFlags` hooks are mocked via `vi.hoisted` so no network is
 * touched; every real shared component (DataTable, Modal, Drawer, MetricCard,
 * QueryError, PageContainer) renders for a true integration signal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type {
  FeatureFlagEntry,
  FeatureFlagChange,
  FeatureFlagsListResponse,
  FeatureFlagChangesResponse,
} from '@/types/admin-diagnostics';

interface QueryStub<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

type FlagsQuery = QueryStub<FeatureFlagsListResponse>;
type ChangesQuery = QueryStub<FeatureFlagChangesResponse>;

interface HookState {
  flags: FlagsQuery;
  changes: ChangesQuery;
  setFlagPending: boolean;
  deleteFlagPending: boolean;
}

const hoisted = vi.hoisted(() => ({
  setFlagMutateAsync: vi.fn(),
  deleteFlagMutateAsync: vi.fn(),
  flagsRefetch: vi.fn(),
  changesRefetch: vi.fn(),
  state: {} as HookState,
}));

vi.mock('@/api/hooks/useFeatureFlags', () => ({
  useFlags: () => hoisted.state.flags,
  useFlagChanges: () => hoisted.state.changes,
  useSetFlag: () => ({
    mutateAsync: hoisted.setFlagMutateAsync,
    isPending: hoisted.state.setFlagPending,
  }),
  useDeleteFlag: () => ({
    mutateAsync: hoisted.deleteFlagMutateAsync,
    isPending: hoisted.state.deleteFlagPending,
  }),
}));

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
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

import FeatureFlagsPage from './FeatureFlagsPage';

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via the freshness
// chip) tolerates its absence, but a canonical stub removes any ambiguity.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const FLAGS: FeatureFlagEntry[] = [
  { key: 'dlq.replay_enabled', value: true },
  { key: 'ui.new_dashboard', value: false },
  { key: 'limits.config', value: { max: 10 } },
  { key: 'rollout.buckets', value: [1, 2, 3] },
  { key: 'banner.text', value: 'hello' },
];

const CHANGES: FeatureFlagChange[] = [
  {
    id: 1,
    changed_at: '2026-01-01T10:00:00Z',
    actor: 'alice@ops',
    actor_ip: '10.0.0.1',
    flag_key: 'dlq.replay_enabled',
    operation: 'set',
    old_value: null,
    new_value: true,
    reason: 'enable replay',
    trace_id: 't1',
  },
  {
    id: 2,
    changed_at: '2026-01-02T11:00:00Z',
    actor: 'bob@ops',
    actor_ip: '10.0.0.2',
    flag_key: 'legacy.removed',
    operation: 'delete',
    old_value: 42,
    new_value: null,
    reason: 'cleanup legacy',
    trace_id: 't2',
  },
];

function makeFlagsQuery(overrides: Partial<FlagsQuery> = {}): FlagsQuery {
  return {
    data: { count: FLAGS.length, flags: FLAGS },
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: hoisted.flagsRefetch,
    ...overrides,
  };
}

function makeChangesQuery(overrides: Partial<ChangesQuery> = {}): ChangesQuery {
  return {
    data: { count: CHANGES.length, flag_key: '', limit: 50, rows: CHANGES },
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: hoisted.changesRefetch,
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FeatureFlagsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Read a MetricCard's rendered value by its visible label. */
function metricValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.closest('p')?.nextElementSibling?.textContent ?? '';
}

/** The `<tr>` in the registry table that owns the given flag key. */
function registryRow(key: string): HTMLElement {
  const cell = screen
    .getAllByText(key)
    .map((el) => el.closest('tr'))
    .find((tr): tr is HTMLTableRowElement =>
      tr != null && within(tr).queryAllByRole('button', { name: /Edit flag/ }).length > 0,
    );
  if (!cell) throw new Error(`no registry row for ${key}`);
  return cell;
}

beforeEach(() => {
  hoisted.setFlagMutateAsync
    .mockReset()
    .mockResolvedValue({ key: '', old_value: null, audit_id: 1 });
  hoisted.deleteFlagMutateAsync
    .mockReset()
    .mockResolvedValue({ key: '', old_value: null, deleted: true, audit_id: 2 });
  hoisted.flagsRefetch.mockReset();
  hoisted.changesRefetch.mockReset();
  hoisted.state.flags = makeFlagsQuery();
  hoisted.state.changes = makeChangesQuery();
  hoisted.state.setFlagPending = false;
  hoisted.state.deleteFlagPending = false;
});

describe('FeatureFlagsPage', () => {
  it('renders every section and derives the KPI band + composition from the feeds', () => {
    renderPage();

    // Page + section chrome.
    expect(
      screen.getByRole('heading', { name: 'Feature Flags', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Registry')).toBeInTheDocument();
    expect(screen.getByText('Value composition')).toBeInTheDocument();
    expect(screen.getByText('Recent changes')).toBeInTheDocument();

    // KPI band counts derived from BOTH feeds (5 flags: 2 boolean, 2
    // structured, 1 string; 2 changes: 1 delete, 2 distinct actors).
    expect(metricValue('Total Flags')).toBe('5');
    expect(metricValue('Boolean Toggles')).toBe('2');
    expect(metricValue('Structured')).toBe('2');
    expect(metricValue('Recent Changes')).toBe('2');
    expect(metricValue('Deletes')).toBe('1');
    expect(metricValue('Contributors')).toBe('2');

    // Registry: one Edit + one Delete action per flag row.
    expect(screen.getAllByRole('button', { name: /Edit flag/ })).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: /Delete flag/ })).toHaveLength(5);
    expect(screen.getByText('rollout.buckets')).toBeInTheDocument();

    // Composition: only non-empty value buckets are drawn (null bucket absent).
    expect(screen.getByText('Boolean')).toBeInTheDocument();
    expect(screen.getByText('Object')).toBeInTheDocument();
    expect(screen.queryByText('Null')).not.toBeInTheDocument();

    // Change-audit log: actors, operations, reasons.
    expect(screen.getByText('alice@ops')).toBeInTheDocument();
    expect(screen.getByText('bob@ops')).toBeInTheDocument();
    expect(screen.getByText('set')).toBeInTheDocument();
    expect(screen.getByText('delete')).toBeInTheDocument();
    expect(screen.getByText('cleanup legacy')).toBeInTheDocument();
  });

  it('opens the create drawer with an empty, editable key when "Add flag" is clicked', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add flag' }));

    expect(screen.getByText('Create flag')).toBeInTheDocument();
    const keyInput = screen.getByLabelText(/flag key/i) as HTMLInputElement;
    expect(keyInput).toHaveValue('');
    expect(keyInput).not.toBeDisabled();
    // Nothing is committed just by opening the drawer.
    expect(hoisted.setFlagMutateAsync).not.toHaveBeenCalled();
  });

  it('forwards the parsed JSON value to setFlag and closes the drawer on save', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add flag' }));

    fireEvent.change(screen.getByLabelText(/flag key/i), {
      target: { value: 'feature.new' },
    });
    fireEvent.change(screen.getByLabelText(/value \(json\)/i), {
      target: { value: '{"enabled":true}' },
    });
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'rolling out' },
    });

    const save = screen.getByRole('button', { name: /save flag/i });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(hoisted.setFlagMutateAsync).toHaveBeenCalledWith({
        key: 'feature.new',
        value: { enabled: true },
        reason: 'rolling out',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Create flag')).not.toBeInTheDocument(),
    );
  });

  it('keeps the drawer open when the save mutation rejects', async () => {
    hoisted.setFlagMutateAsync
      .mockReset()
      .mockRejectedValueOnce(new Error('SUDO_REQUIRED'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add flag' }));
    fireEvent.change(screen.getByLabelText(/flag key/i), {
      target: { value: 'feature.new' },
    });
    fireEvent.change(screen.getByLabelText(/value \(json\)/i), {
      target: { value: 'false' },
    });
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'attempt' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save flag/i }));

    await waitFor(() =>
      expect(hoisted.setFlagMutateAsync).toHaveBeenCalledTimes(1),
    );
    // Drawer stays mounted so the operator can retry without retyping.
    expect(screen.getByText('Create flag')).toBeInTheDocument();
  });

  it('opens the edit drawer in edit mode with a disabled, pre-filled key', () => {
    renderPage();

    const row = registryRow('ui.new_dashboard');
    fireEvent.click(within(row).getByRole('button', { name: /Edit flag/ }));

    expect(
      screen.getByText('Edit flag "ui.new_dashboard"'),
    ).toBeInTheDocument();
    const keyInput = screen.getByLabelText(/flag key/i) as HTMLInputElement;
    expect(keyInput).toBeDisabled();
    expect(keyInput).toHaveValue('ui.new_dashboard');
    // The stored `false` value is seeded into the JSON editor.
    expect(screen.getByLabelText(/value \(json\)/i)).toHaveValue('false');
  });

  it('gates the delete confirm on a reason then forwards { key, reason } to deleteFlag', async () => {
    renderPage();

    const row = registryRow('limits.config');
    fireEvent.click(within(row).getByRole('button', { name: /Delete flag/ }));

    // Confirm dialog names the flag and starts with the destructive CTA off.
    expect(
      screen.getByText(/Permanently remove flag "limits.config"/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete flag' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: 'no longer needed' },
    });

    const confirm = screen.getByRole('button', { name: 'Delete flag' });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(hoisted.deleteFlagMutateAsync).toHaveBeenCalledWith({
        key: 'limits.config',
        reason: 'no longer needed',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Delete flag?')).not.toBeInTheDocument(),
    );
  });

  it('surfaces retryable error panels and refetches when the flags query fails', () => {
    hoisted.state.flags = makeFlagsQuery({
      data: undefined,
      isError: true,
      error: new Error('boom'),
      dataUpdatedAt: 0,
    });
    renderPage();

    // Each self-sufficient section that consumes the flags feed shows an alert.
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(1);

    const retries = screen.getAllByRole('button', { name: /retry/i });
    expect(retries.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(retries[0]);
    expect(hoisted.flagsRefetch).toHaveBeenCalled();
  });

  it('surfaces a retryable error in the audit panel when the changes query fails', () => {
    hoisted.state.changes = makeChangesQuery({
      data: undefined,
      isError: true,
      error: new Error('audit down'),
      dataUpdatedAt: 0,
    });
    renderPage();

    // The flags feed is healthy, so the registry table still renders.
    expect(screen.getAllByRole('button', { name: /Edit flag/ })).toHaveLength(5);

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(hoisted.changesRefetch).toHaveBeenCalled();
  });

  it('renders per-section loading affordances without a page-level block', () => {
    hoisted.state.flags = makeFlagsQuery({ data: undefined, isLoading: true });
    hoisted.state.changes = makeChangesQuery({ data: undefined, isLoading: true });
    renderPage();

    expect(screen.getByText(/Loading flags/)).toBeInTheDocument();
    expect(screen.getByText(/Loading audit log/)).toBeInTheDocument();
    // The KPI band collapses to skeletons — no derived metric labels yet.
    expect(screen.queryByText('Total Flags')).not.toBeInTheDocument();
  });

  it('renders per-section empty messaging when both feeds are empty', () => {
    hoisted.state.flags = makeFlagsQuery({ data: { count: 0, flags: [] } });
    hoisted.state.changes = makeChangesQuery({
      data: { count: 0, flag_key: '', limit: 50, rows: [] },
    });
    renderPage();

    expect(metricValue('Total Flags')).toBe('0');
    expect(
      screen.getByText('No feature flags are set on this server.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No flag changes yet')).toBeInTheDocument();
  });
});
