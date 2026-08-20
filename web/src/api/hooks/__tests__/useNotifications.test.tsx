import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  __serializeNotificationFiltersForTest as serialize,
  useUnreadCount,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useArchiveNotifications,
  useUnarchiveNotifications,
  useDeleteNotifications,
  useNotificationLogs,
  useNotificationEventTypes,
  useNotificationPreferences,
  useUpdateNotificationPreference,
} from '../useNotifications';

vi.mock('../_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const requestMock = vi.fn();
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('serializeNotificationFilters', () => {
  it('returns an empty string for no filters', () => {
    expect(serialize({})).toBe('');
  });

  it('joins multi-value filters with commas (snake_case keys)', () => {
    const qs = serialize({
      severity: ['info', 'warn', 'critical'],
      vehicle_id: [1, 2],
      rule_id: [3, 4],
    });
    const params = new URLSearchParams(qs);
    expect(params.get('severity')).toBe('info,warn,critical');
    expect(params.get('vehicle_id')).toBe('1,2');
    expect(params.get('rule_id')).toBe('3,4');
  });

  it('emits the boolean read filter for true and false but omits undefined', () => {
    expect(new URLSearchParams(serialize({ read: true })).get('read')).toBe('true');
    expect(new URLSearchParams(serialize({ read: false })).get('read')).toBe('false');
    expect(new URLSearchParams(serialize({})).has('read')).toBe(false);
  });

  it('forwards date range, search text, and pagination', () => {
    const params = new URLSearchParams(
      serialize({
        from: '2025-01-01T00:00:00Z',
        to: '2025-01-02T00:00:00Z',
        q: 'battery',
        limit: 25,
        offset: 50,
      }),
    );
    expect(params.get('from')).toBe('2025-01-01T00:00:00Z');
    expect(params.get('to')).toBe('2025-01-02T00:00:00Z');
    expect(params.get('q')).toBe('battery');
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('50');
  });

  it('omits empty arrays and empty search', () => {
    const qs = serialize({ severity: [], vehicle_id: [], q: '' });
    expect(qs).toBe('');
  });
});

describe('useNotificationLogs', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('calls /notifications/logs with serialized filters', async () => {
    requestMock.mockResolvedValue([]);
    const { result } = renderHook(
      () => useNotificationLogs({ severity: ['critical'], archived: false, limit: 10 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = requestMock.mock.calls[0]?.[0] as string;
    expect(url.startsWith('/notifications/logs?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('severity')).toBe('critical');
    expect(params.get('archived')).toBe('false');
    expect(params.get('limit')).toBe('10');
  });

  it('omits the query string when filters are empty', async () => {
    requestMock.mockResolvedValue([]);
    const { result } = renderHook(() => useNotificationLogs({}), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock.mock.calls[0]?.[0]).toBe('/notifications/logs');
  });
});

describe('notification preferences', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('loads the stable component-health event catalog', async () => {
    requestMock.mockResolvedValue([
      {
        event_type: 'system.telemetry.outage',
        component: 'telemetry',
        transition: 'outage',
        default_enabled: true,
        description: 'Telemetry is stale.',
      },
    ]);
    const { result } = renderHook(() => useNotificationEventTypes(), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledWith(
      '/notifications/event-types',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data?.[0]?.event_type).toBe('system.telemetry.outage');
  });

  it('loads the selected channel preferences through the versioned client path', async () => {
    requestMock.mockResolvedValue([
      { id: 1, channel_id: 7, event_type: 'health.database.outage', enabled: true },
    ]);
    const { result } = renderHook(() => useNotificationPreferences(7), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledWith(
      '/notifications/7/preferences',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data?.[0]?.event_type).toBe('health.database.outage');
  });

  it('does not request preferences until a channel is selected', () => {
    const { result } = renderHook(() => useNotificationPreferences(null), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('updates one event preference with a snake_case request body', async () => {
    requestMock.mockResolvedValue({ status: 'updated' });
    const { result } = renderHook(() => useUpdateNotificationPreference(), {
      wrapper: makeWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        channel_id: 7,
        event_type: 'health.telemetry.recovered',
        enabled: false,
      });
    });

    expect(requestMock).toHaveBeenCalledWith('/notifications/7/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'health.telemetry.recovered',
        enabled: false,
      }),
    });
  });
});

describe('useUnreadCount', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('selects the count out of the response payload', async () => {
    requestMock.mockResolvedValue({ count: 7 });
    const { result } = renderHook(() => useUnreadCount(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBe(7));
    expect(requestMock).toHaveBeenCalledWith(
      '/notifications/unread-count',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('falls back to 0 when count is missing', async () => {
    requestMock.mockResolvedValue({});
    const { result } = renderHook(() => useUnreadCount(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.data).toBe(0));
  });
});

describe('bulk notification mutations', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ updated: 0 });
  });

  it.each([
    [useMarkNotificationsRead, '/notifications/mark-read', 'POST'],
    [useMarkNotificationsUnread, '/notifications/mark-unread', 'POST'],
    [useArchiveNotifications, '/notifications/archive', 'POST'],
    [useUnarchiveNotifications, '/notifications/unarchive', 'POST'],
  ])('posts ids body to %#', async (hook, url, method) => {
    const { result } = renderHook(() => hook(), { wrapper: makeWrapper() });
    await act(async () => { await result.current.mutateAsync([10, 11, 12]); });
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [calledUrl, opts] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(opts.method).toBe(method);
    expect(opts.body).toBe(JSON.stringify({ ids: [10, 11, 12] }));
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('useDeleteNotifications hits DELETE /notifications/logs with ids body', async () => {
    requestMock.mockResolvedValue({ deleted: 3 });
    const { result } = renderHook(() => useDeleteNotifications(), { wrapper: makeWrapper() });
    await act(async () => { await result.current.mutateAsync([1, 2, 3]); });
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/notifications/logs');
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBe(JSON.stringify({ ids: [1, 2, 3] }));
  });
});
