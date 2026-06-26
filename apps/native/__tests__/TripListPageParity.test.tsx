import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {useTrips} from '../src/web-parity/api/hooks/useTrips';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import TripListPage from '../src/web-parity/features/trips/pages/TripListPage';

jest.mock('../src/web-parity/api/hooks/useTrips', () => ({
  useTrips: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

const mockUseTrips = useTrips as unknown as jest.Mock;
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

// The ScrollView's `refreshControl` prop holds a React element with a circular
// fiber reference, so JSON.stringify(tree.toJSON()) throws. Walk the instance
// tree for the testID instead (props-only, no serialisation).
function hasTestID(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  id: string,
): boolean {
  if (!tree) {
    return false;
  }
  return (
    tree.root.findAll(node => Boolean(node.props && node.props.testID === id))
      .length > 0
  );
}

const SETTINGS = {
  unit_of_length: 'mi',
  unit_of_temp: 'F',
  unit_of_pressure: 'psi',
  currency_symbol: '$',
  decimal_precision: 2,
};

const VEHICLE_A = {id: 1, display_name: 'Model 3 Performance'};
const VEHICLE_B = {id: 2, display_name: 'Model Y Long Range'};

function tripStub(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    vehicle_id: 1,
    name: 'Coast Road Trip',
    start_date: '2025-01-10T08:00:00Z',
    end_date: '2025-01-12T18:00:00Z',
    started_at: '2025-01-10T08:00:00Z',
    ended_at: '2025-01-12T18:00:00Z',
    total_distance_m: 480_000,
    total_energy_wh: 84_000,
    total_duration_s: 120_000,
    total_cost: 25.5,
    drive_count: 6,
    charge_count: 2,
    created_at: '2025-01-12T18:00:00Z',
    ...overrides,
  };
}

const TRIPS = [
  tripStub(),
  tripStub({
    id: 2,
    name: 'Weekend Commute',
    total_distance_m: 120_000,
    total_energy_wh: 21_000,
    total_cost: 0,
    drive_count: 3,
    charge_count: 0,
  }),
];

beforeEach(() => {
  mockUseSettings.mockReturnValue({data: SETTINGS});
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A]});
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<TripListPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('renders skeleton tiles instead of summary cards while loading', async () => {
  mockUseTrips.mockReturnValue({
    data: undefined,
    isLoading: true,
    refetch: jest.fn(),
  });

  const tree = await render();
  const text = textOf(tree);

  // The scaffold still renders, but the summary grid is swapped for skeletons.
  expect(hasTestID(tree, 'trip-list-page')).toBe(true);
  expect(text).toContain('Trips');
  expect(text).not.toContain('Total Distance');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the empty state and hides pagination when there are no trips', async () => {
  mockUseTrips.mockReturnValue({
    data: [],
    isLoading: false,
    refetch: jest.fn(),
  });

  const tree = await render();
  const text = textOf(tree);

  expect(hasTestID(tree, 'trip-list-page')).toBe(true);
  expect(text).toContain('No trips recorded yet');
  expect(hasTestID(tree, 'trip-list-pagination')).toBe(false);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders summary stats, the chart, the trip list and pagination once trips exist', async () => {
  mockUseTrips.mockReturnValue({
    data: TRIPS,
    isLoading: false,
    refetch: jest.fn(),
  });

  const tree = await render();
  const text = textOf(tree);

  expect(hasTestID(tree, 'trip-list-page')).toBe(true);
  expect(hasTestID(tree, 'trip-list-range')).toBe(true);
  expect(hasTestID(tree, 'trip-list-pagination')).toBe(true);

  // Header + every summary card + section heading is present.
  expect(text).toContain('Total Distance');
  expect(text).toContain('Energy Used');
  expect(text).toContain('Total Cost');
  expect(text).toContain('Total Trips');
  expect(text).toContain('Top Trips by Distance');
  expect(text).toContain('All Trips');

  // Both trip rows surface their names.
  expect(text).toContain('Coast Road Trip');
  expect(text).toContain('Weekend Commute');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the vehicle selector when vehicles are available', async () => {
  mockUseTrips.mockReturnValue({
    data: TRIPS,
    isLoading: false,
    refetch: jest.fn(),
  });
  mockUseVehicles.mockReturnValue({data: [VEHICLE_A, VEHICLE_B]});

  const tree = await render();
  const text = textOf(tree);

  expect(hasTestID(tree, 'trip-list-vehicle-select')).toBe(true);
  expect(text).toContain('Model 3 Performance');
  expect(text).toContain('Model Y Long Range');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
