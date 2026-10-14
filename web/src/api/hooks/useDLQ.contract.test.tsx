import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { INTERVALS, STALE_TIMES, PAGINATION } from '@/lib/constants';
import type {
  DLQEntrySummary,
  DLQEntryFull,
  DLQListResponse,
  DLQReplayResponse,
  DLQReplayAuditRecord,
  DLQAuditResponse,
} from '@/types/admin-diagnostics';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../client', () => ({
  request: mocks.request,
  SudoCanceledError: class SudoCanceledError extends Error {},
}));
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: mocks.success, error: mocks.error }),
}));

import {
  dlqKeys,
  clampAuditLimit,
  useDLQList,
  useDLQEntry,
  useDLQAudit,
  useDLQReplay,
  SudoCanceledError,
} from './useDLQ';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER_ID = 'fedcba9876543210fedcba9876543210';
const PATH_ID = 'opaque/segment ?#%';
const ENCODED_PATH_ID = 'opaque%2Fsegment%20%3F%23%25';
const summary: DLQEntrySummary = {
  id: ID,
  arrived_at: '2026-10-13T18:00:00.000Z',
  dlq_topic: 'synthetic/dlq',
  parsed_redeliveries: 0,
  replayable: false,
  raw_payload_size: 2,
  inner_payload_size: 0,
};
const detail: DLQEntryFull = { ...summary, raw_payload_b64: 'e30=' };
const list: DLQListResponse = { count: 1, replay_enabled: false, entries: [summary] };
const auditRow: DLQReplayAuditRecord = {
  id: 73,
  replayed_at: '2026-10-13T18:01:00Z',
  actor: 'synthetic-operator',
  dlq_id: ID,
  src_topic: 'synthetic/dlq',
  result: 'disabled',
  payload: null,
};
const audit: DLQAuditResponse = { count: 1, limit: 50, dlq_id: ID, rows: [auditRow] };
const replay: DLQReplayResponse = {
  ok: true, replayed_id: ID, dst_topic: 'synthetic/target', result: 'ok', audit_id: 74,
};
const clients: QueryClient[] = [];

function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
});

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
});

describe('DLQ string ID contract', () => {
  it('loads opaque string detail with its exact cache key and cancellation signal', async () => {
    mocks.request.mockResolvedValue(detail);
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => useDLQEntry(ID), { wrapper: Wrapper });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(mocks.request).toHaveBeenCalledWith(`/system/dlq/${ID}`, {
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(result.current.data?.id).toBe(ID));
    expect(client.getQueryCache().getAll().map((query) => query.queryKey))
      .toEqual([['system', 'dlq', 'entry', ID]]);
  });

  it('keeps string audit scoped with its exact cache key and limit', async () => {
    mocks.request.mockResolvedValue({ count: 0, limit: 50, dlq_id: ID, rows: [] });
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => useDLQAudit(ID, 50), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.request).toHaveBeenCalledWith(`/system/dlq/${ID}/audit?limit=50`, {
      signal: expect.any(AbortSignal),
    });
    expect(client.getQueryCache().getAll().map((query) => query.queryKey))
      .toEqual([['system', 'dlq', 'entry', ID, 'audit', 50]]);
    expect(result.current.data?.dlq_id).toBe(ID);
  });

  it('mirrors optional Go fields and JSON null while keeping audit row IDs numeric', async () => {
    expectTypeOf<DLQEntrySummary['id']>().toEqualTypeOf<string>();
    expectTypeOf<DLQEntryFull['id']>().toEqualTypeOf<string>();
    expectTypeOf<DLQReplayResponse['replayed_id']>().toEqualTypeOf<string>();
    expectTypeOf<DLQReplayAuditRecord['dlq_id']>().toEqualTypeOf<string>();
    expectTypeOf<DLQAuditResponse['dlq_id']>().toEqualTypeOf<string>();
    expectTypeOf<DLQReplayAuditRecord['id']>().toEqualTypeOf<number>();
    expectTypeOf<DLQReplayResponse['audit_id']>().toEqualTypeOf<number>();
    expectTypeOf<DLQEntryFull['inner_payload_b64']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<DLQEntrySummary['parsed_vehicle_id']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<DLQReplayAuditRecord['actor_ip']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<DLQReplayAuditRecord['payload']>().toEqualTypeOf<unknown>();
    expectTypeOf<Parameters<typeof useDLQEntry>[0]>().toEqualTypeOf<string | null | undefined>();
    mocks.request.mockResolvedValue(audit);
    const { Wrapper } = fixture();
    const { result } = renderHook(() => useDLQAudit(ID), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows[0]).toEqual({
      id: 73, replayed_at: '2026-10-13T18:01:00Z', actor: 'synthetic-operator',
      dlq_id: ID, src_topic: 'synthetic/dlq', result: 'disabled', payload: null,
    });
    expect(result.current.data?.rows[0]).not.toHaveProperty('actor_ip');
    expect(result.current.data?.rows[0]).not.toHaveProperty('dst_topic');
  });

  it('returns unconverted list fields and preserves list polling policy', async () => {
    mocks.request.mockResolvedValue(list);
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => useDLQList(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(list);
    expect(result.current.data?.entries[0]).not.toHaveProperty('parsed_vehicle_id');
    expect(mocks.request).toHaveBeenCalledWith('/system/dlq', { signal: expect.any(AbortSignal) });
    expect(client.getQueryCache().find({ queryKey: dlqKeys.list })?.options).toMatchObject({
      staleTime: STALE_TIMES.MODERATE, refetchInterval: INTERVALS.STANDARD,
      refetchIntervalInBackground: false, retry: 1,
    });
  });

  it('encodes detail and scoped audit path segments without altering cache identity', async () => {
    mocks.request.mockImplementation((path: string) => Promise.resolve(
      path.includes('/audit?') ? { ...audit, dlq_id: PATH_ID } : { ...detail, id: PATH_ID },
    ));
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => ({
      entry: useDLQEntry(PATH_ID), audit: useDLQAudit(PATH_ID, 3),
    }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.entry.isSuccess && result.current.audit.isSuccess).toBe(true));
    expect(mocks.request).toHaveBeenCalledWith(`/system/dlq/${ENCODED_PATH_ID}`, { signal: expect.any(AbortSignal) });
    expect(mocks.request).toHaveBeenCalledWith(`/system/dlq/${ENCODED_PATH_ID}/audit?limit=3`, { signal: expect.any(AbortSignal) });
    expect(client.getQueryData(dlqKeys.entry(PATH_ID))).toEqual({ ...detail, id: PATH_ID });
    expect(client.getQueryData(dlqKeys.entryAudit(PATH_ID, 3))).toEqual({ ...audit, dlq_id: PATH_ID });
  });

  it('separates detail caches across string ID switches and preserves static cache policy', async () => {
    mocks.request.mockImplementation((path: string) => Promise.resolve({
      ...detail, id: path.endsWith(OTHER_ID) ? OTHER_ID : ID,
    }));
    const { client, Wrapper } = fixture();
    const { result, rerender } = renderHook(({ id }) => useDLQEntry(id), {
      initialProps: { id: ID }, wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.data?.id).toBe(ID));
    rerender({ id: OTHER_ID });
    await waitFor(() => expect(result.current.data?.id).toBe(OTHER_ID));
    rerender({ id: ID });
    await waitFor(() => expect(result.current.data?.id).toBe(ID));
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(dlqKeys.entry(OTHER_ID))).toEqual({ ...detail, id: OTHER_ID });
    expect(client.getQueryCache().find({ queryKey: dlqKeys.entry(ID) })?.options)
      .toMatchObject({ staleTime: STALE_TIMES.STATIC, retry: 1, enabled: true });
  });

  it.each([
    { name: 'undefined', id: undefined }, { name: 'null', id: null },
    { name: 'empty', id: '' }, { name: 'blank', id: '   ' },
  ])('guards $name detail IDs including manual refetch without a numeric fallback', async ({ id }) => {
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => useDLQEntry(id), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([dlqKeys.entry(id)]);
    await act(async () => {
      await expect(result.current.refetch({ throwOnError: true }))
        .rejects.toThrow('DLQ entry ID is required');
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('honors caller disabled detail then enables the unchanged string ID', async () => {
    mocks.request.mockResolvedValue(detail);
    const { Wrapper } = fixture();
    const { result, rerender } = renderHook(({ enabled }) => useDLQEntry(ID, enabled), {
      initialProps: { enabled: false }, wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mocks.request).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toEqual(detail));
  });

  it.each([
    { name: 'omitted', id: undefined }, { name: 'null', id: null },
  ])('uses the default global audit feed only for $name ID', async ({ id }) => {
    mocks.request.mockResolvedValue({ ...audit, dlq_id: '' });
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => useDLQAudit(id), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.request).toHaveBeenCalledWith(`/system/dlq/audit?limit=${PAGINATION.DEFAULT_LIMIT}`, {
      signal: expect.any(AbortSignal),
    });
    expect(client.getQueryCache().getAll().map((query) => query.queryKey))
      .toEqual([dlqKeys.audit(PAGINATION.DEFAULT_LIMIT)]);
    expect(result.current.data?.dlq_id).toBe('');
  });

  it.each([{ name: 'empty', id: '' }, { name: 'blank', id: '  ' }])(
    'does not turn a requested $name scoped audit ID into the global feed',
    async ({ id }) => {
      const { client, Wrapper } = fixture();
      const { result } = renderHook(() => useDLQAudit(id), { wrapper: Wrapper });
      expect(result.current.fetchStatus).toBe('idle');
      expect(client.getQueryCache().getAll().map((query) => query.queryKey))
        .toEqual([dlqKeys.entryAudit(id, PAGINATION.DEFAULT_LIMIT)]);
      await act(async () => {
        await expect(result.current.refetch({ throwOnError: true }))
          .rejects.toThrow('DLQ entry ID is required');
      });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: 'negative', limit: -1, expected: 1 },
    { name: 'zero', limit: 0, expected: 1 },
    { name: 'minimum', limit: 1, expected: 1 },
    { name: 'interior_fraction', limit: 7.9, expected: 7 },
    { name: 'below_maximum', limit: 499, expected: 499 },
    { name: 'maximum', limit: 500, expected: 500 },
    { name: 'above_maximum', limit: 501, expected: 500 },
    { name: 'nan', limit: NaN, expected: PAGINATION.DEFAULT_LIMIT },
    { name: 'positive_infinity', limit: Infinity, expected: PAGINATION.DEFAULT_LIMIT },
    { name: 'negative_infinity', limit: -Infinity, expected: PAGINATION.DEFAULT_LIMIT },
  ])('clamps $name audit limit consistently in the key and URL', async ({ limit, expected }) => {
    mocks.request.mockResolvedValue({ ...audit, limit: expected });
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => useDLQAudit(ID, limit), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clampAuditLimit(limit)).toBe(expected);
    expect(mocks.request).toHaveBeenCalledWith(`/system/dlq/${ID}/audit?limit=${expected}`, {
      signal: expect.any(AbortSignal),
    });
    expect(client.getQueryCache().find({ queryKey: dlqKeys.entryAudit(ID, expected) })?.options)
      .toMatchObject({
        staleTime: STALE_TIMES.MODERATE, refetchInterval: INTERVALS.STANDARD,
        refetchIntervalInBackground: false, retry: 1, enabled: true,
      });
  });

  it.each([
    { name: 'general_pagination_maximum', limit: PAGINATION.MAX_LIMIT },
    { name: 'very_large', limit: 1_000_000 },
  ])('caps $name audit limit at the backend-specific maximum rather than general pagination', async ({ limit }) => {
    mocks.request.mockResolvedValue({ ...audit, limit: 500 });
    const { client, Wrapper } = fixture();
    const { result } = renderHook(() => useDLQAudit(ID, limit), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(clampAuditLimit(limit)).toBe(500);
    expect(mocks.request).toHaveBeenCalledWith(`/system/dlq/${ID}/audit?limit=500`, {
      signal: expect.any(AbortSignal),
    });
    expect(client.getQueryCache().getAll().map((query) => query.queryKey))
      .toEqual([dlqKeys.entryAudit(ID, 500)]);
    expect(client.getQueryData(dlqKeys.entryAudit(ID, limit))).toBeUndefined();
  });

  it('retains scoped audit data through refresh failure and recovers on explicit refetch', async () => {
    const failure = new Error('synthetic refresh failure');
    mocks.request.mockResolvedValueOnce(audit).mockRejectedValue(failure);
    const { Wrapper } = fixture();
    const { result } = renderHook(() => useDLQAudit(ID, 50), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual(audit);
    expect(result.current.error).toBe(failure);
    mocks.request.mockResolvedValue({ ...audit, count: 0, rows: [] });
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ...audit, count: 0, rows: [] });
  });

  it('aborts the detail request signal when its last observer unmounts', async () => {
    mocks.request.mockImplementation(() => new Promise(() => {}));
    const { Wrapper } = fixture();
    const { unmount } = renderHook(() => useDLQEntry(ID), { wrapper: Wrapper });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    const signal = mocks.request.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it.each([
    { name: 'hex', id: ID, encoded: ID },
    { name: 'encoded', id: PATH_ID, encoded: ENCODED_PATH_ID },
  ])('replays $name string ID with POST live gate and success invalidation toast', async ({ id, encoded }) => {
    mocks.request.mockResolvedValue({ ...replay, replayed_id: id });
    const { client, Wrapper } = fixture();
    client.setQueryData(dlqKeys.list, list);
    client.setQueryData(dlqKeys.entryAudit(id, 50), audit);
    client.setQueryData(['unrelated'], 'keep');
    const { result } = renderHook(() => useDLQReplay(), { wrapper: Wrapper });
    await act(async () => {
      expect(await result.current.mutateAsync({ id })).toEqual({ ...replay, replayed_id: id });
    });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(`/system/dlq/${encoded}/replay`, {
      method: 'POST', requiresLiveMode: true,
    });
    expect(client.getQueryState(dlqKeys.list)?.isInvalidated).toBe(true);
    expect(client.getQueryState(dlqKeys.entryAudit(id, 50))?.isInvalidated).toBe(true);
    expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
      'admin.dlq.toast.replaySuccess', 'Replay published to {{topic}}', { topic: 'synthetic/target' },
    );
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('accepts an omitted replay destination and actual numeric zero audit ID without rewriting the DTO', async () => {
    const response: DLQReplayResponse = { ok: false, replayed_id: ID, result: 'disabled', audit_id: 0 };
    mocks.request.mockResolvedValue(response);
    const { Wrapper } = fixture();
    const { result } = renderHook(() => useDLQReplay(), { wrapper: Wrapper });
    await act(async () => { expect(await result.current.mutateAsync({ id: ID })).toEqual(response); });
    // Preserve existing hook HTTP-success toast semantics; the page owns result-code gates.
    expect(mocks.success).toHaveBeenCalledWith(
      'admin.dlq.toast.replaySuccess', 'Replay published to {{topic}}', { topic: '—' },
    );
  });

  it.each([
    { name: 'sudo_cancel', failure: new SudoCanceledError(), silent: true },
    { name: 'sudo_subclass', failure: new (class extends SudoCanceledError {})(), silent: true },
    { name: 'disabled_403', failure: Object.assign(new Error('disabled'), { status: 403 }), silent: true },
    { name: 'not_found_404', failure: Object.assign(new Error('missing'), { status: 404 }), silent: false },
    { name: 'rate_limit_429', failure: Object.assign(new Error('limited'), { status: 429 }), silent: false },
    { name: 'publish_502', failure: Object.assign(new Error('publish failed'), { status: 502 }), silent: false },
  ])('preserves $name replay rejection and toast policy without success invalidation', async ({ failure, silent }) => {
    mocks.request.mockRejectedValue(failure);
    const { client, Wrapper } = fixture();
    client.setQueryData(dlqKeys.list, list);
    const { result } = renderHook(() => useDLQReplay(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: ID })).rejects.toBe(failure);
    });
    expect(client.getQueryState(dlqKeys.list)?.isInvalidated).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    if (silent) expect(mocks.error).not.toHaveBeenCalled();
    else expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      failure, 'admin.dlq.toast.replayError', 'Replay failed',
    );
  });

  it.each([{ name: 'empty', id: '' }, { name: 'blank', id: '  ' }])(
    'rejects $name replay ID before the mocked request seam',
    async ({ id }) => {
      const { Wrapper } = fixture();
      const { result } = renderHook(() => useDLQReplay(), { wrapper: Wrapper });
      await act(async () => {
        await expect(result.current.mutateAsync({ id })).rejects.toThrow('DLQ entry ID is required');
      });
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.success).not.toHaveBeenCalled();
    },
  );
});
