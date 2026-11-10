import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      return opts
        ? base.replace(/{{(\w+)}}/g, (_match, name: string) =>
            name in opts ? String(opts[name]) : `{{${name}}}`)
        : base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useNotifications', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useNotifications')>(
    '@/api/hooks/useNotifications',
  );
  return { ...actual, useNotificationStats: vi.fn(), useNotificationLogs: vi.fn() };
});

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | Date | null | undefined) => `ABS:${String(value)}`,
    formatTime: () => 'TIME',
  }),
}));

import { useNotificationStats, useNotificationLogs } from '@/api/hooks/useNotifications';
import type { NotificationLog, NotificationStats } from '@/api/types';
import NotificationStatsWidget from './NotificationStatsWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

const mockUseStats = vi.mocked(useNotificationStats);
const mockUseLogs = vi.mocked(useNotificationLogs);

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

function qr<T>(over: Partial<UseQueryResult<T>> = {}): UseQueryResult<T> {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1_700_000_000_000,
    refetch: vi.fn(),
    ...over,
  } as UseQueryResult<T>;
}

const STATS: NotificationStats = {
  total_sent: 120,
  sent: 118,
  failed: 2,
  pending: 0,
  total_channels: 5,
  enabled_channels: 3,
};

function log(over: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: 1,
    channel_id: 1,
    alert_id: null,
    title: 'Email',
    message: 'SMTP timeout',
    status: 'failed',
    error: 'SMTP timeout',
    created_at: '2024-10-04T12:00:00Z',
    sent_at: null,
    ...over,
  };
}

function renderWidget(size: WidgetSize, packId: PackId) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <NotificationStatsWidget size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseStats.mockReturnValue(qr<NotificationStats>({ data: undefined }));
  mockUseLogs.mockReturnValue(qr<NotificationLog[]>({ data: [] }));
});

describe.each(PACK_IDS)('NotificationStatsWidget %s', (packId) => {
  async function renderContent(size: WidgetSize = { cols: 2, rows: 2 }) {
    const view = renderWidget(size, packId);
    if (packId !== 'classic') {
      await waitFor(() => {
        expect(view.container.querySelector(
          `[data-widget-family="ring"][data-widget-appearance="${PACK_APPEARANCES[packId]}"]`,
        )).not.toBeNull();
      });
    }
    return view;
  }

  it('renders the delivery headline and source-backed channel count in the selected family', async () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(qr({ data: [] }));
    const view = await renderContent();

    expect(screen.getByRole('heading', { name: 'Notification stats' })).toBeInTheDocument();
    expect(screen.getByText('Delivery rate')).toBeInTheDocument();
    expect(screen.getByText('98.3')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('3 Active channels')).toBeInTheDocument();
    expect(screen.queryByText('Total sent (7d)')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'ok');
  });

  it('shows only the latest real failure and uses shared date formatting', async () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(qr({
      data: [
        log({ id: 1, title: 'Older failure', status: 'failed', created_at: '2024-10-03T12:00:00Z' }),
        log({ id: 2, title: 'Push', status: 'sent', created_at: '2024-10-05T12:00:00Z' }),
        log({ id: 3, title: 'Email', status: 'failed', created_at: '2024-10-04T12:00:00Z' }),
      ],
    }));
    await renderContent();

    expect(screen.getByText('Failed: Email · ABS:2024-10-04T12:00:00Z · SMTP timeout')).toBeInTheDocument();
    expect(screen.getByText(/SMTP timeout/)).toBeInTheDocument();
    expect(screen.queryByText(/Older failure|Failed: Push/)).not.toBeInTheDocument();
  });

  it('keeps unknown delivery and counts honest instead of fabricating zeroes', async () => {
    mockUseStats.mockReturnValue(qr({ data: {} as NotificationStats }));
    const view = await renderContent({ cols: 1, rows: 2 });

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText(/Active channels/)).not.toBeInTheDocument();
    expect(screen.queryByText('%')).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
  });

  it('does not invent a delivery rate when the total is zero', async () => {
    mockUseStats.mockReturnValue(qr({
      data: { ...STATS, total_sent: 0, sent: 0, failed: 0, enabled_channels: 0 },
    }));
    await renderContent();

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('%')).not.toBeInTheDocument();
    expect(screen.queryByText(/Active channels/)).not.toBeInTheDocument();
  });

  it('preserves a real zero delivery rate when attempts exist', async () => {
    mockUseStats.mockReturnValue(qr({ data: { ...STATS, sent: 0, failed: 120 } }));
    await renderContent({ cols: 1, rows: 1 });

    expect(screen.getByText('0.0')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.getByText('3 Active channels')).toBeInTheDocument();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'keeps nonfinite source values unknown (%s)',
    async (invalid) => {
      mockUseStats.mockReturnValue(qr({
        data: { ...STATS, sent: invalid, enabled_channels: invalid },
      }));
      const view = await renderContent();

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('%')).not.toBeInTheDocument();
      expect(screen.queryByText(/Active channels|NaN|Infinity/)).not.toBeInTheDocument();
      expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'partial');
      expect(view.container.querySelector('[aria-valuenow]')).toBeNull();
    },
  );

  it('preserves loading and empty shells', () => {
    mockUseStats.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const loading = renderWidget({ cols: 1, rows: 1 }, packId);
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    loading.unmount();

    mockUseStats.mockReturnValue(qr({ data: undefined }));
    renderWidget({ cols: 2, rows: 2 }, packId);
    expect(screen.getByText('No notification data')).toBeInTheDocument();
  });

  it('renders a real query error and refetches both sources from the shared dot', () => {
    const statsRefetch = vi.fn();
    const logsRefetch = vi.fn();
    mockUseStats.mockReturnValue(qr({
      data: undefined,
      isError: true,
      error: new Error('stats failed'),
      refetch: statsRefetch,
    }));
    mockUseLogs.mockReturnValue(qr({ data: [], refetch: logsRefetch }));
    renderWidget({ cols: 2, rows: 2 }, packId);

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(statsRefetch).toHaveBeenCalledTimes(1);
    expect(logsRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps retained counters after a refresh error and exposes one shared freshness control', async () => {
    mockUseStats.mockReturnValue(qr({
      data: STATS,
      isError: true,
      error: new Error('refresh failed'),
    }));
    mockUseLogs.mockReturnValue(qr({ data: [log()] }));
    const view = await renderContent();

    expect(screen.getByText('98.3')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
    expect(screen.getByText(/Failed: Email · ABS:/)).toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('retains the stats and failure detail when the log source refresh fails', async () => {
    const statsRefetch = vi.fn();
    const logsRefetch = vi.fn();
    mockUseStats.mockReturnValue(qr({ data: STATS, refetch: statsRefetch }));
    mockUseLogs.mockReturnValue(qr({
      data: [log()],
      isError: true,
      error: new Error('log refresh failed'),
      refetch: logsRefetch,
    }));
    const view = await renderContent();

    expect(screen.getByText('98.3')).toBeInTheDocument();
    expect(screen.getByText(/Failed: Email · ABS:/)).toBeInTheDocument();
    expect(view.container.querySelector('[data-content-degraded]')).toHaveAttribute('data-content-degraded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(statsRefetch).toHaveBeenCalledTimes(1);
    expect(logsRefetch).toHaveBeenCalledTimes(1);
  });
});
