import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionCenterHistoryPage } from '@/types/actionCenter';

const requestMock = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ request: requestMock }));
import { actionCenterKeys, useActionCenterHistory } from './useActionCenter';

const firstPage: ActionCenterHistoryPage = {
  items: [{
    id: 17, recommendation_id: 'ac_history', fingerprint: 'a'.repeat(64),
    action: 'acknowledge', from_state: 'open', to_state: 'acknowledged',
    outcome: 'applied', state_version: 1, occurred_at: '2026-10-12T15:30:00Z',
  }],
  total: 26, limit: 25, offset: 0,
};

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60000 } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

beforeEach(() => {
  requestMock.mockReset();
});

describe('Action Center bounded history paging', () => {
  it('preserves default two argument requests raw UTC payload and cancellation', async () => {
    requestMock.mockResolvedValue(firstPage);
    const { wrapper, client } = harness();
    const { result, unmount } = renderHook(() => useActionCenterHistory('ac_history', true), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(firstPage));
    expect(requestMock).toHaveBeenCalledWith(
      '/action-center/ac_history/history?limit=25&offset=0',
      { signal: expect.any(AbortSignal) },
    );
    expect(result.current.data?.items[0]).toEqual(firstPage.items[0]);
    expect(client.getQueryData(actionCenterKeys.historyPage('ac_history'))).toEqual(firstPage);
    unmount();
    client.clear();
  });

  it.each([
    { name: 'minimum', limit: 1, offset: 0, expectedLimit: 1, expectedOffset: 0 },
    { name: 'inside bounds', limit: 99, offset: 99999, expectedLimit: 99, expectedOffset: 99999 },
    { name: 'maximum', limit: 100, offset: 100000, expectedLimit: 100, expectedOffset: 100000 },
    { name: 'older page', limit: 25, offset: 25, expectedLimit: 25, expectedOffset: 25 },
    { name: 'below bounds', limit: 0, offset: -1, expectedLimit: 1, expectedOffset: 0 },
    { name: 'negative limit', limit: -10, offset: 1, expectedLimit: 1, expectedOffset: 1 },
    { name: 'above bounds', limit: 101, offset: 100001, expectedLimit: 100, expectedOffset: 100000 },
    { name: 'fractional', limit: 25.9, offset: 25.9, expectedLimit: 25, expectedOffset: 25 },
    { name: 'nonfinite', limit: Number.NaN, offset: Number.POSITIVE_INFINITY, expectedLimit: 25, expectedOffset: 0 },
  ])('uses backend bounds and matching cache identity for $name', async ({
    limit, offset, expectedLimit, expectedOffset,
  }) => {
    requestMock.mockResolvedValue({ ...firstPage, limit: expectedLimit, offset: expectedOffset });
    const { wrapper, client } = harness();
    const { result, unmount } = renderHook(
      () => useActionCenterHistory('ac/id ?#', true, { limit, offset }), { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledWith(
      `/action-center/ac%2Fid%20%3F%23/history?limit=${expectedLimit}&offset=${expectedOffset}`,
      { signal: expect.any(AbortSignal) },
    );
    expect(actionCenterKeys.historyPage('ac/id ?#', { limit, offset })).toEqual(
      ['action-center', 'history', 'ac/id ?#', { limit: expectedLimit, offset: expectedOffset }],
    );
    expect(client.getQueryData(actionCenterKeys.historyPage('ac/id ?#', { limit, offset })))
      .toEqual({ ...firstPage, limit: expectedLimit, offset: expectedOffset });
    unmount();
    client.clear();
  });

  it('keeps recommendation page and size identities distinct under the history prefix', () => {
    expect(actionCenterKeys.history('ac_history')).toEqual(['action-center', 'history', 'ac_history']);
    const keys = [
      actionCenterKeys.historyPage('ac_history'),
      actionCenterKeys.historyPage('ac_history', { limit: 25, offset: 25 }),
      actionCenterKeys.historyPage('ac_history', { limit: 50, offset: 0 }),
      actionCenterKeys.historyPage('ac_other'),
    ];
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(4);
    expect(keys.slice(0, 3).map((key) => key.slice(0, 3)))
      .toEqual(Array(3).fill(actionCenterKeys.history('ac_history')));
    expect(actionCenterKeys.historyPage(undefined)).toEqual(
      ['action-center', 'history', null, { limit: 25, offset: 0 }],
    );
  });

  it('fetches only open identified history and never requests closed or absent identifiers', async () => {
    requestMock.mockResolvedValue(firstPage);
    const { wrapper, client } = harness();
    const { result, rerender, unmount } = renderHook(
      ({ id, open }: { id: string | undefined; open: boolean }) => useActionCenterHistory(id, open),
      { wrapper, initialProps: { id: undefined as string | undefined, open: true } },
    );
    expect(result.current.fetchStatus).toBe('idle');
    rerender({ id: 'ac_history', open: false });
    expect(requestMock).not.toHaveBeenCalled();
    rerender({ id: 'ac_history', open: true });
    await waitFor(() => expect(result.current.data?.total).toBe(26));
    expect(requestMock).toHaveBeenCalledTimes(1);
    unmount();
    client.clear();
  });

  it('retains actual response offsets while an older page is pending and replaces only on success', async () => {
    let resolveOlder!: (page: ActionCenterHistoryPage) => void;
    requestMock.mockResolvedValueOnce(firstPage).mockImplementationOnce(
      () => new Promise<ActionCenterHistoryPage>((resolve) => { resolveOlder = resolve; }),
    );
    const { wrapper, client } = harness();
    const { result, rerender, unmount } = renderHook(
      ({ offset }) => useActionCenterHistory('ac_history', true, { limit: 25, offset }),
      { wrapper, initialProps: { offset: 0 } },
    );
    await waitFor(() => expect(result.current.data).toEqual(firstPage));
    rerender({ offset: 25 });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(result.current.isFetching).toBe(true);
    expect(result.current.data).toEqual(firstPage);
    const older = { ...firstPage, items: [{ ...firstPage.items[0], id: 3 }], offset: 25 };
    await act(async () => { resolveOlder(older); });
    await waitFor(() => expect(result.current.data).toEqual(older));
    expect(requestMock.mock.calls[1][0]).toBe('/action-center/ac_history/history?limit=25&offset=25');
    expect(client.getQueryData(actionCenterKeys.historyPage('ac_history'))).toEqual(firstPage);
    unmount();
    client.clear();
  });

  it('does not attach another recommendation payload while its first page is pending', async () => {
    requestMock.mockResolvedValueOnce(firstPage).mockImplementationOnce(() => new Promise(() => {}));
    const { wrapper, client } = harness();
    const { result, rerender, unmount } = renderHook(
      ({ id }) => useActionCenterHistory(id, true), { wrapper, initialProps: { id: 'ac_history' } },
    );
    await waitFor(() => expect(result.current.data).toEqual(firstPage));
    rerender({ id: 'ac_other' });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    expect(requestMock.mock.calls[1][0]).toBe('/action-center/ac_other/history?limit=25&offset=0');
    unmount();
    client.clear();
  });

  it('aborts an obsolete page request without changing its original request scope', async () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    const { wrapper, client } = harness();
    const { rerender, unmount } = renderHook(
      ({ offset }) => useActionCenterHistory('ac_history', true, { limit: 25, offset }),
      { wrapper, initialProps: { offset: 0 } },
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const originalSignal = requestMock.mock.calls[0][1].signal as AbortSignal;
    expect(originalSignal.aborted).toBe(false);
    rerender({ offset: 25 });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(originalSignal.aborted).toBe(true);
    expect(requestMock.mock.calls.map(([url]) => url)).toEqual([
      '/action-center/ac_history/history?limit=25&offset=0',
      '/action-center/ac_history/history?limit=25&offset=25',
    ]);
    unmount();
    client.clear();
  });

  it('retains same page data on refresh failure and recovers through the independent refetch', async () => {
    requestMock.mockResolvedValue(firstPage);
    const { wrapper, client } = harness();
    client.setQueryDefaults(actionCenterKeys.history('ac_history'), { staleTime: Infinity });
    const { result, unmount } = renderHook(() => useActionCenterHistory('ac_history'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(firstPage));
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    requestMock.mockRejectedValueOnce(new Error('Refresh failed'));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isError).toBe(true);
    expect(result.current.error?.message).toBe('Refresh failed');
    expect(result.current.data).toEqual(firstPage);
    const recovered = { ...firstPage, total: 27 };
    requestMock.mockResolvedValueOnce(recovered);
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.data).toEqual(recovered));
    expect(requestMock.mock.calls.map(([url]) => url)).toEqual(Array(3).fill(
      '/action-center/ac_history/history?limit=25&offset=0',
    ));
    unmount();
    client.clear();
  });

  it('invalidates all cached pages for the recommendation without invalidating a different identifier', async () => {
    const { client } = harness();
    const first = actionCenterKeys.historyPage('ac_history');
    const older = actionCenterKeys.historyPage('ac_history', { limit: 25, offset: 25 });
    const other = actionCenterKeys.historyPage('ac_other');
    client.setQueryData(first, firstPage);
    client.setQueryData(older, { ...firstPage, offset: 25 });
    client.setQueryData(other, { ...firstPage, total: 4 });
    await client.invalidateQueries({ queryKey: actionCenterKeys.history('ac_history') });
    expect(client.getQueryState(first)?.isInvalidated).toBe(true);
    expect(client.getQueryState(older)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
});
