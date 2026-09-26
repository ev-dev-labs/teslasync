import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../client', () => ({ request: vi.fn() }));

import { request } from '../client';
import { useNotificationReport } from './useNotifications';

describe('useNotificationReport', () => {
  it('passes the header window as exclusive instant bounds instead of UTC calendar dates', async () => {
    vi.mocked(request).mockResolvedValueOnce({ triggered: 2, deliveries: 3, outbound_http_calls: 4 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const from = '2026-09-19T07:00:00.000Z';
    const until = '2026-09-26T07:00:00.000Z';
    const { result } = renderHook(() => useNotificationReport(from, until), { wrapper });
    await waitFor(() => expect(result.current.data?.outbound_http_calls).toBe(4));
    const [path] = vi.mocked(request).mock.calls[0] ?? [];
    const [route, query] = String(path).split('?');
    expect(route).toBe('/notifications/report');
    expect(new URLSearchParams(query).get('from_instant')).toBe(from);
    expect(new URLSearchParams(query).get('to_exclusive')).toBe(until);
    expect(new URLSearchParams(query).has('from')).toBe(false);
  });
});
