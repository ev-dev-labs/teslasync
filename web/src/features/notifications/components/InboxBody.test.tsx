/**
 * InboxBody — contract + hardening tests.
 *
 * InboxBody is the shared notification-log inbox surface used by both
 * InboxPage (`archived=false`) and ArchivedPage (`archived=true`). It owns a
 * lot of behaviour, so this suite drives the REAL component (real filter bar,
 * bulk toolbar, rows, group rows, context menu) against a mocked `request()`
 * boundary and asserts the observable contracts:
 *
 *   1. Flat view — selectable table, count label, loading skeletons, retryable
 *      error, and an honest empty state (never a blank panel).
 *   2. Grouped view — opt-in; threads render and the flat query stays
 *      disabled so we don't double-fetch. Empty grouped state has its own copy.
 *   3. View toggle — grouped↔flat, only shown on the inbox tab, keyboard/ARIA
 *      accessible (aria-pressed + an explicit aria-label so the icon-only
 *      mobile state still has an accessible name — a hardening fix).
 *   4. Archived mode — always flat, no view toggle, and the bulk action set
 *      swaps Archive→Restore.
 *   5. Bulk selection — the select-all header checkbox reflects the tri-state
 *      (none/some/all) as a native `indeterminate` control (a hardening fix),
 *      and bulk "Mark read" posts the selected ids.
 *   6. Auto-mark-read on open (flat, non-archived) + the localStorage opt-out.
 *   7. "Mark all read" header action fires the `{ all: true }` variant.
 *   8. URL-backed filters flow into the request query as SI-clean, snake_case
 *      params with no `/api/v1` double-prefix.
 *   9. Right-click opens the per-row context menu with the correct items.
 *  10. CSV / JSON export supports visible rows, selected rows, and grouped
 *      thread summaries as well as the default table.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * ArchivedPage.test.tsx). `react-i18next` is stubbed to echo the inline
 * fallback (with `{{var}}` interpolation) so text assertions stay
 * deterministic. `framer-motion` is flattened to plain divs (see
 * NotificationGroupRow.test.tsx). `useSettings` / `useTimezone` come from the
 * global stubs in src/test-setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
  type RenderResult,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

/* ── Boundary mocks ───────────────────────────────────── */

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/lib/export', () => ({
  exportAsCSV: vi.fn(),
  exportAsJSON: vi.fn(),
}));

// Echo the inline fallback and interpolate `{{var}}` from either the trailing
// options object (`t('k','{{count}} x', { count })`) or an options-only call
// (`t('k', { count, defaultValue })`). Mirrors just enough of i18next to keep
// interpolated labels ("2 notifications", "1 selected") assertable.
function translate(key: string, second?: unknown, third?: unknown): string {
  let template = key;
  let vars: Record<string, unknown> = {};
  if (typeof second === 'string') {
    template = second;
    if (third && typeof third === 'object') vars = third as Record<string, unknown>;
  } else if (second && typeof second === 'object') {
    const o = second as Record<string, unknown>;
    if (typeof o.defaultValue === 'string') template = o.defaultValue;
    vars = o;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
    vars[k] != null ? String(vars[k]) : `{{${k}}}`,
  );
}

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

// Flatten framer-motion to plain DOM. Strip the animation-only props so React
// doesn't warn about unknown attributes (`initial`, `layout`, …) leaking onto
// the div.
const MOTION_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants', 'layout', 'layoutId',
  'whileHover', 'whileTap', 'whileFocus', 'whileInView', 'whileDrag', 'drag',
  'dragConstraints', 'viewport', 'custom', 'onAnimationComplete',
]);
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
          if (k !== 'children' && !MOTION_PROPS.has(k)) clean[k] = v;
        }
        return <div {...(clean as React.HTMLAttributes<HTMLDivElement>)}>{props.children as React.ReactNode}</div>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { ContextMenuRoot } from '@/components/ui';
import { exportAsCSV, exportAsJSON } from '@/lib/export';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import { SHARED_RANGE_STORAGE_KEY } from '@/hooks/useRangeState';
import type { NotificationLog, NotificationLogGroup, AlertRule, Vehicle, AlertDetail } from '@/api/types';
import { InboxBody } from './InboxBody';
import { notificationKeys } from '@/api/hooks/useNotifications';
import { NotificationReportPanel } from './NotificationReportPanel';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockedExportAsCSV = vi.mocked(exportAsCSV);
const mockedExportAsJSON = vi.mocked(exportAsJSON);

const MARK_ON_OPEN = 'teslasync.notifications.markOnOpen';

/* ── Fixtures ─────────────────────────────────────────── */

const NOW_ISO = new Date().toISOString();

function makeVehicle(id: number): Vehicle {
  return { id, vehicle_id: id, vin: `VIN${id}`, display_name: `Model ${id}` } as unknown as Vehicle;
}

function makeRule(overrides: Partial<AlertRule>): AlertRule {
  return {
    id: 10,
    name: 'Battery Low',
    enabled: true,
    severity: 'warn',
    vehicle_id: 1,
    signal_name: 'BatteryLevel',
    op: '<',
    ...overrides,
  } as unknown as AlertRule;
}

function makeLog(overrides: Partial<NotificationLog>): NotificationLog {
  return {
    id: 1,
    channel_id: 1,
    alert_id: 10,
    title: 'Battery critical',
    message: 'Battery below 10%',
    status: 'sent',
    severity: 'warn',
    error: '',
    created_at: NOW_ISO,
    sent_at: NOW_ISO,
    read_at: null,
    archived_at: null,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<NotificationLogGroup>): NotificationLogGroup {
  return {
    group_key: 'a'.repeat(64),
    latest: makeLog({}),
    count: 3,
    unread_count: 2,
    vehicle_ids: [1],
    ...overrides,
  };
}

const VEHICLES: Vehicle[] = [makeVehicle(1)];
const RULES: AlertRule[] = [makeRule({})];

/* ── Request router ───────────────────────────────────── */

interface Handlers {
  logs?: () => Promise<unknown>;
  groups?: () => Promise<unknown>;
  members?: () => Promise<unknown>;
  total?: number;
  report?: () => Promise<unknown>;
  detail?: (path: string, method?: string) => Promise<AlertDetail>;
}

function installRequest(h: Handlers = {}) {
  mockedRequest.mockImplementation((path: string, options?: { method?: string }) => {
    const method = options?.method;
    if (path.startsWith('/alerts/') && h.detail) return h.detail(path, method);
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      if (path.includes('mark-read')) return Promise.resolve({ updated: 1 });
      if (path.includes('unarchive')) return Promise.resolve({ updated: 1 });
      if (path.includes('archive')) return Promise.resolve({ updated: 1 });
      if (path.startsWith('/notifications/logs')) return Promise.resolve({ deleted: 1 });
      return Promise.resolve({});
    }
    if (path.startsWith('/notifications/report')) return (h.report ?? (() => Promise.reject(new Error('Report unavailable'))))();
    if (path.includes('count_only=true')) return Promise.resolve({ total: h.total ?? 2 });
    if (path.includes('group_key=')) return (h.members ?? (() => Promise.resolve([])))();
    if (path.includes('grouped=true')) return (h.groups ?? (() => Promise.resolve([])))();
    if (path.startsWith('/notifications/logs')) return (h.logs ?? (() => Promise.resolve([])))();
    if (path.startsWith('/vehicles')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

function callsFor(pred: (path: string, method: string | undefined) => boolean) {
  return mockedRequest.mock.calls.filter((c) =>
    pred(String(c[0]), (c[1] as { method?: string } | undefined)?.method),
  );
}
const flatCalls = () =>
  callsFor(
    (p, m) =>
      !m && p.startsWith('/notifications/logs?') && !p.includes('count_only=true') && !p.includes('grouped=true') && !p.includes('group_key='),
  );
const groupedCalls = () => callsFor((p, m) => !m && p.includes('grouped=true'));
const markReadPosts = () => callsFor((p, m) => m === 'POST' && p.includes('mark-read'));
const deleteCalls = () => callsFor((p, m) => m === 'DELETE' && p.startsWith('/notifications/logs'));

function bodyOf(call: unknown[]): Record<string, unknown> {
  const opts = call[1] as { body?: string } | undefined;
  return opts?.body ? (JSON.parse(opts.body) as Record<string, unknown>) : {};
}

/* ── Render harness ───────────────────────────────────── */

function renderInbox(opts: { archived?: boolean; route?: string; report?: boolean } = {}): RenderResult & { client: QueryClient } {
  const { archived = false, route = '/notifications/inbox' } = opts;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <SelectedVehicleProvider>
          <ToastProvider>
            <InboxBody archived={archived} vehicles={VEHICLES} rules={RULES} />
            {opts.report && <NotificationReportPanel fromInstant="2026-01-01T00:00:00Z" toExclusive="2026-02-01T00:00:00Z" timezone="UTC" />}
            <ContextMenuRoot />
          </ToastProvider>
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedExportAsCSV.mockReset();
  mockedExportAsJSON.mockReset();
  localStorage.clear();
  // Quiet default: opt OUT of auto-mark-read so the mark-read endpoint is only
  // exercised by the tests that explicitly cover it. Individual tests opt back
  // in as needed.
  localStorage.setItem(MARK_ON_OPEN, 'false');
  installRequest();
});

/* ── 1. Flat view ─────────────────────────────────────── */

describe('InboxBody — flat view', () => {
  it('pages through older notifications instead of stopping at the first 50', async () => {
    installRequest({
      total: 100,
      logs: () => Promise.resolve(Array.from({ length: 50 }, (_, index) => makeLog({
        id: index + 1,
        title: `Message ${index + 1}`,
      }))),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });
    fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(flatCalls().some(([path]) => String(path).includes('offset=50'))).toBe(true);
    });
    expect(screen.getByLabelText('Page 2 of 2')).toBeInTheDocument();
  });

  it('opens and marks read a channel-less system event without a rule', async () => {
    installRequest({
      logs: () => Promise.resolve([
        makeLog({
          id: 23,
          channel_id: null,
          alert_id: null,
          status: 'triggered',
          title: 'MQTT recovered',
          message: 'The message broker is receiving telemetry again.',
          event_type: 'system.mqtt.recovery',
        }),
      ]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });
    fireEvent.click(await screen.findByText('MQTT recovered'));
    expect(screen.getByRole('dialog', { name: 'MQTT recovered' })).toHaveTextContent(
      'The message broker is receiving telemetry again.',
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('system.mqtt.recovery');
    await waitFor(() => expect(markReadPosts().some(call => JSON.stringify(bodyOf(call)).includes('23'))).toBe(true));
  });

  it('filters rule-triggered history and opens the full text of a legacy delivery', async () => {
    installRequest({
      logs: () => Promise.resolve([
        makeLog({
          id: 24, title: 'Recovered', message: 'Full first line\nFull second line',
          channel_id: 2, alert_id: null, event_type: undefined,
        }),
      ]),
    });
    renderInbox();
    await screen.findByText('Recovered');
    expect(screen.getByText('Legacy channel delivery')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read full message: Recovered' }));
    expect(screen.getByRole('dialog', { name: 'Recovered' })).toHaveTextContent('Full first line');
    expect(screen.getByRole('dialog', { name: 'Recovered' })).toHaveTextContent('Full second line');
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Source filter' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), { target: { value: 'rule' } });
    await waitFor(() => {
      expect(flatCalls().some(([path]) => String(path).includes('source=rule'))).toBe(true);
      expect(callsFor((path) => path.includes('count_only=true') && path.includes('source=rule')).length).toBeGreaterThan(0);
    });
  });

  it('renders a column table, the count label, and fetches the SI-clean flat path by default', async () => {
    installRequest({
      logs: () =>
        Promise.resolve([
          makeLog({ id: 1, title: 'Battery critical' }),
          makeLog({ id: 2, title: 'Charging complete', alert_id: null }),
        ]),
    });
    renderInbox();

    expect(await screen.findByText('Battery critical')).toBeInTheDocument();
    expect(screen.getByText('Charging complete')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Received' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Notification' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByText('2 notifications')).toBeInTheDocument();

    // Flat query used; grouped query never fired (flat view disables grouping).
    expect(flatCalls()).toHaveLength(1);
    expect(groupedCalls()).toHaveLength(0);
    const path = String(flatCalls()[0][0]);
    expect(path).toContain('archived=false');
    expect(path).not.toContain('/api/v1');
  });

  it('shows a current-day Slack delivery without an alert rule and opens its detail', async () => {
    installRequest({
      logs: () => Promise.resolve([
        makeLog({
          id: 28,
          title: 'Weekly digest sent to Slack',
          message: 'Your weekly driving summary',
          channel_id: 2,
          alert_id: null,
          event_type: 'digest.fsd.weekly',
          created_at: NOW_ISO,
        }),
      ]),
    });
    renderInbox();

    expect(await screen.findByText('Weekly digest sent to Slack')).toBeInTheDocument();
    expect(screen.getByText('Digest FSD weekly')).toHaveAttribute('title', 'digest.fsd.weekly');
    expect(screen.getByRole('checkbox', { name: 'Select Weekly digest sent to Slack' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open notification: Weekly digest sent to Slack' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Your weekly driving summary');
  });

  it('shows five loading skeletons (never a blank panel) while the flat query is in flight', () => {
    installRequest({ logs: () => new Promise<never>(() => {}) });
    const { container } = renderInbox({ route: '/notifications/inbox?view=flat' });

    const skeletons = container.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]');
    expect(skeletons).toHaveLength(5);
    for (const skeleton of skeletons) {
      expect(skeleton).toHaveClass('h-14', 'w-full', 'rounded');
      expect(skeleton.parentElement).toHaveClass('space-y-2');
    }
    // Neither the populated list nor the empty state leaks during loading.
    expect(screen.queryByText('No notifications')).toBeNull();
  });

  it('surfaces a retryable error and re-fires the request on Retry', async () => {
    installRequest({ logs: () => Promise.reject(new Error('boom')) });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    expect(await screen.findByText('Could not load notifications')).toBeInTheDocument();
    const before = flatCalls().length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(flatCalls().length).toBeGreaterThan(before));
  });

  it('renders an honest empty state with a "Configure alert rules" CTA', async () => {
    installRequest({ logs: () => Promise.resolve([]) });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    expect(await screen.findByText('No notifications')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Configure alert rules' });
    expect(cta).toHaveAttribute('href', '/notifications/studio');
  });
});

/* ── 2. Grouped view (opt-in) ─────────────────────────── */

describe('InboxBody — grouped view', () => {
  it('renders threads when requested and keeps the flat query disabled', async () => {
    installRequest({
      groups: () =>
        Promise.resolve([
          makeGroup({ group_key: 'a'.repeat(64), latest: makeLog({ id: 1, title: 'Battery thread' }) }),
          makeGroup({
            group_key: null,
            latest: makeLog({ id: 2, title: 'One-off ping', alert_id: null }),
            count: 1,
            unread_count: 0,
            vehicle_ids: [],
          }),
        ]),
    });
    renderInbox({ route: '/notifications/inbox?view=grouped' });

    expect(await screen.findByTestId('notification-groups')).toBeInTheDocument();
    expect(screen.getByText('Battery thread')).toBeInTheDocument();
    expect(screen.getByText('One-off ping')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-result-count')).toHaveTextContent(
      '2 threads · 4 notifications',
    );

    // Grouped endpoint used; the flat endpoint stays untouched.
    expect(groupedCalls().length).toBeGreaterThanOrEqual(1);
    expect(String(groupedCalls()[0][0])).toContain('grouped=true');
    expect(flatCalls()).toHaveLength(0);
  });

  it('shows the thread-specific empty copy when there are no groups', async () => {
    installRequest({ groups: () => Promise.resolve([]) });
    renderInbox({ route: '/notifications/inbox?view=grouped' });

    expect(await screen.findByText('No notification threads')).toBeInTheDocument();
  });
});

/* ── 3. Export ────────────────────────────────────────── */

describe('InboxBody — export', () => {
  it('exports selected flat rows while retaining visible-scope controls', async () => {
    installRequest({
      logs: () =>
        Promise.resolve([
          makeLog({ id: 7, title: 'Selected row' }),
          makeLog({ id: 8, title: 'Visible row' }),
        ]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    await screen.findByText('Selected row');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Selected row' }));
    fireEvent.click(screen.getByTestId('notification-export-trigger'));

    expect(screen.getByTestId('notification-export-scope-selected')).toBeChecked();
    expect(screen.getByTestId('notification-export-scope-visible')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('notification-export-csv'));

    expect(mockedExportAsCSV).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 7, title: 'Selected row' })],
      expect.stringMatching(/^teslasync-notifications-\d{4}-\d{2}-\d{2}\.csv$/),
    );
  });

  it('exports grouped view as thread summaries with delivery metadata', async () => {
    installRequest({
      groups: () =>
        Promise.resolve([
          makeGroup({
            count: 4,
            unread_count: 3,
            vehicle_ids: [1, 2],
            latest: makeLog({ id: 11, title: 'Battery thread' }),
          }),
        ]),
    });
    renderInbox({ route: '/notifications/inbox?view=grouped' });

    await screen.findByText('Battery thread');
    fireEvent.click(screen.getByTestId('notification-export-trigger'));
    fireEvent.click(screen.getByTestId('notification-export-json'));

    expect(mockedExportAsJSON).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 11,
          title: 'Battery thread',
          thread_count: 4,
          unread_count: 3,
          vehicle_ids: '1,2',
        }),
      ],
      expect.stringMatching(/^teslasync-notifications-\d{4}-\d{2}-\d{2}\.json$/),
    );
  });
});

/* ── 4. View toggle ───────────────────────────────────── */

describe('InboxBody — view toggle', () => {
  it('exposes accessible grouped/flat toggles and switches the rendered list', async () => {
    installRequest({
      groups: () => Promise.resolve([makeGroup({ latest: makeLog({ id: 1, title: 'Battery thread' }) })]),
      logs: () => Promise.resolve([makeLog({ id: 5, title: 'Flat row visible' })]),
    });
    renderInbox({ route: '/notifications/inbox?view=grouped' });

    const grouped = await screen.findByTestId('view-toggle-grouped');
    const flat = screen.getByTestId('view-toggle-flat');
    // Explicit aria-label keeps the button named even when the text label is
    // hidden at mobile widths (hardening fix); aria-pressed reflects state.
    expect(grouped).toHaveAttribute('aria-label', 'Grouped');
    expect(flat).toHaveAttribute('aria-label', 'Flat');
    expect(grouped).toHaveAttribute('aria-pressed', 'true');
    expect(flat).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(flat);

    expect(await screen.findByText('Flat row visible')).toBeInTheDocument();
    expect(screen.getByTestId('view-toggle-flat')).toHaveAttribute('aria-pressed', 'true');
  });
});

/* ── 5. Archived mode ─────────────────────────────────── */

describe('InboxBody — archived mode', () => {
  it('hides the view toggle and swaps the bulk action set to Restore', async () => {
    installRequest({ logs: () => Promise.resolve([makeLog({ id: 1, title: 'Archived row' })]) });
    renderInbox({ archived: true, route: '/notifications/archived' });

    await screen.findByText('Archived row');
    // Archived is always flat — no grouped/flat switch is offered.
    expect(screen.queryByTestId('view-toggle-grouped')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Archived row' }));

    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark read' })).toBeNull();
  });

  it('uses the archived-specific empty copy when there are no archived rows', async () => {
    installRequest({ logs: () => Promise.resolve([]) });
    renderInbox({ archived: true, route: '/notifications/archived' });

    expect(await screen.findByText('No archived notifications')).toBeInTheDocument();
  });
});

/* ── 6. Bulk selection ────────────────────────────────── */

describe('InboxBody — bulk selection', () => {
  it('distinguishes selected loaded IDs from the filtered server total', async () => {
    installRequest({
      total: 120,
      logs: () => Promise.resolve([makeLog({ id: 7, title: 'Loaded selection' })]),
    });
    renderInbox();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Loaded selection' }));
    const toolbar = screen.getByRole('region', { name: /bulk actions/i });
    expect(toolbar).toHaveAttribute('data-selection-scope', 'loaded');
    expect(toolbar).toHaveTextContent('1 selected · 1 loaded notifications · 120 matching');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(markReadPosts()).toHaveLength(1));
    expect(bodyOf(markReadPosts()[0])).toEqual({ ids: [7] });
  });

  it('reports unknown result totals without inventing a loaded-row denominator', async () => {
    installRequest({ logs: () => Promise.resolve([makeLog({ id: 9, title: 'Unknown total row' })]) });
    const implementation = mockedRequest.getMockImplementation();
    mockedRequest.mockImplementation((path: string, options?: { method?: string }) =>
      path.includes('count_only=true')
        ? Promise.reject(new Error('Count unavailable'))
        : implementation?.(path, options),
    );
    renderInbox();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Unknown total row' }));
    expect(screen.getByRole('region', { name: /bulk actions/i }))
      .toHaveTextContent('1 selected · 1 loaded notifications · total unavailable');
  });

  it('uses member IDs, never thread totals or group keys, for grouped bulk selection', async () => {
    installRequest({
      total: 30,
      groups: () => Promise.resolve([makeGroup({
        count: 12, latest: makeLog({ id: 70, title: 'Latest member' }),
      })]),
      members: () => Promise.resolve([makeLog({ id: 71, title: 'Expanded member' })]),
    });
    renderInbox({ route: '/notifications/inbox?view=grouped' });
    await screen.findByText('Latest member');
    fireEvent.click(screen.getByTestId('group-expand-toggle'));
    const member = await screen.findByText('Expanded member');
    const row = member.closest('[aria-label="Expanded member"]');
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole('checkbox', { name: 'Select notification' }));
    const toolbar = screen.getByRole('region', { name: /bulk actions/i });
    expect(toolbar).toHaveAttribute('data-selection-scope', 'selected');
    expect(toolbar).toHaveTextContent('1 selected notification members');
    expect(toolbar).not.toHaveTextContent('30');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(markReadPosts()).toHaveLength(1));
    expect(bodyOf(markReadPosts()[0])).toEqual({ ids: [71] });
  });

  it('drives the select-all header checkbox through none → some (indeterminate) → all', async () => {
    installRequest({
      logs: () =>
        Promise.resolve([
          makeLog({ id: 1, title: 'Row one' }),
          makeLog({ id: 2, title: 'Row two' }),
        ]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    await screen.findByText('Row one');
    const header = screen.getByLabelText('Select all rows') as HTMLInputElement;
    expect(header.checked).toBe(false);
    expect(header.indeterminate).toBe(false);

    const rowBoxes = [
      screen.getByRole('checkbox', { name: 'Select Row one' }),
      screen.getByRole('checkbox', { name: 'Select Row two' }),
    ];
    // Partial selection → the header reflects the "some" state as indeterminate
    // rather than silently unchecked (hardening fix).
    fireEvent.click(rowBoxes[0]);
    await waitFor(() => expect(header.indeterminate).toBe(true));
    expect(header.checked).toBe(false);

    // Selecting the rest promotes it to fully checked.
    fireEvent.click(rowBoxes[1]);
    await waitFor(() => expect(header.checked).toBe(true));
    expect(header.indeterminate).toBe(false);
  });

  it('bulk "Mark read" posts exactly the selected ids', async () => {
    installRequest({
      logs: () =>
        Promise.resolve([
          makeLog({ id: 7, title: 'Selectable row' }),
          makeLog({ id: 8, title: 'Other row' }),
        ]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    await screen.findByText('Selectable row');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Selectable row' }));

    const markRead = await screen.findByRole('button', { name: 'Mark read' });
    fireEvent.click(markRead);

    await waitFor(() => expect(markReadPosts().length).toBeGreaterThanOrEqual(1));
    expect(bodyOf(markReadPosts()[0])).toEqual({ ids: [7] });
  });
});

/* ── 7. Auto-mark-read on open ────────────────────────── */

describe('InboxBody — auto-mark-read on open', () => {
  it('marks the unread rows read on open (flat, non-archived) by default', async () => {
    localStorage.setItem(MARK_ON_OPEN, 'true');
    installRequest({
      logs: () =>
        Promise.resolve([
          makeLog({ id: 3, title: 'Unread A', read_at: null }),
          makeLog({ id: 4, title: 'Read B', read_at: NOW_ISO }),
          makeLog({ id: 5, title: 'Unread C', read_at: null }),
        ]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    await screen.findByText('Unread A');
    await waitFor(() => expect(markReadPosts().length).toBeGreaterThanOrEqual(1));
    // Only the unread ids are marked — the already-read row is excluded.
    expect(bodyOf(markReadPosts()[0])).toEqual({ ids: [3, 5] });
  });

  it('respects the markOnOpen=false opt-out (no auto mark-read)', async () => {
    // beforeEach already set the opt-out flag.
    installRequest({ logs: () => Promise.resolve([makeLog({ id: 9, title: 'Still unread', read_at: null })]) });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    await screen.findByText('Still unread');
    // Give the effect a tick; it must not fire.
    await new Promise((r) => setTimeout(r, 30));
    expect(markReadPosts()).toHaveLength(0);
  });
});

/* ── 8. Mark all read ─────────────────────────────────── */

describe('InboxBody — mark all read', () => {
  it('fires the { all: true } variant from the header action', async () => {
    installRequest({
      logs: () =>
        Promise.resolve([
          makeLog({ id: 1, title: 'Unread one', read_at: null }),
          makeLog({ id: 2, title: 'Unread two', read_at: null }),
        ]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    const markAll = await screen.findByRole('button', { name: 'Mark all read' });
    fireEvent.click(markAll);

    await waitFor(() => expect(markReadPosts().length).toBeGreaterThanOrEqual(1));
    expect(bodyOf(markReadPosts()[0])).toEqual({ all: true });
  });
});

/* ── 9. URL-backed filters ────────────────────────────── */

describe('InboxBody — URL filters', () => {
  it('honors the shared seven-day workspace range instead of querying all-time history', async () => {
    localStorage.setItem(SHARED_RANGE_STORAGE_KEY, JSON.stringify({
      version: 2, start: '2026-09-01', end: '2026-09-07', presetId: '7d',
    }));
    installRequest({
      logs: () => Promise.resolve([]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    await waitFor(() => expect(flatCalls().length).toBeGreaterThanOrEqual(1));
    const params = new URL(
      String(flatCalls()[0][0]),
      'http://teslasync.local',
    ).searchParams;
    const from = params.get('from');
    const until = params.get('to_exclusive');

    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(from).not.toContain('2015-01-01');
    expect(until).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(params.has('to')).toBe(false);
    expect(callsFor((path) => path.includes('count_only=true') && path.includes('to_exclusive=')).length).toBeGreaterThan(0);
  });

  it('respects an explicit inbox date range', async () => {
    renderInbox({ route: '/notifications/inbox?from=2026-09-01&to=2026-09-07' });
    await waitFor(() => expect(flatCalls().length).toBeGreaterThanOrEqual(1));
    const params = new URL(String(flatCalls()[0][0]), 'http://teslasync.local').searchParams;
    expect(params.get('from')).toBe(new Date('2026-09-01T00:00:00').toISOString());
    expect(params.get('to_exclusive')).toBe(new Date('2026-09-08T00:00:00').toISOString());
  });

  it('threads URL filters into the request as snake_case params without the /api/v1 prefix', async () => {
    installRequest({ logs: () => Promise.resolve([]) });
    renderInbox({ route: '/notifications/inbox?view=flat&severity=critical&vehicle_id=1' });

    await waitFor(() => expect(flatCalls().length).toBeGreaterThanOrEqual(1));
    const path = String(flatCalls()[0][0]);
    expect(path).toContain('severity=critical');
    expect(path).toContain('vehicle_id=1');
    expect(path).not.toContain('/api/v1');
    expect(path).not.toContain('vehicleId');
  });
});

/* ── 10. Row context menu ─────────────────────────────── */

describe('InboxBody — row context menu', () => {
  it('opens a per-row context menu with mark-read + delete items on right-click', async () => {
    installRequest({
      logs: () => Promise.resolve([makeLog({ id: 1, title: 'Context row', read_at: null })]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    const rowEl = (await screen.findByText('Context row')).closest('tr');
    expect(rowEl).not.toBeNull();
    fireEvent.contextMenu(rowEl as Element);
    const menu = await screen.findByTestId('context-menu');
    expect(within(menu).getByText('Mark as read')).toBeInTheDocument();
    expect(within(menu).getByText('Delete')).toBeInTheDocument();
  });
});

describe('InboxBody — redesigned evidence contracts', () => {
      it.each([
        { archived: false, label: 'Archive', path: '/notifications/archive' },
        { archived: true, label: 'Restore', path: '/notifications/unarchive' },
      ])('preserves bulk $label for the selected server-page rows', async ({ archived, label, path }) => {
        installRequest({ logs: () => Promise.resolve([makeLog({ id: 47, title: 'Bulk evidence' })]) });
        renderInbox({ archived, route: archived ? '/notifications/archived' : '/notifications/inbox' });
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Bulk evidence' }));
        fireEvent.click(screen.getByRole('button', { name: label }));
        await waitFor(() => expect(callsFor((url, method) => url === path && method === 'POST')).toHaveLength(1));
        expect(bodyOf(callsFor((url, method) => url === path && method === 'POST')[0])).toEqual({ ids: [47] });
        await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Bulk evidence' })).not.toBeChecked());
      });

      it('retains confirmation-gated bulk delete', async () => {
        installRequest({ logs: () => Promise.resolve([makeLog({ id: 48, title: 'Bulk delete evidence' })]) });
        renderInbox();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Bulk delete evidence' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(deleteCalls()).toHaveLength(0);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(deleteCalls()).toHaveLength(1));
        expect(bodyOf(deleteCalls()[0])).toEqual({ ids: [48] });
      });

      it('retains rule inspection, server acknowledgement/reopen and view-context affordances', async () => {
        let acknowledged = false;
        const detail = (): AlertDetail => ({
          id: 49, vehicle_id: 1, type: 'Battery Low', severity: 'warn',
          title: 'Rule evidence', message: 'Full rule message', is_read: true,
          created_at: NOW_ISO, rule_id: 10, rule_signal: 'BatteryLevel',
          acknowledged_at: acknowledged ? NOW_ISO : null, events: [],
        });
        installRequest({
          logs: () => Promise.resolve([makeLog({ id: 49, title: 'Rule evidence' })]),
          detail: (path, method) => {
            if (method === 'POST') acknowledged = path.endsWith('/acknowledge');
            return Promise.resolve(detail());
          },
        });
        renderInbox();
        fireEvent.click(await screen.findByRole('button', { name: 'Open notification: Rule evidence' }));
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('Full rule message');
        fireEvent.click(await within(dialog).findByRole('button', { name: 'Acknowledge alert' }));
        await waitFor(() => expect(callsFor((path, method) => path === '/alerts/49/acknowledge' && method === 'POST')).toHaveLength(1));
        expect(acknowledged).toBe(true);
        // The shared drawer deliberately closes after its primary action.
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Open notification: Rule evidence' }));
        await screen.findByRole('button', { name: 'Reopen alert' });
        // Query refresh can remount the flattened motion drawer between await and click.
        fireEvent.click(screen.getByRole('button', { name: 'Reopen alert' }));
        await waitFor(() => expect(callsFor((path, method) => path === '/alerts/49/reopen' && method === 'POST')).toHaveLength(1));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
        expect(within(screen.getByRole('region', { name: 'Notification details' })).getByRole('button', { name: 'View context' })).toBeInTheDocument();
      });

      it('retains cached rows and selection after a failed refresh, but reports initial failures locally', async () => {
        let failed = false;
        installRequest({ logs: () => failed ? Promise.reject(new Error('Refresh offline')) : Promise.resolve([makeLog({ id: 42, title: 'Retained evidence' })]) });
        const { client } = renderInbox();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Retained evidence' }));
        failed = true;
        await act(async () => { await client.refetchQueries({ queryKey: notificationKeys.logs }); });
        expect(screen.getByRole('table', { name: 'Inbox' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Deselect Retained evidence' })).toBeChecked();
        expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument();
        expect(screen.queryByText('Could not load notifications')).not.toBeInTheDocument();
      });

      it('sends server-owned search, severity, vehicle, rule, source and read conditions to both rows and count', async () => {
        renderInbox({ route: '/notifications/inbox?q=pressure&severity=warn&vehicle_id=1&rule_id=10&source=rule&read=unread&from=2026-01-01&to=2026-01-30' });
        await waitFor(() => expect(flatCalls().length).toBeGreaterThan(0));
        const requests = [flatCalls()[0], callsFor(path => path.includes('count_only=true'))[0]];
        for (const call of requests) {
          const params = new URL(String(call[0]), 'http://teslasync.local').searchParams;
          for (const [key, value] of Object.entries({ q: 'pressure', severity: 'warn', vehicle_id: '1', rule_id: '10', source: 'rule', read: 'false' })) {
            expect(params.get(key)).toBe(value);
          }
          expect(params.has('from')).toBe(true);
          expect(params.has('to_exclusive')).toBe(true);
        }
        fireEvent.click(screen.getByRole('button', { name: 'Read state filter' }));
        expect(screen.getByLabelText('Filter by read state')).toHaveValue('unread');
        fireEvent.change(screen.getByLabelText('Filter by read state'), { target: { value: 'read' } });
        await waitFor(() => expect(flatCalls().some(([path]) => new URL(String(path), 'http://teslasync.local').searchParams.get('read') === 'true')).toBe(true));
      });

      it('offers persistent keyboard resize, reorder and visibility without exhaustive page-local value filters', async () => {
        installRequest({ logs: () => Promise.resolve([makeLog({ title: 'Configurable evidence' })]) });
        renderInbox();
        await screen.findByText('Configurable evidence');
        expect(screen.getByRole('columnheader', { name: 'Received' })).toHaveClass('hidden', 'md:table-cell');
        expect(screen.getByRole('columnheader', { name: /Notification/ })).not.toHaveClass('hidden');
        expect(screen.getByRole('button', { name: 'Expand row' })).toHaveAttribute('aria-expanded', 'false');
        const resize = screen.getByRole('separator', { name: 'Resize column Notification' });
        fireEvent.keyDown(resize, { key: 'ArrowRight' });
        expect(localStorage.getItem('teslasync.table.notifications:inbox.widths')).toContain('"title":308');
        fireEvent.click(screen.getByRole('button', { name: 'Reorder or hide columns' }));
        fireEvent.click(screen.getByRole('button', { name: /move.*Notification.*up/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Show or hide Message' }));
        expect(localStorage.getItem('teslasync.table.notifications:inbox.columns')).toContain('"message"');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('columnheader', { name: 'Message' })).not.toBeInTheDocument();
        expect(screen.queryByText('Select all values')).not.toBeInTheDocument();
      });

      it('exposes full metadata and every row action in a touch/keyboard expansion, with unknown distinct from zero', async () => {
        installRequest({ logs: () => Promise.resolve([makeLog({
          id: 43, title: 'Failed delivery', alert_id: null, channel_id: 2, status: 'failed',
          severity: undefined, latency_ms: 0, sent_at: null, scheduled_at: NOW_ISO,
          error: 'Connection refused', event_type: 'system.mqtt.outage',
        })]) });
        renderInbox();
        await screen.findByText('Failed delivery');
        fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
        const details = screen.getByRole('region', { name: 'Notification details' });
        expect(within(details).getByText('0.00 ms')).toBeInTheDocument();
        expect(within(details).getByText('Connection refused')).toBeInTheDocument();
        expect(within(details).getByText('system.mqtt.outage')).toBeInTheDocument();
        expect(within(details).getByText('Sent').nextElementSibling).toHaveTextContent('—');
        expect(within(details).getByText('Severity').nextElementSibling).toHaveTextContent('—');
        for (const name of ['Mark as read', 'Archive', 'Delete']) {
          expect(within(details).getByRole('button', { name })).toBeInTheDocument();
        }
        fireEvent.click(within(details).getByRole('button', { name: 'Archive' }));
        await waitFor(() => expect(callsFor((path, method) => path === '/notifications/archive' && method === 'POST')).toHaveLength(1));
      });

      it('restores archived evidence and marks a read row unread through expanded actions', async () => {
        installRequest({ logs: () => Promise.resolve([makeLog({ id: 44, title: 'Archived evidence', archived_at: NOW_ISO, read_at: NOW_ISO })]) });
        renderInbox({ archived: true, route: '/notifications/archived' });
        await screen.findByText('Archived evidence');
        fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
        const details = screen.getByRole('region', { name: 'Notification details' });
        fireEvent.click(within(details).getByRole('button', { name: 'Mark as unread' }));
        await waitFor(() => expect(callsFor((path, method) => path === '/notifications/mark-unread' && method === 'POST')).toHaveLength(1));
        fireEvent.click(within(details).getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(callsFor((path, method) => path === '/notifications/unarchive' && method === 'POST')).toHaveLength(1));
      });

      it('does not turn missing delivery latency into zero in full inspection', async () => {
        installRequest({ logs: () => Promise.resolve([makeLog({ title: 'Unknown latency', alert_id: null, latency_ms: undefined })]) });
        renderInbox();
        fireEvent.click(await screen.findByRole('button', { name: 'Open notification: Unknown latency' }));
        const dialog = screen.getByRole('dialog', { name: 'Unknown latency' });
        expect(within(dialog).getByText('Delivery latency').nextElementSibling).toHaveTextContent('—');
        expect(within(dialog).queryByText('0.00 ms')).not.toBeInTheDocument();
        await waitFor(() => expect(markReadPosts()).toHaveLength(1));
      });

      it('keeps notification evidence usable when the independent period report fails', async () => {
        installRequest({ logs: () => Promise.resolve([makeLog({ title: 'Independent evidence' })]) });
        renderInbox({ report: true });
        expect(await screen.findByText('Independent evidence')).toBeInTheDocument();
        const report = screen.getByRole('region', { name: 'Notification activity' });
        await waitFor(() => {
          const reportErrors = report.querySelectorAll(':scope > [data-print-card] > [role="alert"]');
          expect(reportErrors).toHaveLength(1);
          for (const reportError of reportErrors) {
            expect(reportError).toHaveTextContent("Can't reach server");
            expect(within(reportError as HTMLElement).getByText("Can't reach server", { exact: true })).toBeInTheDocument();
            expect(within(reportError as HTMLElement).getByText('Check your internet connection and try again.', { exact: true })).toBeInTheDocument();
          }
        });
        expect(screen.getByRole('table', { name: 'Inbox' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open notification: Independent evidence' })).toBeEnabled();
      });
});

describe('InboxBody — controlled column-header filters', () => {
      it.each([false, true])('keeps server-owned filters in headers and resets pagination (archived=%s)', async archived => {
        installRequest({ total: 120, logs: () => Promise.resolve([makeLog({ title: 'Header evidence' })]) });
        renderInbox({
          archived,
          route: `/notifications/${archived ? 'archived' : 'inbox'}?from=2026-01-01&to=2026-01-30&read=unread`,
        });
        await screen.findByText('Header evidence');
        const table = screen.getByRole('table', { name: archived ? 'Archived' : 'Inbox' });
        const frame = table.closest('[data-grid-frame]');
        const footer = frame?.querySelector('[data-grid-footer]');
        expect(footer).toContainElement(screen.getByRole('navigation', { name: 'Pagination' }));
        expect(frame?.querySelector('[data-grid-viewport]')?.contains(footer ?? null)).toBe(false);
        expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search messages…')).toBeInTheDocument();
        const initialParams = new URL(String(flatCalls()[0][0]), 'http://teslasync.local').searchParams;

        const assertQueries = async (expected: Record<string, string | null>) => {
          await waitFor(() => {
            for (const call of [flatCalls().at(-1), callsFor(path => path.includes('count_only=true')).at(-1)]) {
              expect(call).toBeDefined();
              const params = new URL(String(call![0]), 'http://teslasync.local').searchParams;
              for (const [key, value] of Object.entries(expected)) expect(params.get(key)).toBe(value);
              expect(params.get('from')).toBe(initialParams.get('from'));
              expect(params.get('to_exclusive')).toBe(initialParams.get('to_exclusive'));
              expect(params.get('archived')).toBe(String(archived));
              expect(params.get('read')).toBe('false');
            }
          });
        };
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await waitFor(() => expect(String(flatCalls().at(-1)?.[0])).toContain('offset=50'));
        fireEvent.click(screen.getByRole('button', { name: 'Severity filter' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Severity filter' })).getByRole('button', { name: 'Warn' }));
        await assertQueries({ severity: 'warn' });
        expect(new URL(String(flatCalls().at(-1)?.[0]), 'http://teslasync.local').searchParams.get('offset')).toBe('0');
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        fireEvent.click(screen.getByRole('button', { name: 'Source filter' }));
        const sourceDialog = screen.getByRole('dialog', { name: 'Source filter' });
        fireEvent.change(within(sourceDialog).getByRole('combobox', { name: 'Vehicle' }), { target: { value: '1' } });
        await assertQueries({ severity: 'warn', vehicle_id: '1' });
        fireEvent.change(within(sourceDialog).getByRole('combobox', { name: 'Rule' }), { target: { value: '10' } });
        await assertQueries({ severity: 'warn', vehicle_id: '1', rule_id: '10' });
        fireEvent.change(within(sourceDialog).getByRole('combobox', { name: 'Source' }), { target: { value: 'rule' } });
        await assertQueries({ severity: 'warn', vehicle_id: '1', rule_id: '10', source: 'rule' });
        fireEvent.click(within(sourceDialog).getByRole('button', { name: 'Done' }));

        fireEvent.click(screen.getByRole('button', { name: 'Notification filter' }));
        fireEvent.change(within(screen.getByRole('dialog', { name: 'Notification filter' })).getByPlaceholderText('Search messages…'), { target: { value: 'battery' } });
        await assertQueries({ severity: 'warn', vehicle_id: '1', rule_id: '10', source: 'rule', q: 'battery' });
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        fireEvent.click(screen.getByRole('button', { name: 'Severity filter' }));
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Severity filter' })).getByRole('button', { name: 'Clear' }));
        await assertQueries({ severity: null, vehicle_id: '1', rule_id: '10', source: 'rule', q: 'battery' });
        expect(screen.queryByText('Select all values')).not.toBeInTheDocument();
      });

      it('changes server-owned page size and resets the notification offset', async () => {
        installRequest({ total: 200, logs: () => Promise.resolve([makeLog({ title: 'Sized evidence' })]) });
        renderInbox({ route: '/notifications/inbox?severity=warn' });
        await screen.findByText('Sized evidence');
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        await waitFor(() => expect(String(flatCalls().at(-1)?.[0])).toContain('offset=50'));
        fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '100' } });
        await waitFor(() => {
          const params = new URL(String(flatCalls().at(-1)?.[0]), 'http://teslasync.local').searchParams;
          expect(params.get('limit')).toBe('100');
          expect(params.get('offset')).toBe('0');
          expect(params.get('severity')).toBe('warn');
        });
        expect(screen.getByRole('textbox', { name: 'Go to page' })).toHaveValue('1');
      });

      it('keeps all filters and reset available from the visible mobile Notification header', async () => {
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = vi.fn(query => ({
          matches: query === '(max-width: 767px)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }));
        try {
          installRequest({ logs: () => Promise.resolve([]) });
          renderInbox({
            archived: true,
            route: '/notifications/archived?severity=critical&vehicle_id=1&rule_id=10&source=rule&q=pressure&read=unread&from=2026-01-01&to=2026-01-30',
          });
          await screen.findByText('No archived notifications');
          const table = screen.getByRole('table', { name: 'Archived' });
          expect(table.parentElement).toHaveClass('min-w-0', 'w-full', 'max-w-full');
          expect(table.parentElement?.parentElement?.parentElement).toHaveClass('min-w-0', 'w-full', 'max-w-full');
          const initialParams = new URL(String(flatCalls()[0][0]), 'http://teslasync.local').searchParams;
          fireEvent.click(screen.getByRole('button', { name: 'Notification filter' }));
          const dialog = screen.getByRole('dialog', { name: 'Notification filter' });
          expect(within(dialog).getByRole('button', { name: 'Critical' })).toHaveAttribute('aria-pressed', 'true');
          expect(within(dialog).getByRole('combobox', { name: 'Vehicle' })).toHaveValue('1');
          expect(within(dialog).getByRole('combobox', { name: 'Rule' })).toHaveValue('10');
          expect(within(dialog).getByRole('combobox', { name: 'Source' })).toHaveValue('rule');
          for (const name of ['Vehicle', 'Rule', 'Source']) {
            expect(within(dialog).getByRole('combobox', { name }).parentElement?.parentElement)
              .toHaveClass('min-w-0', 'w-full', 'max-w-full');
          }
          expect(within(dialog).getByLabelText('Filter by read state')).toHaveValue('unread');
          expect(within(dialog).getByPlaceholderText('Search messages…')).toHaveValue('pressure');
          fireEvent.click(within(dialog).getByRole('button', { name: 'Clear all' }));
          await waitFor(() => {
            for (const call of [flatCalls().at(-1), callsFor(path => path.includes('count_only=true')).at(-1)]) {
              const params = new URL(String(call![0]), 'http://teslasync.local').searchParams;
              for (const key of ['severity', 'vehicle_id', 'rule_id', 'source', 'q', 'read']) expect(params.has(key)).toBe(false);
              expect(params.get('archived')).toBe('true');
              expect(params.get('from')).toBe(initialParams.get('from'));
              expect(params.get('to_exclusive')).toBe(initialParams.get('to_exclusive'));
            }
          });
        } finally {
          window.matchMedia = originalMatchMedia;
        }
      });

      it('preserves usable header filters during initial request failure', async () => {
        installRequest({ logs: () => Promise.reject(new Error('Offline evidence')) });
        renderInbox({ route: '/notifications/inbox?severity=warn' });
        await screen.findByText('Could not load notifications');
        fireEvent.click(screen.getByRole('button', { name: 'Severity filter' }));
        expect(screen.getByRole('button', { name: 'Warn' })).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        await waitFor(() => expect(new URL(String(flatCalls().at(-1)?.[0]), 'http://teslasync.local').searchParams.has('severity')).toBe(false));
      });
});

describe('InboxBody — single-row confirmations', () => {
  it('confirm-gates the single-row delete from the context menu', async () => {
    installRequest({
      logs: () => Promise.resolve([makeLog({ id: 1, title: 'Context row', read_at: null })]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    const rowEl = (await screen.findByText('Context row')).closest('tr');
    fireEvent.contextMenu(rowEl as Element);
    const menu = await screen.findByTestId('context-menu');
    fireEvent.click(within(menu).getByText('Delete'));

    // A danger confirm naming the notification — no DELETE yet.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete this notification?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Context row');
    expect(deleteCalls().length).toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteCalls().length).toBe(1));
    expect(bodyOf(deleteCalls()[0] ?? [])).toEqual({ ids: [1] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not delete when the single-row confirm is cancelled', async () => {
    installRequest({
      logs: () => Promise.resolve([makeLog({ id: 1, title: 'Context row', read_at: null })]),
    });
    renderInbox({ route: '/notifications/inbox?view=flat' });

    const rowEl = (await screen.findByText('Context row')).closest('tr');
    fireEvent.contextMenu(rowEl as Element);
    const menu = await screen.findByTestId('context-menu');
    fireEvent.click(within(menu).getByText('Delete'));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deleteCalls().length).toBe(0);
  });
});
