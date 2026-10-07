import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { ErrorStats } from '@/api/types';
import type { WebErrorsSummary } from '@/types/admin';
import { ApiLogsBackendErrors } from './ApiLogsBackendErrors';
import { ApiLogsFrontendErrors } from './ApiLogsFrontendErrors';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      const variables = options ?? (typeof fallback === 'object' ? fallback : {});
      return text.replace(/{{(\w+)}}/g, (_, name: string) => String(variables[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn(),
}));

import { request } from '@/api/client';
const mockedRequest = vi.mocked(request);

const backendData: ErrorStats = {
  total_errors: 178,
  uptime: '10m53s',
  by_code: {
    RATE_LIMITED: { count: 22, last_message: 'Retry budget exhausted', last_seen: '2026-10-03T08:00:00Z' },
    ERROR: { count: 100, last_message: 'Connection refused', last_seen: '2026-10-03T08:01:00Z' },
    SERVICE_UNAVAILABLE: { count: 30, last_message: 'Upstream unavailable', last_seen: '2026-10-03T08:02:00Z' },
  },
};

function browserData(overrides: Partial<WebErrorsSummary> = {}): WebErrorsSummary {
  return {
    total: 0, top: [], window_seconds: 3600, windowSeconds: 3600,
    as_of: '2026-10-03T08:00:00Z', asOf: '2026-10-03T08:00:00Z',
    ...overrides,
  };
}

function renderBrowser() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ApiLogsFrontendErrors /></MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function renderBackend(data?: ErrorStats, error?: Error, loading = false) {
  const onRetry = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return {
    onRetry,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ApiLogsBackendErrors
            data={data}
            state={deriveDataState({ data, error, isError: !!error, isPending: loading })}
            loading={loading}
            onRetry={onRetry}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('API logs runtime diagnostic cards', () => {
  it('separates process totals and uptime, sorts all categories, and preserves messages and timestamps', () => {
    renderBackend(backendData);
    const card = screen.getByRole('region', { name: 'Backend runtime errors' });
    expect(within(card).getByText('178')).toBeInTheDocument();
    expect(within(card).getByText('10m53s')).toBeInTheDocument();
    expect(within(card).getByText('Process uptime')).toBeInTheDocument();
    const rows = within(card).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('ERROR');
    expect(rows[0]).toHaveTextContent('100');
    expect(rows[0]).toHaveTextContent('Connection refused');
    expect(rows[1]).toHaveTextContent('SERVICE_UNAVAILABLE');
    expect(rows[2]).toHaveTextContent('RATE_LIMITED');
    expect(within(card).getByRole('region', { name: 'Backend error categories' })).toHaveAttribute('tabindex', '0');
    expect(card.querySelector('[title="2026-10-03T08:00:00.000Z (UTC)"]')).not.toBeNull();
    expect(card.querySelector('[title="2026-10-03T08:01:00.000Z (UTC)"]')).not.toBeNull();
    expect(card.querySelector('[title="2026-10-03T08:02:00.000Z (UTC)"]')).not.toBeNull();
    expect(within(card).getAllByText('Last seen')).toHaveLength(3);
    expect(card.querySelectorAll('[data-print-card]')).toHaveLength(0);
    expect(within(card).getByRole('link', { name: 'Inspect system health' })).toHaveAttribute('href', '/system-status');
  });

  it('only claims no backend errors when the process total is explicitly zero', () => {
    const result = renderBackend({ total_errors: 0, uptime: '2h', by_code: {} });
    expect(screen.getByText('No backend runtime errors in this process.')).toBeInTheDocument();
    result.unmount();
    renderBackend({ total_errors: 3, uptime: '2h', by_code: {} });
    expect(screen.getByText('No error category breakdown is available for this process.')).toBeInTheDocument();
    expect(screen.queryByText('No backend runtime errors in this process.')).not.toBeInTheDocument();
  });

  it('does not replace unknown totals with zero or infer a clean process from missing categories', () => {
    const incomplete = { ...backendData, by_code: {} };
    Reflect.set(incomplete, 'total_errors', null);
    renderBackend(incomplete);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('No backend runtime errors in this process.')).not.toBeInTheDocument();
    expect(screen.getByText('No error category breakdown is available for this process.')).toBeInTheDocument();
  });

  it('preserves backend evidence after a failed refresh', () => {
    renderBackend(backendData, new Error('runtime refresh offline'));
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('178')).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it('keeps backend loading, unavailable, and initial failure distinct', () => {
    const pending = renderBackend(undefined, undefined, true);
    expect(screen.getByRole('status', { name: 'Loading backend error summary' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    pending.unmount();
    const unavailable = renderBackend();
    expect(screen.getByText('Backend runtime error summary unavailable.')).toBeInTheDocument();
    unavailable.unmount();
    const failed = renderBackend(undefined, new Error('offline'));
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.onRetry).toHaveBeenCalledOnce();
  });

  it('shows zero received browser reports without claiming an error-free frontend or complete coverage', async () => {
    mockedRequest.mockResolvedValue(browserData());
    renderBrowser();
    expect(await screen.findByText('0')).toBeInTheDocument();
    expect(screen.getByText('No browser error reports received in this window.')).toBeInTheDocument();
    expect(screen.getByText(/zero reports does not prove there were no frontend errors/)).toBeInTheDocument();
    expect(screen.getByText('Last hour; independent of API call filters.')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Frontend error reports' });
    expect(card.querySelectorAll('[data-print-card]')).toHaveLength(0);
    expect(card.querySelector('[title="2026-10-03T08:00:00.000Z (UTC)"]')).not.toBeNull();
  });

  it('preserves and sorts reported browser sources with names, complete routes and counts', async () => {
    mockedRequest.mockResolvedValue(browserData({
      total: 12,
      top: [
        { name: 'RangeError', route: '/analytics/long-route?scope=custom', count: 2 },
        { name: 'TypeError', route: '/api-logs', count: 10 },
      ],
    }));
    renderBrowser();
    expect(await screen.findByText('12')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('TypeError');
    expect(rows[0]).toHaveTextContent('/api-logs');
    expect(rows[0]).toHaveTextContent('10');
    expect(rows[1]).toHaveTextContent('/analytics/long-route?scope=custom');
    expect(screen.getByRole('region', { name: 'Frontend error sources' })).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText('No browser error reports received in this window.')).not.toBeInTheDocument();
  });

  it('distinguishes missing browser breakdown and missing totals from explicit zero', async () => {
    const unknown = browserData();
    Reflect.set(unknown, 'total', null);
    mockedRequest.mockResolvedValue(unknown);
    renderBrowser();
    expect(await screen.findByText('No per-source breakdown available for the reported errors.')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('No browser error reports received in this window.')).not.toBeInTheDocument();
  });

  it('uses the returned browser reporting window rather than inventing an hour', async () => {
    mockedRequest.mockResolvedValue(browserData({ window_seconds: 120 }));
    renderBrowser();
    expect(await screen.findByText('Last 120 seconds; independent of API call filters.')).toBeInTheDocument();
  });

  it('keeps browser loading and query failures distinct and retries through the existing hook', async () => {
    mockedRequest.mockReturnValueOnce(new Promise(() => {}));
    const pending = renderBrowser();
    expect(screen.getByRole('status', { name: 'Loading frontend error summary' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    pending.unmount();
    mockedRequest.mockRejectedValueOnce(new Error('browser summary offline'));
    mockedRequest.mockResolvedValue(browserData());
    renderBrowser();
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('0')).toBeInTheDocument();
  });

  it('retains browser reports and labels failed refreshes as stale', async () => {
    mockedRequest.mockResolvedValueOnce(browserData({ total: 4 }));
    const { client } = renderBrowser();
    expect(await screen.findByText('4')).toBeInTheDocument();
    mockedRequest.mockRejectedValue(new Error('refresh offline'));
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });
});
