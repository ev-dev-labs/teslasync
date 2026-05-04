/**
 * Phase-45 / Prompt 28 — useBulkMarkRead hook tests.
 *
 * Covers the relaxed `{ ids?, all? }` contract:
 *   1. Calling with `ids` posts to /notifications/mark-read with the id list.
 *   2. Calling with `all: true` posts the whole-inbox flag (no ids).
 *   3. Optimistic update flips matching cached rows to `read_at != null`
 *      BEFORE the server resolves.
 *   4. Optimistic write rolls back when the server rejects.
 *   5. Multiple cached query keys (different filter sets) are all updated.
 *
 * We stub `request` directly so the hook exercises its real internals
 * (queryKey resolution, snapshot/rollback) but never touches the network.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the resilience-aware request helper used by useBulkMarkRead. The
// mock is hoisted by Vitest so the import below resolves to it.
vi.mock('@/api/client', () => ({
  request: vi.fn(),
}));

import { request } from '@/api/client';
import { useBulkMarkRead, notificationKeys } from '../useNotifications';
import type { NotificationLog } from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

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

function makeLog(id: number, readAt: string | null = null): NotificationLog {
  return {
    id,
    alert_id: 10,
    channel_id: 1,
    status: 'sent',
    message: `msg-${id}`,
    metadata: null,
    sent_at: '2024-01-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
    read_at: readAt,
    archived_at: null,
  } as unknown as NotificationLog;
}

describe('useBulkMarkRead', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it('POSTs ids to /notifications/mark-read when called with an id list', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockResolvedValueOnce({ updated: 2 });

    const { result } = renderHook(() => useBulkMarkRead(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ids: [1, 2] });
    });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [path, opts] = mockedRequest.mock.calls[0];
    expect(path).toBe('/notifications/mark-read');
    expect(opts).toMatchObject({ method: 'POST' });
    expect(JSON.parse(opts.body as string)).toEqual({ ids: [1, 2] });
  });

  it('POSTs all=true when called with the whole-inbox flag', async () => {
    const { Wrapper } = makeWrapper();
    mockedRequest.mockResolvedValueOnce({ updated: 99 });

    const { result } = renderHook(() => useBulkMarkRead(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ all: true });
    });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [path, opts] = mockedRequest.mock.calls[0];
    expect(path).toBe('/notifications/mark-read');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ all: true });
    // Crucially, `ids` is omitted — passing both is a 400 server-side, so
    // the hook must not fabricate an empty array next to the all flag.
    expect('ids' in body).toBe(false);
  });

  it('optimistically marks matching rows read BEFORE the server resolves (ids path)', async () => {
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData<NotificationLog[]>(
      [...notificationKeys.logs, 'q1'],
      [makeLog(1), makeLog(2), makeLog(3)],
    );

    let resolveMut: ((v: { updated: number }) => void) | null = null;
    mockedRequest.mockImplementationOnce(
      () => new Promise((res) => { resolveMut = res; }),
    );

    const { result } = renderHook(() => useBulkMarkRead(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ ids: [1, 3] });
    });

    await waitFor(() => {
      const cached = qc.getQueryData<NotificationLog[]>([
        ...notificationKeys.logs,
        'q1',
      ])!;
      expect(cached.find((r) => r.id === 1)?.read_at).toBeTruthy();
      expect(cached.find((r) => r.id === 2)?.read_at).toBeNull();
      expect(cached.find((r) => r.id === 3)?.read_at).toBeTruthy();
    });

    await act(async () => {
      resolveMut?.({ updated: 2 });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('optimistically marks EVERY unread row when called with all=true', async () => {
    const { Wrapper, qc } = makeWrapper();
    const alreadyRead = makeLog(2, '2024-06-01T00:00:00Z');
    qc.setQueryData<NotificationLog[]>(
      [...notificationKeys.logs, 'inbox'],
      [makeLog(1), alreadyRead, makeLog(3)],
    );

    let resolveMut: ((v: { updated: number }) => void) | null = null;
    mockedRequest.mockImplementationOnce(
      () => new Promise((res) => { resolveMut = res; }),
    );

    const { result } = renderHook(() => useBulkMarkRead(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({ all: true });
    });

    await waitFor(() => {
      const cached = qc.getQueryData<NotificationLog[]>([
        ...notificationKeys.logs,
        'inbox',
      ])!;
      expect(cached.every((r) => r.read_at != null)).toBe(true);
      // Already-read row keeps its original timestamp — must not be overwritten.
      expect(cached.find((r) => r.id === 2)?.read_at).toBe('2024-06-01T00:00:00Z');
    });

    await act(async () => {
      resolveMut?.({ updated: 2 });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls the cache back when the server rejects', async () => {
    const { Wrapper, qc } = makeWrapper();
    const initial: NotificationLog[] = [makeLog(1), makeLog(2)];
    qc.setQueryData<NotificationLog[]>([...notificationKeys.logs, 'q1'], initial);

    mockedRequest.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useBulkMarkRead(), { wrapper: Wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ ids: [1, 2] });
      } catch {
        // expected
      }
    });

    const restored = qc.getQueryData<NotificationLog[]>([
      ...notificationKeys.logs,
      'q1',
    ])!;
    expect(restored.every((r) => r.read_at == null)).toBe(true);
  });

  it('updates every cached filtered list under the notification-logs prefix in one pass', async () => {
    const { Wrapper, qc } = makeWrapper();
    qc.setQueryData<NotificationLog[]>(
      [...notificationKeys.logs, 'inbox'],
      [makeLog(1), makeLog(2)],
    );
    qc.setQueryData<NotificationLog[]>(
      [...notificationKeys.logs, 'critical-only'],
      [makeLog(1), makeLog(3)],
    );

    mockedRequest.mockResolvedValueOnce({ updated: 1 });

    const { result } = renderHook(() => useBulkMarkRead(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ids: [1] });
    });

    const inbox = qc.getQueryData<NotificationLog[]>([
      ...notificationKeys.logs,
      'inbox',
    ])!;
    const criticalOnly = qc.getQueryData<NotificationLog[]>([
      ...notificationKeys.logs,
      'critical-only',
    ])!;
    expect(inbox.find((r) => r.id === 1)?.read_at).toBeTruthy();
    expect(inbox.find((r) => r.id === 2)?.read_at).toBeNull();
    expect(criticalOnly.find((r) => r.id === 1)?.read_at).toBeTruthy();
    expect(criticalOnly.find((r) => r.id === 3)?.read_at).toBeNull();
  });

  it('skips the optimistic write when ids is an empty array (no-op contract)', async () => {
    const { Wrapper, qc } = makeWrapper();
    const initial: NotificationLog[] = [makeLog(1), makeLog(2)];
    qc.setQueryData<NotificationLog[]>([...notificationKeys.logs, 'q1'], initial);

    mockedRequest.mockResolvedValueOnce({ updated: 0 });

    const { result } = renderHook(() => useBulkMarkRead(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ids: [] });
    });

    const cached = qc.getQueryData<NotificationLog[]>([
      ...notificationKeys.logs,
      'q1',
    ])!;
    expect(cached.every((r) => r.read_at == null)).toBe(true);
  });
});
