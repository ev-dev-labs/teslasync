import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

let mockVehiclesData: Array<{id: number; display_name: string; vin: string}> = [];

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: mockVehiclesData,
    isLoading: false,
    isFetching: false,
    error: null,
  }),
}));

import LiveSignalMonitorPage from '../src/web-parity/features/telemetry/pages/LiveSignalMonitorPage';

async function render(element: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

beforeEach(() => {
  mockVehiclesData = [
    {id: 1, display_name: 'Roadrunner', vin: '5YJTESLASYNC0001'},
    {id: 2, display_name: 'Coyote', vin: '5YJTESLASYNC0002'},
  ];
});

test('renders the live monitor scaffold with title, subtitle and disconnected pill', async () => {
  const tree = await render(<LiveSignalMonitorPage />);
  const serialized = JSON.stringify(tree.toJSON());

  expect(serialized).toContain('Live Signal Monitor');
  expect(serialized).toContain('Real-time scrolling view of incoming vehicle signals');
  // No EventSource polyfill in jest -> disconnected + explicit unavailable note.
  expect(serialized).toContain('Disconnected');
  // No Recharts/DOM/placeholder leak into the native tree.
  expect(serialized).not.toContain('unavailable in React Native');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the vehicle scope picker and the four tail stat cards', async () => {
  const tree = await render(<LiveSignalMonitorPage />);
  const serialized = JSON.stringify(tree.toJSON());

  expect(serialized).toContain('Roadrunner');
  expect(serialized).toContain('Signals / sec');
  expect(serialized).toContain('Buffer Size');
  expect(serialized).toContain('Unique Signals');
  expect(serialized).toContain('Filtered');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the waiting empty state when no signals have streamed', async () => {
  const tree = await render(<LiveSignalMonitorPage />);
  const serialized = JSON.stringify(tree.toJSON());

  expect(serialized).toContain('Waiting for signals');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('hides the vehicle picker when the fleet is empty', async () => {
  mockVehiclesData = [];
  const tree = await render(<LiveSignalMonitorPage />);
  const serialized = JSON.stringify(tree.toJSON());

  // Fleet empty -> VehicleSelect renders nothing, but the page still mounts.
  expect(serialized).toContain('Live Signal Monitor');
  expect(serialized).not.toContain('Select vehicle');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
