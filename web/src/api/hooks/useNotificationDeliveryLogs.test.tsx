import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../client', () => ({ request: vi.fn() }));

import { request } from '../client';
import { useNotificationDeliveryLogs } from './useNotifications';

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
      '/notifications/logs?view=deliveries&limit=1000',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
