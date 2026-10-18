import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { APICallLog, APICallLogResponse, APICallLogStats, ErrorStats } from '@/api/types';
import type { WebErrorsSummary } from '@/types/admin';
import { adminKeys } from '@/api/hooks/useAdmin';
import ApiLogsPage from './ApiLogsPage';

vi.mock('@/api/devtools', async () => ({
  ...await vi.importActual<typeof import('@/api/devtools')>('@/api/devtools'),
  getAPICallLogs: vi.fn(),
  getAPICallLogStats: vi.fn(),
  getErrorStats: vi.fn(),
}));

vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn(),
}));

import { getAPICallLogs, getAPICallLogStats, getErrorStats } from '@/api/devtools';
import { request } from '@/api/client';

const mockedLogs = vi.mocked(getAPICallLogs);
const mockedStats = vi.mocked(getAPICallLogStats);
const mockedBackend = vi.mocked(getErrorStats);
const mockedRequest = vi.mocked(request);
const clients = new Set<QueryClient>();

const log: APICallLog = {
  id: 1, ts: '2026-10-01T12:00:00Z', vehicle_id: null,
  service: 'tesla-api', http_method: 'GET', endpoint: '/phase6-evidence',
  status_code: 200, duration_ms: 0, error_message: null, rate_limited: false,
  request_body: null, response_body: null, request_headers: null, response_headers: null,
};
const stats: APICallLogStats = {
  total_calls: 5, by_method: { GET: 5 }, by_service: { 'tesla-api': 5 },
  error_rate: 0, error_count: 0, avg_duration_ms: 0, last_24h: 0,
};
const backend: ErrorStats = { total_errors: 0, uptime: '2h', by_code: {} };
const browser: WebErrorsSummary = {
  total: 0, top: [], window_seconds: 3600, windowSeconds: 3600,
  as_of: '2026-10-01T12:00:00Z', asOf: '2026-10-01T12:00:00Z',
};

function response(total = 5, offset = 0, limit = 25): APICallLogResponse {
  return { data: offset < total ? [log] : [], total, offset, limit };
}

function renderPage(route = '/api-logs', enabled = true, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, enabled } },
  });
  clients.add(client);
  seed?.(client);
  const router = createMemoryRouter(
    [{ path: '/api-logs', element: <ApiLogsPage /> }],
    { initialEntries: [route] },
  );
  return {
    client,
    router,
    ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>),
  };
}

function card(name: string) {
  return screen.getByRole('region', { name });
}

function assertUnknownDiagnostics(status: string) {
  const front = card('Frontend error reports');
  const back = card('Backend runtime errors');
  for (const region of [front, back]) {
    expect(within(region).getByRole('status')).toHaveTextContent(status);
    expect(within(region).queryByText('0')).not.toBeInTheDocument();
    expect(within(region).queryByText("Can't reach server")).not.toBeInTheDocument();
  }
  expect(screen.queryByText('No service activity yet')).not.toBeInTheDocument();
  expect(screen.queryByText('No API call logs')).not.toBeInTheDocument();
  expect(screen.queryByText('Unable to load frontend error summary.')).not.toBeInTheDocument();
  expect(screen.queryByText('Backend runtime error summary unavailable.')).not.toBeInTheDocument();
  expect(screen.queryByText('No backend runtime errors in this process.')).not.toBeInTheDocument();
  expect(screen.queryByText('No browser error reports received in this window.')).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.resetAllMocks();
  onlineManager.setOnline(true);
  localStorage.removeItem('teslasync.table.admin:api-logs.columns');
  localStorage.removeItem('teslasync.table.admin:api-logs.visible');
  mockedLogs.mockImplementation(async (params) => response(5, params?.offset ?? 0, params?.limit ?? 25));
  mockedStats.mockResolvedValue(stats);
  mockedBackend.mockResolvedValue(backend);
  mockedRequest.mockImplementation(async (path) => {
    if (path === '/admin/web-errors/summary') return browser;
    throw new Error(`Unexpected mocked request: ${path}`);
  });
});

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('phase6 API logs initial trust and authoritative page', () => {
  it('keeps all cold paused sources unknown, preserves the URL and exposes independent retry', () => {
    onlineManager.setOnline(false);
    const { router } = renderPage('/api-logs?page=3&size=50&method=POST');
    assertUnknownDiagnostics('Refresh paused');
    expect(mockedLogs).not.toHaveBeenCalled();
    expect(mockedStats).not.toHaveBeenCalled();
    expect(mockedBackend).not.toHaveBeenCalled();
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('50');
    expect(screen.getByRole('heading', { name: 'By service' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'API call log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(within(card('Frontend error reports')).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(within(card('Backend runtime errors')).getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('does not call a cold idle pending source empty or failed', () => {
    const { router } = renderPage('/api-logs?page=3', false);
    assertUnknownDiagnostics('Pending');
    expect(mockedLogs).not.toHaveBeenCalled();
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
  });

  it('keeps actively fetching cold sources loading rather than empty', () => {
    mockedLogs.mockReturnValue(new Promise(() => {}));
    mockedStats.mockReturnValue(new Promise(() => {}));
    mockedBackend.mockReturnValue(new Promise(() => {}));
    mockedRequest.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading frontend error summary' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading backend error summary' })).toBeInTheDocument();
    expect(screen.queryByText('No API call logs')).not.toBeInTheDocument();
    expect(screen.queryByText('No service activity yet')).not.toBeInTheDocument();
  });

  it('resumes paused sources and accepts measured zero without claiming full browser coverage', async () => {
    onlineManager.setOnline(false);
    mockedLogs.mockResolvedValue(response(0));
    mockedStats.mockResolvedValue({ ...stats, total_calls: 0, by_service: {} });
    renderPage();
    assertUnknownDiagnostics('Refresh paused');
    await act(async () => { onlineManager.setOnline(true); });
    expect(await screen.findByText('No API call logs')).toBeInTheDocument();
    expect(await screen.findByText('No service activity yet')).toBeInTheDocument();
    expect(await screen.findByText('No backend runtime errors in this process.')).toBeInTheDocument();
    expect(await screen.findByText('No browser error reports received in this window.')).toBeInTheDocument();
    expect(screen.getByText(/zero reports does not prove there were no frontend errors/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No data to export' })).toBeDisabled();
  });

  it('recovers a failed browser source independently without refreshing the other sources', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('browser summary failed'));
    renderPage();
    const front = card('Frontend error reports');
    expect(await within(front).findByText("Can't reach server")).toBeInTheDocument();
    expect(await screen.findByText('/phase6-evidence')).toBeInTheDocument();
    const counts = [mockedLogs.mock.calls.length, mockedStats.mock.calls.length, mockedBackend.mock.calls.length];
    fireEvent.click(within(front).getByRole('button', { name: 'Retry' }));
    expect(await within(front).findByText('No browser error reports received in this window.')).toBeInTheDocument();
    expect([mockedLogs.mock.calls.length, mockedStats.mock.calls.length, mockedBackend.mock.calls.length]).toEqual(counts);
  });

  it('keeps failed-refresh evidence and successful neighbors visible', async () => {
    mockedBackend.mockResolvedValue({
      total_errors: 3, uptime: '2h',
      by_code: { TIMEOUT: { count: 3, last_message: 'Retained backend evidence', last_seen: '2026-10-01T12:00:00Z' } },
    });
    mockedRequest.mockResolvedValue({ ...browser, total: 4, top: [{ name: 'TypeError', route: '/synthetic', count: 4 }] });
    const { client } = renderPage();
    await screen.findByText('Retained backend evidence');
    await screen.findByText('TypeError');
    mockedBackend.mockRejectedValue(new Error('backend refresh failed'));
    mockedRequest.mockRejectedValue(new Error('browser refresh failed'));
    await act(async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: adminKeys.systemErrorStats }),
        client.invalidateQueries({ queryKey: adminKeys.webErrorsSummary }),
      ]);
    });
    // The failed background refetch lands asynchronously; await the same
    // retained-data warnings (the page's main suite asserts them via waitFor).
    await waitFor(() => {
      expect(within(card('Backend runtime errors')).getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(within(card('Frontend error reports')).getByTestId('stale-refresh-warning')).toBeInTheDocument();
    });
    expect(screen.getByText('Retained backend evidence')).toBeInTheDocument();
    expect(screen.getByText('TypeError')).toBeInTheDocument();
    expect(screen.getByText('/phase6-evidence')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });

  it.each([
    { size: 25, total: 5, last: 0 },
    { size: 50, total: 125, last: 2 },
    { size: 100, total: 0, last: 0 },
  ])('reconciles an authoritative total=$total at size=$size without dropping scope', async ({ size, total, last }) => {
    mockedLogs.mockImplementation(async (params) => response(total, params?.offset ?? 0, params?.limit ?? 25));
    const { router } = renderPage(`/api-logs?page=3&size=${size}&method=POST&status=5xx&endpoint=timeout&service=tesla-api&client=desktop&key=42&from=2026-09-19&to=2026-09-25&keep=value`);
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]?.offset).toBe(last * size));
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get('page')).toBe(last === 0 ? null : String(last));
    for (const [key, value] of Object.entries({
      size: String(size), method: 'POST', status: '5xx', endpoint: 'timeout',
      service: 'tesla-api', client: 'desktop', key: '42',
      from: '2026-09-19', to: '2026-09-25', keep: 'value',
    })) expect(query.get(key)).toBe(value);
    expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      limit: size, offset: last * size, method: 'POST', status: '5xx',
      endpoint: 'timeout', service: 'tesla-api', client: 'desktop', key: '42',
      start: expect.any(String), endExclusive: expect.any(String),
    }));
    expect(mockedLogs.mock.lastCall?.[0]?.start).toBe(mockedStats.mock.lastCall?.[0]);
    expect(mockedLogs.mock.lastCall?.[0]?.endExclusive).toBe(mockedStats.mock.lastCall?.[1]);
    expect(mockedLogs.mock.lastCall?.[1]).toEqual({ signal: expect.any(AbortSignal) });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Go to page' })).toHaveValue(String(last + 1)));
    expect(screen.queryByText(/Showing 76[–-]5/)).not.toBeInTheDocument();
  });

  it('waits for the requested-page response before reconciling instead of clamping an unknown total', async () => {
    let resolveFirst: ((data: APICallLogResponse) => void) | undefined;
    mockedLogs.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { router } = renderPage('/api-logs?page=3&method=GET');
    expect(mockedLogs.mock.lastCall?.[0]?.offset).toBe(75);
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
    await act(async () => { resolveFirst?.(response(5, 75)); });
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]?.offset).toBe(0));
    expect(await screen.findByText('/phase6-evidence')).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get('method')).toBe('GET');
  });

  it.each([null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('does not clamp a malformed total %s to a fabricated zero', async (total) => {
    const data = response();
    Reflect.set(data, 'total', total);
    mockedLogs.mockResolvedValue(data);
    const { router } = renderPage('/api-logs?page=3');
    await screen.findByText('/phase6-evidence');
    expect(mockedLogs).toHaveBeenCalledOnce();
    expect(mockedLogs.mock.lastCall?.[0]?.offset).toBe(75);
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
    expect(screen.queryByText('0 total')).not.toBeInTheDocument();
  });

  it('reconciles a shrinking dataset after a successful refresh and retains filter/size interactions', async () => {
    mockedLogs.mockResolvedValueOnce(response(100, 75));
    const { client, router } = renderPage('/api-logs?page=3&method=POST');
    await screen.findByText('/phase6-evidence');
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
    await act(async () => { await client.invalidateQueries({ queryKey: ['api-logs'] }); });
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]?.offset).toBe(0));
    expect(new URLSearchParams(router.state.location.search).get('method')).toBe('POST');
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '50' } });
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      offset: 0, limit: 50, method: 'POST',
    })));
  });

  it('does not use a paused retained total to rewrite the requested URL or erase independent evidence', async () => {
    onlineManager.setOnline(false);
    const { client, router } = renderPage('/api-logs?page=3', true, (client) => {
      client.setQueryData(adminKeys.systemErrorStats, backend);
      client.setQueryData(adminKeys.webErrorsSummary, browser);
    });
    // The logs/stats queries are keyed by the page's resolved range window,
    // so their retained payloads must land on the live keys (the mount fetch
    // is paused offline, which keeps the retained total stale, not trusted).
    const liveLogsKey = client.getQueryCache()
      .find({ predicate: (query) => query.queryKey[0] === 'api-logs' })?.queryKey;
    const liveStatsKey = client.getQueryCache()
      .find({ predicate: (query) => query.queryKey[0] === 'api-log-stats' })?.queryKey;
    expect(liveLogsKey).toBeDefined();
    expect(liveStatsKey).toBeDefined();
    await act(async () => {
      client.setQueryData(liveLogsKey!, response(5, 75));
      client.setQueryData(liveStatsKey!, stats);
      await client.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'api-logs' });
    });
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
    expect(mockedLogs).not.toHaveBeenCalled();
    expect(screen.getByText('No backend runtime errors in this process.')).toBeInTheDocument();
    expect(screen.getByText('No browser error reports received in this window.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Tesla API/, pressed: false })).toBeInTheDocument();
    expect(within(card('Frontend error reports')).queryByText('Refresh paused', { exact: true })).not.toBeInTheDocument();
    expect(within(card('Frontend error reports')).getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('does not reconcile against placeholder totals while the requested page is unresolved', () => {
    mockedLogs.mockReturnValue(new Promise(() => {}));
    const { router } = renderPage('/api-logs?page=3', true, (client) => {
      client.setQueryDefaults(['api-logs'], { placeholderData: response(5, 75) });
    });
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
    expect(mockedLogs.mock.lastCall?.[0]?.offset).toBe(75);
  });

  it('waits for refresh confirmation and does not reconcile a retained total after refresh failure', async () => {
    // Hold the mount fetch open so the retained total lands on the live
    // range-keyed query before the refresh failure resolves against it.
    let rejectMount!: (reason: unknown) => void;
    mockedLogs.mockImplementationOnce(
      () => new Promise<APICallLogResponse>((_, reject) => { rejectMount = reject; }),
    );
    mockedLogs.mockRejectedValue(new Error('requested-page refresh failed'));
    const { client, router } = renderPage('/api-logs?page=3');
    await waitFor(() => expect(mockedLogs).toHaveBeenCalled());
    const liveLogsKey = client.getQueryCache()
      .find({ predicate: (query) => query.queryKey[0] === 'api-logs' })?.queryKey;
    expect(liveLogsKey).toBeDefined();
    await act(async () => {
      client.setQueryData(liveLogsKey!, response(5, 75));
      rejectMount(new Error('requested-page refresh failed'));
    });
    await waitFor(() => expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument());
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('3');
    expect(mockedLogs.mock.lastCall?.[0]?.offset).toBe(75);
    expect(screen.queryByText(/Showing 76[–-]5/)).not.toBeInTheDocument();
  });
});
