import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationChannel, NotificationStats } from '@/api/types';
import { INTERVALS } from '@/lib/constants';

vi.mock('../client', () => ({ request: vi.fn() }));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/broadcast', () => ({ broadcast: vi.fn() }));

import { request } from '../client';
import { broadcast } from '@/lib/broadcast';
import {
  __flushQueryBroadcastForTests,
  __resetQueryBroadcastForTests,
} from '@/lib/queryBroadcast';
import {
  notificationKeys,
  useNotificationChannels,
  useNotificationStats,
  useSaveChannel,
} from './useNotifications';

const channel: NotificationChannel = {
  id: 7,
  kind: 'discord',
  name: 'Alerts',
  enabled: true,
  webhook_url: 'https://example.com/webhook',
  username: null,
  avatar_url: null,
  created_at: '2026-10-14T00:00:00Z',
  updated_at: '2026-10-14T00:00:00Z',
};
const stats: NotificationStats = {
  total_sent: 12,
  sent: 10,
  failed: 1,
  pending: 1,
  total_channels: 1,
  enabled_channels: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetQueryBroadcastForTests();
});

afterEach(() => {
  cleanup();
  __resetQueryBroadcastForTests();
});

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  client.setQueryData(notificationKeys.channels, [channel]);
  client.setQueryData(notificationKeys.stats, stats);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => ({
    channels: useNotificationChannels(),
    stats: useNotificationStats(),
    save: useSaveChannel(),
  }), { wrapper });
  return { ...hook, client };
}

describe('useSaveChannel', () => {
  it.each(['create', 'update'] as const)(
    '%s refreshes populated channels and stats and broadcasts their existing keys',
    async (operation) => {
      const saved = { ...channel, name: 'Updated alerts', enabled: false };
      const refreshedStats = { ...stats, enabled_channels: 0 };
      vi.mocked(request).mockImplementation(async (path, options) => {
        if (options?.method) return saved;
        if (path === '/notifications') return [saved];
        if (path === '/notifications/stats') return refreshedStats;
        throw new Error(`Unexpected request: ${path}`);
      });
      const { result, client } = setup();
      expect(result.current.channels.data).toEqual([channel]);
      expect(result.current.stats.data).toEqual(stats);
      const input = {
        kind: 'discord' as const,
        name: saved.name,
        enabled: false,
        webhook_url: channel.webhook_url,
        username: null,
        avatar_url: null,
        ...(operation === 'update' ? { id: channel.id } : {}),
      };

      await act(async () => {
        await expect(result.current.save.mutateAsync(input)).resolves.toEqual(saved);
      });
      await waitFor(() => {
        expect(result.current.channels.data).toEqual([saved]);
        expect(result.current.stats.data).toEqual(refreshedStats);
      });
      expect(request).toHaveBeenCalledWith(
        operation === 'update' ? '/notifications/7' : '/notifications',
        {
          method: operation === 'update' ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      expect(request).toHaveBeenCalledWith('/notifications/stats', {
        signal: expect.any(AbortSignal),
      });
      expect(client.getQueryCache().find({ queryKey: notificationKeys.stats })?.options)
        .toMatchObject({ queryKey: ['notification-stats'], refetchInterval: INTERVALS.STANDARD });
      __flushQueryBroadcastForTests();
      expect(broadcast).toHaveBeenCalledExactlyOnceWith({
        type: 'queryInvalidate',
        keys: [['notification-channels'], ['notification-stats']],
      });
    },
  );

  it('preserves populated caches and does not broadcast when saving fails', async () => {
    vi.mocked(request).mockRejectedValue(new Error('Save failed'));
    const { result, client } = setup();
    await act(async () => {
      await expect(result.current.save.mutateAsync(channel)).rejects.toThrow('Save failed');
    });
    expect(result.current.channels.data).toEqual([channel]);
    expect(result.current.stats.data).toEqual(stats);
    expect(client.getQueryState(notificationKeys.stats)?.isInvalidated).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    __flushQueryBroadcastForTests();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
