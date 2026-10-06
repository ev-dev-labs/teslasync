import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from '../client';
import {
  useTimelinePageSummary,
  useTimelinePageTimeline,
  type SummaryResponse,
  type TimelineResponse,
} from './useTimelinePage';

// Do not import the actual client: these cases cannot open a real network.
vi.mock('../client', () => ({ request: vi.fn() }));
const requestMock = vi.mocked(request);
const clients: QueryClient[] = [];
const start = '2026-10-01T00:00:00+05:30';
const end = '2026-10-08T00:00:00+05:30';

const timeline: TimelineResponse = {
  transitions: [
    {
      ts: '2026-10-01T00:00:00Z',
      from_state: 'offline',
      to_state: 'online',
      trigger_field: null,
      trigger_value: null,
    },
    {
      ts: '2026-10-01T00:01:00Z',
      from_state: 'online',
      to_state: 'driving',
      trigger_field: 'speed_mps',
      trigger_value: '2.5',
    },
  ],
};
const summary: SummaryResponse = {
  vehicle_id: 7,
  days: 7,
  total_seconds: 60.25,
  by_state: [
    { state: 'online', total_seconds: 60.25, percentage: 100, transition_count: 1 },
  ],
};

function harness(retry: boolean | number = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry, retryDelay: 0, gcTime: Infinity } },
  });
  clients.push(client);
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

const contracts = [
  {
    name: 'timeline',
    key: 'vehicle-timeline',
    path: '/vehicle-states/timeline',
    useHook: useTimelinePageTimeline,
    payload: timeline,
  },
  {
    name: 'summary',
    key: 'vehicle-summary',
    path: '/vehicle-states/summary',
    useHook: useTimelinePageSummary,
    payload: summary,
  },
] as const;

beforeEach(() => {
  // Vitest treats a returned function as cleanup; mockReset returns the mock.
  requestMock.mockReset();
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

for (const contract of contracts) {
  describe(contract.name, () => {
    it('uses both encoded bounds, raw vehicle string, default GET and the query signal', async () => {
      requestMock.mockResolvedValue(contract.payload);
      const { result } = renderHook(
        () => contract.useHook('007+raw', start, end),
        harness(),
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(requestMock.mock.calls).toEqual([[
        `${contract.path}?vehicle_id=007+raw&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { signal: expect.any(AbortSignal) },
      ]]);
      expect(requestMock.mock.calls[0][1]).not.toHaveProperty('method');
      expect(result.current.data).toBe(contract.payload);
    });

    it('keeps the exact string key and separates vehicle and each bound in the cache', async () => {
      requestMock.mockResolvedValue(contract.payload);
      const { client, wrapper } = harness();
      const { result, rerender } = renderHook(
        ({ id, from, to }) => contract.useHook(id, from, to),
        { wrapper, initialProps: { id: '7', from: start, to: end } },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      rerender({ id: '8', from: start, to: end });
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
      rerender({ id: '8', from: `${start} changed`, to: end });
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));
      rerender({ id: '8', from: `${start} changed`, to: `${end} changed` });
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(4));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([
        [contract.key, '7', start, end],
        [contract.key, '8', start, end],
        [contract.key, '8', `${start} changed`, end],
        [contract.key, '8', `${start} changed`, `${end} changed`],
      ]);
      expect(client.getQueryData([contract.key, '7', start, end])).toBe(contract.payload);
    });

    it('disables only the empty vehicle string, not empty bounds', async () => {
      requestMock.mockResolvedValue(contract.payload);
      const { result, rerender } = renderHook(
        ({ id }) => contract.useHook(id, '', ''),
        { ...harness(), initialProps: { id: '' } },
      );
      expect(result.current.fetchStatus).toBe('idle');
      expect(result.current.isPending).toBe(true);
      expect(requestMock).not.toHaveBeenCalled();
      rerender({ id: '7' });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(requestMock).toHaveBeenCalledExactlyOnceWith(
        `${contract.path}?vehicle_id=7&start=&end=`,
        { signal: expect.any(AbortSignal) },
      );
    });

    it.each(['0', ' ', 'not-a-number'])('enables the nonempty string %j without validation', async (id) => {
      requestMock.mockResolvedValue(contract.payload);
      const { result } = renderHook(() => contract.useHook(id, start, end), harness());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(requestMock).toHaveBeenCalledExactlyOnceWith(
        `${contract.path}?vehicle_id=${id}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { signal: expect.any(AbortSignal) },
      );
    });

    it.each([null, [], { unexpected: 'raw envelope' }])('does not silently normalize runtime payload %j', async (payload) => {
      // Malformed runtime JSON is intentional: the original hook did not coerce it.
      requestMock.mockResolvedValue(payload);
      const { result } = renderHook(() => contract.useHook('7', start, end), harness());
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe(payload);
      expect(result.current.error).toBeNull();
    });

    it('retains Error identity rather than returning a null success', async () => {
      const error = new Error('source unavailable');
      requestMock.mockRejectedValue(error);
      const { client, wrapper } = harness();
      const queryKey = [contract.key, '7', start, end];
      // This fixture inspects the error result, not an error boundary. Keep the
      // policy local to this client/key; do not catch global/unhandled failures.
      client.setQueryDefaults(queryKey, { throwOnError: false });
      const { result } = renderHook(() => contract.useHook('7', start, end), { wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBe(error);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.data).toBeUndefined();
      expect(client.getQueryState(queryKey)?.error).toBe(error);
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it('inherits retry policy from the caller QueryClient', async () => {
      const error = new Error('temporary');
      requestMock.mockRejectedValueOnce(error).mockRejectedValueOnce(error)
        .mockResolvedValueOnce(contract.payload);
      const { result } = renderHook(() => contract.useHook('7', start, end), harness(2));
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(requestMock).toHaveBeenCalledTimes(3);
      expect(result.current.data).toBe(contract.payload);
    });

    it('does not add stale-time or polling overrides', async () => {
      requestMock.mockResolvedValue(contract.payload);
      const { client, wrapper } = harness();
      client.setDefaultOptions({
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchInterval: false },
      });
      const { result } = renderHook(() => contract.useHook('7', start, end), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const query = client.getQueryCache().find({ queryKey: [contract.key, '7', start, end] });
      expect(query?.options).toMatchObject({ staleTime: Infinity, refetchInterval: false });
      expect(result.current.isStale).toBe(false);
    });

    it('aborts on unmount and does not cache a late response', async () => {
      let resolve: (payload: TimelineResponse | SummaryResponse) => void = () => {
        throw new Error('deferred request was not acquired');
      };
      requestMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      const { client, wrapper } = harness();
      const { unmount } = renderHook(() => contract.useHook('7', start, end), { wrapper });
      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
      const signal = requestMock.mock.calls[0][1]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
      unmount();
      expect(signal?.aborted).toBe(true);
      await act(async () => { resolve(contract.payload); });
      await waitFor(() => expect(
        client.getQueryData([contract.key, '7', start, end]),
      ).toBeUndefined());
      expect(requestMock.mock.calls[0]).toHaveLength(2);
    });
  });
}

it('retains chronological records, nullable triggers, arrays and scalar SI summary fields', async () => {
  requestMock.mockResolvedValueOnce(timeline).mockResolvedValueOnce(summary);
  const { result } = renderHook(() => ({
    timeline: useTimelinePageTimeline('7', start, end),
    summary: useTimelinePageSummary('7', start, end),
  }), harness());
  await waitFor(() => expect(result.current.timeline.isSuccess && result.current.summary.isSuccess).toBe(true));
  expect(result.current.timeline.data?.transitions).toBe(timeline.transitions);
  expect(result.current.timeline.data?.transitions.map((record) => record.ts)).toEqual([
    '2026-10-01T00:00:00Z', '2026-10-01T00:01:00Z',
  ]);
  expect(result.current.timeline.data?.transitions[0].trigger_field).toBeNull();
  expect(result.current.timeline.data?.transitions[0].trigger_value).toBeNull();
  expect(Array.isArray(result.current.summary.data)).toBe(false);
  expect(result.current.summary.data?.by_state).toBe(summary.by_state);
  expect(result.current.summary.data?.total_seconds).toBe(60.25);
  expect(result.current.summary.data?.by_state[0].total_seconds).toBe(60.25);
});

it('passes through a null from_state without coercing the raw record', async () => {
  const payload: TimelineResponse = {
    transitions: [
      { ...timeline.transitions[0], from_state: null },
      timeline.transitions[1],
    ],
  };
  requestMock.mockResolvedValueOnce(payload);
  const { result } = renderHook(() => useTimelinePageTimeline('7', start, end), harness());
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toBe(payload);
  expect(result.current.data?.transitions).toBe(payload.transitions);
  expect(result.current.data?.transitions[0]).toBe(payload.transitions[0]);
  expect(result.current.data?.transitions[0].from_state).toBeNull();
  expect(result.current.data?.transitions[1].from_state).toBe('online');
});
