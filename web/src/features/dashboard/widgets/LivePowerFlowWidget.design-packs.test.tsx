import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeslaEnergyLiveStatus, TeslaEnergySite } from '@/types/energy';
import LivePowerFlowWidget from './LivePowerFlowWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

const mocks = vi.hoisted(() => ({ sites: vi.fn(), live: vi.fn(), refreshSites: vi.fn(), refreshLive: vi.fn() }));
vi.mock('@/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => mocks.sites(),
  useTeslaEnergyLiveStatus: (...args: unknown[]) => mocks.live(...args),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(values?.[name] ?? match)),
    i18n: { language: 'en', dir: () => 'ltr' },
  }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', locale: 'en-US', decimal_precision: 2 } }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: unknown) => String(value),
    formatDateTime: (value: unknown) => String(value),
  }),
}));

const NOW = '2026-11-06T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const site: TeslaEnergySite = {
  id: 1, energy_site_id: 100, site_name: 'Courtyard', resource_type: 'battery',
  gateway_id: null, total_pack_energy: null, percentage_charged: null, battery_type: null,
  backup_capable: true, storm_mode_enabled: false, has_solar: true, has_battery: true,
  has_grid: true, has_load_meter: true, tou_capable: true, storm_mode_capable: true,
  fetched_at: NOW, created_at: NOW, updated_at: NOW, site_info_fetched_at: null,
};

function snapshot(overrides: Partial<TeslaEnergyLiveStatus> = {}): TeslaEnergyLiveStatus {
  return {
    id: 1, energy_site_id: 100, solar_power: 4200, load_power: 2500,
    grid_power: -700, battery_power: -1000, percentage_charged: 78,
    grid_services_power: null, energy_left: null, total_pack_energy: null,
    grid_status: 'Connected', backup_capable: true, storm_mode_active: false,
    timestamp: NOW, fetched_at: NOW, ...overrides,
  };
}

function query<T>(data: T, refetch: () => void, overrides: {
  isLoading?: boolean; isFetching?: boolean; isError?: boolean; isStale?: boolean;
  error?: Error; dataUpdatedAt?: number;
} = {}) {
  return {
    data, refetch, isLoading: false, isFetching: false, isError: false, isStale: false,
    error: null, dataUpdatedAt: NOW_MS, ...overrides,
  };
}

const clients: QueryClient[] = [];

function mount(pack: unknown = 'classic', size: WidgetSize = { cols: 2, rows: 3 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <LivePowerFlowWidget size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

function diagram() {
  return screen.getByRole('img', { name: /^Live power flow:/ });
}

function headline(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('.widget-big-number');
  expect(element).not.toBeNull();
  return within(element!);
}

function facts(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('[data-max-per-row]');
  expect(element).not.toBeNull();
  return within(element!);
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="siteflow"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
  mocks.sites.mockReturnValue(query([site], mocks.refreshSites));
  mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
});

describe.each(Object.entries(PACK_APPEARANCES))('Live power flow — %s / %s', (packId, appearance) => {
  it('recomposes the real site diagram, signed readings and source context, preserves refresh and returns to Classic', async () => {
    mocks.sites.mockReturnValue(query([site, { ...site, id: 2, energy_site_id: 200 }], mocks.refreshSites));
    const view = mount();
    const classicDiagram = diagram().innerHTML;
    const topology = () => ({
      nodes: [...diagram().querySelectorAll('[data-flow-node]')].map(node => node.getAttribute('data-flow-node')),
      edges: [...diagram().querySelectorAll('[data-flow-edge]')].map(edge => ({
        path: edge.getAttribute('d'), motion: edge.getAttribute('stroke-dasharray'),
        active: edge.classList.contains('flow-active'),
      })),
    });
    const classicTopology = topology();
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(view.container.querySelector('.widget-big-number')).toBeNull();

    view.selectPack(packId);
    await expectAppearance(view.container, appearance);
    expect(screen.getByRole('heading', { name: 'Live power flow' })).toBeInTheDocument();
    expect(headline(view.container).getByText('Solar production')).toBeInTheDocument();
    expect(headline(view.container).getByText('4.20 kW')).toBeInTheDocument();
    expect(screen.getByText('Energy site · Courtyard')).toBeInTheDocument();
    expect(screen.getByText(`Observed ${NOW}`)).toHaveAttribute('datetime', NOW);
    for (const value of ['2.50 kW', '-0.70 kW', '-1.00 kW', '78%']) {
      expect(facts(view.container).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByText('Connections show measured flow at the site, not source-to-load allocation.')).toBeInTheDocument();
    expect(topology()).toEqual(classicTopology);
    expect(diagram().querySelectorAll('[data-flow-node]')).toHaveLength(5);
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(4);
    expect(diagram().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(4);
    for (const label of ['Solar', 'Grid', 'Home', 'Battery', '4.20 kW', '0.70 kW', '1.00 kW', '2.50 kW', '78%']) {
      expect(within(diagram()).getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-family="siteflow"] .lucide-sun')).toBeInTheDocument();
    expect(mocks.live).toHaveBeenLastCalledWith(100);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshSites).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
    view.selectPack('classic');
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(view.container.querySelector('.widget-big-number')).toBeNull();
    expect(screen.queryByText('Energy site · Courtyard')).not.toBeInTheDocument();
    expect(diagram().innerHTML).toBe(classicDiagram);
  });

  it('retains all four measured bus connections and full labels in a single-column allocation', async () => {
    mocks.live.mockReturnValue(query(snapshot({
      solar_power: 1000, grid_power: 3000, battery_power: -2000, load_power: 2000,
    }), mocks.refreshLive));
    const { container } = mount(packId, { cols: 1, rows: 2 });
    await expectAppearance(container, appearance);
    expect(container.querySelector('[data-max-per-row]')).toHaveAttribute('data-max-per-row', '2');
    expect(diagram().querySelectorAll('[data-flow-node]')).toHaveLength(5);
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(4);
    expect(within(diagram()).getByText('Battery')).toBeInTheDocument();
    expect(within(diagram()).getByText('Solar')).toBeInTheDocument();
    expect(within(diagram()).getByText('3.00 kW')).toBeInTheDocument();
    expect(headline(container).getByText('1.00 kW')).toBeInTheDocument();
    expect(facts(container).getByText('-2.00 kW')).toBeInTheDocument();
    expect(facts(container).getByText('78%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshSites).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
  });

  it('keeps reversed solar, grid, battery and load directions, rather than assuming a solar-to-home sequence', async () => {
    mocks.live.mockReturnValue(query(snapshot({
      solar_power: -1000, grid_power: 2000, battery_power: 1500, load_power: -500,
    }), mocks.refreshLive));
    const { container } = mount(packId);
    await expectAppearance(container, appearance);
    expect(headline(container).getByText('Solar')).toBeInTheDocument();
    expect(headline(container).getByText('-1.00 kW')).toBeInTheDocument();
    expect(screen.queryByText('Solar production')).not.toBeInTheDocument();
    for (const value of ['-0.50 kW', '2.00 kW', '1.50 kW']) {
      expect(facts(container).getByText(value)).toBeInTheDocument();
    }
    const paths = Array.from(diagram().querySelectorAll('[data-flow-edge]'), edge => edge.getAttribute('d'));
    expect(paths).toEqual([
      'M180 150 C180 150 180 38 180 38',
      'M180 262 C180 262 180 150 180 150',
      'M60 150 C120 150 120 150 180 150',
      'M300 150 C240 150 240 150 180 150',
    ]);
  });

  it('distinguishes missing and invalid readings from a genuinely measured zero system', async () => {
    mocks.live.mockReturnValue(query(snapshot({
      solar_power: null, grid_power: Number.NaN, battery_power: null,
      load_power: Number.POSITIVE_INFINITY, percentage_charged: 101,
    }), mocks.refreshLive));
    const view = mount(packId);
    await expectAppearance(view.container, appearance);
    expect(headline(view.container).getByText('—')).toBeInTheDocument();
    expect(facts(view.container).getAllByText('—')).toHaveLength(4);
    expect(within(diagram()).getByText('—')).toBeInTheDocument();
    expect(diagram().querySelectorAll('[data-flow-node]')).toHaveLength(5);
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(0);
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
    for (const invalid of ['0.00 kW', '0%', '101%', 'NaN', 'Infinity']) {
      expect(screen.queryByText(invalid)).not.toBeInTheDocument();
    }

    mocks.live.mockReturnValue(query(snapshot({
      solar_power: 0, grid_power: 0, battery_power: 0, load_power: 0, percentage_charged: 0,
    }), mocks.refreshLive));
    view.selectPack(packId);
    expect(headline(view.container).getByText('0.00 kW')).toBeInTheDocument();
    expect(facts(view.container).getAllByText('0.00 kW')).toHaveLength(3);
    expect(facts(view.container).getByText('0%')).toBeInTheDocument();
    expect(within(diagram()).getByText('0%')).toBeInTheDocument();
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(0);
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'ok');
  });

  it('keeps distinct no-site and no-snapshot shells without inventing flows or readings', async () => {
    mocks.sites.mockReturnValue(query([], mocks.refreshSites));
    mocks.live.mockReturnValue(query(undefined, mocks.refreshLive));
    const view = mount(packId);
    await expectAppearance(view.container, appearance);
    expect(screen.getByRole('heading', { name: 'Live power flow' })).toBeInTheDocument();
    expect(screen.getByText('No Tesla energy site linked')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Live power flow:/ })).not.toBeInTheDocument();
    expect(view.container.querySelector('.widget-big-number')).toBeNull();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(mocks.live).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshSites).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).not.toHaveBeenCalled();

    mocks.sites.mockReturnValue(query([site], mocks.refreshSites));
    view.selectPack(packId);
    expect(screen.getByText('No live power data')).toBeInTheDocument();
    expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
    expect(headline(view.container).getByText('—')).toBeInTheDocument();
    expect(facts(view.container).getAllByText('—')).toHaveLength(4);
    expect(screen.queryByRole('img', { name: /^Live power flow:/ })).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 kW')).not.toBeInTheDocument();
    expect(mocks.live).toHaveBeenLastCalledWith(100);
  });

  it('retains the snapshot, source time and disabled refresh during a failed background fetch', async () => {
    const timestamp = new Date(NOW_MS - 180_000).toISOString();
    mocks.live.mockReturnValue(query(snapshot({ timestamp }), mocks.refreshLive, {
      isError: true, isFetching: true, isStale: true, error: new Error('Refresh failed'),
    }));
    const view = mount(packId);
    await expectAppearance(view.container, appearance);
    expect(headline(view.container).getByText('4.20 kW')).toBeInTheDocument();
    expect(facts(view.container).getByText('-0.70 kW')).toBeInTheDocument();
    expect(screen.getByText(`Observed ${timestamp}`)).toHaveAttribute('datetime', timestamp);
    expect(screen.getByText('Snapshot is stale or its observation time is unverified.')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-motion-suppressed', 'true');
    expect(view.container.querySelector('.widget-flow-frame')).toHaveAttribute('data-motion-suppressed', 'true');
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(4);
    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(mocks.refreshSites).not.toHaveBeenCalled();
    expect(mocks.refreshLive).not.toHaveBeenCalled();

    mocks.live.mockReturnValue(query(snapshot({ timestamp }), mocks.refreshLive, {
      isError: true, error: new Error('Refresh failed'),
    }));
    view.selectPack(packId);
    expect(screen.getByRole('button', { name: /^Refresh/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refreshSites).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).toHaveBeenCalledOnce();
  });

  it('preserves loading and fatal retries rather than displaying a successful empty system', async () => {
    mocks.sites.mockReturnValue(query(undefined, mocks.refreshSites, { isLoading: true, isFetching: true, dataUpdatedAt: 0 }));
    mocks.live.mockReturnValue(query(undefined, mocks.refreshLive, { dataUpdatedAt: 0 }));
    const view = mount(packId);
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No Tesla energy site linked')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Live power flow:/ })).not.toBeInTheDocument();

    mocks.sites.mockReturnValue(query([site], mocks.refreshSites));
    mocks.live.mockReturnValue(query(undefined, mocks.refreshLive, {
      isLoading: true, isFetching: true, dataUpdatedAt: 0,
    }));
    view.selectPack(packId);
    expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No live power data')).not.toBeInTheDocument();

    mocks.live.mockReturnValue(query(undefined, mocks.refreshLive, {
      isError: true, error: new Error('Initial live failure'), dataUpdatedAt: 0,
    }));
    view.selectPack(packId);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No live power data')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00 kW')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(mocks.refreshSites).toHaveBeenCalledOnce();
    expect(mocks.refreshLive).toHaveBeenCalledOnce();

    mocks.live.mockReturnValue(query(snapshot(), mocks.refreshLive));
    view.selectPack(packId);
    await expectAppearance(view.container, appearance);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(headline(view.container).getByText('4.20 kW')).toBeInTheDocument();
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(4);
  });

  it.each(['', 'unparseable', '2026-11-06T12:00:06.000Z'])('does not imply current flow from an unverified source time %j', async timestamp => {
    mocks.live.mockReturnValue(query(snapshot({ timestamp }), mocks.refreshLive));
    const { container } = mount(packId);
    await expectAppearance(container, appearance);
    expect(screen.getByText('Snapshot is stale or its observation time is unverified.')).toBeInTheDocument();
    expect(container.querySelector('.widget-flow-frame')).toHaveAttribute('data-motion-suppressed', 'true');
    expect(headline(container).getByText('4.20 kW')).toBeInTheDocument();
    expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(4);
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument();
  });
});

it('preserves default Classic and recovers unknown pack IDs without a presentation or duplicate controller', async () => {
  const view = mount(undefined);
  const classicDiagram = diagram().innerHTML;
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  view.selectPack('v7');
  await expectAppearance(view.container, 'pixel');
  view.selectPack('retired-pack');
  expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(view.container.querySelector('.widget-big-number')).toBeNull();
  expect(diagram().innerHTML).toBe(classicDiagram);
  expect(mocks.refreshSites).not.toHaveBeenCalled();
  expect(mocks.refreshLive).not.toHaveBeenCalled();
});
