/**
 * ApiLogsPage contract tests.
 *
 * The page is the admin "API Call Log" viewer: a KPI band (total calls,
 * error rate, avg duration, last-24h), a "By Service" quick-pick rail, a
 * filter panel (service/method/status/endpoint), and a paginated, expandable
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
 *   8. Pagination renders only when total exceeds the page size.
 *
 * Network is faked at `@/api/devtools`; react-i18next is stubbed to return
 * fallback strings with {{var}} interpolation. Nothing hits real fetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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
  };
});

import { getAPICallLogs, getAPICallLogStats } from '@/api/devtools';
import { ToastProvider } from '@/components/feedback/Toast';
import ApiLogsPage from './ApiLogsPage';
import type { APICallLog, APICallLogResponse, APICallLogStats } from '@/api/types';

const mockedLogs = getAPICallLogs as unknown as Mock;
const mockedStats = getAPICallLogStats as unknown as Mock;

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

function renderPage(route = '/api-logs') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <ApiLogsPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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

beforeEach(() => {
  mockedLogs.mockReset();
  mockedStats.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('ApiLogsPage', () => {
  it('fires both fetchers and shows no data rows while the queries are pending', () => {
    // Never-resolving promises keep both queries in the loading state.
    mockedStats.mockReturnValue(new Promise<APICallLogStats>(() => {}));
    mockedLogs.mockReturnValue(new Promise<APICallLogResponse>(() => {}));

    renderPage();

    // Page shell renders immediately.
    expect(screen.getByRole('heading', { name: 'API Logs', level: 1 })).toBeInTheDocument();
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
    expect(screen.getByText('Total Calls')).toBeInTheDocument();
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

  it('expands a row: toggles aria-expanded and reveals pretty JSON + a Copy affordance', async () => {
    mockedStats.mockResolvedValue(makeStats());
    mockedLogs.mockResolvedValue(makeLogsResponse());

    renderPage();

    const row = await screen.findByRole('button', { name: /\/vehicles/ });
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
    expect(screen.getByRole('button', { name: 'Copy Response Body' })).toBeInTheDocument();

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
    const errorRow = await screen.findByRole('button', { name: /\/geo\/lookup/ });
    fireEvent.click(errorRow);
    expect(screen.getByText('Error')).toBeInTheDocument(); // uppercase error label
    expect(screen.getByText(/"a": 1/)).toBeInTheDocument(); // request body re-indented
    fireEvent.click(errorRow);

    // Row 3 has an unparseable request body + plain-text response — both must
    // render verbatim (the JsonViewer catch branch).
    const rawRow = await screen.findByRole('button', { name: /\/charging\/5/ });
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
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });

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

  it('shows Clear only when a filter is active and resets it to an unfiltered fetch', async () => {
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
    // Clear disappears once no filters remain.
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
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

  it('renders pagination only when the total exceeds the page size', async () => {
    mockedStats.mockResolvedValue(makeStats());

    // total <= limit → no pagination.
    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 5 }));
    const { unmount } = renderPage();
    await screen.findByText('/vehicles');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
    unmount();

    // total > limit → pagination nav appears.
    mockedLogs.mockResolvedValue(makeLogsResponse({ total: 200 }));
    renderPage();
    await screen.findAllByText('/vehicles');
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument(),
    );
  });
});
