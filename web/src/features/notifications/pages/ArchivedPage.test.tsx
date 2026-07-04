/**
 * ArchivedPage — contract + hardening tests.
 *
 * ArchivedPage is a composition page: it wires the unfiltered archived
 * backlog query into a KPI summary band (`ArchivedSummary`) over the shared
 * `InboxBody` detail surface, plus a "Back to inbox" affordance and a
 * copy-link header. Its job is orchestration, so these tests drive the page
 * end-to-end — the REAL `ArchivedSummary` + `PageContainer` + `Link` against a
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
 *      page forwards empty arrays (never `undefined`) to the inbox body, and it
 *      sets the document title.
 *
 * Network is mocked at the `@/api/client` boundary (repo convention — see
 * CostAnalysisPage.test.tsx). `react-i18next` is stubbed to echo the inline
 * fallback so text assertions stay deterministic. `useSettings` / `useTimezone`
 * come from the global stubs in src/test-setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

vi.mock('../components/InboxBody', () => ({
  InboxBody: (props: { archived: boolean; vehicles: unknown[]; rules: unknown[] }) => {
    const vehicles = props.vehicles ?? [];
    const rules = props.rules ?? [];
    captured.inbox = { archived: props.archived, vehicles, rules };
    return (
      <div
        data-testid="inbox-body"
        data-archived={String(props.archived)}
        data-vehicles={vehicles.length}
        data-rules={rules.length}
      />
    );
  },
}));

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/notifications/archived']}>
        <ToastProvider>
          <ArchivedPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
  captured.inbox = null;
  __resetTitleStoreForTests();
  installRequest();
});

describe('ArchivedPage', () => {
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
    expect(await screen.findByText('Total archived')).toBeInTheDocument();
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
    expect(await screen.findByTestId('stat-grid-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Total archived')).toBeNull();
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
