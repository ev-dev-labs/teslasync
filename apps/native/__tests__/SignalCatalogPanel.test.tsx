import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  SignalCatalogPanel,
  getCatalogStalenessStyle,
  formatStaleness,
} from '../src/web-parity/features/telemetry/components/SignalCatalogPanel';

/**
 * Native parity contract for SignalCatalogPanel.
 *
 * The web panel reads the live signal snapshot (useSignalGaps, polled every 5s),
 * derives per-signal staleness, and renders a 4-up StatCard summary plus a
 * searchable / filterable / sortable DataTable. When a `selection` prop is
 * supplied it prepends a checkbox column with an optional `max`. These tests
 * mock useSignalGaps and assert the summary counts, the status badges, the
 * loading skeletons, the empty state, the filter behaviour, and the selection
 * checkbox toggle + max gating against the native port.
 */

const mockUseSignalGaps = jest.fn();

jest.mock('../src/web-parity/api/hooks/useTelemetry', () => ({
  useSignalGaps: (...args: unknown[]) => mockUseSignalGaps(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

const NOW = Date.now();

// active (<30s), stale (>5min), never (no timestamp).
const LIVE = {
  vehicle_speed: {value: 42, timestamp: new Date(NOW - 5_000).toISOString()},
  tpms_fl: {value: 2.9, timestamp: new Date(NOW - 600_000).toISOString()},
  charge_state: {value: 'Charging', timestamp: null},
};

function gapsQuery(
  data: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isLoading: false,
    dataUpdatedAt: Date.UTC(2026, 5, 26, 12, 0, 0),
    ...overrides,
  };
}

async function render(node: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

function hostsWithTestId(tree: Tree, testID: string) {
  return tree.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  );
}

function pressableByLabel(tree: Tree, label: string) {
  return tree.root.find(
    n =>
      typeof n.props?.onPress === 'function' &&
      n.props?.accessibilityLabel === label,
  );
}

function pressableContaining(tree: Tree, text: string) {
  const candidates = tree.root.findAll(
    n => typeof n.props?.onPress === 'function',
  );
  return candidates.find(
    n => n.findAll(d => d.props?.children === text).length > 0,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSignalGaps.mockReturnValue(gapsQuery(LIVE));
});

test('renders the summary counts, status badges and refresh affordances', async () => {
  const tree = await render(<SignalCatalogPanel vehicleId={7} />);

  const serialized = json(tree);
  // Four StatCards with their labels.
  expect(serialized).toContain('Total Signals');
  expect(serialized).toContain('Active (<30s)');
  expect(serialized).toContain('Stale (>5min)');
  expect(serialized).toContain('Never Received');
  // Signal names + a value.
  expect(serialized).toContain('vehicle_speed');
  expect(serialized).toContain('tpms_fl');
  expect(serialized).toContain('charge_state');
  expect(serialized).toContain('42');
  expect(serialized).toContain('Charging');
  // Status badge labels for each staleness bucket.
  expect(serialized).toContain('Active');
  expect(serialized).toContain('Stale');
  expect(serialized).toContain('Never received');
  // Refresh interval + last-refreshed affordances.
  expect(serialized).toContain('Refreshes every 5s');
  expect(serialized).toContain('Last refreshed');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows eight skeleton bars while loading', async () => {
  mockUseSignalGaps.mockReturnValue(
    gapsQuery(undefined, {isLoading: true, dataUpdatedAt: 0}),
  );

  const tree = await render(<SignalCatalogPanel vehicleId={7} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBe(8);
  const serialized = json(tree);
  expect(serialized).not.toContain('vehicle_speed');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the no-data message when the snapshot is empty', async () => {
  mockUseSignalGaps.mockReturnValue(gapsQuery({}, {dataUpdatedAt: 0}));

  const tree = await render(<SignalCatalogPanel vehicleId={7} />);

  const serialized = json(tree);
  expect(serialized).toContain('No signal data available');
  expect(serialized).not.toContain('vehicle_speed');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('honours the optional title and hides the summary when disabled', async () => {
  const tree = await render(
    <SignalCatalogPanel showSummary={false} title="Signal Catalog" vehicleId={7} />,
  );

  const serialized = json(tree);
  expect(serialized).toContain('Signal Catalog');
  // Summary StatCards are gone.
  expect(serialized).not.toContain('Total Signals');
  // The catalog table is still present.
  expect(serialized).toContain('vehicle_speed');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('the "Stale Only" filter drops active signals', async () => {
  const tree = await render(<SignalCatalogPanel vehicleId={7} />);

  const chip = pressableContaining(tree, 'Stale Only');
  expect(chip).toBeDefined();
  await ReactTestRenderer.act(async () => {
    chip!.props.onPress();
  });

  const serialized = json(tree);
  // Stale + never remain; the active signal is filtered out.
  expect(serialized).toContain('tpms_fl');
  expect(serialized).toContain('charge_state');
  expect(serialized).not.toContain('vehicle_speed');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('selection adds a checkbox column and toggles on press', async () => {
  const onToggle = jest.fn();
  const tree = await render(
    <SignalCatalogPanel
      selection={{selectedSignals: [], onToggle}}
      vehicleId={7}
    />,
  );

  const addBtn = pressableByLabel(tree, 'Add vehicle_speed to selection');
  expect(addBtn.props.disabled).toBeFalsy();
  await ReactTestRenderer.act(async () => {
    addBtn.props.onPress();
  });
  expect(onToggle).toHaveBeenCalledWith('vehicle_speed');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('selection max disables further unchecked toggles', async () => {
  const onToggle = jest.fn();
  const tree = await render(
    <SignalCatalogPanel
      selection={{selectedSignals: ['tpms_fl'], onToggle, max: 1}}
      vehicleId={7}
    />,
  );

  // Already at the max with tpms_fl selected, so an unchecked row is disabled.
  const addBtn = pressableByLabel(tree, 'Add vehicle_speed to selection');
  expect(addBtn.props.disabled).toBe(true);
  // The selected row stays removable.
  const removeBtn = pressableByLabel(tree, 'Remove tpms_fl from selection');
  expect(removeBtn.props.disabled).toBeFalsy();

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('getCatalogStalenessStyle buckets seconds + missing timestamps', () => {
  expect(getCatalogStalenessStyle(0, false)).toMatchObject({
    label: 'Never received',
    variant: 'neutral',
  });
  expect(getCatalogStalenessStyle(5, true)).toMatchObject({
    label: 'Active',
    variant: 'success',
  });
  expect(getCatalogStalenessStyle(120, true)).toMatchObject({
    label: 'Aging',
    variant: 'warning',
  });
  expect(getCatalogStalenessStyle(900, true)).toMatchObject({
    label: 'Stale',
    variant: 'danger',
  });
});

test('formatStaleness renders s / m / h+m windows and the em-dash guard', () => {
  expect(formatStaleness(Infinity)).toBe('—');
  expect(formatStaleness(15)).toBe('15s ago');
  expect(formatStaleness(120)).toBe('2m ago');
  expect(formatStaleness(3720)).toBe('1h 2m ago');
});
