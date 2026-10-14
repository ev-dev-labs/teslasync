import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportFrontendError } from '@/lib/errorReporter';
import type { ParsedEndpoint } from '../EndpointSidebar';
import type { HistoryEntry } from '../ResponseViewer';
import { findReplayEndpoint, loadHistory, MAX_HISTORY, saveHistory } from './playgroundHistory';

vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: vi.fn() }));

const HISTORY_KEY = 'teslasync-api-playground-history';
const getItem = vi.fn<(key: string) => string | null>();
const setItem = vi.fn<(key: string, value: string) => void>();
const fetchMock = vi.fn();
const localGetItem = vi.fn();
const localSetItem = vi.fn();

function entry(index = 0): HistoryEntry {
  return {
    method: 'GET',
    path: `/vehicles/${index}/state`,
    status: 200,
    duration: index + 0.5,
    timestamp: '2026-10-06T00:00:00Z',
  };
}

function endpoint(method: ParsedEndpoint['method'], path: string): ParsedEndpoint {
  return {
    method, path, tag: 'Vehicles', summary: '', description: '',
    operationId: '', parameters: [], responses: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getItem.mockReturnValue(null);
  vi.stubGlobal('sessionStorage', { getItem, setItem });
  vi.stubGlobal('localStorage', { getItem: localGetItem, setItem: localSetItem });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(localGetItem).not.toHaveBeenCalled();
  expect(localSetItem).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('playground history existing behavior', () => {
  it('keeps absent and explicitly empty history distinct from malformed data', () => {
    expect(loadHistory()).toEqual([]);
    getItem.mockReturnValue('[]');
    expect(loadHistory()).toEqual([]);
    expect(getItem).toHaveBeenCalledWith(HISTORY_KEY);
    expect(setItem).not.toHaveBeenCalled();
    expect(reportFrontendError).not.toHaveBeenCalled();
  });

  it('preserves all metadata and stored order without sorting or deduplication', () => {
    const entries = [entry(8), { ...entry(2), method: 'DELETE', status: 503 }, entry(8)];
    getItem.mockReturnValue(JSON.stringify(entries));
    expect(loadHistory()).toEqual(entries);
    expect(reportFrontendError).not.toHaveBeenCalled();
  });

  it('keeps the session-only key and save cap', () => {
    const entries = Array.from({ length: MAX_HISTORY + 5 }, (_, index) => entry(index));
    saveHistory(entries);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(
      HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)),
    );
  });

  it('does not let an unavailable session store prevent viewing a response on save', () => {
    setItem.mockImplementationOnce(() => { throw new Error('synthetic quota failure'); });
    expect(() => saveHistory([entry()])).not.toThrow();
  });

  it('prefers an exact same-method route even when a template comes first', () => {
    const exact = endpoint('GET', '/vehicles/count/state');
    const endpoints = [endpoint('GET', '/vehicles/{vehicleID}/state'), exact];
    expect(findReplayEndpoint(endpoints, { ...entry(), path: exact.path })).toBe(exact);
  });

  it('selects a nonempty template segment without executing a request', () => {
    const template = endpoint('GET', '/vehicles/{vehicleID}/state');
    expect(findReplayEndpoint([template], entry(42))).toBe(template);
    expect(findReplayEndpoint([template], { ...entry(), path: '/vehicles//state' })).toBeUndefined();
    expect(findReplayEndpoint([template], { ...entry(), path: '/vehicles/42/state/extra' })).toBeUndefined();
    expect(findReplayEndpoint([template], { ...entry(), method: 'POST' })).toBeUndefined();
    expect(findReplayEndpoint([], entry())).toBeUndefined();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps encoded path segments literal and supports multiple template segments', () => {
    const template = endpoint('GET', '/vehicles/{vehicleID}/signals/{signalName}');
    expect(findReplayEndpoint([template], {
      ...entry(), path: '/vehicles/42/signals/%24%26%2F%3F',
    })).toBe(template);
    expect(findReplayEndpoint([template], {
      ...entry(), path: '/vehicles/42/signal/%24%26%2F%3F',
    })).toBeUndefined();
  });
});

describe('playground history bounded shape trust', () => {
  it('caps externally supplied stored history at load without rewriting storage', () => {
    const entries = Array.from({ length: MAX_HISTORY + 10 }, (_, index) => entry(index));
    getItem.mockReturnValue(JSON.stringify(entries));
    expect(loadHistory()).toEqual(entries.slice(0, MAX_HISTORY));
    expect(setItem).not.toHaveBeenCalled();
  });

  it.each(['null', '{}', '"history"', '42', 'false'])(
    'surfaces non-array state %s instead of returning an authoritative empty list',
    raw => {
      getItem.mockReturnValue(raw);
      expect(loadHistory).toThrow(TypeError);
      expect(loadHistory).toThrow('API playground history must be an array');
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it.each(['', '{"private":"synthetic-secret"', '[invalid'])(
    'surfaces malformed JSON without including its raw contents',
    raw => {
      getItem.mockReturnValue(raw);
      expect(loadHistory).toThrow(SyntaxError);
      expect(loadHistory).toThrow('API playground history is not valid JSON');
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it('preserves a storage read failure instead of disguising it as an empty history', () => {
    const error = new Error('synthetic read failure');
    getItem.mockImplementationOnce(() => { throw error; });
    expect(loadHistory).toThrow(error);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('filters invalid entries, reports the partial state, and fills the cap from valid entries', () => {
    const valid = Array.from({ length: MAX_HISTORY + 5 }, (_, index) => entry(index));
    const invalid: unknown[] = [
      null, [], {}, 42, 'entry',
      { ...entry(), method: '' },
      { ...entry(), method: 42 },
      { ...entry(), path: null },
      { ...entry(), path: '' },
      { ...entry(), duration: '1' },
      { ...entry(), duration: -1 },
      { ...entry(), duration: null },
      { ...entry(), status: '200' },
      { ...entry(), status: 200.5 },
      { ...entry(), timestamp: null },
      { ...entry(), timestamp: 'invalid' },
    ];
    getItem.mockReturnValue(JSON.stringify([...invalid, ...valid]));
    expect(loadHistory()).toEqual(valid.slice(0, MAX_HISTORY));
    expect(reportFrontendError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: 'TypeError', message: 'API playground history contains invalid entries',
      }),
      'react',
    );
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reports an entirely invalid array rather than silently pretending no history exists', () => {
    getItem.mockReturnValue('[null,{},false]');
    expect(loadHistory).toThrow('API playground history contains invalid entries');
    expect(reportFrontendError).not.toHaveBeenCalled();
  });

  it('drops nonfinite numeric metadata without leaking invalid entry contents to diagnostics', () => {
    const privateValue = 'synthetic-private-value';
    getItem.mockReturnValue(`[{"method":"${privateValue}","path":"/private","status":1e400,`
      + `"duration":1e400,"timestamp":"2026-10-06T00:00:00Z"},${JSON.stringify(entry())}]`);
    expect(loadHistory()).toEqual([entry()]);
    const error = vi.mocked(reportFrontendError).mock.calls[0][0] as Error;
    expect(error.message).not.toContain(privateValue);
    expect(error.stack).not.toContain(privateValue);
  });

  it('projects loaded and saved entries to metadata only and strips query/fragment secrets', () => {
    const metadata = entry();
    const untrusted = {
      ...metadata,
      path: `${metadata.path}?api_key=synthetic-secret#synthetic-fragment`,
      apiKey: 'synthetic-secret',
      headers: { Authorization: 'synthetic-token' },
      requestBody: { private: 'synthetic-private' },
      response: { private: 'synthetic-response' },
    };
    getItem.mockReturnValue(JSON.stringify([untrusted]));
    expect(loadHistory()).toEqual([metadata]);
    saveHistory([untrusted]);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(HISTORY_KEY, JSON.stringify([metadata]));
    expect(reportFrontendError).not.toHaveBeenCalled();
    expect(untrusted.path).toContain('?api_key=');
  });

  it('keeps genuine zero duration, HTTP failures, encoded paths and timestamp text unchanged', () => {
    const metadata = {
      ...entry(), method: 'PATCH', path: '/vehicles/%3F%23%2F/state',
      status: 500, duration: 0, timestamp: '2026-10-06T02:00:00+02:00',
    };
    getItem.mockReturnValue(JSON.stringify([metadata]));
    expect(loadHistory()).toEqual([metadata]);
    expect(reportFrontendError).not.toHaveBeenCalled();
  });
});
