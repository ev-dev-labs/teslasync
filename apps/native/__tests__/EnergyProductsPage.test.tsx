import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native energy hooks are mocked so EnergyProductsPage resolves its queries
// synchronously without a QueryClientProvider, network, or open handles (the
// MileagePage / TeslaRegionPage mocking precedent). All referenced module
// variables are `mock`-prefixed so the jest.mock factory may close over them.
type Query<T> = {
  data?: T;
  isLoading?: boolean;
  error?: unknown;
};

type Mutation = {mutate: () => void; isPending: boolean};

type EnergySite = {
  id: number;
  energy_site_id: number;
  resource_type: string;
  site_name: string;
  total_pack_energy: number | null;
  percentage_charged: number | null;
  battery_type: string | null;
  backup_capable: boolean;
  storm_mode_enabled: boolean;
  has_solar: boolean;
  has_battery: boolean;
  has_grid: boolean;
  tou_capable: boolean;
  storm_mode_capable: boolean;
  fetched_at: string;
};

type SiteInfoResponse = {
  data: Record<string, unknown> | null;
  fetched_at: string | null;
};

const site: EnergySite = {
  id: 1,
  energy_site_id: 12345,
  resource_type: 'battery',
  site_name: 'Home Powerwall',
  total_pack_energy: 13500,
  percentage_charged: 87.5,
  battery_type: 'Powerwall 2',
  backup_capable: true,
  storm_mode_enabled: true,
  has_solar: true,
  has_battery: true,
  has_grid: true,
  tou_capable: true,
  storm_mode_capable: true,
  fetched_at: '2026-06-25T10:00:00Z',
};

const siteInfo: Record<string, unknown> = {
  default_real_mode: 'autonomous',
  backup_reserve_percent: 20,
  battery_count: 2,
  nameplate_power: 10000,
  nameplate_energy: 27000,
  version: '23.44.0',
  installation_time_zone: 'America/Los_Angeles',
  components: {solar: true, battery: true, grid: true, tou_capable: true},
};

let mockSites: Query<EnergySite[]> = {data: [site], isLoading: false, error: null};
let mockSiteInfo: Query<SiteInfoResponse> = {
  data: {data: siteInfo, fetched_at: '2026-06-25T10:05:00Z'},
  isLoading: false,
};
const mockRefreshSites: Mutation = {mutate: jest.fn(), isPending: false};
const mockRefreshSiteInfo: Mutation = {mutate: jest.fn(), isPending: false};
const mockUpdateTOU: Mutation = {mutate: jest.fn(), isPending: false};

jest.mock('../src/web-parity/api/hooks/useEnergy', () => ({
  useTeslaEnergySites: () => mockSites,
  useRefreshTeslaEnergySites: () => mockRefreshSites,
  useTeslaEnergySiteInfo: () => mockSiteInfo,
  useRefreshTeslaEnergySiteInfo: () => mockRefreshSiteInfo,
  useUpdateTOUSettings: () => mockUpdateTOU,
}));

import EnergyProductsPage from '../src/web-parity/features/battery/pages/EnergyProductsPage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

afterEach(() => {
  mockSites = {data: [site], isLoading: false, error: null};
  mockSiteInfo = {
    data: {data: siteInfo, fetched_at: '2026-06-25T10:05:00Z'},
    isLoading: false,
  };
  jest.clearAllMocks();
});

/* ── scaffold + header ── */

test('renders the page scaffold with title, subtitle, and refresh action', () => {
  const tree = render(<EnergyProductsPage />);
  expect(hasHost(tree, 'energy-products-page')).toBe(true);
  expect(hasHost(tree, 'energy-products-refresh')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Energy Products');
  expect(text).toContain(
    'Powerwalls, Solar Panels & Wall Connectors discovered from Tesla',
  );
});

/* ── summary metric cards ── */

test('renders the four summary stat cards with counts', () => {
  const tree = render(<EnergyProductsPage />);
  const text = allText(tree);
  expect(text).toContain('Energy Sites');
  expect(text).toContain('With Solar');
  expect(text).toContain('With Battery');
  expect(text).toContain('Backup Capable');
});

/* ── site card ── */

test('renders a site card with header, stats, and capability badges', () => {
  const tree = render(<EnergyProductsPage />);
  expect(hasHost(tree, 'energy-site-card-1')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Home Powerwall');
  expect(text).toContain('Powerwall 2'); // battery_type badge
  expect(text).toContain('87.5%'); // percentage_charged
  expect(text).toContain('13.5 kWh'); // total_pack_energy via fmtEnergy
  // capability badge labels
  expect(text).toContain('Solar');
  expect(text).toContain('Storm Watch');
  expect(text).toContain('Storm Mode Active'); // storm_mode_enabled
});

/* ── embedded site info section ── */

test('renders the site info section from the site-info query', () => {
  const tree = render(<EnergyProductsPage />);
  const text = allText(tree);
  expect(text).toContain('Site Configuration');
  expect(text).toContain('Time-Based Control'); // operationModeLabel(autonomous)
  expect(text).toContain('Backup Reserve');
  expect(text).toContain('Rated Power');
  expect(text).toContain('10.0 kW'); // nameplate_power via fmtPower
  expect(text).toContain('27.0 kWh'); // nameplate_energy via fmtEnergy
  expect(text).toContain('Firmware');
  expect(text).toContain('America/Los_Angeles');
  expect(text).toContain('Rate Plan');
  expect(text).toContain('No rate plan configured'); // tariffName resolves undefined
  expect(hasHost(tree, 'tou-update-button')).toBe(true);
});

/* ── site info empty state ── */

test('shows the site-info empty state when the site-info data is null', () => {
  mockSiteInfo = {data: {data: null, fetched_at: null}, isLoading: false};
  const tree = render(<EnergyProductsPage />);
  expect(hasHost(tree, 'energy-site-info-empty')).toBe(true);
  expect(allText(tree)).toContain('No site configuration loaded yet');
});

/* ── products empty state ── */

test('shows the products empty state when no energy sites are returned', () => {
  mockSites = {data: [], isLoading: false, error: null};
  const tree = render(<EnergyProductsPage />);
  expect(hasHost(tree, 'energy-products-empty')).toBe(true);
  expect(allText(tree)).toContain('No energy products found');
  expect(hasHost(tree, 'energy-site-card-1')).toBe(false);
});

/* ── loading gates the body behind the spinner ── */

test('shows the loading spinner and hides the body while sites load', () => {
  mockSites = {data: undefined, isLoading: true, error: null};
  const tree = render(<EnergyProductsPage />);
  expect(hasHost(tree, 'energy-products-loading')).toBe(true);
  expect(allText(tree)).not.toContain('Home Powerwall');
});

/* ── error box ── */

test('renders the error box when the sites query errors', () => {
  mockSites = {data: undefined, isLoading: false, error: new Error('boom')};
  const tree = render(<EnergyProductsPage />);
  expect(hasHost(tree, 'energy-products-error')).toBe(true);
  expect(allText(tree)).toContain('boom');
});
