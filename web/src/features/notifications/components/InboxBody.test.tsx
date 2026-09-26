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
import type { NotificationLog, NotificationLogGroup, AlertRule, Vehicle } from '@/api/types';
import { InboxBody } from './InboxBody';

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
}

function installRequest(h: Handlers = {}) {
  mockedRequest.mockImplementation((path: string, options?: { method?: string }) => {
    const method = options?.method;
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      if (path.includes('mark-read')) return Promise.resolve({ updated: 1 });
      if (path.includes('unarchive')) return Promise.resolve({ updated: 1 });
      if (path.includes('archive')) return Promise.resolve({ updated: 1 });
      if (path.startsWith('/notifications/logs')) return Promise.resolve({ deleted: 1 });
      return Promise.resolve({});
    }
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

function renderInbox(opts: { archived?: boolean; route?: string } = {}): RenderResult {
  const { archived = false, route = '/notifications/inbox' } = opts;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <SelectedVehicleProvider>
          <ToastProvider>
            <InboxBody archived={archived} vehicles={VEHICLES} rules={RULES} />
            <ContextMenuRoot />
          </ToastProvider>
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'rule' } });
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
    expect(screen.getByText('Digest FSD Weekly')).toHaveAttribute('title', 'digest.fsd.weekly');
    expect(screen.getByRole('checkbox', { name: 'Select Weekly digest sent to Slack' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open notification: Weekly digest sent to Slack' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Your weekly driving summary');
  });

  it('shows five loading skeletons (never a blank panel) while the flat query is in flight', () => {
    installRequest({ logs: () => new Promise<never>(() => {}) });
    const { container } = renderInbox({ route: '/notifications/inbox?view=flat' });

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
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
    expect(params.get('from')).toBe('2026-09-01T07:00:00.000Z');
    expect(params.get('to_exclusive')).toBe('2026-09-08T07:00:00.000Z');
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
