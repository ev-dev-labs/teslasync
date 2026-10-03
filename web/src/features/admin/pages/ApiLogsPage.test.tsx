/**
 * ApiLogsPage contract tests.
 *
 * The page is the admin "API Call Log" viewer: a KPI band (total calls,
 * error rate, avg duration, last-24h), a "By Service" quick-pick rail, a
 * server-owned column-header filters, and a paginated, expandable
 * log table with a consistent CSV / JSON export menu.
 *
 * These tests exercise the page's real branches end-to-end (no smoke render):
 *   1. Loading  — both queries pending → no data rows, both fetchers fired.
 *   2. Populated — KPIs, service rail (incl. fallback label), and rows render;
 *      every `statusBadgeVariant` branch (2xx/3xx/4xx/5xx/null) is present.
 *   3. Expand   — a row toggles `aria-expanded`, reveals Request URL + pretty
 *      JSON (both the valid-JSON and non-JSON `JsonViewer` branches) and a
 *      per-body Copy affordance; the error branch renders its own panel.
 *   4. Empty    — explicit EmptyState + disabled Export.
 *   5. Logs error / Stats error — each surfaces its own <QueryError> without
 *      lying in the KPI band.
 *   6. Filters  — method select + service chip write snake_case query params;
 *      the URL round-trips into a re-fetch. Clear resets them.
 *   7. Export   — creates + revokes an object URL and attaches a real
 *      <a download> to the DOM (the Firefox-safe path).
 *   8. Pagination is integrated in the grid, including single-page results.
 *
 * Network is faked at `@/api/devtools`; react-i18next is stubbed to return
 * fallback strings with {{var}} interpolation. Nothing hits real fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      // Form: t('key', 'Fallback {{x}}', { x })
      if (typeof fallbackOrOpts === 'string') {
        let s = fallbackOrOpts;
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          s = s.replace(/{{(\w+)}}/g, (_, name) => (name in o ? String(o[name]) : `{{${name}}}`));
        }
        return s;
      }
      // Form: t('key', { defaultValue: '...', ...vars })
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') {
          return o.defaultValue.replace(/{{(\w+)}}/g, (_, name) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/devtools', async () => {
  const actual = await vi.importActual<typeof import('@/api/devtools')>('@/api/devtools');
  return {
    ...actual,
    getAPICallLogs: vi.fn(),
    getAPICallLogStats: vi.fn(),
    getErrorStats: vi.fn(),
  };
});

vi.mock('@/api/hooks/useAdmin', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useAdmin')>('@/api/hooks/useAdmin'),
  useWebErrorsSummary: () => ({ data: { total: 0, top: [] }, isLoading: false }),
}));

import { getAPICallLogs, getAPICallLogStats, getErrorStats } from '@/api/devtools';
import { ToastProvider } from '@/components/feedback';
import ApiLogsPage from './ApiLogsPage';
import type { APICallLog, APICallLogResponse, APICallLogStats } from '@/api/types';
import * as exportHelpers from '@/lib/export';
import { BADGE_VARIANTS } from '@/components/ui';

const mockedLogs = vi.mocked(getAPICallLogs);
const mockedStats = vi.mocked(getAPICallLogStats);
const mockedRuntime = vi.mocked(getErrorStats);

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeLog(overrides: Partial<APICallLog> = {}): APICallLog {
  return {
    id: 1,
    ts: '2026-01-02T03:04:05Z',
    vehicle_id: 1,
    service: 'tesla-api',
    http_method: 'GET',
    endpoint: '/vehicles',
    status_code: 200,
    duration_ms: 12,
    error_message: null,
    rate_limited: false,
    request_body: null,
    response_body: '{"ok":true}',
    request_headers: { 'Content-Type': 'application/json', Authorization: 'REDACTED' },
    response_headers: { 'Content-Type': 'application/json' },
    ...overrides,
  };
}

// One row per statusBadgeVariant branch: 200→success, 301→info, 404→warning,
// 500→danger, null→neutral ("N/A").
const LOGS: APICallLog[] = [
  makeLog({ id: 1, http_method: 'GET', endpoint: '/vehicles', status_code: 200, duration_ms: 12, service: 'tesla-api', response_body: '{"ok":true}' }),
  makeLog({ id: 2, http_method: 'POST', endpoint: '/geo/lookup', status_code: 500, duration_ms: 34, service: 'geocoder-google', error_message: 'boom upstream', request_body: '{"a":1}', response_body: null }),
  makeLog({ id: 3, http_method: 'DELETE', endpoint: '/charging/5', status_code: null, duration_ms: 7, service: 'mystery-svc', request_body: 'not-json{', response_body: 'plain text body' }),
  makeLog({ id: 4, http_method: 'PUT', endpoint: '/drives/9', status_code: 301, duration_ms: 20, service: 'teslasync-api', response_body: null }),
  makeLog({ id: 5, http_method: 'GET', endpoint: '/alerts', status_code: 404, duration_ms: 5, service: 'notify-generic', response_body: null }),
];

function makeLogsResponse(overrides: Partial<APICallLogResponse> = {}): APICallLogResponse {
  return { data: LOGS, total: LOGS.length, limit: 25, offset: 0, ...overrides };
}

function makeStats(overrides: Partial<APICallLogStats> = {}): APICallLogStats {
  return {
    total_calls: 1234,
    by_method: { GET: 1000, POST: 234 },
    by_service: { 'tesla-api': 900, 'geocoder-google': 300, 'mystery-svc': 34 },
    error_rate: 6.5,
    error_count: 80,
    avg_duration_ms: 145,
    last_24h: 56,
    ...overrides,
  };
}

function UrlProbe() {
  const location = useLocation();
  return <output data-testid="api-log-url">{location.search}</output>;
}

function renderPage(route = '/api-logs') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{
    path: '/api-logs',
    element: (
        <ToastProvider>
          <ApiLogsPage />
          <UrlProbe />
        </ToastProvider>
    ),
  }], { initialEntries: [route] });
  return { ...render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  ), router };
}

/**
 * The "By Service" quick-pick chips share their label with the log rows
 * (both go through `serviceBadgeConfig`). Only the rail chips expose
 * `aria-pressed`, so filter on it to disambiguate from a row button that
 * happens to carry the same service badge.
 */
function railChip(name: RegExp): HTMLElement {
  const chip = screen
    .getAllByRole('button', { name })
    .find((b) => b.hasAttribute('aria-pressed'));
  if (!chip) throw new Error(`no By Service chip matching ${name}`);
  return chip;
}

async function requestRow(endpoint: string) {
  const cell = await screen.findByText(endpoint);
  const row = cell.closest('tr');
  if (!row) throw new Error(`Missing evidence row for ${endpoint}`);
  return row;
}

function expansionButton(row: HTMLElement) {
  return within(row).getByRole('button', { name: /^(Expand|Collapse) row$/ });
}

function filterControl(label: string) {
  const openFilter = screen.queryByRole('dialog', { name: / filter$/ });
  if (openFilter) fireEvent.click(within(openFilter).getByRole('button', { name: 'Done' }));
  if (!screen.queryByRole('button', { name: `${label} filter` })) {
    const menu = screen.getByRole('button', { name: 'Reorder or hide columns' });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('checkbox', { name: `Show or hide ${label}` }));
    fireEvent.click(menu);
  }
  fireEvent.click(screen.getByRole('button', { name: `${label} filter` }));
  return within(screen.getByRole('dialog', { name: `${label} filter` })).getByLabelText(label);
}

beforeEach(() => {
  localStorage.removeItem('teslasync.table.admin:api-logs.columns');
  localStorage.removeItem('teslasync.table.admin:api-logs.visible');
  mockedLogs.mockReset();
  mockedStats.mockReset();
  mockedRuntime.mockReset();
  mockedRuntime.mockResolvedValue({ total_errors: 0, uptime: '2h', by_code: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ApiLogsPage', () => {
  it('labels the independent scopes and shows backend and browser summaries alongside outbound calls', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());
    mockedRuntime.mockResolvedValue({
      total_errors: 3,
      uptime: '2h',
      by_code: { TIMEOUT: { count: 3, last_seen: '2026-01-02T03:04:05Z', last_message: 'upstream timeout' } },
    });
    renderPage('/api-logs?status=5xx');
    expect(await screen.findByText('3 errors · uptime 2h')).toBeInTheDocument();
    expect(screen.getByText('upstream timeout')).toBeInTheDocument();
    expect(screen.getByText(/API call totals and service counts use the View settings range/)).toBeInTheDocument();
    expect(screen.getByText(/Since the current API process started/)).toBeInTheDocument();
    expect(screen.getByText('Frontend errors (last hour)')).toBeInTheDocument();
    expect(mockedRuntime).toHaveBeenCalledTimes(1);
  });

  it('scopes service totals and request rows to the same exclusive header window', async () => {
    mockedStats.mockResolvedValue(makeStats({ by_service: { 'notify-generic': 12 } }));
    mockedLogs.mockResolvedValue(makeLogsResponse());
    renderPage('/api-logs?service=notify-generic&from=2026-09-19&to=2026-09-25');

    await waitFor(() => expect(railChip(/Notifications/)).toHaveTextContent('12'));
    const start = new Date('2026-09-19T00:00:00').toISOString();
    const endExclusive = new Date('2026-09-26T00:00:00').toISOString();
    expect(mockedStats).toHaveBeenCalledWith(start, endExclusive, { signal: expect.any(AbortSignal) });
    expect(mockedLogs).toHaveBeenCalledWith(expect.objectContaining({
      service: 'notify-generic', start, endExclusive,
    }), { signal: expect.any(AbortSignal) });
    expect(mockedLogs.mock.lastCall?.[0]).not.toHaveProperty('end');
  });

  it('preserves a precise rolling 24-hour header window for both queries', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());
    renderPage('/api-logs?time_scope=24h');
    await waitFor(() => expect(mockedStats).toHaveBeenCalled());
    const [start, end] = mockedStats.mock.lastCall ?? [];
    if (!start || !end) throw new Error('Missing rolling range bounds');
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(86_400_000);
    expect(mockedLogs).toHaveBeenCalledWith(expect.objectContaining({
      start, endExclusive: end,
    }), { signal: expect.any(AbortSignal) });
  });

  it('distinguishes a clean backend from a failed runtime-summary request', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({ data: [], total: 0 }));
    const page = renderPage();
    expect(await screen.findByText('No backend runtime errors in this process.')).toBeInTheDocument();
    page.unmount();

    mockedRuntime.mockRejectedValue(new Error('runtime summary offline'));
    renderPage();
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No backend runtime errors in this process.')).not.toBeInTheDocument();
  });

  it('fires both fetchers and shows no data rows while the queries are pending', () => {
    // Never-resolving promises keep both queries in the loading state.
    mockedStats.mockReturnValue(new Promise<APICallLogStats>(() => {}));
    mockedLogs.mockReturnValue(new Promise<APICallLogResponse>(() => {}));

    renderPage();

    // Page shell renders immediately.
    expect(screen.getByRole('heading', { name: 'API logs', level: 1 })).toBeInTheDocument();
    // Both data sources requested exactly once on mount.
    expect(mockedStats).toHaveBeenCalledTimes(1);
    expect(mockedLogs).toHaveBeenCalledTimes(1);
    // No resolved content yet — neither a row nor the empty state.
    expect(screen.queryByText('/vehicles')).not.toBeInTheDocument();
    expect(screen.queryByText('No API call logs')).not.toBeInTheDocument();
  });

  it('renders KPIs, the service rail (with fallback label), and every status badge branch', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    renderPage();

    // KPI band — formatted with the default en-US / precision-2 formatters.
    await waitFor(() => expect(screen.getByText('1,234')).toBeInTheDocument());
    expect(screen.getByText('Total calls')).toBeInTheDocument();
    expect(screen.getByText('6.50%')).toBeInTheDocument(); // error_rate
    expect(screen.getByText('145ms')).toBeInTheDocument(); // avg_duration_ms
    expect(screen.getByText('56')).toBeInTheDocument(); // last_24h

    // Service rail: known label + count, and the unknown service falls back
    // to its raw key (serviceBadgeConfig default branch). Scope to the rail
    // chips (aria-pressed) so we don't collide with the row badges.
    expect(railChip(/Tesla API/)).toBeInTheDocument();
    expect(railChip(/mystery-svc/)).toBeInTheDocument();

    // Rows: all five endpoints render.
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
    expect(screen.getByText('/geo/lookup')).toBeInTheDocument();
    expect(screen.getByText('/charging/5')).toBeInTheDocument();

    // statusBadgeVariant branches: numeric codes + the null → "N/A" branch.
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('301')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('N/A')).toBeInTheDocument();
  });

  it('shows verified app key and installation separately and filters full server results', async () => {
    const id = 'android:550e8400-e29b-41d4-a716-446655440000';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({
      data: [makeLog({
        id: 77, service: 'teslasync-api',
        request_headers: {
          'App-Key-ID': '42',
          'App-Key-Name': 'Living room tablet',
          'X-Teslasync-App': id,
          Authorization: 'REDACTED',
        },
      })],
      total: 1,
    }));
    renderPage();
    const row = await requestRow('/vehicles');
    expect(row).toHaveTextContent('42');
    expect(row).toHaveTextContent('android');
    expect(row).toHaveTextContent('550e8400');
    fireEvent.click(expansionButton(row));
    expect(screen.getByText(`App installation: ${id}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy app installation ID' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy app installation ID' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(id));
    fireEvent.change(filterControl('App key'), { target: { value: 'Living room' } });
    await waitFor(() => expect(mockedLogs).toHaveBeenCalledWith(expect.objectContaining({ key: 'Living room' }), { signal: expect.any(AbortSignal) }));
    fireEvent.change(filterControl('App installation'), { target: { value: 'android' } });
    await waitFor(() => expect(mockedLogs).toHaveBeenCalledWith(expect.objectContaining({ client: 'android', key: 'Living room' }), { signal: expect.any(AbortSignal) }));
  });

  it('does not treat a client installation header without verified key metadata as trusted', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({
      data: [makeLog({ request_headers: { 'X-Teslasync-App': 'android:550e8400-e29b-41d4-a716-446655440000' } })],
      total: 1,
    }));
    renderPage();
    const row = await requestRow('/vehicles');
    expect(row).not.toHaveTextContent('android');
    fireEvent.click(expansionButton(row));
    expect(screen.queryByText(/App installation:/)).not.toBeInTheDocument();
  });

  it('expands a row: toggles aria-expanded and reveals pretty JSON + a Copy affordance', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    renderPage();

    const row = expansionButton(await requestRow('/vehicles'));
    expect(row).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');

    // Request URL header + method/endpoint echoed into the detail surface.
    expect(screen.getByText('Request URL')).toBeInTheDocument();
    // Response body was compact ('{"ok":true}') → JsonViewer re-indents it.
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
    // Null request body → the explicit "No request body" branch.
    expect(screen.getByText('No request body')).toBeInTheDocument();
    // Per-body copy affordance carries an accessible label.
    expect(screen.getByRole('button', { name: 'Copy Response body' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Request headers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Response headers' })).toBeInTheDocument();
    expect(screen.getByText(/Bodies are recorded only when API_LOG_CAPTURE_BODIES/)).toBeInTheDocument();
    expect(screen.getByText('Rate limited: No')).toBeInTheDocument();

    // Collapsing hides the detail again.
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Request URL')).not.toBeInTheDocument();
  });

  it('expanded error row shows the error panel, and non-JSON bodies fall back to raw text', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    renderPage();

    // Row 2 (500 / geocoder-google) carries an error_message + JSON request body.
    const errorRow = expansionButton(await requestRow('/geo/lookup'));
    fireEvent.click(errorRow);
    expect(screen.getAllByText('Error').length).toBeGreaterThan(0);
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument(); // request body re-indented
    fireEvent.click(errorRow);

    // Row 3 has an unparseable request body + plain-text response — both must
    // render verbatim (the JsonViewer catch branch).
    const rawRow = expansionButton(await requestRow('/charging/5'));
    fireEvent.click(rawRow);
    expect(screen.getByText('not-json{')).toBeInTheDocument();
    expect(screen.getByText('plain text body')).toBeInTheDocument();
  });

  it('renders an explicit empty state and disables Export when there are no logs', async () => {
    mockedStats.mockResolvedValue(makeStats({ by_service: {} }));
    mockedLogs.mockResolvedValue(makeLogsResponse({ data: [], total: 0 }));

    renderPage();

    await waitFor(() => expect(screen.getByText('No API call logs')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'No data to export' })).toBeDisabled();
    // Service rail shows its own empty copy, not a spinner.
    expect(screen.getByText('No service activity yet')).toBeInTheDocument();
  });

  it('surfaces a QueryError for the log table without corrupting the KPI band', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockRejectedValue(new Error('logs exploded'));

    renderPage();

    // The log table renders the shared network-error state.
    await waitFor(() => expect(screen.getByText("Can't reach server")).toBeInTheDocument());
    // KPIs still render truthfully from the (successful) stats query.
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('surfaces a QueryError in the service rail and shows KPI placeholders when stats fail', async () => {
    mockedStats.mockRejectedValue(new Error('stats exploded'));
    mockedLogs.mockResolvedValue(makeLogsResponse());

    renderPage();

    // Service rail shows the error; KPI band shows the "—" placeholder rather
    // than a fabricated 0.
    await waitFor(() => expect(screen.getByText("Can't reach server")).toBeInTheDocument());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Rows still render from the healthy logs query.
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
  });

  it('writes snake_case query params when the method filter changes', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    renderPage();

    await screen.findByText('/vehicles');
    fireEvent.change(filterControl('Method'), { target: { value: 'POST' } });

    await waitFor(() =>
      expect(mockedLogs.mock.calls.some(([p]) => p?.method === 'POST')).toBe(true),
    );
    // The initial fetch must have been param-free (method undefined).
    expect(mockedLogs.mock.calls[0][0].method).toBeUndefined();
  });

  it('service quick-pick chip toggles aria-pressed and filters by service key', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    renderPage();

    // Wait for stats to resolve (drives both the KPI band and the rail).
    await screen.findByText('1,234');
    const chip = railChip(/Geocoder \(Google\)/);
    expect(chip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(chip);

    await waitFor(() =>
      expect(mockedLogs.mock.calls.some(([p]) => p?.service === 'geocoder-google')).toBe(true),
    );
    expect(railChip(/Geocoder \(Google\)/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('enables the table reset only when a filter is active and resets to an unfiltered fetch', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    // Start with a method filter already applied via the URL.
    renderPage('/api-logs?method=GET');

    await screen.findByText('/vehicles');
    // Initial fetch honored the URL param.
    expect(mockedLogs.mock.calls[0][0].method).toBe('GET');

    const clear = screen.getByRole('button', { name: /Clear/ });
    fireEvent.click(clear);

    await waitFor(() => {
      const last = mockedLogs.mock.calls[mockedLogs.mock.calls.length - 1][0];
      expect(last.method).toBeUndefined();
    });
    expect(screen.getByRole('button', { name: /Clear/ })).toBeDisabled();
  });

  it('offers CSV and JSON and exports the current page via a DOM-attached anchor', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    const createObjectURL = vi.fn(() => 'blob:api-logs');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderPage();

    // Export is only enabled once the current page of logs has loaded.
    await screen.findByText('/vehicles');
    const exportBtn = screen.getByRole('button', { name: 'Export list' });
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);
    expect(screen.getByRole('menuitem', { name: 'Download as CSV' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:api-logs');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // The Firefox-safe path: a real <a download> was attached to the DOM…
    const attached = appendSpy.mock.calls
      .map((c) => c[0])
      .find(
        (n): n is HTMLAnchorElement =>
          n instanceof HTMLAnchorElement && n.download.startsWith('teslasync-api-logs-'),
      );
    expect(attached).toBeTruthy();
    // …and removed again after the click (not left dangling in the document).
    expect(document.body.contains(attached!)).toBe(false);
  });

  it('keeps pagination inside the grid for both single and multiple pages', async () => {
    mockedStats.mockResolvedValue(makeStats());

    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 5 }));
    const { unmount } = renderPage();
    await screen.findByText('/vehicles');
    const table = screen.getByRole('table', { name: 'API call log' });
    const frame = table.closest('[data-grid-frame]');
    const footer = frame?.querySelector('[data-grid-footer]');
    expect(footer).toContainElement(screen.getByRole('navigation', { name: 'Pagination' }));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Go to page' })).toHaveValue('1');
    unmount();

    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 200 }));
    renderPage();
    await screen.findAllByText('/vehicles');
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument(),
    );
  });

  it('changes row size on the server and resets the offset without dropping filters', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 200 }));
    renderPage('/api-logs?page=2&method=POST');
    await screen.findByText('/vehicles');
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '50' } });
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      limit: 50, offset: 0, method: 'POST',
    })));
    expect(screen.getByRole('textbox', { name: 'Go to page' })).toHaveValue('1');
  });

  it('renders a compact responsive evidence table with persistent column controls, not card buttons', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());
    renderPage();
    const row = await requestRow('/vehicles');
    const table = screen.getByRole('table', { name: 'API call log' });
    expect(table).toContainElement(row);
    const headers = within(table).getAllByRole('columnheader');
    const header = (name: string) => {
      const found = headers.find((element) => element.textContent?.includes(name));
      if (!found) throw new Error(`Missing column ${name}`);
      return found;
    };
    expect(header('Time')).toHaveClass('hidden', 'md:table-cell');
    expect(header('Method')).not.toHaveClass('hidden');
    expect(header('Endpoint')).not.toHaveClass('hidden');
    expect(header('Endpoint')).toHaveClass('max-md:!min-w-0');
    expect(header('Status')).not.toHaveClass('hidden');
    expect(header('Service')).not.toHaveClass('hidden');
    expect(header('App installation')).not.toHaveClass('hidden');
    expect(screen.queryByRole('group', { name: 'Filters' })).not.toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: / filter$/ })).toHaveLength(5);
    expect(within(table).queryByRole('columnheader', { name: 'App key' })).not.toBeInTheDocument();
    expect(header('Latency (ms)')).toHaveClass('text-right');
    expect(within(row).getAllByText('GET')).toHaveLength(2); // dedicated desktop cell + phone summary
    expect(expansionButton(row)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /GET.*\/vehicles/ })).not.toBeInTheDocument();
    expect(screen.getByText(/exports include only this loaded page/)).toBeInTheDocument();
    const resizer = within(table).getByRole('separator', { name: 'Resize column Latency (ms)' });
    const width = Number(resizer.getAttribute('aria-valuenow'));
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(resizer).toHaveAttribute('aria-valuenow', String(width + 8));
    fireEvent.click(screen.getByRole('button', { name: 'Reorder or hide columns' }));
    expect(screen.getByRole('checkbox', { name: 'Show or hide Latency (ms)' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Move Latency (ms) up' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Latency (ms) up' }));
    const reordered = within(table).getAllByRole('columnheader').map((element) => element.getAttribute('aria-label'));
    expect(reordered.indexOf('Latency (ms)')).toBeLessThan(reordered.indexOf('Service'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show or hide Latency (ms)' }));
    expect(within(table).queryByRole('columnheader', { name: /Latency/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('datatable-column-menu-reset'));
    expect(within(table).getByRole('columnheader', { name: /Latency/ })).toBeInTheDocument();
  });

  it.each([
    ['Method', 'method', 'PATCH'],
    ['Status', 'status', '5xx'],
    ['Endpoint', 'endpoint', '/debug'],
    ['Service', 'service', 'tesla-api'],
    ['App installation', 'client', 'android'],
    ['App key', 'key', 'tablet'],
  ])('resets the server offset atomically when %s changes', async (label, predicate, value) => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 200 }));
    renderPage('/api-logs?page=3&method=GET&status=4xx&endpoint=/old&service=notify-generic&client=desktop&key=old-key');
    await requestRow('/vehicles');
    expect(mockedLogs.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      limit: 25, offset: 75, method: 'GET', status: '4xx', endpoint: '/old',
      service: 'notify-generic', client: 'desktop', key: 'old-key',
    }));
    fireEvent.change(filterControl(label), { target: { value } });
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      [predicate]: value, offset: 0, limit: 25,
    })));
    const url = new URLSearchParams(screen.getByTestId('api-log-url').textContent ?? '');
    expect(url.get(predicate)).toBe(value);
    expect(url.has('page')).toBe(false);
    expect(screen.getByRole('button', { name: `${label} filter` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('dialog', { name: `${label} filter` })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog', { name: `${label} filter` })).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      [predicate]: undefined, offset: 0,
    })));
    expect(screen.getByRole('button', { name: `${label} filter` })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps header popovers editable during pending server filters and restores the matching cached requests', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValueOnce(makeLogsResponse({ total: 200 }));
    mockedLogs.mockImplementation(() => new Promise(() => undefined));
    renderPage();
    const row = await requestRow('/vehicles');
    fireEvent.click(expansionButton(row));
    fireEvent.change(filterControl('Endpoint'), { target: { value: '/not-on-this-page' } });
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      endpoint: '/not-on-this-page', offset: 0,
    })));
    expect(screen.getByRole('dialog', { name: 'Endpoint filter' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Endpoint filter' })).getByLabelText('Endpoint')).toHaveValue('/not-on-this-page');
    expect(screen.getByRole('button', { name: 'Endpoint filter' })).toHaveAttribute('aria-pressed', 'true');
    const pendingSignal = mockedLogs.mock.lastCall?.[1]?.signal;
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Endpoint filter' })).getByRole('button', { name: 'Clear' }));
    expect(pendingSignal?.aborted).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Endpoint filter' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Endpoint filter' })).getByLabelText('Endpoint')).toHaveValue('');
    expect(await requestRow('/vehicles')).toBeInTheDocument();
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
  });

  it('keeps column filters and clear-all available when a server filter returns no requests', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({ data: [], total: 0 }));
    renderPage('/api-logs?method=PATCH&key=missing');
    await screen.findByText('No API call logs');
    expect(screen.getByRole('table', { name: 'API call log' })).toBeInTheDocument();
    expect(filterControl('App key')).toHaveValue('missing');
    expect(screen.getByRole('button', { name: 'App key filter' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(screen.getByRole('dialog', { name: 'App key filter' })).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      method: undefined, key: undefined, offset: 0,
    })));
    expect(screen.getByRole('button', { name: 'Method filter' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('retains requests, open inspection, KPIs and runtime data after a failed refresh', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());
    mockedRuntime.mockResolvedValue({ total_errors: 3, uptime: '2h', by_code: {} });
    renderPage();
    const row = await requestRow('/vehicles');
    fireEvent.click(expansionButton(row));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    mockedLogs.mockRejectedValue(new Error('refresh offline'));
    mockedStats.mockRejectedValue(new Error('stats refresh offline'));
    mockedRuntime.mockRejectedValue(new Error('runtime refresh offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3));
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('3 errors · uptime 2h')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled();
  });

  it('keeps unknown latency distinct from zero, and preserves a zero status without success styling', async () => {
    mockedStats.mockResolvedValue(makeStats());
    const missingDuration = makeLog({ id: 20, endpoint: '/unknown', status_code: null });
    // Exercise a missing runtime field without weakening the production API type.
    Reflect.set(missingDuration, 'duration_ms', null);
    mockedLogs.mockResolvedValue(makeLogsResponse({
      data: [
        missingDuration,
        makeLog({ id: 21, endpoint: '/zero', duration_ms: 0, status_code: 0, rate_limited: true }),
      ],
      total: 2,
    }));
    renderPage();
    const unknown = await requestRow('/unknown');
    const zero = await requestRow('/zero');
    expect(within(unknown).queryByText('0ms')).not.toBeInTheDocument();
    expect(within(unknown).getByText('N/A')).toBeInTheDocument();
    expect(within(zero).getByText('0ms')).toBeInTheDocument();
    expect(within(zero).getByText('Rate limited')).toBeInTheDocument();
    const statusCell = zero.querySelector('[data-column-key="status"]');
    if (!statusCell) throw new Error('Missing HTTP status evidence');
    expect(within(statusCell).getByText('0')).toHaveClass(...BADGE_VARIANTS.neutral.split(' '));
    fireEvent.click(expansionButton(unknown));
    expect(screen.getByText('Duration: —')).toBeInTheDocument();
    fireEvent.click(expansionButton(zero));
    expect(screen.getByText('Duration: 0ms')).toBeInTheDocument();
    expect(screen.getByText('Status: 0')).toBeInTheDocument();
    expect(screen.getByText('Rate limited: Yes')).toBeInTheDocument();
    expect(screen.queryByText('Duration: —')).not.toBeInTheDocument(); // one inspection at a time
  });

  it('copies pretty JSON headers/body and raw bodies without altering diagnostic content', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());
    renderPage();
    fireEvent.click(expansionButton(await requestRow('/vehicles')));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Response body' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{\n  "ok": true\n}'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Request headers' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(LOGS[0].request_headers, null, 2)));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Response headers' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(LOGS[0].response_headers, null, 2)));
    fireEvent.click(screen.getByRole('button', { name: 'Copy request URL' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('GET /vehicles'));
    fireEvent.click(expansionButton(await requestRow('/charging/5')));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Request body' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('not-json{'));
  });

  it('exports only the loaded server page in both formats, including all diagnostic metadata', async () => {
    const csv = vi.spyOn(exportHelpers, 'exportAsCSV').mockImplementation(() => {});
    const json = vi.spyOn(exportHelpers, 'exportAsJSON').mockImplementation(() => {});
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 400, offset: 50 }));
    renderPage('/api-logs?page=2');
    await requestRow('/vehicles');
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    expect(csv).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({
        id: 1, request_headers: LOGS[0].request_headers,
        response_headers: LOGS[0].response_headers, duration_ms: 12,
        request_body: null, response_body: '{"ok":true}', app_key_id: '', app_installation: '',
      })]),
      expect.stringMatching(/\.csv$/),
    );
    expect(csv.mock.calls[0]?.[0]).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    expect(json).toHaveBeenCalledWith(LOGS, expect.stringMatching(/\.json$/));
    expect(mockedLogs).toHaveBeenCalledTimes(1); // export never pretends to fetch all 400
    expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({ limit: 25, offset: 50 }));
  });

  it('resets paging after header range navigation and sends exclusive bounds to both server queries', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 200 }));
    const { router } = renderPage('/api-logs?page=3&method=GET&from=2026-09-01&to=2026-09-02');
    await requestRow('/vehicles');
    await act(() => router.navigate('/api-logs?page=3&method=GET&from=2026-09-19&to=2026-09-25'));
    const start = new Date('2026-09-19T00:00:00').toISOString();
    const endExclusive = new Date('2026-09-26T00:00:00').toISOString();
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      method: 'GET', offset: 0, start, endExclusive,
    })));
    expect(mockedStats).toHaveBeenLastCalledWith(start, endExclusive, { signal: expect.any(AbortSignal) });
    expect(new URLSearchParams(router.state.location.search).has('page')).toBe(false);
  });

  it('pages on the server without dropping filters and clears all predicates in one URL write', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 200 }));
    renderPage('/api-logs?method=POST&status=5xx&endpoint=/debug&service=tesla-api&client=android&key=tablet');
    await requestRow('/vehicles');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      offset: 25, method: 'POST', status: '5xx', endpoint: '/debug',
      service: 'tesla-api', client: 'android', key: 'tablet',
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(mockedLogs.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      offset: 0, method: undefined, status: undefined, endpoint: undefined,
      service: undefined, client: undefined, key: undefined,
    })));
    const url = new URLSearchParams(screen.getByTestId('api-log-url').textContent ?? '');
    for (const name of ['page', 'method', 'status', 'endpoint', 'service', 'client', 'key']) {
      expect(url.has(name)).toBe(false);
    }
  });
});
