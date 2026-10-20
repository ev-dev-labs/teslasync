import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import type { PollingConfig } from '@/api/hooks/useSettings';
import { ToastProvider } from '@/components/feedback/Toast';
import { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';
import { FleetAPIPolling } from './FleetAPIPolling';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

const mockedRequest = vi.mocked(request);
const clients: QueryClient[] = [];
let apiSuspended: boolean;
let settingsError: boolean;
let polling: PollingConfig;

function PollingHarness() {
  const controller = useFleetAPIPage();
  return <FleetAPIPolling controller={controller} />;
}

function renderPolling() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <PollingHarness />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function installRequests() {
  mockedRequest.mockImplementation(async (path, options) => {
    const method = options?.method ?? 'GET';
    if (path === '/settings' && method === 'GET') {
      if (settingsError) throw new Error('Settings unavailable');
      return { api_suspended: apiSuspended };
    }
    if (path === '/settings/polling-config' && method === 'GET') return polling;
    if (path === '/system/version' && method === 'GET') return null;
    if (path === '/settings/suspend-api' && method === 'POST') {
      apiSuspended = false;
      return { api_suspended: false };
    }
    if (path === '/settings/polling-config' && method === 'PUT') {
      const update = JSON.parse(String(options?.body)) as Partial<PollingConfig>;
      polling = { ...polling, ...update };
      return polling;
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  });
}

beforeEach(() => {
  mockedRequest.mockReset();
  apiSuspended = true;
  settingsError = false;
  polling = {
    auto_polling_enabled: false,
    fleet_endpoints: { 'vehicles.list': true, 'command.door_lock': false },
    auto_endpoints: { 'vehicles.list': true },
    endpoint_catalog: [
      { key: 'vehicles.list', method: 'GET', path: '/api/1/vehicles', category: 'Vehicle data', pollable: true },
      { key: 'command.door_lock', method: 'POST', path: '/api/1/vehicles/{vin}/command/door_lock', category: 'Vehicle commands', pollable: false },
    ],
    vehicle_discovery: false,
    charge_state: false,
    climate_state: false,
    drive_state: false,
    location_data: false,
    vehicle_state: false,
    vehicle_config: false,
    on_demand_vehicle_discovery: true,
    on_demand_charge_state: true,
    on_demand_climate_state: true,
    on_demand_drive_state: true,
    on_demand_location_data: true,
    on_demand_vehicle_state: true,
    on_demand_vehicle_config: true,
    nearby_charging_sites: true,
    release_notes: true,
    recent_alerts: true,
    service_data: true,
    wake_up: false,
    commands: false,
    telemetry_capture: false,
    telemetry_capture_retention_days: 7,
  };
  installRequests();
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('FleetAPIPolling Resume touch contract', () => {
  it('declares mobile minimum targets and restores compact desktop height and width', async () => {
    renderPolling();
    const resume = await screen.findByRole('button', { name: 'Resume API actions' });
    expect(resume).toHaveClass('h-11', 'min-h-11', 'min-w-11');
    expect(resume).toHaveClass('md:h-9', 'md:min-h-0', 'md:min-w-0', 'px-3', 'text-sm');
    expect(resume).not.toHaveClass('h-9');
    expect(resume).toHaveClass('focus-visible:outline', 'focus-visible:outline-2');
    expect(resume).toBeEnabled();
  });

  it('resumes through the existing live-only handler without changing polling selections', async () => {
    const before = structuredClone(polling);
    renderPolling();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume API actions' }));
    await screen.findByText('API resumed');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume API actions' })).not.toBeInTheDocument());
    expect(mockedRequest).toHaveBeenCalledWith('/settings/suspend-api', expect.objectContaining({
      method: 'POST',
      requiresLiveMode: true,
      body: JSON.stringify({ suspended: false }),
    }));
    expect(polling).toEqual(before);
    expect(mockedRequest.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(mockedRequest.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  });

  it('disables Resume while its existing mutation is pending and rejects duplicate activation', async () => {
    let finish: ((value: { api_suspended: boolean }) => void) | undefined;
    const result = new Promise<{ api_suspended: boolean }>((resolve) => { finish = resolve; });
    renderPolling();
    const resume = await screen.findByRole('button', { name: 'Resume API actions' });
    mockedRequest.mockImplementationOnce(() => result);
    fireEvent.click(resume);
    await waitFor(() => expect(resume).toBeDisabled());
    fireEvent.click(resume);
    expect(mockedRequest.mock.calls.filter(([path, options]) => path === '/settings/suspend-api' && options?.method === 'POST')).toHaveLength(1);
    apiSuspended = false;
    finish?.({ api_suspended: false });
    await screen.findByText('API resumed');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resume API actions' })).not.toBeInTheDocument());
  });

  it('retains suspension and re-enables Resume after mutation failure with error feedback', async () => {
    renderPolling();
    const resume = await screen.findByRole('button', { name: 'Resume API actions' });
    mockedRequest.mockRejectedValueOnce(new Error('Resume denied'));
    fireEvent.click(resume);
    await screen.findByText('Failed to toggle API suspension');
    expect(screen.getByText('Resume denied')).toBeInTheDocument();
    await waitFor(() => expect(resume).toBeEnabled());
    expect(screen.getByText(/API actions were suspended previously/)).toBeInTheDocument();
    expect(screen.queryByText('API resumed')).not.toBeInTheDocument();
    expect(apiSuspended).toBe(true);
  });

  it('keeps Resume unavailable until a fatal settings error is retried successfully', async () => {
    settingsError = true;
    renderPolling();
    await screen.findByText("Can't reach server");
    expect(screen.queryByRole('button', { name: 'Resume API actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Toggle Tesla API polling' })).toBeEnabled();
    settingsError = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('button', { name: 'Resume API actions' })).toBeEnabled();
  });

  it('preserves master polling enable and pause handlers without clearing selected routes', async () => {
    const before = structuredClone(polling);
    renderPolling();
    const master = await screen.findByRole('switch', { name: 'Toggle Tesla API polling' });
    expect(master).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(master);
    await waitFor(() => expect(master).toHaveAttribute('aria-checked', 'true'));
    expect(polling.fleet_endpoints).toEqual(before.fleet_endpoints);
    expect(polling.auto_endpoints).toEqual(before.auto_endpoints);
    await waitFor(() => expect(master).toBeEnabled());
    fireEvent.click(master);
    await waitFor(() => expect(master).toHaveAttribute('aria-checked', 'false'));
    expect(polling.fleet_endpoints).toEqual(before.fleet_endpoints);
    expect(polling.auto_endpoints).toEqual(before.auto_endpoints);
    const writes = mockedRequest.mock.calls.filter(([, options]) => options?.method === 'PUT');
    expect(writes).toHaveLength(2);
    for (const [, options] of writes) expect(options).toMatchObject({ requiresLiveMode: true });
    expect(screen.getByRole('button', { name: 'Resume API actions' })).toBeEnabled();
  });

  it('keeps the master disabled while its polling mutation is pending', async () => {
    let finish: ((value: PollingConfig) => void) | undefined;
    const result = new Promise<PollingConfig>((resolve) => { finish = resolve; });
    renderPolling();
    const master = await screen.findByRole('switch', { name: 'Toggle Tesla API polling' });
    mockedRequest.mockImplementationOnce(() => result);
    fireEvent.click(master);
    await waitFor(() => expect(master).toBeDisabled());
    fireEvent.click(master);
    expect(mockedRequest.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Resume API actions' })).toBeEnabled();
    polling = { ...polling, auto_polling_enabled: true };
    finish?.(polling);
    await waitFor(() => expect(master).toBeEnabled());
    expect(master).toHaveAttribute('aria-checked', 'true');
  });
});
