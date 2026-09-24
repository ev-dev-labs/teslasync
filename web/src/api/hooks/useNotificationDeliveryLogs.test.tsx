import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../client', () => ({ request: vi.fn() }));

import { request } from '../client';
import { useNotificationAnalysisLogs, useNotificationDeliveryLogs } from './useNotifications';

beforeEach(() => vi.clearAllMocks());

describe('useNotificationDeliveryLogs', () => {
  it('fetches channel attempts rather than canonical inbox trigger rows', async () => {
    const delivery = {
      id: 12,
      channel_id: 3,
      alert_id: null,
      title: 'Test',
      message: 'Delivered',
      status: 'sent',
      severity: 'info',
      error: '',
      created_at: '2026-01-01T00:00:00Z',
      sent_at: '2026-01-01T00:00:01Z',
      latency_ms: 1000,
    };
    vi.mocked(request).mockResolvedValueOnce([delivery]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(useNotificationDeliveryLogs, { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([delivery]));
    expect(request).toHaveBeenCalledWith(
      '/notifications/logs?view=deliveries&archived=all&limit=1000',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reads every page using the last row cursor instead of silently dropping older events', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: 2000 - index, created_at: new Date(Date.UTC(2026, 8, 20, 0, 0, 0, 1000 - index)).toISOString(),
    }));
    const older = { id: 1000, created_at: '2026-09-19T00:00:00.000Z' };
    vi.mocked(request).mockResolvedValueOnce(firstPage).mockResolvedValueOnce([older]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(useNotificationAnalysisLogs, { wrapper });
    await waitFor(() => expect(result.current.data).toHaveLength(1001));
    expect(request).toHaveBeenNthCalledWith(2,
      expect.stringContaining(`before_id=1001`),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(request).toHaveBeenNthCalledWith(1,
      '/notifications/logs?view=inbox&archived=all&limit=1000',
      expect.anything(),
    );
  });

  it('surfaces a malformed history response rather than reporting no activity', async () => {
    vi.mocked(request).mockResolvedValueOnce(null);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(useNotificationDeliveryLogs, { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error('Invalid notification history response'));
  });
});
