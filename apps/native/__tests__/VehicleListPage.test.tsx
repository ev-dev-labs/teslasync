import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// VehicleListPage uses @tanstack/react-query directly (useQuery/useMutation/
// useQueryClient) plus the ported usePinned/useSettings/useVehicles hooks. They
// are mocked so the page resolves synchronously without a QueryClientProvider,
// network, or open handles (the MileagePage / SmartChargePage mocking
// precedent). All referenced module variables are `mock`-prefixed so the
// jest.mock factories may close over them.
type Query<T> = {
  data?: T;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  error?: unknown;
  refetch?: () => unknown;
};

type Mutation = {
  mutate: (vars?: unknown) => void;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
};

type Vehicle = {
  id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  model: string;
  trim_badging: string;
};

type VehicleState = {
  vehicle_id: number;
  state: string;
  speed: number;
  battery_level: number;
  rated_range: number;
  odometer: number;
  is_charging: boolean;
  charger_power: number;
  is_locked: boolean;
  sentry_mode: boolean;
};

const vehicleA: Vehicle = {
  id: 7,
  vehicle_id: 7,
  vin: '5YJ3E1EA7KF000007',
  display_name: 'Bluey',
  model: 'Model 3',
  trim_badging: 'Long Range',
};
const vehicleB: Vehicle = {
  id: 8,
  vehicle_id: 8,
  vin: '5YJSA1E26MF000008',
  display_name: 'Reddy',
  model: 'Model S',
  trim_badging: 'Plaid',
};

const stateA: VehicleState = {
  vehicle_id: 7,
  state: 'online',
  speed: 0,
  battery_level: 72,
  rated_range: 400_000,
  odometer: 1_000_000,
  is_charging: false,
  charger_power: 0,
  is_locked: true,
  sentry_mode: false,
};

function makeQuery<T>(overrides: Query<T>): Required<Query<T>> {
  return {
    data: undefined as unknown as T,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    error: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

let mockVehiclesQuery: Required<Query<Vehicle[]>>;
let mockFleetStatesQuery: Query<{vehicle: Vehicle; state: VehicleState | null}[]>;
let mockPinned: Query<{item_id: string; position: number}[]>;
let mockSettings: Query<{unit_of_length: string; decimal_precision?: number}>;
let mockMutation: Mutation;

function resetMocks() {
  mockVehiclesQuery = makeQuery<Vehicle[]>({data: [vehicleA]});
  mockFleetStatesQuery = {data: [{vehicle: vehicleA, state: stateA}]};
  mockPinned = {data: []};
  mockSettings = {data: {unit_of_length: 'km'}};
  mockMutation = {
    mutate: jest.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  };
}

resetMocks();

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: {queryKey: unknown[]}) => {
    const key = Array.isArray(options.queryKey) ? options.queryKey[0] : options.queryKey;
    if (key === 'vehicles') {
      return mockVehiclesQuery;
    }
    if (key === 'fleet-vehicle-states') {
      return mockFleetStatesQuery;
    }
    return {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isStale: false,
      isError: false,
      dataUpdatedAt: Date.now(),
      error: null,
      refetch: jest.fn(),
    };
  },
  useMutation: () => mockMutation,
  useQueryClient: () => ({invalidateQueries: jest.fn()}),
}));

jest.mock('../src/web-parity/api/hooks/usePinned', () => ({
  usePinned: () => mockPinned,
  useTogglePin: () => ({mutate: jest.fn(), isPending: false}),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => mockSettings,
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  fetchVehicleState: jest.fn(),
}));

jest.mock('../src/web-parity/api/client', () => ({
  request: jest.fn(),
}));

import VehicleListPage from '../src/web-parity/features/vehicles/pages/VehicleListPage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const activeTrees: Renderer[] = [];

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  activeTrees.push(tree!);
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
  // Unmount every rendered tree so the AnimatedNumber effect cleanup cancels its
  // pending requestAnimationFrame — otherwise the RAF polyfill leaks a timer past
  // teardown (--detectOpenHandles).
  ReactTestRenderer.act(() => {
    while (activeTrees.length > 0) {
      activeTrees.pop()!.unmount();
    }
  });
  resetMocks();
  jest.restoreAllMocks();
});

/* ── loading skeleton ── */

test('renders the loading skeleton while the fleet is loading', () => {
  mockVehiclesQuery = makeQuery<Vehicle[]>({isLoading: true, data: undefined});
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'vehicle-list-skeleton')).toBe(true);
  // Body sections are gated behind the skeleton.
  expect(allText(tree)).not.toContain('All Vehicles');
});

/* ── error state ── */

test('renders the error panel when the fleet query errors', () => {
  mockVehiclesQuery = makeQuery<Vehicle[]>({
    isError: true,
    error: new Error('boom'),
    data: undefined,
  });
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'vehicle-list-page-error')).toBe(true);
  expect(allText(tree)).toContain('Failed to load vehicles.');
});

/* ── empty state ── */

test('renders the empty state when there are no vehicles', () => {
  mockVehiclesQuery = makeQuery<Vehicle[]>({data: []});
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'vehicles-empty')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('No vehicles yet');
  expect(text).toContain('Sync from Tesla');
});

/* ── fleet summary metrics ── */

test('renders the four fleet-summary tiles with converted values', () => {
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'fleet-summary')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Total Vehicles');
  expect(text).toContain('Avg Battery');
  expect(text).toContain('Total Range (km)');
  expect(text).toContain('Charging / Online');
  // avgBattery 72 → fmtNumber default 2dp → "72.00%"; total range 400000 m → 400 km.
  expect(text).toContain('72.00%');
  expect(text).toContain('400.00');
  // chargingCount 0 / onlineCount 1.
  expect(text).toContain('0 / 1');
});

/* ── battery status panel ── */

test('renders the fleet battery status panel with a per-vehicle bar', () => {
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'battery-status-panel')).toBe(true);
  expect(hasHost(tree, 'battery-status-empty')).toBe(false);
  const text = allText(tree);
  expect(text).toContain('Fleet Battery Status');
  expect(text).toContain('72%');
  // rated_range 400000 m → "400.0 km" (distance precision fallback = 1).
  expect(text).toContain('400.0 km');
});

test('shows the no-data state in the battery panel when no states resolve', () => {
  mockFleetStatesQuery = {data: [{vehicle: vehicleA, state: null}]};
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'battery-status-empty')).toBe(true);
  expect(allText(tree)).toContain('No data available');
});

/* ── vehicle cards ── */

test('renders a vehicle card with name, status badge, and battery', () => {
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'vehicles-list')).toBe(true);
  expect(hasHost(tree, 'vehicles-card')).toBe(true);
  expect(hasHost(tree, 'pin-button')).toBe(true);
  expect(hasHost(tree, 'delete-vehicle-7')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Bluey');
  expect(text).toContain('Model 3');
  expect(text).toContain('Long Range');
  expect(text).toContain('5YJ3E1EA7KF000007');
  // state 'online', not charging, speed 0 → derived status 'online'.
  expect(text).toContain('online');
});

/* ── compare button gating ── */

test('hides the compare button with a single vehicle', () => {
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'compare-button')).toBe(false);
  expect(hasHost(tree, 'sync-button')).toBe(true);
});

test('shows the compare button when there are at least two vehicles', () => {
  mockVehiclesQuery = makeQuery<Vehicle[]>({data: [vehicleA, vehicleB]});
  mockFleetStatesQuery = {
    data: [
      {vehicle: vehicleA, state: stateA},
      {vehicle: vehicleB, state: null},
    ],
  };
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'compare-button')).toBe(true);
  expect(allText(tree)).toContain('Reddy');
});

/* ── sync banner ── */

test('renders the sync success banner when the sync mutation succeeds', () => {
  mockMutation = {
    mutate: jest.fn(),
    isPending: false,
    isSuccess: true,
    isError: false,
    error: null,
  };
  const tree = render(<VehicleListPage />);
  expect(hasHost(tree, 'sync-success-banner')).toBe(true);
  expect(allText(tree)).toContain('Vehicles synced successfully.');
});

/* ── sync button triggers the mutation ── */

test('invokes the sync mutation when the sync button is pressed', () => {
  const tree = render(<VehicleListPage />);
  const button = tree.root.findAll(
    (node: ReactTestInstance) =>
      node.props?.testID === 'sync-button' && typeof node.props?.onPress === 'function',
  )[0];
  ReactTestRenderer.act(() => {
    button.props.onPress();
  });
  expect(mockMutation.mutate).toHaveBeenCalled();
});

/* ── delete dialog opens on remove ── */

test('opens the delete confirmation dialog when remove is pressed', () => {
  const tree = render(<VehicleListPage />);
  const del = tree.root.findAll(
    (node: ReactTestInstance) =>
      node.props?.testID === 'delete-vehicle-7' &&
      typeof node.props?.onPress === 'function',
  )[0];
  ReactTestRenderer.act(() => {
    del.props.onPress();
  });
  const text = allText(tree);
  expect(text).toContain('Remove Vehicle');
  expect(text).toContain('Bluey');
});
