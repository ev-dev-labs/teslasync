/**
 * NotificationStatsWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans TWO hooks (`useNotificationStats` for the KPI grid /
 * delivery-rate hero + `useNotificationLogs` for the recent-notification
 * table) into three responsive layouts (compact 1×N delivery-rate hero /
 * standard 2×2 stat grid / wide ≥3-col stat grid + recent-log table). It has
 * no named exports, so this suite drives the single default export through its
 * accessible surface across every layout, state, and branch:
 *
 *   - the loading / empty / error paths of each layout (never a blank panel —
 *     an <EmptyState role="status"> or <QueryError> always renders);
 *   - the compact hero's delivery-rate number + the conditional "N failed"
 *     line (shown only when failures exist);
 *   - the standard stat grid's four KPIs plus the "Healthy" / "Needs
 *     attention" trend copy driven by the delivery-rate + failed thresholds;
 *   - the wide layout's recent-log table: the ELEVATION BUG FIX that the two
 *     leading columns are now honestly labelled "Title" / "Message" (they
 *     render `log.title` / `log.message` but were previously mislabelled
 *     "Channel" / "Type"), the per-status badge (incl. the `deferred_dnd`
 *     fallback), newest-first ordering, the 5-row cap, and — crucially — the
 *     i18n'd relative-time formatter (`Just now` / `Nm ago` / `Nh ago` /
 *     absolute fall-through) that replaced hardcoded English;
 *   - the dual-source refresh: the freshness control refetches BOTH queries.
 *
 * Both hooks are mocked at the hook boundary so no network is touched;
 * `importActual` keeps the module's other exports intact. `useDateFormat` is
 * mocked to a deterministic `formatDateTime` (so the >24h fall-through is
 * assertable) + `formatTime` (which <DataFreshness> inside <WidgetShell>
 * destructures). `react-i18next` is stubbed to echo the English fallback and
 * interpolate `{{var}}` tokens. `@testing-library/user-event` is not installed
 * in this repo (see the sibling ExportStatusWidget / LocationFavoritesWidget
 * suites), so interactions use `fireEvent`. `QueryError` + `EmptyState` pull in
 * `react-router-dom`, so renders are wrapped in a `MemoryRouter`.
 */

import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so count-bearing copy ("{{minutes}}m ago", DataFreshness) renders
// as real text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data sources become controllable vi.fns. importActual keeps the
// module's many other notification hooks intact for any transitive importer.
vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
    '@/api/hooks/useNotifications',
  );
  return { ...actual, useNotificationStats: vi.fn(), useNotificationLogs: vi.fn() };
});

// Deterministic date formatting: the widget uses `formatDateTime` for the
// >24h relative-time fall-through, and <DataFreshness> (inside <WidgetShell>)
// destructures `formatTime`. Both are stubbed so assertions never depend on
// the ambient locale / timezone settings.
vi.mock('@/hooks/useDateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDateFormat')>(
    '@/hooks/useDateFormat',
  );
  return { ...actual, useDateFormat: vi.fn() };
});

import NotificationStatsWidget from './NotificationStatsWidget';
import { useNotificationStats, useNotificationLogs } from '@/api/hooks/useNotifications';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { NotificationLog, NotificationStats } from '@/api/types';
import type { WidgetSize } from './types';

const mockUseStats = vi.mocked(useNotificationStats);
const mockUseLogs = vi.mocked(useNotificationLogs);
const mockUseDateFormat = vi.mocked(useDateFormat);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 1_700_000_000_000,
    refetch: vi.fn(),
    ...over,
  };
}

/** Deterministic `useDateFormat` stub: only the two consumed formatters. */
function dateFmt(): ReturnType<typeof useDateFormat> {
  return {
    formatDateTime: (v: string | Date | null | undefined) => `ABS:${String(v)}`,
    formatTime: () => 'TIME',
  } as unknown as ReturnType<typeof useDateFormat>;
}

const STATS: NotificationStats = {
  total_sent: 120,
  sent: 118,
  failed: 2,
  pending: 0,
  total_channels: 5,
  enabled_channels: 3,
};

let logSeq = 0;
function makeLog(over: Partial<NotificationLog> = {}): NotificationLog {
  logSeq += 1;
  return {
    id: logSeq,
    channel_id: 1,
    alert_id: null,
    title: `Log ${logSeq}`,
    message: `Body ${logSeq}`,
    status: 'sent',
    error: '',
    created_at: new Date(Date.now() - logSeq * 60_000).toISOString(),
    sent_at: null,
    ...over,
  };
}

/** ISO string `mins` minutes in the past (for relative-time branches). */
const minsAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

function renderWidget(size: WidgetSize) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationStatsWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };

beforeEach(() => {
  logSeq = 0;
  vi.clearAllMocks();
  mockUseStats.mockReturnValue(qr({ data: undefined }));
  mockUseLogs.mockReturnValue(qr({ data: [] }));
  mockUseDateFormat.mockReturnValue(dateFmt());
});

// ── Compact layout (cols ≤ 1): the delivery-rate hero ───────────────────────

describe('NotificationStatsWidget — compact layout', () => {
  it('renders a loading skeleton (no hero copy) while the stats query loads', () => {
    mockUseStats.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(COMPACT);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Delivery Rate')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there is no stats data', () => {
    renderWidget(COMPACT);
    const empty = screen.getByText('No notification data');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('surfaces a query error instead of the hero', () => {
    mockUseStats.mockReturnValue(qr({ isError: true, error: new Error('boom') }));
    renderWidget(COMPACT);
    // QueryError's generic (status-less) branch renders the network copy.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Delivery Rate')).toBeNull();
  });

  it('renders the delivery-rate hero and the "N failed" line when failures exist', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    renderWidget(COMPACT);
    // 118 / 120 → 98.333… → one decimal.
    expect(screen.getByText('98.3%')).toBeInTheDocument();
    expect(screen.getByText('Delivery Rate')).toBeInTheDocument();
    expect(screen.getByText('2 failed')).toBeInTheDocument();
  });

  it('hides the failed line when there are zero failures', () => {
    mockUseStats.mockReturnValue(
      qr({ data: { ...STATS, total_sent: 100, sent: 100, failed: 0 } }),
    );
    renderWidget(COMPACT);
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it('refetches BOTH queries when the accessible refresh control is activated', () => {
    const statsRefetch = vi.fn();
    const logsRefetch = vi.fn();
    mockUseStats.mockReturnValue(qr({ data: STATS, refetch: statsRefetch }));
    mockUseLogs.mockReturnValue(qr({ data: [], refetch: logsRefetch }));
    renderWidget(COMPACT);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(statsRefetch).toHaveBeenCalledTimes(1);
    expect(logsRefetch).toHaveBeenCalledTimes(1);
  });
});

// ── Standard layout (2×2): the KPI stat grid ────────────────────────────────

describe('NotificationStatsWidget — standard layout', () => {
  it('renders the title, four KPIs, and the threshold-driven trend copy', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    renderWidget(STANDARD);

    expect(screen.getByText('Notification Stats')).toBeInTheDocument();
    expect(screen.getByText('Total Sent (7d)')).toBeInTheDocument();
    expect(screen.getByText('Delivery Rate')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Active Channels')).toBeInTheDocument();

    // Values: total sent (also echoed as its "up" trend), delivery rate,
    // failed, active channels.
    expect(screen.getAllByText('120')).toHaveLength(2);
    expect(screen.getByText('98.3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // 98.3% ≥ 95 → "Healthy"; failed 2 > 0 → "Needs attention".
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('treats a logs-query load as loading too (renders the skeleton)', () => {
    // Stats are ready but the secondary logs query is still loading — the
    // standard layout gates its skeleton on `statsLoading || logsLoading`.
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Total Sent (7d)')).toBeNull();
  });

  it('shows the title + empty state (not the grid) when stats are absent', () => {
    mockUseLogs.mockReturnValue(qr({ data: [makeLog()] }));
    renderWidget(STANDARD);
    expect(screen.getByText('Notification Stats')).toBeInTheDocument();
    expect(screen.getByText('No notification data')).toBeInTheDocument();
    expect(screen.queryByText('Active Channels')).toBeNull();
  });

  it('does NOT render the recent-log table below the standard breakpoint', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(qr({ data: [makeLog({ title: 'Charge Complete' })] }));
    renderWidget(STANDARD);
    // The table (and its "Status" header + the log title) only appears in wide.
    expect(screen.queryByText('Charge Complete')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
  });
});

// ── Wide layout (≥3 cols): stat grid + recent-log table ─────────────────────

describe('NotificationStatsWidget — wide layout', () => {
  it('renders the recent-log table with honest headers, content, and status badges', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(
      qr({
        data: [
          makeLog({ title: 'Alpha', message: 'Body A', status: 'sent' }),
          makeLog({ title: 'Bravo', message: 'Body B', status: 'failed' }),
          makeLog({ title: 'Charlie', message: 'Body C', status: 'pending' }),
          makeLog({ title: 'Delta', message: 'Body D', status: 'deferred_dnd' }),
        ],
      }),
    );
    renderWidget(WIDE);

    // ELEVATION BUG FIX: the two leading columns are honestly labelled
    // "Title"/"Message" (they render log.title/log.message) — they were
    // previously mislabelled "Channel"/"Type".
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Message')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.queryByText('Channel')).toBeNull();
    expect(screen.queryByText('Type')).toBeNull();

    // Row content.
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Body A')).toBeInTheDocument();

    // Per-status badges, including the `deferred_dnd` fallback (no known icon,
    // warning variant) which must still render its raw status text.
    expect(screen.getByText('sent')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('deferred_dnd')).toBeInTheDocument();
  });

  it('formats each relative-time branch and orders rows newest-first', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(
      qr({
        data: [
          makeLog({ title: 'Older', created_at: minsAgo(50 * 60) }), // >24h → absolute
          makeLog({ title: 'Hours', created_at: minsAgo(3 * 60) }), //  3h ago
          makeLog({ title: 'Mins', created_at: minsAgo(5) }), //         5m ago
          makeLog({ title: 'Fresh', created_at: minsAgo(0.5) }), //      Just now
        ],
      }),
    );
    const { container } = renderWidget(WIDE);

    // Each i18n'd branch (replacing the old hardcoded English).
    expect(screen.getByText('Just now')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    // >24h falls through to the (mocked) locale-aware formatter.
    expect(screen.getByText(/^ABS:/)).toBeInTheDocument();

    // Newest-first: the "Just now" row comes before the absolute-date row.
    const rowText = Array.from(container.querySelectorAll('tbody tr')).map(
      (r) => r.textContent ?? '',
    );
    expect(rowText[0]).toContain('Just now');
    expect(rowText[rowText.length - 1]).toContain('ABS:');
  });

  it('caps the table at the 5 most recent logs', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    // 6 logs, oldest last (makeLog's default created_at decreases with seq).
    const logs = Array.from({ length: 6 }, (_, i) => makeLog({ title: `Row-${i + 1}` }));
    mockUseLogs.mockReturnValue(qr({ data: logs }));
    renderWidget(WIDE);

    // Newest 5 shown; the 6th (oldest) is dropped.
    expect(screen.getByText('Row-1')).toBeInTheDocument();
    expect(screen.getByText('Row-5')).toBeInTheDocument();
    expect(screen.queryByText('Row-6')).toBeNull();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(5);
  });

  it('still renders the stat grid (no table) when there are no logs', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(qr({ data: [] }));
    renderWidget(WIDE);
    expect(screen.getByText('Active Channels')).toBeInTheDocument();
    // No logs → no table headers.
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
  });
});
