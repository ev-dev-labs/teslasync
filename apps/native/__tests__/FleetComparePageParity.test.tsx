import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useCostBreakdown, useMonthlyMileage} from '../src/web-parity/api/hooks/useAnalytics';
import {useDrivingStats} from '../src/web-parity/api/hooks/useDriving';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {
  useVehicles,
  useVehicleState,
} from '../src/web-parity/api/hooks/useVehicles';
import FleetComparePage from '../src/web-parity/features/analytics/pages/FleetComparePage';

jest.mock('../src/web-parity/api/hooks/useAnalytics', () => ({
  useCostBreakdown: jest.fn(),
  useMonthlyMileage: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useDriving', () => ({
  useDrivingStats: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
  useVehicleState: jest.fn(),
}));

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseVehicleState = useVehicleState as unknown as jest.Mock;
const mockUseDrivingStats = useDrivingStats as unknown as jest.Mock;
const mockUseCostBreakdown = useCostBreakdown as unknown as jest.Mock;
const mockUseMonthlyMileage = useMonthlyMileage as unknown as jest.Mock;
const mockUseSettings = useSettings as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

const VEHICLE_A = {
  id: 1,
  vehicle_id: 1,
  vin: 'VINAAA',
  display_name: 'Model 3 Performance',
  model: 'Model 3',
  trim_badging: 'P',
  exterior_color: 'red',
  wheel_type: 'sport',
  state: 'online',
  healthy: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const VEHICLE_B = {
  id: 2,
  vehicle_id: 2,
  vin: 'VINBBB',
  display_name: 'Model Y Long Range',
  model: 'Model Y',
  trim_badging: 'LR',
  exterior_color: 'white',
  wheel_type: 'induction',
  state: 'asleep',
  healthy: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function vehicleStateStub(id: number) {
  return {
    data: {
      state: {
        vehicle_id: id,
        state: 'online',
        latitude: 0,
        longitude: 0,
        speed: 0,
        power: 0,
        battery_level: id === 1 ? 82 : 64,
        rated_range: id === 1 ? 480000 : 410000,
        ideal_range: 0,
        odometer: 0,
        inside_temp: 21,
        outside_temp: 14,
        is_climate_on: false,
        is_charging: false,
        charger_power: 0,
        charge_rate: 0,
        time_to_full_charge: 0,
        is_locked: true,
        sentry_mode: id === 1,
        software_version: '2026.4',
      },
    },
    isLoading: false,
  };
}

function drivingStatsStub(scale: number) {
  return {
    data: {
      totalDrives: 100 * scale,
      totalDistanceKm: 1500 * scale,
      totalDurationS: 0,
      avgEfficiencyWhKm: 150 + scale,
      avgSpeedKmh: 45 + scale,
      topSpeedKmh: 120 + scale,
      regenRatio: 0.18,
      regenEnergyWh: 0,
      co2SavedKg: 320 * scale,
    },
    isLoading: false,
  };
}

function costStub(scale: number) {
  return {
    data: {
      total_charging_cost: 200 * scale,
      total_wh: 500000 * scale,
      total_sessions: 30 * scale,
      total_km: 0,
      first_date: '',
      last_date: '',
      equivalent_gas_cost: 0,
      total_savings: 0,
      monthly_savings: 0,
      cost_per_km_ev: 0,
      cost_per_km_ice: 0,
      maintenance_savings_estimate: 0,
      months_of_ownership: 0,
      gas_price: 0,
      gas_efficiency_mpg: 0,
      monthly_breakdown: [],
    },
  };
}

beforeEach(() => {
  mockUseVehicleState.mockImplementation((id: number) => vehicleStateStub(id));
  mockUseDrivingStats.mockImplementation((vehicleId?: string) =>
    drivingStatsStub(vehicleId === '2' ? 2 : 1),
  );
  mockUseCostBreakdown.mockImplementation((vehicleId: string) =>
    costStub(vehicleId === '2' ? 2 : 1),
  );
  mockUseMonthlyMileage.mockReturnValue({data: []});
  mockUseSettings.mockReturnValue({data: undefined});
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<FleetComparePage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('shows a centered spinner while vehicles are loading', async () => {
  mockUseVehicles.mockReturnValue({data: undefined, isLoading: true});

  const tree = await render();
  const raw = rawOf(tree);

  expect(textOf(tree)).toContain('Fleet Comparison');
  expect(raw).toContain('fleet-compare-page');
  expect(raw).toContain('fleet-compare-loading');
  // While loading the selectors/table are gated off, exactly like web.
  expect(raw).not.toContain('fleet-compare-select-a');
  expect(raw).not.toContain('fleet-compare-table');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the single-vehicle EmptyState when fewer than two vehicles exist', async () => {
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A], isLoading: false});

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('fleet-compare-single-vehicle');
  expect(text).toContain('Add a second vehicle to compare');
  expect(text).toContain('Manage vehicles');
  // The comparison body is not rendered for a single-vehicle account.
  expect(raw).not.toContain('fleet-compare-table');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders selectors, status cards, comparison table, and highlights for two vehicles', async () => {
  mockUseVehicles.mockReturnValue({
    data: [VEHICLE_A, VEHICLE_B],
    isLoading: false,
  });

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  // Selectors + disambiguation banner.
  expect(raw).toContain('fleet-compare-select-a');
  expect(raw).toContain('fleet-compare-select-b');
  expect(raw).toContain('fleet-compare-banner');
  expect(text).toContain('Looking to compare time periods instead?');

  // Both vehicle names surface (auto-selected first two).
  expect(text).toContain('Model 3 Performance');
  expect(text).toContain('Model Y Long Range');

  // Comparison table with its lifetime metrics.
  expect(raw).toContain('fleet-compare-table');
  expect(text).toContain('Total Drives');
  expect(text).toContain('Total Distance');
  expect(text).toContain('Avg Efficiency');
  expect(text).toContain('Charge Sessions');

  // Winner highlighting marks the better column with a check.
  expect(text).toContain('✓');

  // Key highlights grid.
  expect(text).toContain('Key Highlights');
  expect(text).toContain('Battery Level');
  expect(text).toContain('Charging Cost');
  expect(text).toContain('CO₂ Saved');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
