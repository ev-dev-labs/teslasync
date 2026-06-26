import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useVehicleLiveSignals} from '../src/web-parity/api/hooks/useTelemetry';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import LiveSignalInspectorPage from '../src/web-parity/features/admin/pages/LiveSignalInspectorPage';

jest.mock('../src/web-parity/api/hooks/useTelemetry', () => ({
  useVehicleLiveSignals: jest.fn(),
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

const mockUseVehicleLiveSignals = useVehicleLiveSignals as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {props?: {testID?: string}; children?: JsonNode | JsonNode[]}
  | JsonNode[];

// Interpolated JSX text (e.g. `Signal ↑`) renders as several adjacent text
// segments, so flatten every text leaf into one string before asserting.
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

function vehiclesStub(
  vehicles: Array<{id: number; display_name: string; vin: string}>,
) {
  return {data: vehicles, isLoading: false};
}

function liveStub(
  signals: Record<string, unknown> | undefined,
  opts: {isLoading?: boolean; dataUpdatedAt?: number} = {},
) {
  return {
    data: signals ? {vehicle_id: 1, signals} : undefined,
    isLoading: opts.isLoading ?? false,
    isError: false,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: opts.dataUpdatedAt ?? 0,
  };
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<LiveSignalInspectorPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

async function pressByTestID(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): Promise<void> {
  const node = tree.root.find(
    n =>
      (n.props as {testID?: string}).testID === testID &&
      typeof (n.props as {onPress?: unknown}).onPress === 'function',
  );
  await ReactTestRenderer.act(async () => {
    (node.props as {onPress: () => void}).onPress();
  });
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue(
    vehiclesStub([
      {id: 1, display_name: 'Garage Model 3', vin: 'VIN-AAA'},
      {id: 2, display_name: '', vin: 'VIN-BBB'},
    ]),
  );
  mockUseVehicleLiveSignals.mockReturnValue(liveStub(undefined));
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the header, vehicle picker, and the no-vehicle empty state', async () => {
  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('live-signal-inspector-page');
  expect(text).toContain('Live Signal Inspector');
  expect(text).toContain(
    'Realtime view of the Redis-cached live signal snapshot. Refreshes every second while this tab is in the foreground.',
  );

  // Vehicle picker: placeholder + both vehicles (display_name, then vin fallback).
  expect(raw).toContain('live-signals-vehicle-select');
  expect(text).toContain('Select vehicle\u2026');
  expect(text).toContain('Garage Model 3');
  expect(text).toContain('VIN-BBB');

  // No vehicle selected -> Radio empty state, no snapshot panel / live indicator.
  expect(raw).toContain('live-signals-no-vehicle');
  expect(text).toContain('Select a vehicle');
  expect(text).toContain(
    'Pick a vehicle from the dropdown above to start streaming its live signal cache.',
  );
  expect(raw).not.toContain('live-signals-panel');
  expect(raw).not.toContain('live-signals-live-indicator');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('selecting a vehicle reveals the snapshot panel, live indicator, and signal rows', async () => {
  const now = new Date().toISOString();
  mockUseVehicleLiveSignals.mockReturnValue(
    liveStub(
      {
        BatteryLevel: {value: 87, timestamp: now},
        Gear: 'Drive',
        Location: {value: {lat: 1, lon: 2}, timestamp: now},
      },
      {dataUpdatedAt: Date.now()},
    ),
  );

  const tree = await render();
  await pressByTestID(tree, 'live-signals-vehicle-option-1');

  const raw = rawOf(tree);
  const text = textOf(tree);

  // Snapshot panel + live indicator + freshness badge now visible.
  expect(raw).toContain('live-signals-panel');
  expect(text).toContain('Live snapshot');
  expect(raw).toContain('live-signals-live-indicator');
  expect(raw).toContain('live-signals-freshness');

  // No-vehicle empty state is gone.
  expect(raw).not.toContain('live-signals-no-vehicle');

  // Each signal renders as a row: name + coerced value (incl. JSON object).
  expect(raw).toContain('live-signals-table');
  expect(raw).toContain('live-signal-row-BatteryLevel');
  expect(raw).toContain('live-signal-row-Gear');
  expect(raw).toContain('live-signal-row-Location');
  expect(text).toContain('BatteryLevel');
  expect(text).toContain('87');
  expect(text).toContain('Drive');
  // Compound object value is stringified, never crashing the row.
  expect(text).toContain('{"lat":1,"lon":2}');
  // Relative timestamp for the just-now envelope.
  expect(text).toContain('just now');

  // Sortable Signal + Last update headers are present.
  expect(raw).toContain('live-signals-sort-name');
  expect(raw).toContain('live-signals-sort-timestamp');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the loading message in the table while the live snapshot loads', async () => {
  mockUseVehicleLiveSignals.mockReturnValue(
    liveStub(undefined, {isLoading: true}),
  );

  const tree = await render();
  await pressByTestID(tree, 'live-signals-vehicle-option-2');

  const raw = rawOf(tree);
  const text = textOf(tree);

  // vin fallback option (display_name was empty) still selectable.
  expect(raw).toContain('live-signals-table-empty');
  expect(text).toContain('Loading\u2026');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the no-signals-cached empty state when the snapshot is empty', async () => {
  mockUseVehicleLiveSignals.mockReturnValue(liveStub({}));

  const tree = await render();
  await pressByTestID(tree, 'live-signals-vehicle-option-1');

  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('live-signals-empty');
  expect(text).toContain('No live signals cached');
  expect(text).toContain(
    'Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing.',
  );

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('filters signal rows by name', async () => {
  mockUseVehicleLiveSignals.mockReturnValue(
    liveStub({
      BatteryLevel: {value: 87},
      ChargeState: {value: 'Charging'},
    }),
  );

  const tree = await render();
  await pressByTestID(tree, 'live-signals-vehicle-option-1');

  // Drive the filter TextInput to a query that excludes ChargeState.
  const input = tree.root.find(
    n => (n.props as {testID?: string}).testID === 'live-signals-filter',
  );
  await ReactTestRenderer.act(async () => {
    (input.props as {onChangeText: (v: string) => void}).onChangeText('battery');
  });

  const raw = rawOf(tree);
  expect(raw).toContain('live-signal-row-BatteryLevel');
  expect(raw).not.toContain('live-signal-row-ChargeState');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
