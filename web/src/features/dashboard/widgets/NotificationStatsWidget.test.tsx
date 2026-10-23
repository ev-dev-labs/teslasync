import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

function qr(over: Record<string, unknown> = {}): never {
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
  } as never;
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

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationStatsWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseStats.mockReturnValue(qr({ data: undefined }));
  mockUseLogs.mockReturnValue(qr({ data: [] }));
});

describe('NotificationStatsWidget redesign', () => {
  it('renders the After-style delivery headline and source-backed channel count', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(qr({ data: [] }));
    renderWidget();

    expect(screen.getByRole('heading', { name: 'Notification stats' })).toBeInTheDocument();
    expect(screen.getByText('Delivery rate')).toBeInTheDocument();
    expect(screen.getByText('98.3')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('3 Active channels')).toBeInTheDocument();
    expect(screen.queryByText('Total sent (7d)')).not.toBeInTheDocument();
  });

  it('shows only the latest real failure and uses shared date formatting', () => {
    mockUseStats.mockReturnValue(qr({ data: STATS }));
    mockUseLogs.mockReturnValue(qr({
      data: [
        log({ id: 1, title: 'Email', status: 'failed', created_at: '2024-10-04T12:00:00Z' }),
        log({ id: 2, title: 'Push', status: 'sent', created_at: '2024-10-05T12:00:00Z' }),
      ],
    }));
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText(/Failed: Email · ABS:/)).toBeInTheDocument();
    expect(screen.getByText(/SMTP timeout/)).toBeInTheDocument();
  });

  it('keeps unknown delivery and counts honest instead of fabricating zeroes', () => {
    mockUseStats.mockReturnValue(qr({ data: {} }));
    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0 active channels')).not.toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
  });

  it('does not invent a delivery rate when the total is zero', () => {
    mockUseStats.mockReturnValue(qr({
      data: { ...STATS, total_sent: 0, sent: 0, failed: 0, enabled_channels: 0 },
    }));
    renderWidget();

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('%')).not.toBeInTheDocument();
  });

  it('uses loading, empty, error, and retained-error states honestly', () => {
    mockUseStats.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const loading = renderWidget({ cols: 1, rows: 1 });
    expect(loading.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    loading.unmount();

    mockUseStats.mockReturnValue(qr({ data: undefined }));
    renderWidget();
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
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(statsRefetch).toHaveBeenCalledTimes(1);
    expect(logsRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps retained counters after a refresh error and exposes one shared freshness control', () => {
    mockUseStats.mockReturnValue(qr({
      data: STATS,
      isError: true,
      error: new Error('refresh failed'),
    }));
    mockUseLogs.mockReturnValue(qr({ data: [log()] }));
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('98.3')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Refresh/i })).toHaveLength(1);
    expect(screen.getByText(/Failed: Email · ABS:/)).toBeInTheDocument();
  });
});
