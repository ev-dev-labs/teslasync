import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import {FSMTimelineChart} from '../src/web-parity/features/system/components/FSMTimelineChart';
import type {FSMTransition} from '../src/web-parity/api/hooks/useFSM';

function makeTransition(
  id: number,
  fsmName: string,
  minutesAgo: number,
): FSMTransition {
  return {
    id,
    vehicle_id: 42,
    ts: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    fsm_name: fsmName,
    from_state: 'idle',
    to_state: 'active',
    trigger: 'signal',
  };
}

function renderWithQueryClient(element: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });

  return ReactTestRenderer.create(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

test('renders the stacked timeline with a per-FSM colour legend when there is data', async () => {
  const transitions = [
    makeTransition(1, 'vehicle', 30),
    makeTransition(2, 'vehicle', 90),
    makeTransition(3, 'telemetry_connection', 45),
  ];

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = renderWithQueryClient(
      <FSMTimelineChart hours={24} transitions={transitions} />,
    );
  });

  const serialized = JSON.stringify(tree?.toJSON());
  expect(serialized).toContain('Transitions Over Time');
  // FSM names appear as legend labels (sorted): both series are present.
  expect(serialized).toContain('vehicle');
  expect(serialized).toContain('telemetry_connection');
  // No DOM/Recharts placeholder leaked into the native tree.
  expect(serialized).not.toContain('WebView');
  expect(serialized).not.toContain('unavailable in React Native');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('renders the empty state with the provided message when there are no transitions', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = renderWithQueryClient(
      <FSMTimelineChart
        emptyMessage="No transitions in range"
        hours={24}
        transitions={[]}
      />,
    );
  });

  expect(JSON.stringify(tree?.toJSON())).toContain('No transitions in range');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('falls back to the default empty message when none is provided', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = renderWithQueryClient(
      <FSMTimelineChart hours={24} transitions={[]} />,
    );
  });

  expect(JSON.stringify(tree?.toJSON())).toContain(
    'No transition data for timeline',
  );

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
