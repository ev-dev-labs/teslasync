/**
 * FleetAPIPage contract tests.
 *
 * The page fans four settings queries (settings, polling-config, capture-stats,
 * version) plus two mutations (suspend-api, update-polling-config) across a
 * KPI band, a master API power switch, a telemetry-capture panel, a full
 * endpoint-toggle grid, and a configured-endpoints detail band. These tests
 * exercise every branch and interaction:
 *
 *   1. Loading  — skeletons render; no KPI values and no switches are shown.
 *   2. Loaded   — truthful KPIs, named endpoint switches, retention select,
 *                 captured-signal summary, and configured endpoints.
 *   3. Suspended — the paused status + unchecked master switch + danger note.
 *   4. Suspend  — clicking the master switch POSTs /settings/suspend-api.
 *   5. Endpoint — clicking a toggle PUTs /settings/polling-config with the
 *                 flipped flag.
 *   6. Retention — changing the select PUTs the new retention value.
 *   7. Error    — when ONLY /settings fails, the API-status KPI degrades to an
 *                 em-dash (regression guard: it must not fabricate "Active"),
 *                 the master switch panel surfaces <QueryError>, and the other
 *                 KPIs stay truthful because their sources resolved.
 *   8. Degraded — MongoDB off hides the retention select and shows the
 *                 "not configured" badge; an empty version payload shows the
 *                 configured-endpoints empty state; a known 0 stays a truthful 0.
 *   9. a11y     — the KPI region is labelled and every switch + the retention
 *                 combobox has an accessible name (regression guard for the
 *                 Toggle aria-label routing fix).
 *
 * Network is driven entirely through the mocked `@/api/client` `request`
 * (the same seam APIKeysPage / DevToolsPage use) so nothing touches the real
 * network. `isApiError` is preserved from the real module so <QueryError>
 * falls to its generic network branch for a plain Error.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

// jsdom lacks matchMedia; framer-motion (via <FadeIn> / <ToastProvider>) reads
// it. Guarded polyfill keeps the render deterministic.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import FleetAPIPage from './FleetAPIPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

interface ReqOpts {
  method?: string;
  body?: string;
}

// Every boolean polling key the tally counts (mirrors ALL_ENDPOINT_KEYS in the
// page). telemetry_capture_retention_days is a number and is excluded.
const POLLING_BOOL_KEYS = [
  'vehicle_discovery', 'charge_state', 'climate_state', 'drive_state',
  'location_data', 'vehicle_state', 'vehicle_config',
  'on_demand_vehicle_discovery', 'on_demand_charge_state', 'on_demand_climate_state',
  'on_demand_drive_state', 'on_demand_location_data', 'on_demand_vehicle_state',
  'on_demand_vehicle_config', 'nearby_charging_sites', 'release_notes',
  'recent_alerts', 'service_data', 'wake_up', 'commands', 'telemetry_capture',
];

const DEFAULT_ENDPOINTS = {
  api: 'http://api.internal:8080',
  web: 'http://web.local',
  oauth_callback: 'http://oauth.local/callback',
  tesla_api: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
};

function makeSettings(overrides: Record<string, unknown> = {}) {
  return { api_suspended: false, ...overrides };
}

function makePolling(overrides: Record<string, boolean | number> = {}) {
  const base: Record<string, boolean | number> = {};
  for (const k of POLLING_BOOL_KEYS) base[k] = false;
  base.telemetry_capture_retention_days = 7;
  return { ...base, ...overrides };
}

function makeCapture(overrides: Record<string, unknown> = {}) {
  return { mongodb_enabled: true, total_documents: 512, distinct_vins: ['VIN_A', 'VIN_B'], ...overrides };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return { chart_version: '2.4.0', go_version: 'go1.25', os: 'linux', arch: 'amd64', endpoints: { ...DEFAULT_ENDPOINTS }, ...overrides };
}

interface InstallCfg {
  settings?: unknown;
  polling?: unknown;
  capture?: unknown;
  version?: unknown;
  /** GET paths that should reject with a plain network Error. */
  rejectGet?: string[];
}

/** Route the single `request` mock by "METHOD path" so queries + mutations work. */
function installRequest(cfg: InstallCfg = {}) {
  const {
    settings = makeSettings(),
    polling = makePolling({ charge_state: true, drive_state: true, telemetry_capture: true }),
    capture = makeCapture(),
    version = makeVersion(),
    rejectGet = [],
  } = cfg;

  mockedRequest.mockImplementation((path: string, opts?: ReqOpts) => {
    const method = opts?.method ?? 'GET';
    if (method === 'GET' && rejectGet.includes(path)) {
      return Promise.reject(new Error('network down'));
    }
    switch (`${method} ${path}`) {
      case 'GET /settings': return Promise.resolve(settings);
      case 'GET /settings/polling-config': return Promise.resolve(polling);
      case 'GET /dev-tools/telemetry-capture/stats': return Promise.resolve(capture);
      case 'GET /system/version': return Promise.resolve(version);
      case 'POST /settings/suspend-api': return Promise.resolve({ api_suspended: true });
      case 'PUT /settings/polling-config': return Promise.resolve(polling);
      default: return Promise.reject(new Error(`unexpected ${method} ${path}`));
    }
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <FleetAPIPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const kpiRegion = () => screen.getByRole('region', { name: 'Fleet API summary' });

/** Find the body of a mutation call by method + path and JSON-parse it. */
function findRequestBody(path: string, method: string): Record<string, unknown> {
  const call = mockedRequest.mock.calls.find(
    (c) => c[0] === path && (c[1] as ReqOpts | undefined)?.method === method,
  );
  expect(call).toBeDefined();
  return JSON.parse((call![1] as ReqOpts).body ?? '{}') as Record<string, unknown>;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('FleetAPIPage', () => {
  it('renders skeletons — no KPI values and no switches — while the sources load', () => {
    // Never-resolving promise keeps every query pending.
    mockedRequest.mockReturnValue(new Promise(() => {}));

    renderPage();

    // The page shell + labelled KPI region are always present.
    expect(screen.getByText('Fleet API Settings')).toBeInTheDocument();
    expect(kpiRegion()).toBeInTheDocument();

    // During the KPI skeleton no metric labels are rendered yet...
    expect(within(kpiRegion()).queryByText('API Status')).toBeNull();
    // ...and no toggle switches exist while polling/settings are still loading.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('renders truthful KPIs, named switches, retention select, and configured endpoints', async () => {
    installRequest();

    renderPage();

    const region = kpiRegion();
    // API status resolves to the true "Active" state (api_suspended === false).
    expect(await within(region).findByText('Active')).toBeInTheDocument();
    // 3 of 21 endpoint keys enabled (charge_state, drive_state, telemetry_capture).
    expect(within(region).getByText('3 / 21')).toBeInTheDocument();
    expect(within(region).getByText('On')).toBeInTheDocument();
    expect(within(region).getByText('512')).toBeInTheDocument();

    // The master switch is named AND reflects the un-suspended (checked) state.
    const master = screen.getByRole('switch', { name: 'Toggle Tesla API polling' });
    expect(master).toHaveAttribute('aria-checked', 'true');

    // "Charge State" exists in BOTH the polling and on-demand groups.
    expect(screen.getAllByRole('switch', { name: 'Charge State' })).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Nearby Charging' })).toBeInTheDocument();

    // MongoDB connected → the retention select + captured summary are shown.
    expect(screen.getByRole('combobox', { name: 'Retention Period' })).toBeInTheDocument();
    expect(screen.getByText('512 signals captured from 2 vehicle(s)')).toBeInTheDocument();
    expect(screen.getByText('MongoDB Connected')).toBeInTheDocument();

    // Header tally badge + a configured endpoint URL surface.
    expect(screen.getByText('3/21 enabled')).toBeInTheDocument();
    expect(screen.getByText('https://fleet-api.prd.na.vn.cloud.tesla.com')).toBeInTheDocument();
  });

  it('reflects a suspended API with a paused status and an unchecked master switch', async () => {
    installRequest({ settings: makeSettings({ api_suspended: true }) });

    renderPage();

    expect(await within(kpiRegion()).findByText('Suspended')).toBeInTheDocument();

    const master = screen.getByRole('switch', { name: 'Toggle Tesla API polling' });
    expect(master).toHaveAttribute('aria-checked', 'false');

    expect(screen.getByText(/Polling and commands are paused/)).toBeInTheDocument();
  });

  it('POSTs /settings/suspend-api when the master switch is toggled', async () => {
    installRequest();

    renderPage();

    const master = await screen.findByRole('switch', { name: 'Toggle Tesla API polling' });
    expect(master).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(master);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/suspend-api',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // The un-suspended page suspends on click.
    expect(findRequestBody('/settings/suspend-api', 'POST').suspended).toBe(true);
  });

  it('PUTs /settings/polling-config with the flipped flag when an endpoint is toggled', async () => {
    installRequest();

    renderPage();

    const sw = await screen.findByRole('switch', { name: 'Nearby Charging' });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(sw);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/polling-config',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    // The disabled endpoint is flipped on.
    expect(findRequestBody('/settings/polling-config', 'PUT').nearby_charging_sites).toBe(true);
  });

  it('PUTs the new retention period when the select changes', async () => {
    installRequest();

    renderPage();

    const select = (await screen.findByRole('combobox', { name: 'Retention Period' })) as HTMLSelectElement;
    // Default retention is 7 days.
    expect(select.value).toBe('7');

    fireEvent.change(select, { target: { value: '30' } });

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/polling-config',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(findRequestBody('/settings/polling-config', 'PUT').telemetry_capture_retention_days).toBe(30);
  });

  it('degrades the API-status KPI to an em-dash (not a fabricated Active) when only /settings fails', async () => {
    installRequest({ rejectGet: ['/settings'] });

    renderPage();

    const region = kpiRegion();
    // Settings source is unknown → the KPI must NOT invent "Active"/"Suspended".
    await waitFor(() => expect(within(region).getByText('—')).toBeInTheDocument());
    expect(within(region).queryByText('Active')).toBeNull();
    expect(within(region).queryByText('Suspended')).toBeNull();

    // The other three sources resolved, so their KPIs stay truthful.
    expect(within(region).getByText('3 / 21')).toBeInTheDocument();

    // The master switch panel surfaces the error and hides the header toggle.
    expect(screen.queryByRole('switch', { name: 'Toggle Tesla API polling' })).toBeNull();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  });

  it('degrades gracefully when MongoDB is off and the version payload has no endpoints', async () => {
    installRequest({
      capture: makeCapture({ mongodb_enabled: false, total_documents: 0, distinct_vins: [] }),
      version: makeVersion({ endpoints: {} }),
    });

    renderPage();

    // MongoDB not configured → badge shown and retention select withheld.
    expect(await screen.findByText('MongoDB Not Configured')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Retention Period' })).toBeNull();
    expect(screen.getByText(/Set MONGODB_ENABLED=true/)).toBeInTheDocument();

    // Empty version endpoints → configured-endpoints empty state.
    expect(screen.getByText('Endpoint metadata unavailable')).toBeInTheDocument();
    expect(screen.getByText(/did not publish any configured endpoint URLs/)).toBeInTheDocument();
    expect(screen.getByText(/Configure the public and Tesla Fleet API URLs/)).toBeInTheDocument();

    // Capture stats are known, so a real 0 is shown (not an em-dash).
    expect(within(kpiRegion()).getByText('0')).toBeInTheDocument();
  });

  it('is accessible: labelled KPI region, named switches, and a named retention control', async () => {
    installRequest();

    renderPage();

    // Regression guard for the Toggle aria-label routing fix: the master switch
    // (icon-only) now has an accessible name on the role="switch" element.
    expect(await screen.findByRole('switch', { name: 'Toggle Tesla API polling' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fleet API summary' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Wake Up' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Raw Signal Recording' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Retention Period' })).toBeInTheDocument();

    // Master (1) + raw-signal (1) + polling (7) + on-demand (11) + commands (2).
    expect(screen.getAllByRole('switch')).toHaveLength(22);
  });
});
