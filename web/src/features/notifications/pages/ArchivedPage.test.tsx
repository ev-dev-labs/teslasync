/**
 * ArchivedPage — contract + hardening tests.
 *
 * ArchivedPage is a composition page: it wires the unfiltered archived
 * backlog query into a KPI summary band (`ArchivedSummary`) over the shared
 * `InboxBody` detail surface, plus a "Back to inbox" affordance and a
 * copy-link header. Its job is orchestration, so these tests drive the page
 * end-to-end — the REAL `InboxSummary` + `PageLayout` + `Link` against a
 * mocked `request()` boundary — while stubbing the heavy, URL-coupled
 * `InboxBody` so we can assert exactly what the page forwards to it.
 *
 * Facets covered:
 *   1. Populated — header/subtitle/back-link render; the KPI band derives the
 *      right totals from the archived set; the inbox body receives
 *      `archived=true` + the vehicles/rules lookups; the summary fetch uses the
 *      SI-clean `/notifications/logs?archived=true` path (no `/api/v1` prefix,
 *      snake_case param).
 *   2. Loading — while the archived query is in flight the summary shows its
 *      skeleton (never a blank panel) and the inbox body still mounts.
 *   3. Error — a failed archived query surfaces a retryable alert without
 *      hiding the rest of the page; Retry re-fires the request.
 *   4. Empty — a zero-row backlog renders an honest empty state, not a blank
 *      panel, and no KPI cards.
 *   5. Null-safety + title — when the vehicle/rule lookups return no data the
 *      page forwards empty arrays (never `undefined`) to the inbox body, shows
 *      independent lookup recovery, and sets the document title.
 *   6. Trust — active loading, paused acquisition, authoritative emptiness,
 *      unknown filter IDs, and retained lookup refresh failure/recovery.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * CostAnalysisPage.test.tsx). `react-i18next` is stubbed to echo the inline
 * fallback so text assertions stay deterministic. `useSettings` / `useTimezone`
 * come from the global stubs in src/test-setup.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

// Stub the heavy, URL-state-coupled InboxBody so this suite isolates the page's
// wiring. The stub records the props the page forwards and mirrors the counts
// onto data-* attributes for attribute assertions.
const captured = vi.hoisted(() => ({
  inbox: null as { archived: unknown; vehicles: unknown[]; rules: unknown[] } | null,
}));

vi.mock('../components/InboxBody', async () => {
  const { NotificationFilterBar } = await import('../components/NotificationFilterBar');
  const { useSearchParams } = await import('react-router-dom');
  return {
    InboxBody: (props: { archived: boolean; vehicles: Vehicle[]; rules: AlertRule[] }) => {
    const [params] = useSearchParams();
    const vehicles = props.vehicles ?? [];
    const rules = props.rules ?? [];
    captured.inbox = { archived: props.archived, vehicles, rules };
    return (
      <div
        data-testid="inbox-body"
        data-archived={String(props.archived)}
        data-vehicles={vehicles.length}
        data-rules={rules.length}
      >
        <NotificationFilterBar
          vehicles={props.vehicles}
          rules={props.rules}
          filters={{
            vehicle_id: params.getAll('vehicle_id').map(Number),
            rule_id: params.getAll('rule_id').map(Number),
          }}
          onChange={vi.fn()}
        />
      </div>
    );
    },
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { __resetTitleStoreForTests } from '@/lib/titleStore';
import type { NotificationLog, AlertRule } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';
import ArchivedPage from './ArchivedPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/* ── Fixtures ─────────────────────────────────────────── */

function makeVehicle(id: number): Vehicle {
  return { id, vehicle_id: id, vin: `VIN${id}`, display_name: `Car ${id}` } as unknown as Vehicle;
}

function makeRule(id: number): AlertRule {
  return { id, name: `Rule ${id}` } as unknown as AlertRule;
}

function makeLog(overrides: Partial<NotificationLog>): NotificationLog {
  return {
    id: 1,
    channel_id: 1,
    alert_id: null,
    title: 'Archived alert',
    message: 'msg',
    status: 'sent',
    error: '',
    created_at: '2025-01-01T00:00:00Z',
    sent_at: '2025-01-01T00:00:00Z',
    read_at: null,
    archived_at: '2025-01-02T00:00:00Z',
    ...overrides,
  } as NotificationLog;
}

const VEHICLES: Vehicle[] = [makeVehicle(1), makeVehicle(2)];
const RULES: AlertRule[] = [makeRule(10), makeRule(11), makeRule(12)];

// total 6 · critical 3 · warn 2 · info 1 · unread 4 (ids 1,2,4,5) — every
// asserted count is a unique digit so getByText('N') never collides.
const LOGS: NotificationLog[] = [
  makeLog({ id: 1, severity: 'critical', read_at: null }),
  makeLog({ id: 2, severity: 'critical', read_at: null }),
  makeLog({ id: 3, severity: 'critical', read_at: '2025-01-03T00:00:00Z' }),
  makeLog({ id: 4, severity: 'warn', read_at: null }),
  makeLog({ id: 5, severity: 'warn', read_at: null }),
  makeLog({ id: 6, severity: 'info', read_at: '2025-01-03T00:00:00Z' }),
];

type Resolver = () => Promise<unknown>;

function installRequest(handlers: { vehicles?: Resolver; rules?: Resolver; logs?: Resolver } = {}) {
  mockedRequest.mockImplementation((path: string) => {
    if (path.startsWith('/vehicles')) return (handlers.vehicles ?? (() => Promise.resolve(VEHICLES)))();
    if (path.startsWith('/alerts/rules')) return (handlers.rules ?? (() => Promise.resolve(RULES)))();
    if (path.startsWith('/notifications/logs')) return (handlers.logs ?? (() => Promise.resolve(LOGS)))();
    return Promise.resolve([]);
  });
}

const logsCallCount = () =>
  mockedRequest.mock.calls.filter((c) => String(c[0]).startsWith('/notifications/logs')).length;

function renderPage(initialEntry = '/notifications/archived') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <ArchivedPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

beforeEach(() => {
  mockedRequest.mockReset();
  captured.inbox = null;
  __resetTitleStoreForTests();
  installRequest();
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('ArchivedPage independent lookup trust', () => {
  it('shows active lookup loading without claiming empty catalogs or hiding the summary', async () => {
    installRequest({ vehicles: () => new Promise<never>(() => {}) });
    renderPage();

    const vehicles = screen.getByRole('region', { name: 'Vehicles' });
    expect(within(vehicles).getByRole('status')).toBeInTheDocument();
    expect(vehicles.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('No vehicles yet')).toBeNull();
    await waitFor(() => expect(captured.inbox?.rules).toEqual(RULES));
    expect(screen.getByTestId('inbox-body')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archived summary' })).toBeInTheDocument();
  });

  it('distinguishes paused acquisition from active loading and successful emptiness', async () => {
    onlineManager.setOnline(false);
    renderPage();

    for (const label of ['Vehicles', 'Rules']) {
      const region = screen.getByRole('region', { name: label });
      expect(within(region).getByText('Refresh paused')).toBeInTheDocument();
      expect(within(region).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(region.querySelector('[class*="--skeleton-bg"]')).toBeNull();
      expect(within(region).queryByRole('alert')).toBeNull();
    }
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(screen.queryByText('No archived notifications yet')).toBeNull();
    expect(screen.queryByText('No vehicles yet')).toBeNull();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(captured.inbox?.vehicles).toEqual(VEHICLES));
    expect(screen.queryByRole('region', { name: 'Vehicles' })).toBeNull();
  });

  it('discloses successful empty catalogs and preserves unknown selected IDs', async () => {
    installRequest({ vehicles: () => Promise.resolve([]), rules: () => Promise.resolve([]) });
    renderPage('/notifications/archived?vehicle_id=999&rule_id=888');

    expect(await screen.findByText('No vehicles yet')).toBeInTheDocument();
    expect(await screen.findByText('No alert rules yet')).toBeInTheDocument();
    expect(screen.getByText('#999')).toBeInTheDocument();
    expect(screen.getByText('#888')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Archived summary' });
    await waitFor(() => expect(within(summary).getByText('6')).toBeInTheDocument());
    expect(within(summary).getByText('3')).toBeInTheDocument();
  });

  it('renders confirmed zero severity counts rather than unknown values', async () => {
    installRequest({ logs: () => Promise.resolve([makeLog({ severity: 'info', read_at: null })]) });
    renderPage();
    const summary = screen.getByRole('region', { name: 'Archived summary' });
    await waitFor(() => expect(within(summary).getByText('Total archived')).toBeInTheDocument());
    await waitFor(() => {
      expect(within(summary).getAllByText('0')).toHaveLength(2);
      expect(within(summary).getAllByText('1').length).toBeGreaterThanOrEqual(3);
    });
  });

  it('retains lookup evidence on refresh failure and retries only the affected source', async () => {
    const { client } = renderPage('/notifications/archived?vehicle_id=999&rule_id=888');
    await waitFor(() => expect(captured.inbox?.vehicles).toEqual(VEHICLES));
    await waitFor(() => expect(captured.inbox?.rules).toEqual(RULES));
    installRequest({ vehicles: () => Promise.reject(new Error('vehicles refresh down')) });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['vehicles'], exact: true });
    });

    const vehicles = await screen.findByRole('region', { name: 'Vehicles' });
    expect(within(vehicles).getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(within(vehicles).queryByRole('alert')).toBeNull();
    expect(captured.inbox?.vehicles).toEqual(VEHICLES);
    expect(captured.inbox?.rules).toEqual(RULES);
    expect(screen.getByText('#999')).toBeInTheDocument();
    expect(screen.getByText('#888')).toBeInTheDocument();
    const rulesCalls = mockedRequest.mock.calls.filter(([path]) => path === '/alerts/rules').length;
    const logsCalls = logsCallCount();

    installRequest({ vehicles: () => Promise.resolve([makeVehicle(3)]) });
    fireEvent.click(within(vehicles).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(captured.inbox?.vehicles).toEqual([makeVehicle(3)]));
    expect(screen.queryByRole('region', { name: 'Vehicles' })).toBeNull();
    expect(mockedRequest.mock.calls.filter(([path]) => path === '/alerts/rules')).toHaveLength(rulesCalls);
    expect(logsCallCount()).toBe(logsCalls);
  });

  it('recovers a failed rules lookup without replacing neighboring evidence', async () => {
    installRequest({ rules: () => Promise.reject(new Error('rules down')) });
    renderPage();
    const rules = await screen.findByRole('region', { name: 'Rules' });
    expect(await within(rules).findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(captured.inbox?.vehicles).toEqual(VEHICLES));
    installRequest();
    fireEvent.click(within(rules).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(captured.inbox?.rules).toEqual(RULES));
    expect(screen.queryByRole('region', { name: 'Rules' })).toBeNull();
    expect(captured.inbox?.vehicles).toEqual(VEHICLES);
  });
});

describe('ArchivedPage', () => {
  it('counts warn and warning together without rewriting archived source evidence or unknown severity', async () => {
    const logs = [
      makeLog({ id: 71, severity: 'warn' }),
      makeLog({ id: 72, severity: 'warning', read_at: '2025-01-03T00:00:00Z' }),
      makeLog({ id: 73, severity: 'custom' }),
    ];
    const original = structuredClone(logs);
    installRequest({ logs: () => Promise.resolve(logs) });
    const { client } = renderPage();
    await waitFor(() => expect(screen.getByTestId('notification-backlog-brief')).not.toHaveAttribute('aria-busy', 'true'));
    const summary = screen.getByRole('region', { name: 'Archived summary' });
    expect(within(summary).getByText('Warnings')).toBeInTheDocument();
    expect(within(summary).getAllByText('2')).toHaveLength(2);
    expect(within(summary).getByText('Unknown severity')).toBeInTheDocument();
    expect(logs).toEqual(original);
    expect(client.getQueriesData({ queryKey: ['notification-logs'] }).some(([, data]) => data === logs)).toBe(true);
    expect(mockedRequest.mock.calls.every(([, options]) => !options?.method)).toBe(true);
    expect(captured.inbox?.archived).toBe(true);
  });

  it('renders the header, back-link, KPI band, and forwards archived+lookups to the inbox body', async () => {
    renderPage();

    // Header + subtitle render synchronously from the page shell.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Archived notifications' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Notifications you previously archived. Restore to bring them back.'),
    ).toBeInTheDocument();

    // Back-to-inbox is a real link with an icon that is hidden from AT, so its
    // accessible name is exactly the label text.
    const back = screen.getByRole('link', { name: 'Back to inbox' });
    expect(back).toHaveAttribute('href', '/notifications/inbox');

    // Copy-link header affordance is wired via `copyLink`.
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();

    // KPI band populates from the archived backlog. The summary section is an
    // accessible region; assert the derived counts inside it.
    await waitFor(() => expect(screen.getByTestId('notification-backlog-brief')).not.toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByText('Total archived')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Archived summary' });
    expect(within(region).getByText('6')).toBeInTheDocument(); // total
    expect(within(region).getByText('3')).toBeInTheDocument(); // critical
    expect(within(region).getByText('2')).toBeInTheDocument(); // warn
    expect(within(region).getByText('1')).toBeInTheDocument(); // info
    expect(within(region).getByText('4')).toBeInTheDocument(); // unread

    // Inbox body receives archived=true plus the resolved vehicle/rule lookups.
    const inbox = screen.getByTestId('inbox-body');
    expect(inbox).toHaveAttribute('data-archived', 'true');
    expect(inbox).toHaveAttribute('data-vehicles', '2');
    expect(inbox).toHaveAttribute('data-rules', '3');
    expect(captured.inbox?.archived).toBe(true);

    // The summary fetch uses the SI-clean path: no /api/v1 double-prefix and a
    // snake_case `archived=true` query param.
    const logsCall = mockedRequest.mock.calls.find((c) =>
      String(c[0]).startsWith('/notifications/logs'),
    );
    expect(logsCall?.[0]).toBe('/notifications/logs?archived=true');
  });

  it('shows the summary skeleton while the archived query is in flight, without blanking the page', async () => {
    installRequest({ logs: () => new Promise<never>(() => {}) });
    renderPage();

    // Loading state renders the stat-grid skeleton, not the populated cards or
    // the empty state.
    const brief = await screen.findByTestId('notification-backlog-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.queryByText('No archived notifications yet')).toBeNull();

    // The rest of the page still renders — never a frozen/blank surface.
    expect(screen.getByTestId('inbox-body')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archived summary' })).toBeInTheDocument();
  });

  it('surfaces a retryable error for a failed archived query and keeps the page usable', async () => {
    installRequest({ logs: () => Promise.reject(new Error('boom')) });
    renderPage();

    const region = await screen.findByRole('region', { name: 'Archived summary' });
    // Network-class failure renders the loud alert + a Retry CTA scoped to the
    // summary band.
    expect(await within(region).findByRole('alert')).toBeInTheDocument();
    const retry = within(region).getByRole('button', { name: 'Retry' });

    // Graceful degrade: the header link + inbox body remain despite the error.
    expect(screen.getByRole('link', { name: 'Back to inbox' })).toBeInTheDocument();
    expect(screen.getByTestId('inbox-body')).toBeInTheDocument();

    // Retry re-issues the archived request.
    const before = logsCallCount();
    fireEvent.click(retry);
    await waitFor(() => expect(logsCallCount()).toBeGreaterThan(before));
  });

  it('renders an empty state (not a blank panel) when there are no archived notifications', async () => {
    installRequest({ logs: () => Promise.resolve([]) });
    renderPage();

    expect(await screen.findByText('No archived notifications yet')).toBeInTheDocument();
    const region = screen.getByRole('region', { name: 'Archived summary' });
    expect(within(region).getByRole('status')).toBeInTheDocument();
    // No KPI cards in the empty branch.
    expect(screen.queryByText('Total archived')).toBeNull();
    // Inbox body still mounts.
    expect(screen.getByTestId('inbox-body')).toBeInTheDocument();
  });

  it('forwards empty arrays (never undefined) when the vehicle/rule lookups fail and sets the title', async () => {
    // A failed lookup leaves the hook `data` undefined; the page's `= []`
    // defaults must still hand the inbox body arrays, never undefined.
    installRequest({
      vehicles: () => Promise.reject(new Error('vehicles down')),
      rules: () => Promise.reject(new Error('rules down')),
      logs: () => Promise.resolve([]),
    });
    renderPage();

    // Wait for the archived query to settle so the summary/inbox have rendered.
    await screen.findByText('No archived notifications yet');

    const inbox = screen.getByTestId('inbox-body');
    expect(inbox).toHaveAttribute('data-vehicles', '0');
    expect(inbox).toHaveAttribute('data-rules', '0');
    expect(captured.inbox?.vehicles).toEqual([]);
    expect(captured.inbox?.rules).toEqual([]);

    await waitFor(() =>
      expect(document.title).toBe('Archived notifications — TeslaSync'),
    );
  });
});

describe('ArchivedPage restrained navigation', () => {
  it('keeps a native named back link with theme focus, mobile targets, and wrapping text', async () => {
    renderPage();

    const back = screen.getByRole('link', { name: 'Back to inbox' });
    expect(back.tagName).toBe('A');
    expect(back).toHaveAttribute('href', '/notifications/inbox');
    expect(back).toHaveClass(
      'min-h-11',
      'min-w-11',
      'md:min-h-9',
      'max-w-full',
      'hover:bg-[var(--control-bg)]',
      'focus-visible:outline-[var(--focus-ring)]',
      'forced-colors:focus-visible:outline-[Highlight]',
      'motion-reduce:transition-none',
    );
    expect(back).not.toHaveClass('focus-visible:ring-cyan-400/60', 'hover:bg-white/[0.04]');
    expect(within(back).getByText('Back to inbox')).toHaveClass('min-w-0', 'break-words');
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(back.querySelector('svg')).toHaveClass('shrink-0', 'rtl:rotate-180');
    back.focus();
    expect(back).toHaveFocus();

    await waitFor(() => expect(captured.inbox?.rules).toEqual(RULES));
  });

  it('preserves the independent archived sample and performs only catalog and summary reads on mount', async () => {
    renderPage();

    await waitFor(() => expect(captured.inbox?.vehicles).toEqual(VEHICLES));
    await waitFor(() =>
      expect(screen.getByTestId('notification-backlog-brief')).not.toHaveAttribute('aria-busy', 'true'),
    );

    const calls = mockedRequest.mock.calls;
    expect(calls.map(([path]) => path)).toEqual(expect.arrayContaining([
      '/vehicles',
      '/alerts/rules',
      '/notifications/logs?archived=true',
    ]));
    expect(calls.every(([path]) => [
      '/vehicles',
      '/alerts/rules',
      '/notifications/logs?archived=true',
    ].includes(String(path)))).toBe(true);
    expect(calls.every(([, options]) => options?.method == null || options.method === 'GET')).toBe(true);
    expect(captured.inbox).toEqual({ archived: true, vehicles: VEHICLES, rules: RULES });
  });
});
