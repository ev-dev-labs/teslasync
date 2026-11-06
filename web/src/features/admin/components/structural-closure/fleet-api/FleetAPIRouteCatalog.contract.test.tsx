import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetEndpoint, PollingConfig } from '@/api/hooks/useSettings';
import { Input } from '@/components/ui';
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
  return (
    <>
      <Input aria-label="Fixture search" value={controller.search}
        onChange={(event) => controller.setSearch(event.target.value)} />
      <FleetAPIRouteCatalog controller={controller} pollingConfig={controller.pollingConfig} />
    </>
  );
}

function renderCatalog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><CatalogHarness /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'View options' }));
}

function routeKeys() {
  return fixtures.table.mock.lastCall?.[0].endpoints.map(endpoint => endpoint.key);
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
      endpoints: [fixtures.catalog[1], fixtures.catalog[0], fixtures.catalog[2]],
      candidates: fixtures.catalog,
      access: fixtures.polling.fleet_endpoints,
      auto: fixtures.polling.auto_endpoints,
      pollingEnabled: true,
      pending: false,
      onEnable: expect.any(Function),
      onAuto: expect.any(Function),
    }));
  });

  it.each([
    { case: 'category', name: 'Category' },
    { case: 'method', name: 'HTTP method' },
    { case: 'direction', name: 'Sort descending' },
  ])('declares mobile target classes and restores compact desktop sizing for $case', ({ name }) => {
    renderCatalog();
    const button = screen.getByRole('button', { name });
    expect(button).toHaveClass('h-11', 'min-w-11', 'md:h-9', 'md:min-w-0', 'px-3', 'text-sm');
    expect(button).not.toHaveClass('h-9', 'w-11', 'md:w-11', 'md:min-w-11');
  });

  it('runs method and category grouping handlers while keeping raw method identity', () => {
    renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'HTTP method' }));
    expect(screen.getByRole('button', { name: 'HTTP method' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Category' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Expand POST' })).toBeInTheDocument();
    expect(fixtures.table.mock.lastCall?.[0].grouping?.key(fixtures.catalog[2])).toBe('POST');
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixture search' }), { target: { value: 'command.lock' } });
    expect(screen.queryByRole('button', { name: 'Expand GET' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Category' }));
    expect(screen.getByRole('button', { name: 'Category' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Collapse Fahrzeugbefehle' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixture search' }), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Expand Fahrzeugdaten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Fahrzeugbefehle' })).toBeInTheDocument();
  });

  it.each([
    { case: 'operation', value: 'name', keys: ['vehicle.a', 'vehicle.z'], reversed: ['vehicle.z', 'vehicle.a'], direction: 'Sort descending' },
    { case: 'path', value: 'path', keys: ['vehicle.z', 'vehicle.a'], reversed: ['vehicle.a', 'vehicle.z'], direction: 'Sort descending' },
    { case: 'method', value: 'method', keys: ['vehicle.a', 'vehicle.z'], reversed: ['vehicle.a', 'vehicle.z'], direction: 'Sort descending' },
    { case: 'access', value: 'access', keys: ['vehicle.z', 'vehicle.a'], reversed: ['vehicle.a', 'vehicle.z'], direction: 'Sort ascending' },
    { case: 'auto', value: 'auto', keys: ['vehicle.z', 'vehicle.a'], reversed: ['vehicle.a', 'vehicle.z'], direction: 'Sort ascending' },
  ])('runs the $case sort selection and direction handlers', ({ value, keys, reversed, direction }) => {
    renderCatalog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixture search' }), { target: { value: 'vehicle.' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort routes by' }), { target: { value } });
    expect(screen.getByRole('combobox', { name: 'Sort routes by' })).toHaveValue(value);
    expect(routeKeys()).toEqual(keys);
    fireEvent.click(screen.getByRole('button', { name: direction }));
    expect(screen.getByRole('button', { name: direction === 'Sort ascending' ? 'Sort descending' : 'Sort ascending' })).toBeInTheDocument();
    expect(routeKeys()).toEqual(reversed);
  });

  it('filters both grouping modes through one shared search alongside category chips', async () => {
    renderCatalog();
    expect(screen.getByRole('group', { name: 'Route groups' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixture search' }), { target: { value: 'vehicle.a' } });
    expect(routeKeys()).toEqual(['vehicle.a']);
    fireEvent.click(screen.getByRole('button', { name: 'HTTP method' }));
    expect(screen.getByRole('button', { name: 'Collapse GET' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Fixture search' })).toHaveValue(''));
    expect(routeKeys()).toEqual(['vehicle.a', 'vehicle.z', 'command.lock']);
  });

  it('retains the no-match message and executes the clear-search action', async () => {
    renderCatalog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Fixture search' }), { target: { value: 'missing-fixture-route' } });
    expect(screen.getByText('No API routes match that search.')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Collapse Fahrzeug/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Fixture search' })).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Expand Fahrzeugdaten' })).toBeInTheDocument();
    expect(routeKeys()).toEqual(['vehicle.a', 'vehicle.z', 'command.lock']);
  });
});
