import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useChargingSessionsPaginated,
  useCostForecast,
} from '../src/web-parity/api/hooks/useCharging';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import CostAnalysisPage from '../src/web-parity/features/charging/pages/CostAnalysisPage';

jest.mock('../src/web-parity/api/hooks/useCharging', () => ({
  useChargingSessionsPaginated: jest.fn(),
  useCostForecast: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));
// AICostForecastNarration pulls in the AI streaming stack + withAiFeature; the
// page test isolates the cost dashboard, so the overlay is stubbed to nothing.
jest.mock('../src/web-parity/components/ai/AICostForecastNarration', () => ({
  AICostForecastNarration: () => null,
}));

const mockUseSessions = useChargingSessionsPaginated as unknown as jest.Mock;
const mockUseCostForecast = useCostForecast as unknown as jest.Mock;
const mockUseSettings = useSettings as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;

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

const SETTINGS = {
  unit_of_length: 'mi',
  unit_of_temp: 'F',
  unit_of_pressure: 'psi',
  currency_symbol: '$',
  decimal_precision: 2,
  gas_unit: 'gallon',
  chart_palette: 'neon',
};

const VEHICLE_A = {id: 1, display_name: 'Model 3 Performance'};
const VEHICLE_B = {id: 2, display_name: 'Model Y Long Range'};

function sessionStub(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2025-01-10T08:00:00Z',
    ended_at: '2025-01-10T09:00:00Z',
    start_odometer_m: 0,
    end_odometer_m: 200_000,
    start_place: 'Home',
    total_energy_added_wh: 40_000,
    peak_power_w: 11_000,
    cost_decimal: 6.5,
    charger_type: null,
    ...overrides,
  };
}

const SESSIONS = [
  sessionStub(),
  sessionStub({
    id: 2,
    started_at: '2025-02-14T22:30:00Z',
    ended_at: '2025-02-14T23:10:00Z',
    start_odometer_m: 200_000,
    end_odometer_m: 320_000,
    total_energy_added_wh: 55_000,
    peak_power_w: 150_000,
    cost_decimal: 18.25,
    charger_type: 'Tesla',
    start_place: 'Supercharger',
  }),
];

beforeEach(() => {
  mockUseSettings.mockReturnValue({data: SETTINGS});
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A]});
  mockUseCostForecast.mockReturnValue({data: undefined});
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<CostAnalysisPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('shows the loading skeleton while sessions are loading', async () => {
  mockUseSessions.mockReturnValue({data: undefined, isLoading: true});

  const tree = await render();
  const raw = rawOf(tree);

  expect(raw).toContain('cost-analysis-loading');
  expect(raw).not.toContain('cost-analysis-page');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the empty state when there are no charging sessions', async () => {
  mockUseSessions.mockReturnValue({data: [], isLoading: false});

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('cost-analysis-empty');
  expect(text).toContain('No Charging Data');
  expect(raw).not.toContain('cost-analysis-page');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders every cost-analysis section once sessions exist', async () => {
  mockUseSessions.mockReturnValue({data: SESSIONS, isLoading: false});

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('cost-analysis-page');
  expect(raw).toContain('cost-analysis-range');

  // Header + every section heading is present.
  expect(text).toContain('Cost Analysis');
  expect(text).toContain('Total Cost');
  expect(text).toContain('Monthly Cost Trend');
  expect(text).toContain('Cost per kWh Trend');
  expect(text).toContain('Cost by Charger Type');
  expect(text).toContain('Gas vs Electric Savings Calculator');
  expect(text).toContain('Monthly Cost Breakdown');
  expect(text).toContain('Electricity Rate Analysis (Time-of-Use)');
  expect(text).toContain('Cost Forecast');
  expect(text).toContain('Lifetime Summary');
  expect(text).toContain('Environmental Impact');

  // Charger categorisation surfaces both a Home and a Supercharger row.
  expect(text).toContain('Supercharger');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the vehicle selector when vehicles are available', async () => {
  mockUseSessions.mockReturnValue({data: SESSIONS, isLoading: false});
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A, VEHICLE_B]});

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('cost-analysis-vehicle-select');
  expect(text).toContain('Model 3 Performance');
  expect(text).toContain('Model Y Long Range');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
