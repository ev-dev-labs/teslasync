import React from 'react';
import {Alert} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// react-query, the native useVehicles hook, and the devtools client are mocked
// so the page resolves its queries synchronously without a QueryClientProvider,
// network/fetch, or real Alert side effects (keeps the suite deterministic +
// free of open handles). Mirrors the FleetAPIPage / ApiPlaygroundPage mocking
// precedent. All referenced module variables are `mock`-prefixed so the
// jest.mock factory may close over them; their bodies read the latest value
// lazily at call time.
type QueryResult<T> = {
  data?: T;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  isError: boolean;
  refetch: () => void;
};

type KeysResult<T> = {data?: T; isError: boolean};

type MockSignals = {
  vehicle_id: number;
  signal_count: number;
  signals: Record<string, {value: number | string | boolean; type: string}>;
  meta?: Record<string, unknown>;
};

type MockVehicle = {id: number; vin: string; display_name: string};

function fullSignals(): MockSignals {
  return {
    vehicle_id: 1,
    signal_count: 3,
    signals: {
      battery_level: {value: 80, type: 'number'},
      charge_state: {value: 'Charging', type: 'string'},
      climate_on: {value: true, type: 'boolean'},
    },
    meta: {
      live_signal_store_mode: 'hybrid',
      redis_key: 'vehicle:1:signals',
      redis_field_count: 3,
      l1_signal_count: 3,
      l1_last_seen_at: '2026-06-25T10:00:00Z',
      l2_last_seen_at: '2026-06-25T10:00:00Z',
      vehicle_vin: 'VINONE',
    },
  };
}

const refetch = jest.fn();

let mockSignalQuery: QueryResult<MockSignals> = {
  data: fullSignals(),
  isLoading: false,
  isFetching: false,
  error: null,
  isError: false,
  refetch,
};

let mockKeysQuery: KeysResult<{keys: unknown[]; total: number}> = {
  data: {keys: [], total: 0},
  isError: false,
};

let mockVehicles: {data?: MockVehicle[]} = {
  data: [
    {id: 1, vin: 'VINONE', display_name: 'Car One'},
    {id: 2, vin: 'VINTWO', display_name: 'Car Two'},
  ],
};

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
let mockPurgeOne = jest.fn().mockResolvedValue({vehicle_id: 1, purged: true});
let mockPurgeAll = jest
  .fn()
  .mockResolvedValue({purged: 2, scanned: 2, limit: 1000, has_more: false});

jest.mock('@tanstack/react-query', () => ({
  useQuery: (opts: {queryKey: unknown}) => {
    const key = Array.isArray(opts.queryKey) ? opts.queryKey[0] : opts.queryKey;
    if (key === 'redis-signal-keys') {
      return mockKeysQuery;
    }
    return mockSignalQuery;
  },
  useQueryClient: () => ({invalidateQueries: mockInvalidate}),
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => mockVehicles,
}));

jest.mock('../src/web-parity/api/devtools', () => ({
  getRedisSignals: jest.fn(),
  getRedisSignalKeys: jest.fn(),
  purgeRedisSignals: (...args: unknown[]) => mockPurgeOne(...args),
  purgeAllRedisSignals: (...args: unknown[]) => mockPurgeAll(...args),
}));

import RedisSignalViewerPage from '../src/web-parity/features/admin/pages/RedisSignalViewerPage';

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

function press(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function changeText(tree: Renderer, testID: string, text: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onChangeText === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onChangeText(text);
  });
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
  mockSignalQuery = {
    data: fullSignals(),
    isLoading: false,
    isFetching: false,
    error: null,
    isError: false,
    refetch,
  };
  mockKeysQuery = {data: {keys: [], total: 0}, isError: false};
  mockVehicles = {
    data: [
      {id: 1, vin: 'VINONE', display_name: 'Car One'},
      {id: 2, vin: 'VINTWO', display_name: 'Car Two'},
    ],
  };
  mockPurgeOne = jest.fn().mockResolvedValue({vehicle_id: 1, purged: true});
  mockPurgeAll = jest
    .fn()
    .mockResolvedValue({purged: 2, scanned: 2, limit: 1000, has_more: false});
  mockInvalidate.mockClear();
  refetch.mockClear();
});

/* ── scaffold ── */

test('renders the scaffold + the select-a-vehicle prompt before a vehicle is chosen', () => {
  const tree = render(<RedisSignalViewerPage />);
  expect(hasHost(tree, 'redis-signal-viewer-page')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Redis Signal Viewer');
  expect(text).toContain('Inspect cached signal values in Redis');
  expect(hasHost(tree, 'redis-select-prompt')).toBe(true);
  // Stats + table are gated behind a selected vehicle.
  expect(hasHost(tree, 'redis-stat-total')).toBe(false);
  expect(hasHost(tree, 'admin:redis-signals')).toBe(false);
});

/* ── selection → stats + meta chips + table ── */

test('selecting a vehicle reveals the stat cards, meta chips, and signal table', () => {
  const tree = render(<RedisSignalViewerPage />);
  press(tree, 'redis-vehicle-option-1');

  const text = allText(tree);
  // Stat cards: total signal_count = 3, one number signal.
  expect(hasHost(tree, 'redis-stat-total')).toBe(true);
  expect(hasHost(tree, 'redis-stat-numbers')).toBe(true);
  expect(text).toContain('Total Signals');
  // Meta chips reflect the hybrid mode + VIN.
  expect(text).toContain('Mode: hybrid');
  expect(text).toContain('VINONE');
  // Table rows for each cached signal (sorted by name).
  expect(hasHost(tree, 'admin:redis-signals')).toBe(true);
  expect(hasHost(tree, 'admin:redis-signals-row-battery_level')).toBe(true);
  expect(hasHost(tree, 'admin:redis-signals-row-charge_state')).toBe(true);
  expect(hasHost(tree, 'admin:redis-signals-row-climate_on')).toBe(true);
});

/* ── search filter ── */

test('the search box filters the table rows by signal name', () => {
  const tree = render(<RedisSignalViewerPage />);
  press(tree, 'redis-vehicle-option-1');
  changeText(tree, 'redis-search-input', 'battery');

  expect(hasHost(tree, 'admin:redis-signals-row-battery_level')).toBe(true);
  expect(hasHost(tree, 'admin:redis-signals-row-charge_state')).toBe(false);
  expect(hasHost(tree, 'admin:redis-signals-row-climate_on')).toBe(false);
});

/* ── category filter ── */

test('the category selector narrows the rows to a single category', () => {
  const tree = render(<RedisSignalViewerPage />);
  press(tree, 'redis-vehicle-option-1');
  press(tree, 'redis-category-option-Climate');

  expect(hasHost(tree, 'admin:redis-signals-row-climate_on')).toBe(true);
  expect(hasHost(tree, 'admin:redis-signals-row-battery_level')).toBe(false);
});

/* ── diagnostic empty-state ── */

test('shows the mode-local diagnostic banner when the cache is empty in local mode', () => {
  mockSignalQuery = {
    data: {
      vehicle_id: 1,
      signal_count: 0,
      signals: {},
      meta: {
        live_signal_store_mode: 'local',
        redis_key: 'vehicle:1:signals',
        redis_field_count: 0,
        l1_signal_count: 0,
        l1_last_seen_at: null,
        l2_last_seen_at: null,
        vehicle_vin: 'VINONE',
      },
    },
    isLoading: false,
    isFetching: false,
    error: null,
    isError: false,
    refetch,
  };
  const tree = render(<RedisSignalViewerPage />);
  press(tree, 'redis-vehicle-option-1');

  expect(hasHost(tree, 'redis-diagnostic-banner')).toBe(true);
  expect(allText(tree)).toContain('Redis L2 writes are disabled');
});

/* ── purge per-vehicle ── */

test('opening the per-vehicle purge dialog and confirming fires purgeRedisSignals', async () => {
  const tree = render(<RedisSignalViewerPage />);
  press(tree, 'redis-vehicle-option-1');

  press(tree, 'redis-purge-button');
  expect(hasHost(tree, 'confirm-dialog')).toBe(true);
  // The dialog title pins the chosen vehicle's label.
  expect(allText(tree)).toContain('Purge Redis (L2) cache for Car One?');

  await ReactTestRenderer.act(async () => {
    const confirm = tree.root.find(
      (node: ReactTestInstance) =>
        node.props.testID === 'confirm-dialog-confirm' &&
        typeof node.props.onPress === 'function',
    );
    confirm.props.onPress();
    await Promise.resolve();
  });

  expect(mockPurgeOne).toHaveBeenCalledWith(1);
});

/* ── purge all (typed confirmation) ── */

test('the cluster-wide purge dialog requires a typed confirmation', () => {
  const tree = render(<RedisSignalViewerPage />);
  press(tree, 'redis-vehicle-option-1');

  press(tree, 'redis-purge-all-button');
  expect(hasHost(tree, 'confirm-dialog')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Purge ALL Redis (L2) caches?');
  expect(text).toContain('Type PURGE ALL to confirm');
  // The typed-confirmation input gate is rendered for the all-vehicles path.
  expect(hasHost(tree, 'confirm-dialog-input')).toBe(true);
});
