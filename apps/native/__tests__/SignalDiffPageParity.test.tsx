import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {usePinned, useTogglePin} from '../src/web-parity/api/hooks/usePinned';
import {
  useSignalDiffServer,
  useSignals,
} from '../src/web-parity/api/hooks/useTelemetry';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import SignalDiffPage from '../src/web-parity/features/telemetry/pages/SignalDiffPage';

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

jest.mock('../src/web-parity/api/hooks/useTelemetry', () => ({
  useSignals: jest.fn(),
  useSignalDiffServer: jest.fn(),
}));

jest.mock('../src/web-parity/api/hooks/usePinned', () => ({
  usePinned: jest.fn(),
  useTogglePin: jest.fn(),
}));

// Mock the already-converted SignalDiffTable so the page test focuses on the
// page's own composition. The stub reflects the row count and exposes a select
// affordance that drives the page's onSelectionChange (bulk-actions wiring).
jest.mock(
  '../src/web-parity/features/telemetry/components/SignalDiffTable',
  () => {
    const RN = require('react-native');
    const R = require('react');
    return {
      SignalDiffTable: (props: {
        rows: Array<{name: string}>;
        onSelectionChange: (s: string[]) => void;
      }) =>
        R.createElement(
          RN.View,
          {testID: 'mock-signal-diff-table'},
          R.createElement(RN.Text, null, `rows:${props.rows.length}`),
          R.createElement(RN.Pressable, {
            testID: 'mock-select-all',
            onPress: () =>
              props.onSelectionChange(props.rows.map(r => r.name)),
          }),
        ),
    };
  },
);

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseSignals = useSignals as unknown as jest.Mock;
const mockUseSignalDiffServer = useSignalDiffServer as unknown as jest.Mock;
const mockUsePinned = usePinned as unknown as jest.Mock;
const mockUseTogglePin = useTogglePin as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {props?: {testID?: string}; children?: JsonNode | JsonNode[]}
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

interface DiffRow {
  name: string;
  value_a: unknown;
  value_b: unknown;
  source_a?: string;
  source_b?: string;
  changed: boolean;
}

function diffStub(
  rows: DiffRow[] | undefined,
  opts: {isLoading?: boolean; error?: unknown} = {},
) {
  return {
    data: rows ? {vehicle_id: 1, at_a: 'a', at_b: 'b', count: rows.length, data: rows} : undefined,
    isLoading: opts.isLoading ?? false,
    error: opts.error ?? null,
    isError: Boolean(opts.error),
  };
}

const mutateAsync = jest.fn().mockResolvedValue(undefined);

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<SignalDiffPage />);
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

async function typeByTestID(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
  value: string,
): Promise<void> {
  const node = tree.root.find(
    n =>
      (n.props as {testID?: string}).testID === testID &&
      typeof (n.props as {onChangeText?: unknown}).onChangeText === 'function',
  );
  await ReactTestRenderer.act(async () => {
    (node.props as {onChangeText: (v: string) => void}).onChangeText(value);
  });
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({
    data: [
      {id: 1, display_name: 'Garage Model 3', vin: 'VIN-AAA'},
      {id: 2, display_name: '', vin: 'VIN-BBB'},
    ],
    isLoading: false,
  });
  mockUseSignals.mockReturnValue({data: ['BatteryLevel', 'VehicleSpeed']});
  mockUseSignalDiffServer.mockReturnValue(diffStub([]));
  mockUsePinned.mockReturnValue({data: []});
  mockUseTogglePin.mockReturnValue({mutateAsync});
});

afterEach(() => {
  jest.clearAllMocks();
  mutateAsync.mockClear();
});

test('renders header, share, compare controls, and default stat cards', async () => {
  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('signal-diff-page');
  expect(text).toContain('Signal Diff');
  expect(text).toContain(
    'Compare signal values between two snapshots in time',
  );

  // Share (CopyButton) action.
  expect(raw).toContain('signal-diff-share');
  expect(text).toContain('Share');

  // Compare controls: vehicle picker options (display_name, then vin fallback).
  expect(raw).toContain('signal-compare-controls');
  expect(raw).toContain('signal-diff-vehicle-select');
  expect(text).toContain('Garage Model 3');
  expect(text).toContain('VIN-BBB');

  // Window A/B fields + presets + category chips.
  expect(raw).toContain('signal-diff-window-a');
  expect(raw).toContain('signal-diff-window-b');
  expect(text).toContain('Window A');
  expect(text).toContain('Window B');
  expect(raw).toContain('signal-diff-preset-now-vs-1h');
  expect(text).toContain('Now vs 1h ago');
  expect(raw).toContain('signal-diff-category-battery');
  expect(text).toContain('Battery');

  // Four StatCards with their labels.
  expect(text).toContain('Changed signals');
  expect(text).toContain('Visible after filter');
  expect(text).toContain('Pinned');
  expect(text).toContain('Window span');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the loading skeleton while the diff loads', async () => {
  mockUseSignalDiffServer.mockReturnValue(diffStub(undefined, {isLoading: true}));

  const tree = await render();
  const raw = rawOf(tree);

  expect(raw).toContain('signal-diff-loading');
  expect(raw).not.toContain('signal-diff-empty');
  expect(raw).not.toContain('mock-signal-diff-table');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the no-changes empty state when the diff is empty', async () => {
  mockUseSignalDiffServer.mockReturnValue(diffStub([]));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('signal-diff-empty');
  expect(text).toContain(
    'No signals changed between the two snapshots',
  );
  // changed = 0 stat.
  expect(text).toContain('Changed signals');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the diff table and filters rows by category', async () => {
  mockUseSignalDiffServer.mockReturnValue(
    diffStub([
      {name: 'BatteryLevel', value_a: 80, value_b: 82, changed: true},
      {name: 'VehicleSpeed', value_a: 0, value_b: 35, changed: true},
    ]),
  );

  const tree = await render();
  expect(rawOf(tree)).toContain('mock-signal-diff-table');
  // Both rows visible initially.
  expect(textOf(tree)).toContain('rows:2');

  // Filter to the Battery category -> only BatteryLevel matches.
  await pressByTestID(tree, 'signal-diff-category-battery');
  expect(textOf(tree)).toContain('rows:1');

  // A free-text filter narrows further/clears.
  await pressByTestID(tree, 'signal-diff-category-battery');
  await typeByTestID(tree, 'signal-diff-filter', 'speed');
  expect(textOf(tree)).toContain('rows:1');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('surfaces pinned signals as badges and in the pinned stat', async () => {
  mockUsePinned.mockReturnValue({
    data: [
      {id: 1, item_type: 'widget', item_id: 'signal:BatteryLevel', position: 0, pinned_at: 'x'},
      {id: 2, item_type: 'widget', item_id: 'signal:VehicleSpeed', position: 1, pinned_at: 'x'},
    ],
  });
  mockUseSignalDiffServer.mockReturnValue(
    diffStub([{name: 'BatteryLevel', value_a: 1, value_b: 2, changed: true}]),
  );

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('signal-diff-pinned');
  expect(text).toContain('Pinned:');
  expect(text).toContain('BatteryLevel');
  expect(text).toContain('VehicleSpeed');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('runs bulk pin and csv actions on the current selection', async () => {
  mockUseSignalDiffServer.mockReturnValue(
    diffStub([
      {name: 'BatteryLevel', value_a: 80, value_b: 82, source_a: 'L1', source_b: 'LOG', changed: true},
    ]),
  );

  const tree = await render();

  // No toolbar until something is selected.
  expect(rawOf(tree)).not.toContain('bulk-actions-toolbar');

  // Drive the (mocked) table selection.
  await pressByTestID(tree, 'mock-select-all');
  expect(rawOf(tree)).toContain('bulk-actions-toolbar');

  // Pin -> the unchanged useTogglePin mutateAsync with the verbatim item_id +
  // context.
  await pressByTestID(tree, 'bulk-action-pin');
  expect(mutateAsync).toHaveBeenCalledWith({
    itemId: 'signal:BatteryLevel',
    context: 'signal-diff:vehicle:1',
    pin: true,
  });

  // Copy CSV -> a native notice carrying the filename (no browser download).
  await pressByTestID(tree, 'bulk-action-csv');
  const text = textOf(tree);
  expect(rawOf(tree)).toContain('signal-diff-notice');
  expect(text).toContain('signal-diff-vehicle-1.csv');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the error box when the diff query fails', async () => {
  mockUseSignalDiffServer.mockReturnValue(
    diffStub(undefined, {error: new Error('boom')}),
  );

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('signal-diff-error');
  expect(text).toContain('Failed to load diff');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
