/**
 * Per-mutation tests for notification mark-read hooks that use
 * `useOptimisticMutation`. The singular filename is historical; this suite
 * covers the shipped bulk notification and single-alert hooks.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useMarkNotificationsRead,
  useMarkAlertRead,
  notificationKeys,
} from '../useNotifications';
import type { Alert, NotificationLog } from '@/api/types';

vi.mock('../_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const requestMock = vi.fn();
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

function makeWrapper(client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function makeLog(id: number, read = false): NotificationLog {
  return {
    id,
    channel_id: 1,
    alert_id: null,
    title: `Log #${id}`,
    message: '',
    status: 'sent',
    error: '',
    created_at: '2025-01-01T00:00:00Z',
    sent_at: '2025-01-01T00:00:00Z',
    read_at: read ? '2025-01-01T00:00:01Z' : null,
    archived_at: null,
  };
}

function makeAlert(id: number, isRead = false): Alert {
  return {
    id,
    vehicle_id: 1,
    type: 'low_battery',
    severity: 'warning',
    title: `Alert ${id}`,
    message: '',
    is_read: isRead,
    created_at: '2025-01-01T00:00:00Z',
  };
}

describe('useMarkNotificationsRead (optimistic)', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('flips read_at synchronously on every matching id across filtered caches', async () => {
    const { Wrapper, qc } = makeWrapper();
    const filteredKey = notificationKeys.logsFiltered({ archived: false });
    qc.setQueryData<NotificationLog[]>(filteredKey, [
      makeLog(10),
      makeLog(11),
      makeLog(12),
    ]);

    let resolveReq: (() => void) | null = null;
    requestMock.mockImplementation(
      () => new Promise<{ updated: number }>((res) => {
        resolveReq = () => res({ updated: 2 });
      }),
    );

    const { result } = renderHook(() => useMarkNotificationsRead(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate([10, 11]);
    });

    // Optimistic update visible BEFORE the server resolves.
    await waitFor(() => {
      const cur = qc.getQueryData<NotificationLog[]>(filteredKey)!;
      expect(cur[0].read_at).not.toBeNull();
      expect(cur[1].read_at).not.toBeNull();
      expect(cur[2].read_at).toBeNull();
    });

    await act(async () => {
      resolveReq?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls every cache back to its original snapshot when the request fails', async () => {
    const { Wrapper, qc } = makeWrapper();
    const filteredKey = notificationKeys.logsFiltered({ archived: false });
    const initial = [makeLog(20), makeLog(21)];
    qc.setQueryData<NotificationLog[]>(filteredKey, initial);

    requestMock.mockRejectedValue(new Error('500: server boom'));

    const { result } = renderHook(() => useMarkNotificationsRead(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      try {
        await result.current.mutateAsync([20, 21]);
      } catch {
        /* expected */
      }
    });

    const cur = qc.getQueryData<NotificationLog[]>(filteredKey)!;
    expect(cur).toEqual(initial);
    expect(cur[0].read_at).toBeNull();
    expect(cur[1].read_at).toBeNull();
  });

  it('hits POST /notifications/mark-read with an ids body', async () => {
    const { Wrapper } = makeWrapper();
    requestMock.mockResolvedValue({ updated: 1 });

    const { result } = renderHook(() => useMarkNotificationsRead(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync([99]);
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, opts] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/notifications/mark-read');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(JSON.stringify({ ids: [99] }));
  });
});

describe('useMarkAlertRead (optimistic)', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('marks the matching alert as is_read=true before the server settles', async () => {
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData<Alert[]>(notificationKeys.alerts, [
      makeAlert(101),
      makeAlert(102),
    ]);

    let resolveReq: (() => void) | null = null;
    requestMock.mockImplementation(
      () => new Promise<void>((res) => { resolveReq = () => res(); }),
    );

    const { result } = renderHook(() => useMarkAlertRead(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.mutate('101');
    });

    await waitFor(() => {
      const cur = qc.getQueryData<Alert[]>(notificationKeys.alerts)!;
      expect(cur[0].is_read).toBe(true);
      expect(cur[1].is_read).toBe(false);
    });

    await act(async () => {
      resolveReq?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('restores the prior alerts list when the POST rejects', async () => {
    const { Wrapper, qc } = makeWrapper();
    const initial = [makeAlert(201)];
    qc.setQueryData<Alert[]>(notificationKeys.alerts, initial);

    requestMock.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useMarkAlertRead(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      try {
        await result.current.mutateAsync('201');
      } catch {
        /* expected */
      }
    });

    expect(qc.getQueryData<Alert[]>(notificationKeys.alerts)).toEqual(initial);
  });

  it('cancels in-flight queries on the alerts key so a stale refetch cannot clobber the optimistic write', async () => {
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData<Alert[]>(notificationKeys.alerts, [makeAlert(301)]);
    const cancelSpy = vi.spyOn(qc, 'cancelQueries');

    requestMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useMarkAlertRead(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync('301');
    });

    expect(
      cancelSpy.mock.calls.some(
        (c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['alerts']),
      ),
    ).toBe(true);
  });
});
