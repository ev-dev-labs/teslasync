/**
 * FleetAPIPage contract tests.
 *
 * The page uses the backend catalog so every implemented Fleet route has an
 * independent access switch; only worker-supported read routes offer auto-poll.
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
import { camelCaseKeys } from '@/lib/resilience';
import FleetAPIPage from './FleetAPIPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

interface ReqOpts {
  method?: string;
  body?: string;
}

const CATALOG = [
  { key: 'vehicles.list', method: 'GET', path: '/api/1/vehicles', category: 'Vehicle data', pollable: true },
  { key: 'vehicle_data.charge_state', method: 'GET', path: '/api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state', category: 'Vehicle data', pollable: true },
  { key: 'vehicle_data.drive_state', method: 'GET', path: '/api/1/vehicles/{vin}/vehicle_data?endpoints=drive_state', category: 'Vehicle data', pollable: true },
  { key: 'vehicles.nearby_charging_sites', method: 'GET', path: '/api/1/vehicles/{vin}/nearby_charging_sites', category: 'Vehicle data', pollable: false },
  { key: 'command.door_lock', method: 'POST', path: '/api/1/vehicles/{vin}/command/door_lock', category: 'Vehicle commands', pollable: false },
  { key: 'telemetry.subscribe', method: 'POST', path: '/api/1/vehicles/fleet_telemetry_config', category: 'Fleet telemetry', pollable: false },
  { key: 'dx.pricing', method: 'POST', path: '/api/1/dx/vehicles/pricing', category: 'Vehicle services', pollable: false },
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

function makePolling(overrides: Record<string, unknown> = {}) {
  return {
    auto_polling_enabled: false,
    fleet_endpoints: Object.fromEntries(CATALOG.map(({ key }) => [key, false])),
    auto_endpoints: { 'vehicles.list': false, 'vehicle_data.charge_state': false, 'vehicle_data.drive_state': false },
    endpoint_catalog: CATALOG,
    telemetry_capture: false,
    telemetry_capture_retention_days: 7,
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return { chart_version: '2.4.0', go_version: 'go1.25', os: 'linux', arch: 'amd64', endpoints: { ...DEFAULT_ENDPOINTS }, ...overrides };
}

interface InstallCfg {
  settings?: unknown;
  polling?: unknown;
  version?: unknown;
  /** GET paths that should reject with a plain network Error. */
  rejectGet?: string[];
}

/** Route the single `request` mock by "METHOD path" so queries + mutations work. */
function installRequest(cfg: InstallCfg = {}) {
  const {
    settings = makeSettings(),
    polling = makePolling({
      fleet_endpoints: { ...Object.fromEntries(CATALOG.map(({ key }) => [key, false])), 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': true },
      auto_endpoints: { 'vehicles.list': false, 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': false },
    }),
    version = makeVersion(),
    rejectGet = [],
  } = cfg;
  let currentPolling = polling;
  let currentSettings = settings;

  mockedRequest.mockImplementation((path: string, opts?: ReqOpts) => {
    const method = opts?.method ?? 'GET';
    if (method === 'GET' && rejectGet.includes(path)) {
      return Promise.reject(new Error('network down'));
    }
    switch (`${method} ${path}`) {
      case 'GET /settings': return Promise.resolve(currentSettings);
      case 'GET /settings/polling-config': return Promise.resolve(currentPolling);
      case 'GET /system/version': return Promise.resolve(version);
      case 'POST /settings/suspend-api': {
        const { suspended } = JSON.parse(opts?.body ?? '{}') as { suspended: boolean };
        currentSettings = { ...(currentSettings as Record<string, unknown>), api_suspended: suspended };
        return Promise.resolve({ api_suspended: suspended });
      }
      case 'PUT /settings/polling-config':
        currentPolling = { ...JSON.parse(opts?.body ?? '{}'), endpoint_catalog: CATALOG } as unknown;
        return Promise.resolve(currentPolling);
      default: return Promise.reject(new Error(`unexpected ${method} ${path}`));
    }
  });
}

function renderPage({ details = true } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <FleetAPIPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  if (details) fireEvent.click(screen.getByRole('button', { name: 'Connection details' }));
  return { ...rendered, client };
}

const statusCard = () => screen.getByRole('heading', { name: 'Tesla API' }).closest('[data-card]') as HTMLElement;
async function showVehicleData() {
  fireEvent.click(await screen.findByRole('button', { name: 'Expand Vehicle data' }));
}

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

describe('FleetAPIPage retained sources', () => {
  it('preserves full endpoint controls and runtime URLs after independent refresh failures', async () => {
    installRequest();
    const { client } = renderPage();
    await showVehicleData();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    await screen.findByText(DEFAULT_ENDPOINTS.tesla_api);
    await screen.findByText('/api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state');
    installRequest({ rejectGet: ['/settings/polling-config', '/system/version'] });
    await client.invalidateQueries();
    await waitFor(() => expect(client.getQueryCache().getAll().some((query) => query.state.error !== null)).toBe(true));
    expect(screen.getByText(DEFAULT_ENDPOINTS.tesla_api)).toBeInTheDocument();
    expect(screen.getByText('/api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Toggle Tesla API polling' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Category/ })).toBeInTheDocument();
  });
});

describe('FleetAPIPage', () => {
  it('places bulk and group switches in the same four-column shared table', async () => {
    installRequest();
    renderPage({ details: false });
    const table = await screen.findByRole('table');
    expect(screen.getByRole('heading', { name: 'Tesla API' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Endpoint access' })).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    const bulkAccess = within(table).getByRole('switch', { name: 'Allow all endpoints' });
    const bulkAuto = within(table).getByRole('switch', { name: 'Auto-poll all eligible endpoints' });
    const groupAccess = within(table).getByRole('switch', { name: 'Allow all Vehicle data' });
    const groupAuto = within(table).getByRole('switch', { name: 'Auto-poll all eligible Vehicle data' });
    expect(bulkAccess.closest('th')).toHaveAttribute('data-column-key', 'access');
    expect(bulkAuto.closest('th')).toHaveAttribute('data-column-key', 'auto');
    expect(groupAccess.closest('td')).toHaveAttribute('data-column-key', 'access');
    expect(groupAuto.closest('td')).toHaveAttribute('data-column-key', 'auto');
    for (const control of [bulkAccess, bulkAuto, groupAccess, groupAuto]) {
      expect(control).toHaveAccessibleDescription(/Some enabled/);
    }
    expect(screen.queryByRole('navigation', { name: 'Route groups' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Exports include only matching loaded rows/)).not.toBeInTheDocument();
  });

  it('updates all eligible routes in a searched group without changing other groups', async () => {
    installRequest({ polling: makePolling({
      auto_polling_enabled: true,
      fleet_endpoints: { ...Object.fromEntries(CATALOG.map(({ key }) => [key, false])),
        'vehicle_data.charge_state': true, 'vehicle_data.drive_state': true },
      auto_endpoints: { 'vehicles.list': false, 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': false },
    }) });
    renderPage({ details: false });
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search API routes' }), { target: { value: 'charge_state' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-poll all eligible Vehicle data' }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith('/settings/polling-config', expect.objectContaining({ method: 'PUT' })));
    expect(findRequestBody('/settings/polling-config', 'PUT').auto_endpoints).toEqual({
      'vehicles.list': false, 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': true,
    });
  });

  it('starts with one table, collapsed groups and private connection details', async () => {
    installRequest();
    renderPage({ details: false });
    await screen.findByRole('switch', { name: 'Toggle Tesla API polling' });
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Expand / })).toHaveLength(4);
    expect(screen.queryByText(DEFAULT_ENDPOINTS.api)).not.toBeInTheDocument();
    expect(screen.queryByTestId('fleet-api-summary')).not.toBeInTheDocument();
    expect(screen.getByText('Allowed', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2 of 7 endpoints allowed · 1 auto-polled')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch', { name: /^Enable / })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Vehicle data' }));
    expect(screen.getAllByRole('switch', { name: /^Enable / })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Vehicle data' }));
    expect(screen.queryAllByRole('switch', { name: /^Enable / })).toHaveLength(0);
  });

  it('shows one truthful enabled and selected count with the catalog denominator', async () => {
    installRequest();
    renderPage();
    expect(await within(statusCard()).findByText('2 of 7 endpoints allowed · 1 auto-polled')).toBeInTheDocument();
    expect(screen.getAllByText('2 of 7 endpoints allowed · 1 auto-polled')).toHaveLength(1);
    expect(screen.queryByTestId('fleet-api-summary')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Toggle Tesla API polling' })).toBeInTheDocument();
  });

  it('renders loading placeholders without fabricated counts or switches', () => {
    // Never-resolving promise keeps every query pending.
    mockedRequest.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByRole('heading', { name: 'Fleet API settings', level: 1 })).toBeInTheDocument();
    expect(statusCard()).toBeInTheDocument();
    expect(within(statusCard()).getByText('API status unknown')).toBeInTheDocument();
    expect(within(statusCard()).queryByText(/endpoints allowed/)).toBeNull();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('renders truthful status, named switches, and configured endpoints', async () => {
    installRequest();

    renderPage();
    await showVehicleData();

    const region = statusCard();
    expect(await within(region).findByText('Allowed', { exact: true })).toBeInTheDocument();
    expect(within(region).getByText('Scheduled reads only · Off')).toBeInTheDocument();

    const master = screen.getByRole('switch', { name: 'Toggle Tesla API polling' });
    expect(master).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Enable GET /api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles/{vin}/vehicle_data?endpoints=drive_state' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Auto-poll all eligible endpoints' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('switch', { name: 'Allow all endpoints' })).toBeEnabled();
    expect(screen.queryByRole('switch', { name: /Auto-poll .*door_lock/ })).toBeNull();

    expect(screen.queryByText('Telemetry Capture')).toBeNull();
    expect(screen.queryByText(/MongoDB/)).toBeNull();
    expect(mockedRequest.mock.calls.some(([path]) => path === '/dev-tools/telemetry-capture/stats')).toBe(false);

    expect(screen.getByText('2 of 7 endpoints allowed · 1 auto-polled')).toBeInTheDocument();
    expect(screen.getByText('https://fleet-api.prd.na.vn.cloud.tesla.com')).toBeInTheDocument();
  });

  it('keeps suspension independent of the polling master switch', async () => {
    installRequest({ settings: makeSettings({ api_suspended: true }) });

    renderPage();

    expect(await within(statusCard()).findByText(/Suspended — live requests and commands are blocked/)).toBeInTheDocument();

    expect(screen.queryByRole('switch', { name: 'Suspend Tesla API actions' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Toggle Tesla API polling' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/token refresh continues/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume API actions' }));
    await waitFor(() => expect(findRequestBody('/settings/suspend-api', 'POST').suspended).toBe(false));
  });

  it('PUTs the polling master without suspending on-demand actions', async () => {
    installRequest();

    renderPage();

    const master = await screen.findByRole('switch', { name: 'Toggle Tesla API polling' });
    expect(master).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(master);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/polling-config',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(findRequestBody('/settings/polling-config', 'PUT').auto_polling_enabled).toBe(true);
    expect(mockedRequest.mock.calls.some(([path]) => path === '/settings/suspend-api')).toBe(false);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Auto-poll all eligible endpoints' })).not.toHaveAttribute('aria-disabled'));
    await showVehicleData();
    expect(screen.getByRole('switch', { name: 'Auto-poll GET /api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state' })).not.toHaveAttribute('aria-disabled');
  });

  it('toggles individual routes without enrolling them in automatic polling', async () => {
    installRequest();

    renderPage();
    await showVehicleData();

    const sw = await screen.findByRole('switch', { name: 'Enable GET /api/1/vehicles/{vin}/nearby_charging_sites' });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(sw);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/polling-config',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    // The disabled endpoint is flipped on.
    expect((findRequestBody('/settings/polling-config', 'PUT').fleet_endpoints as Record<string, boolean>)['vehicles.nearby_charging_sites']).toBe(true);
    expect(screen.queryByRole('switch', { name: /Auto-poll .*nearby_charging_sites/ })).toBeNull();
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  });

  it('clears auto-poll selection when an enabled route is disabled', async () => {
    installRequest();
    renderPage();
    await showVehicleData();
    const sw = await screen.findByRole('switch', { name: 'Enable GET /api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state' });
    fireEvent.click(sw);
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith('/settings/polling-config', expect.objectContaining({ method: 'PUT' })));
    const body = findRequestBody('/settings/polling-config', 'PUT');
    expect((body.fleet_endpoints as Record<string, boolean>)['vehicle_data.charge_state']).toBe(false);
    expect((body.auto_endpoints as Record<string, boolean>)['vehicle_data.charge_state']).toBe(false);
  });

  it('strips response-only camelCase endpoint aliases from the strict update payload', async () => {
    installRequest({ polling: camelCaseKeys(makePolling({
      fleet_endpoints: { ...Object.fromEntries(CATALOG.map(({ key }) => [key, true])) },
    })) });
    renderPage();
    await showVehicleData();
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable GET /api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state' }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith('/settings/polling-config', expect.objectContaining({ method: 'PUT' })));
    const body = findRequestBody('/settings/polling-config', 'PUT');
    expect(Object.keys(body.fleet_endpoints as Record<string, boolean>).sort()).toEqual(CATALOG.map(({ key }) => key).sort());
    expect(Object.keys(body.auto_endpoints as Record<string, boolean>).sort()).toEqual(CATALOG.filter(({ pollable }) => pollable).map(({ key }) => key).sort());
    expect(body.endpoint_catalog).toBeUndefined();
  });

  it('bulk access disables every route and clears all automatic preferences without changing the schedule', async () => {
    installRequest();
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Allow all endpoints' }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith('/settings/polling-config', expect.objectContaining({ method: 'PUT' })));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Allow all endpoints' })).toHaveAttribute('aria-checked', 'true'));
    mockedRequest.mockClear();
    fireEvent.click(screen.getByRole('switch', { name: 'Allow all endpoints' }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith('/settings/polling-config', expect.objectContaining({ method: 'PUT' })));
    const body = findRequestBody('/settings/polling-config', 'PUT');
    expect(Object.values(body.fleet_endpoints as Record<string, boolean>)).toEqual(Array(CATALOG.length).fill(false));
    expect(Object.values(body.auto_endpoints as Record<string, boolean>)).toEqual(Array(CATALOG.filter(({ pollable }) => pollable).length).fill(false));
    expect(body.auto_polling_enabled).toBe(false);
  });

  it('bulk auto-poll selects only enabled, worker-supported routes', async () => {
    installRequest({ polling: makePolling({
      auto_polling_enabled: true,
      fleet_endpoints: { ...Object.fromEntries(CATALOG.map(({ key }) => [key, false])), 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': true },
      auto_endpoints: { 'vehicles.list': false, 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': false },
    }) });
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Auto-poll all eligible endpoints' }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith('/settings/polling-config', expect.objectContaining({ method: 'PUT' })));
    const body = findRequestBody('/settings/polling-config', 'PUT');
    expect(body.auto_endpoints).toEqual({
      'vehicles.list': false,
      'vehicle_data.charge_state': true,
      'vehicle_data.drive_state': true,
    });
    expect(body.auto_polling_enabled).toBe(true);
  });

  it('group access updates the whole group through search without changing other groups or the master', async () => {
    installRequest({ polling: makePolling({
      fleet_endpoints: { ...Object.fromEntries(CATALOG.map(({ key }) => [key, false])), 'command.door_lock': true },
      auto_endpoints: { 'vehicles.list': true, 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': true },
    }) });
    renderPage({ details: false });
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search API routes' }), { target: { value: 'charge_state' } });
    const group = screen.getByRole('switch', { name: 'Allow all Vehicle data' });
    fireEvent.click(group);
    await waitFor(() => expect(group).toHaveAttribute('aria-checked', 'true'));
    const enabled = findRequestBody('/settings/polling-config', 'PUT');
    expect(enabled.fleet_endpoints).toEqual(Object.fromEntries(CATALOG.map(endpoint => [
      endpoint.key, endpoint.category === 'Vehicle data' || endpoint.key === 'command.door_lock',
    ])));
    expect(enabled.auto_polling_enabled).toBe(false);
    expect(enabled.auto_endpoints).toEqual({ 'vehicles.list': true, 'vehicle_data.charge_state': true, 'vehicle_data.drive_state': true });
    mockedRequest.mockClear();
    await waitFor(() => expect(group).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(group);
    await waitFor(() => expect(group).toHaveAttribute('aria-checked', 'false'));
    const disabled = findRequestBody('/settings/polling-config', 'PUT');
    expect(disabled.fleet_endpoints).toEqual(Object.fromEntries(CATALOG.map(endpoint => [endpoint.key, endpoint.key === 'command.door_lock'])));
    expect(disabled.auto_endpoints).toEqual({ 'vehicles.list': false, 'vehicle_data.charge_state': false, 'vehicle_data.drive_state': false });
  });

  it('filters catalog routes by search term', async () => {
    installRequest();
    renderPage();
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search API routes' }), { target: { value: 'door_lock' } });
    expect(await screen.findByRole('switch', { name: 'Enable POST /api/1/vehicles/{vin}/command/door_lock' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Enable .*charge_state/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse Vehicle data' })).toBeNull();
  });

  it('retains full loaded group candidates when text search narrows the shared table', async () => {
    installRequest();
    renderPage();
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search API routes' }), { target: { value: 'charge_state' } });
    const region = screen.getByRole('table');
    fireEvent.click(within(region).getByRole('button', { name: 'API path filter' }));
    const menu = screen.getByRole('dialog', { name: 'API path filter' });
    expect(within(menu).getByRole('checkbox', { name: '/api/1/vehicles' })).toBeInTheDocument();
    expect(within(menu).getByRole('checkbox', { name: '/api/1/vehicles/{vin}/vehicle_data?endpoints=drive_state' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Enable GET /api/1/vehicles' })).not.toBeInTheDocument();
  });

  it('filters auto-poll by the effective switch state when endpoint access is disabled', async () => {
    installRequest({
      polling: makePolling({
        auto_polling_enabled: true,
        auto_endpoints: {
          'vehicles.list': true,
          'vehicle_data.charge_state': true,
          'vehicle_data.drive_state': true,
        },
      }),
    });
    renderPage();

    await showVehicleData();
    const toggle = await screen.findByRole('switch', { name: 'Auto-poll GET /api/1/vehicles' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    const region = screen.getByRole('table');
    fireEvent.click(within(region).getByRole('button', { name: 'Auto-poll filter' }));
    const menu = screen.getByRole('dialog', { name: 'Auto-poll filter' });
    expect(within(menu).getByRole('checkbox', { name: 'Disabled' })).toBeInTheDocument();
    expect(within(menu).queryByRole('checkbox', { name: 'Enabled' })).not.toBeInTheDocument();
  });

  it('groups by HTTP method and sorts routes by path and access state', async () => {
    installRequest();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'View options' }));
    fireEvent.click(await screen.findByRole('button', { name: 'HTTP method' }));
    expect(screen.getByRole('button', { name: 'Expand POST' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand GET' }));

    const labels = () => within(screen.getByRole('table'))
      .getAllByRole('switch', { name: /^Enable GET/ })
      .map((node) => node.getAttribute('aria-label'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort routes by' }), { target: { value: 'path' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sort descending' }));
    expect(labels()[0]).toContain('endpoints=drive_state');

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort routes by' }), { target: { value: 'access' } });
    expect(labels().slice(0, 2)).toEqual(expect.arrayContaining([
      expect.stringContaining('endpoints=charge_state'),
      expect.stringContaining('endpoints=drive_state'),
    ]));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search API routes' }), { target: { value: 'door_lock' } });
    expect(await screen.findByRole('button', { name: 'Collapse POST' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand GET' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Enable POST /api/1/vehicles/{vin}/command/door_lock' })).toBeInTheDocument();
  });

  it('shows unknown API status without losing known polling counts when only /settings fails', async () => {
    installRequest({ rejectGet: ['/settings'] });

    renderPage();

    const region = statusCard();
    await waitFor(() => expect(within(region).getByText('2 of 7 endpoints allowed · 1 auto-polled')).toBeInTheDocument());
    expect(within(region).getByText('API status unknown')).toBeInTheDocument();
    expect(within(region).queryByText('Allowed', { exact: true })).toBeNull();
    expect(within(region).queryByText(/^Suspended/)).toBeNull();

    expect(screen.getByRole('switch', { name: 'Toggle Tesla API polling' })).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  });

  it('omits retired capture controls when endpoint metadata is missing', async () => {
    installRequest({
      version: makeVersion({ endpoints: {} }),
    });

    renderPage();

    expect(await screen.findByText('Endpoint metadata unavailable')).toBeInTheDocument();
    expect(screen.queryByText('MongoDB Not Configured')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Retention Period' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Raw Signal Recording' })).toBeNull();

    // Empty version endpoints → configured-endpoints empty state.
    expect(screen.getByText('Endpoint metadata unavailable')).toBeInTheDocument();
    expect(screen.getByText(/did not publish any configured endpoint URLs/)).toBeInTheDocument();
    expect(screen.getByText(/Configure the public and Tesla Fleet API URLs/)).toBeInTheDocument();

  });

  it('is accessible: labelled status card and named endpoint switches', async () => {
    installRequest();

    renderPage();

    // Regression guard for the Toggle aria-label routing fix: the master switch
    // (icon-only) now has an accessible name on the role="switch" element.
    expect(await screen.findByRole('switch', { name: 'Toggle Tesla API polling' })).toBeInTheDocument();
    expect(statusCard()).toHaveAccessibleName('Tesla API');
    for (const button of screen.getAllByRole('button', { name: /^Expand / })) fireEvent.click(button);
    expect(screen.getByRole('switch', { name: 'Enable POST /api/1/vehicles/{vin}/command/door_lock' })).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(18);
  });
});
