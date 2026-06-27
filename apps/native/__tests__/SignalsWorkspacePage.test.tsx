import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import SignalsWorkspacePage from '../src/web-parity/features/telemetry/pages/SignalsWorkspacePage';

/**
 * Native parity contract for SignalsWorkspacePage.
 *
 * The web page is the unified `/signals` workspace: a headline strip, an "Add
 * signals" catalog accordion, a Time-range/Run/Live/Compare toolbar, and a
 * Live/Compare/Historical detail column. The native port keeps every state,
 * query, mode toggle, and API path; these tests render the page through a real
 * QueryClient with the api-client request() mocked and assert the core sections
 * render plus the no-vehicle empty state.
 */

jest.mock('../src/web-parity/api/client', () => {
  const actual = jest.requireActual('../src/web-parity/api/client');
  return {
    __esModule: true,
    ...actual,
    request: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {request} = require('../src/web-parity/api/client') as {
  request: jest.Mock;
};

type Tree = ReactTestRenderer.ReactTestRenderer;

const SAMPLE_VEHICLES = [
  {
    id: 1,
    vehicle_id: 1,
    vin: '5YJ3000000NEXUS01',
    display_name: 'Nexus',
    model: 'model3',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

const SAMPLE_SIGNALS = ['vehicle_speed', 'battery_level', 'soc'];

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}

async function renderPage(): Promise<{tree: Tree; client: QueryClient}> {
  const client = makeClient();
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <SignalsWorkspacePage />
      </QueryClientProvider>,
    );
  });
  await flush();
  return {tree, client};
}

async function teardown(tree: Tree, client: QueryClient): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
  client.clear();
  await flush();
}

beforeEach(() => {
  request.mockReset();
});

test('renders the headline strip, catalog, toolbar, and default empty state', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/available')) {
      return Promise.resolve(SAMPLE_SIGNALS);
    }
    if (path.includes('/pinned')) {
      return Promise.resolve([]);
    }
    if (path.includes('/vehicles')) {
      return Promise.resolve(SAMPLE_VEHICLES);
    }
    return Promise.resolve([]);
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Header + headline metric cards.
  expect(body).toContain('Signals');
  expect(body).toContain('Selected');
  expect(body).toContain('Mode');
  expect(body).toContain('Historical');
  expect(body).toContain('Pinned signals');
  // Catalog accordion + toolbar controls.
  expect(body).toContain('Add signals');
  expect(body).toContain('None selected');
  expect(body).toContain('Run');
  expect(body).toContain('Live');
  expect(body).toContain('Compare');
  // Default (no query yet) empty state.
  expect(body).toContain('Pick signals and run a query');

  await teardown(tree, client);
});

test('renders the no-vehicle empty state when the fleet is empty', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/pinned')) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  expect(body).toContain('Signals');
  expect(body).toContain('Select a vehicle to begin');

  await teardown(tree, client);
});
