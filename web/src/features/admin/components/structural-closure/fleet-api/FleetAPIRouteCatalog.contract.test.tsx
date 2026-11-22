import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetEndpoint, PollingConfig } from '@/api/hooks/useSettings';
import { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';
import { FleetAPIRouteCatalog } from './FleetAPIRouteCatalog';

type TableProps = ComponentProps<typeof import('../../FleetEndpointTable')['FleetEndpointTable']>;

const fixtures = vi.hoisted(() => {
  const catalog: FleetEndpoint[] = [
    { key: 'vehicle.z', method: 'GET', path: '/api/1/a', category: 'Vehicle data', pollable: true },
    { key: 'vehicle.a', method: 'GET', path: '/api/1/z', category: 'Vehicle data', pollable: true },
    { key: 'command.lock', method: 'POST', path: '/api/1/b', category: 'Vehicle commands', pollable: false },
  ];
  const polling: PollingConfig = {
    auto_polling_enabled: true,
    fleet_endpoints: { 'vehicle.z': true, 'vehicle.a': false, 'command.lock': false },
    auto_endpoints: { 'vehicle.z': true, 'vehicle.a': false },
    endpoint_catalog: catalog,
    vehicle_discovery: false, charge_state: false, climate_state: false,
    drive_state: false, location_data: false, vehicle_state: false, vehicle_config: false,
    on_demand_vehicle_discovery: false, on_demand_charge_state: false,
    on_demand_climate_state: false, on_demand_drive_state: false,
    on_demand_location_data: false, on_demand_vehicle_state: false,
    on_demand_vehicle_config: false, nearby_charging_sites: false, release_notes: false,
    recent_alerts: false, service_data: false, wake_up: false, commands: false,
    telemetry_capture: false, telemetry_capture_retention_days: 7,
  };
  return { catalog, polling, table: vi.fn<(props: TableProps) => void>() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translations: Record<string, string> = {
    'fleetApi.categories.vehicledata': 'Fahrzeugdaten',
    'fleetApi.categories.vehiclecommands': 'Fahrzeugbefehle',
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const text = translations[key] ?? (typeof fallback === 'string' ? fallback : key);
        return text.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ''));
      },
      i18n: { language: 'de', changeLanguage: vi.fn() },
    }),
  };
});

// The real controller derives grouping, filtering and ordering from local query data.
vi.mock('@/api/hooks/useSettings', async () => {
  const { useQuery, useMutation } = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    useSettings: () => useQuery({
      queryKey: ['catalog-contract-settings'],
      queryFn: async () => ({ api_suspended: false }),
      initialData: { api_suspended: false },
      staleTime: Infinity,
    }),
    usePollingConfig: () => useQuery({
      queryKey: ['catalog-contract-polling'],
      queryFn: async () => fixtures.polling,
      initialData: fixtures.polling,
      staleTime: Infinity,
    }),
    useVersionInfo: () => useQuery({
      queryKey: ['catalog-contract-version'],
      queryFn: async () => ({ chart_version: 'fixture', go_version: 'fixture', os: 'fixture', arch: 'fixture', endpoints: {} }),
      initialData: { chart_version: 'fixture', go_version: 'fixture', os: 'fixture', arch: 'fixture', endpoints: {} },
      staleTime: Infinity,
    }),
    useToggleAPISuspend: () => useMutation({ mutationFn: async (suspended: boolean) => suspended }),
    useUpdatePollingConfig: () => useMutation({ mutationFn: async (polling: PollingConfig) => polling }),
  };
});

vi.mock('../../FleetEndpointTable', async () => {
  const actual = await vi.importActual<typeof import('../../FleetEndpointTable')>('../../FleetEndpointTable');
  return {
    FleetEndpointTable: (props: TableProps) => {
      fixtures.table(props);
      return <actual.FleetEndpointTable {...props} />;
    },
  };
});

function CatalogHarness() {
  const controller = useFleetAPIPage();
  if (!controller.pollingConfig) throw new Error('Missing local polling fixture');
  return <FleetAPIRouteCatalog controller={controller} pollingConfig={controller.pollingConfig} />;
}

function renderCatalog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><CatalogHarness /></QueryClientProvider>);
}

function routeKeys() {
  return fixtures.table.mock.lastCall?.[0].endpoints.map(endpoint => endpoint.key);
}

function setSearch(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search API routes' }), { target: { value } });
}

function openGrouping() {
  fireEvent.click(screen.getByRole('button', { name: 'View options' }));
  return within(screen.getByRole('dialog', { name: 'View options' }));
}

beforeEach(() => fixtures.table.mockClear());
afterEach(cleanup);

describe('FleetAPIRouteCatalog source contracts', () => {
  it('uses translated group disclosures without translating raw table and candidate identities', () => {
    renderCatalog();
    expect(screen.getByRole('button', { name: 'Expand Fahrzeugdaten' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand Vehicle data' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(fixtures.table).toHaveBeenLastCalledWith(expect.objectContaining({
      tableId: 'admin:fleet-endpoints',
      endpoints: fixtures.catalog,
      candidates: fixtures.catalog,
      access: fixtures.polling.fleet_endpoints,
      auto: fixtures.polling.auto_endpoints,
      pollingEnabled: true,
      pending: false,
      onEnable: expect.any(Function),
      onAuto: expect.any(Function),
    }));
  });

  it('keeps each grouping option reachable with a mobile-sized target', () => {
    renderCatalog();
    const grouping = openGrouping();
    for (const name of ['Category', 'HTTP method', 'No grouping']) {
      expect(grouping.getByRole('button', { name })).toHaveClass('min-h-11', 'md:min-h-9');
    }
  });

  it('runs method and category grouping handlers while keeping raw method identity', async () => {
    renderCatalog();
    const grouping = openGrouping();
    fireEvent.click(grouping.getByRole('button', { name: 'HTTP method' }));
    expect(grouping.getByRole('button', { name: 'HTTP method' })).toHaveAttribute('aria-pressed', 'true');
    expect(grouping.getByRole('button', { name: 'Category' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Expand POST' })).toBeInTheDocument();
    expect(fixtures.table.mock.lastCall?.[0].grouping?.key(fixtures.catalog[2])).toBe('POST');
    setSearch('command.lock');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Expand GET' })).not.toBeInTheDocument());
    fireEvent.click(grouping.getByRole('button', { name: 'Category' }));
    expect(grouping.getByRole('button', { name: 'Category' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Collapse Fahrzeugbefehle' })).toBeInTheDocument();
    setSearch('');
    expect(await screen.findByRole('button', { name: 'Expand Fahrzeugdaten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Fahrzeugbefehle' })).toBeInTheDocument();
  });

  it.each([
    { value: 'operation', paths: ['/api/1/a', '/api/1/z'], direction: 'Sort descending' },
    { value: 'path', paths: ['/api/1/a', '/api/1/z'], direction: 'Sort ascending' },
    { value: 'method', paths: ['/api/1/a', '/api/1/b'], direction: 'Sort ascending' },
    { value: 'access', paths: ['/api/1/a', '/api/1/z'], direction: 'Sort ascending' },
    { value: 'auto', paths: ['/api/1/a', '/api/1/z'], direction: 'Sort ascending' },
  ])('sorts the displayed routes by $value in both directions', ({ value, paths, direction }) => {
    renderCatalog();
    fireEvent.click(openGrouping().getByRole('button', { name: 'No grouping' }));
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    if (value !== 'method') setSearch('vehicle.');
    const visiblePaths = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
      .map(row => row.querySelector('[data-column-key="operation"] code')?.textContent);
    fireEvent.click(screen.getByRole('button', { name: 'Filter & sort' }));
    const query = within(screen.getByRole('dialog', { name: 'Filter & sort' }));
    fireEvent.change(query.getByRole('combobox', { name: 'Column' }), { target: { value } });
    fireEvent.click(query.getByRole('button', { name: direction }));
    const reverse = direction === 'Sort ascending' ? 'Sort descending' : 'Sort ascending';
    expect(query.getByRole('button', { name: reverse })).toBeInTheDocument();
    expect(visiblePaths()[0]).toBe(paths[0]);
    fireEvent.click(query.getByRole('button', { name: reverse }));
    expect(visiblePaths()[0]).toBe(paths[1]);
  });

  it('filters both grouping modes through the shared search and category selector', async () => {
    renderCatalog();
    const category = screen.getByRole('combobox', { name: 'Route groups' });
    fireEvent.change(category, { target: { value: 'Vehicle data' } });
    expect(routeKeys()).toEqual(['vehicle.z', 'vehicle.a']);
    setSearch('vehicle.a');
    await waitFor(() => expect(routeKeys()).toEqual(['vehicle.a']));
    fireEvent.click(openGrouping().getByRole('button', { name: 'HTTP method' }));
    expect(screen.getByRole('button', { name: 'Collapse GET' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search API routes' })).toHaveValue(''));
    await waitFor(() => expect(routeKeys()).toEqual(['vehicle.z', 'vehicle.a']));
  });

  it('retains the no-match message and executes the clear-search action', async () => {
    renderCatalog();
    setSearch('missing-fixture-route');
    expect(await screen.findByText('No API routes match that search.')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Collapse Fahrzeug/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search API routes' })).toHaveValue(''));
    expect(await screen.findByRole('button', { name: 'Expand Fahrzeugdaten' })).toBeInTheDocument();
    expect(routeKeys()).toEqual(['vehicle.z', 'vehicle.a', 'command.lock']);
  });
});
