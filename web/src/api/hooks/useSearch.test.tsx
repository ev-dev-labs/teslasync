// useSearch hook-suite tests.
//
// Covers EVERY export of ./useSearch:
//   - SEARCH_MIN_QUERY_LENGTH — the client-side floor that gates the request
//     and mirrors the backend's minQueryRunes (see internal/api/search).
//   - searchKeys.global        — the query-key factory: namespaced, stable, and
//     cache-safe (empty `types` collapses to the same slot as `undefined`, and
//     distinct limits produce distinct keys).
//   - UseGlobalSearchOptions   — exercised as the hook's options type.
//   - useGlobalSearch          — the endpoint hook: the enabled boundary (with
//     whitespace trimming), the `q`/`types`/`limit` URLSearchParams contract,
//     abort-signal threading, the `disabled` override, loading + error states,
//     null-safe response coercion, keep-previous-on-refetch, and — the
//     correctness guarantee — DROPPING stale hits the moment the query falls
//     below the minimum (so a cleared box can't keep surfacing old results).
//
// Network is mocked at the api/client boundary (the repo convention — see
// usePinned.test.tsx / useExports.test.tsx). Never hits real network.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// HTTP client stub. The deferred wrapper means `requestMock` is only touched
// when the mocked `request` is *called* (query time), never during Vitest's
// hoisted factory evaluation — so no temporal-dead-zone error.
const requestMock = vi.fn();
vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

import {
  useGlobalSearch,
  searchKeys,
  SEARCH_MIN_QUERY_LENGTH,
  type UseGlobalSearchOptions,
} from './useSearch';
import type { SearchHit, SearchResponse } from '../types';

function makeWrapper(client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, qc };
}

function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    type: 'vehicle',
    id: 1,
    title: 'Model 3',
    subtitle: 'VIN ····1234',
    url: '/vehicles/1',
    score: 1,
    ...overrides,
  };
}

function makeResponse(hits: SearchHit[], query = 'tesla'): SearchResponse {
  return { hits, query };
}

/** Parse the query string of the most recent `request()` URL. */
function lastRequestParams(): URLSearchParams {
  const url = requestMock.mock.calls.at(-1)?.[0] as string | undefined;
  return new URLSearchParams((url ?? '').split('?')[1] ?? '');
}

beforeEach(() => {
  requestMock.mockReset();
});

// ---------------------------------------------------------------------------
// SEARCH_MIN_QUERY_LENGTH
// ---------------------------------------------------------------------------

describe('SEARCH_MIN_QUERY_LENGTH', () => {
  it('is the backend-mirrored floor of 2 runes', () => {
    // A regression guard: the hook's enabled-boundary and the backend's
    // minQueryRunes must agree, so this constant is load-bearing.
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// searchKeys
// ---------------------------------------------------------------------------

describe('searchKeys.global', () => {
  it('namespaces the key and normalises absent types/limit to stable slots', () => {
    expect(searchKeys.global('tesla', undefined, undefined)).toEqual([
      'search',
      'global',
      'tesla',
      '',
      null,
    ]);
  });

  it('joins the requested types and threads the limit', () => {
    expect(searchKeys.global('m3', ['vehicle', 'drive'], 25)).toEqual([
      'search',
      'global',
      'm3',
      'vehicle,drive',
      25,
    ]);
  });

  it('collapses an empty types array to the same key as undefined (cache-stability)', () => {
    // Empty `types` and absent `types` issue the SAME request, so they MUST
    // share a cache bucket — otherwise identical searches would double-fetch.
    expect(searchKeys.global('x', [], undefined)).toEqual(
      searchKeys.global('x', undefined, undefined),
    );
  });

  it('produces distinct keys for distinct limits', () => {
    expect(searchKeys.global('x', undefined, 5)).not.toEqual(
      searchKeys.global('x', undefined, 25),
    );
  });
});

// ---------------------------------------------------------------------------
// useGlobalSearch
// ---------------------------------------------------------------------------

describe('useGlobalSearch', () => {
  it('does not fire a request for a query shorter than the minimum', async () => {
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useGlobalSearch('a'), { wrapper: Wrapper });

    // Disabled queries sit idle: no fetch, no data, no error.
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('trims whitespace before applying the length gate (a padded single char stays disabled)', () => {
    const { Wrapper } = makeWrapper();

    renderHook(() => useGlobalSearch('   a   '), { wrapper: Wrapper });

    expect(requestMock).not.toHaveBeenCalled();
  });

  it('GETs /search with a trimmed q and threads the abort signal', async () => {
    requestMock.mockResolvedValueOnce(makeResponse([makeHit()], 'tesla'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useGlobalSearch('  tesla  '), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url, opts] = requestMock.mock.calls[0] as [string, { signal?: AbortSignal }];
    expect(lastRequestParams().get('q')).toBe('tesla');
    expect(url.startsWith('/search?')).toBe(true);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(result.current.data).toEqual(makeResponse([makeHit()], 'tesla'));
  });

  it('appends the joined types param only when a non-empty list is provided', async () => {
    requestMock.mockResolvedValue(makeResponse([], 'm3'));
    const { Wrapper } = makeWrapper();

    renderHook(() => useGlobalSearch('m3', { types: ['vehicle', 'drive'] }), { wrapper: Wrapper });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(lastRequestParams().get('types')).toBe('vehicle,drive');
  });

  it('omits the types param for an empty types array', async () => {
    requestMock.mockResolvedValue(makeResponse([], 'm3'));
    const { Wrapper } = makeWrapper();

    renderHook(() => useGlobalSearch('m3', { types: [] }), { wrapper: Wrapper });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(lastRequestParams().has('types')).toBe(false);
  });

  it('appends the limit param when positive and omits it when zero', async () => {
    requestMock.mockResolvedValue(makeResponse([], 'm3'));

    const withLimit = makeWrapper();
    renderHook(() => useGlobalSearch('m3', { limit: 25 }), { wrapper: withLimit.Wrapper });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(lastRequestParams().get('limit')).toBe('25');

    requestMock.mockClear();
    const noLimit = makeWrapper();
    renderHook(() => useGlobalSearch('m3', { limit: 0 }), { wrapper: noLimit.Wrapper });
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(lastRequestParams().has('limit')).toBe(false);
  });

  it('honours the disabled override even for a long-enough query', () => {
    const { Wrapper } = makeWrapper();
    const options: UseGlobalSearchOptions = { disabled: true };

    const { result } = renderHook(() => useGlobalSearch('tesla', options), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports a loading state before the first response arrives', () => {
    // A promise that never settles keeps the query pending so we observe the
    // idiomatic loading phase (no placeholder masks isLoading on a cold cache).
    requestMock.mockImplementation(() => new Promise<SearchResponse>(() => {}));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useGlobalSearch('tesla'), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSuccess).toBe(false);
  });

  it('surfaces request failures as isError', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom'));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useGlobalSearch('tesla'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('coerces a null response body into a well-formed empty result (null-safety)', async () => {
    // Without the `?? []` guard a 204 / malformed body leaves `data.hits`
    // undefined and crashes `.map`/`.length` at every callsite.
    requestMock.mockResolvedValueOnce(null);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useGlobalSearch('tesla'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ hits: [], query: 'tesla' });
    expect(Array.isArray(result.current.data?.hits)).toBe(true);
  });

  it('keeps the previous hits visible while a new valid query is in flight (no flicker)', async () => {
    const first = makeResponse([makeHit({ id: 1, title: 'Model 3' })], 'tesla');
    requestMock.mockResolvedValueOnce(first);
    requestMock.mockReturnValueOnce(new Promise<SearchResponse>(() => {})); // 'teslas' stays pending
    const { Wrapper } = makeWrapper();

    const { result, rerender } = renderHook((q: string) => useGlobalSearch(q), {
      wrapper: Wrapper,
      initialProps: 'tesla',
    });

    await waitFor(() => expect(result.current.data).toEqual(first));

    rerender('teslas');

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    // The in-flight query has no data of its own yet — the previous page's
    // hits are retained as placeholder data.
    expect(result.current.data).toEqual(first);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('drops stale hits the instant the query falls below the minimum', async () => {
    const first = makeResponse([makeHit({ id: 1, title: 'Model 3' })], 'tesla');
    requestMock.mockResolvedValueOnce(first);
    const { Wrapper } = makeWrapper();

    const { result, rerender } = renderHook((q: string) => useGlobalSearch(q), {
      wrapper: Wrapper,
      initialProps: 'tesla',
    });

    await waitFor(() => expect(result.current.data).toEqual(first));

    // Shorten below the floor — the query is now disabled. Stale results MUST
    // NOT linger via placeholderData (the command palette's empty state and
    // the search page's "keep typing" prompt both depend on this).
    rerender('t');

    await waitFor(() => expect(result.current.data).toBeUndefined());
    expect(result.current.fetchStatus).toBe('idle');
    // 't' was never fetched — only the original 'tesla' request happened.
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
