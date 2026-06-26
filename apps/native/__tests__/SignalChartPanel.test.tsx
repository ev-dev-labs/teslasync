import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  SignalChartPanel,
  type SignalStat,
} from '../src/web-parity/features/telemetry/components/SignalChartPanel';

function makeData(count: number): Record<string, unknown>[] {
  return Array.from({length: count}, (_, index) => ({
    timestamp: new Date(Date.now() - (count - index) * 60_000).toISOString(),
    battery_power: 10 + index,
    cabin_temp: 20 + (index % 5),
  }));
}

const stats: SignalStat[] = [
  {signal: 'battery_power', min: 0, max: 100, avg: 50, count: 10},
  {signal: 'cabin_temp', min: 19, max: 24, avg: 21, count: 10},
];

async function render(element: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('renders the overlay historical chart with title, series and points loaded', async () => {
  const tree = await render(
    <SignalChartPanel
      data={makeData(12)}
      pointsLoaded={1234}
      selectedSignals={['battery_power', 'cabin_temp']}
      stats={stats}
    />,
  );

  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain('Signal Chart');
  expect(serialized).toContain('battery_power');
  expect(serialized).toContain('cabin_temp');
  expect(serialized).toContain('1,234');
  expect(serialized).toContain('points loaded');
  // No Recharts/DOM placeholder leaked into the native tree.
  expect(serialized).not.toContain('unavailable in React Native');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the live waiting state when there is no data', async () => {
  const tree = await render(
    <SignalChartPanel
      data={[]}
      isLive
      selectedSignals={['battery_power']}
      stats={[]}
    />,
  );

  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain('Live Signal Stream');
  expect(serialized).toContain('Waiting for signal data');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the live event/point annotation when streaming data', async () => {
  const tree = await render(
    <SignalChartPanel
      data={makeData(4)}
      isLive
      liveEventCount={42}
      selectedSignals={['battery_power']}
      stats={[]}
    />,
  );

  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain('42');
  expect(serialized).toContain('events');
  expect(serialized).toContain('points');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the empty historical state when there is no data', async () => {
  const tree = await render(
    <SignalChartPanel
      data={[]}
      selectedSignals={['battery_power']}
      stats={[]}
    />,
  );

  expect(JSON.stringify(tree.toJSON())).toContain('No data for this time range');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the small-multiples grid when grid mode is forced with 2+ signals', async () => {
  const tree = await render(
    <SignalChartPanel
      chartMode="grid"
      data={makeData(6)}
      selectedSignals={['battery_power', 'cabin_temp']}
      stats={stats}
    />,
  );

  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain('battery_power');
  expect(serialized).toContain('cabin_temp');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
