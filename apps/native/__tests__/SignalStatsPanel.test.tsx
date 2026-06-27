import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {SignalStatsPanel} from '../src/web-parity/features/telemetry/components/SignalStatsPanel';
import type {SignalStat} from '../src/web-parity/features/telemetry/components/SignalStatsPanel';

/**
 * Native parity contract for SignalStatsPanel.
 *
 * The web panel is a presentation-only wrapper around DataTable that renders a
 * per-signal min/max/avg/count summary. When `selectedSignals` is supplied it
 * emits one row per selected signal — filling gaps with `—` placeholder rows
 * that carry a "No data in range" subtitle — and exposes a "Hide empty (N)"
 * Toggle to collapse those rows. These tests assert that behaviour against the
 * native port: the column headers + formatted values, the loading skeletons,
 * the empty state, the selected-signal gap filling, the hide-empty toggle, and
 * the optional title override.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

const STATS: SignalStat[] = [
  {signal: 'vehicle_speed', min: 0, max: 80, avg: 42.5, count: 1200},
  {signal: 'battery_level', min: 20, max: 90, avg: 55.25, count: 600},
];

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

function switchesByLabel(tree: Tree, label: string) {
  return tree.root.findAll(
    n =>
      typeof n.props?.onPress === 'function' &&
      n.props?.accessibilityLabel === label,
  );
}

test('renders the column headers and the formatted stat values', async () => {
  const tree = await render(<SignalStatsPanel stats={STATS} />);

  const serialized = json(tree);
  // Default title + the five column headers.
  expect(serialized).toContain('Stats Summary');
  expect(serialized).toContain('Signal');
  expect(serialized).toContain('Min');
  expect(serialized).toContain('Max');
  expect(serialized).toContain('Avg');
  expect(serialized).toContain('Count');
  // Signal names.
  expect(serialized).toContain('vehicle_speed');
  expect(serialized).toContain('battery_level');
  // fmtNumber (2dp) min/max/avg + fmtInt count with locale grouping.
  expect(serialized).toContain('80.00');
  expect(serialized).toContain('42.50');
  expect(serialized).toContain('1,200');
  // No empty rows -> the "Hide empty" toggle is absent.
  expect(switchesByLabel(tree, 'Hide empty (1)').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows four skeleton bars while loading', async () => {
  const tree = await render(<SignalStatsPanel loading stats={[]} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBe(4);
  const serialized = json(tree);
  expect(serialized).not.toContain('No stats available');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the no-stats message when there is nothing to render', async () => {
  const tree = await render(<SignalStatsPanel stats={[]} />);

  const serialized = json(tree);
  expect(serialized).toContain('No stats available');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('fills gaps for selected signals with em-dash placeholder rows', async () => {
  const tree = await render(
    <SignalStatsPanel
      selectedSignals={['vehicle_speed', 'missing_signal']}
      stats={[STATS[0]]}
    />,
  );

  const serialized = json(tree);
  // The present signal renders, and the missing one gets a placeholder row.
  expect(serialized).toContain('vehicle_speed');
  expect(serialized).toContain('missing_signal');
  expect(serialized).toContain('No data in range');
  expect(serialized).toContain('—');
  // One empty row -> the "Hide empty (1)" toggle is shown.
  expect(switchesByLabel(tree, 'Hide empty (1)').length).toBe(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('the hide-empty toggle collapses placeholder rows on press', async () => {
  const tree = await render(
    <SignalStatsPanel
      selectedSignals={['vehicle_speed', 'missing_signal']}
      stats={[STATS[0]]}
    />,
  );

  const toggles = switchesByLabel(tree, 'Hide empty (1)');
  expect(toggles.length).toBe(1);
  const toggle = toggles[0];
  await ReactTestRenderer.act(async () => {
    toggle.props.onPress();
  });

  const serialized = json(tree);
  // The empty placeholder row is gone; the populated row remains.
  expect(serialized).toContain('vehicle_speed');
  expect(serialized).not.toContain('missing_signal');
  expect(serialized).not.toContain('No data in range');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('honours the optional title override', async () => {
  const tree = await render(
    <SignalStatsPanel stats={STATS} title="Selected Signal Stats" />,
  );

  const serialized = json(tree);
  expect(serialized).toContain('Selected Signal Stats');
  expect(serialized).not.toContain('Stats Summary');

  await ReactTestRenderer.act(async () => tree.unmount());
});
