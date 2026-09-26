import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../client', () => ({ request: vi.fn() }));

import { request } from '../client';
import { useNotificationReport } from './useNotifications';

beforeEach(() => {
  vi.mocked(request).mockReset();
});

describe('useNotificationReport', () => {
  it('passes the header window as exclusive instant bounds instead of UTC calendar dates', async () => {
    vi.mocked(request).mockResolvedValueOnce({ triggered: 2, deliveries: 3, outbound_http_calls: 4 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const from = '2026-09-19T07:00:00.000Z';
    const until = '2026-09-26T07:00:00.000Z';
    const { result } = renderHook(() => useNotificationReport(from, until, 'America/Los_Angeles'), { wrapper });
    await waitFor(() => expect(result.current.data?.outbound_http_calls).toBe(4));
    const [path] = vi.mocked(request).mock.calls[0] ?? [];
    const [route, query] = String(path).split('?');
    expect(route).toBe('/notifications/report');
    expect(new URLSearchParams(query).get('from_instant')).toBe(from);
    expect(new URLSearchParams(query).get('to_exclusive')).toBe(until);
    expect(new URLSearchParams(query).get('timezone')).toBe('America/Los_Angeles');
    expect(new URLSearchParams(query).has('from')).toBe(false);
  });

  it('refetches local-day buckets when only the header timezone changes', async () => {
    vi.mocked(request).mockResolvedValue({ triggered: 1, deliveries: 0, outbound_http_calls: 0 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const from = '2026-03-08T08:00:00.000Z';
    const until = '2026-03-10T07:00:00.000Z';
    const { rerender } = renderHook(
      ({ timezone }) => useNotificationReport(from, until, timezone),
      { initialProps: { timezone: 'UTC' }, wrapper },
    );
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    rerender({ timezone: 'America/Los_Angeles' });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    const [path] = vi.mocked(request).mock.calls[1] ?? [];
    expect(new URLSearchParams(String(path).split('?')[1]).get('timezone')).toBe('America/Los_Angeles');
  });
});
