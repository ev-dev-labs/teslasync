import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import AutomationBuilderPage from '../src/web-parity/features/automations/pages/AutomationBuilderPage';

/**
 * Native parity contract for AutomationBuilderPage.
 *
 * The web page is the typed Automation builder (create / edit / preset-install)
 * with four FormSections (General, When/Trigger, Only If/Conditions,
 * Then/Actions), two AI panels, draft/dirty/lease guards, and a discard
 * ConfirmDialog. The native port keeps the full structure, inlines the four
 * sibling builders + the UI-kit primitives, and wires the create/edit/test-run
 * hooks. These tests render the page through a real QueryClient with the
 * api-client request() mocked so the supporting queries resolve, then assert the
 * page header + every builder section renders, and that edit-mode hydrates the
 * name from GET /automations/{id} and surfaces Save + Test Run.
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
    display_name: 'Car One',
  },
];

const SAMPLE_CHANNELS = [
  {id: 1, name: 'Email', kind: 'email', enabled: true},
];

const SAMPLE_AUTOMATION = {
  id: 123,
  name: 'My Automation',
  description: 'A typed rule',
  enabled: true,
  vehicle_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  triggers: [
    {kind: 'trigger_signal', signal: 'battery_level', op: '<', value_num: 20},
  ],
  conditions: [],
  actions: [{kind: 'action_command', command_name: 'climate_on'}],
};

function defaultRequest(path: string): Promise<unknown> {
  if (path.includes('/automations/123')) {
    return Promise.resolve(SAMPLE_AUTOMATION);
  }
  if (path.includes('/vehicles')) {
    return Promise.resolve(SAMPLE_VEHICLES);
  }
  if (path.includes('/notifications')) {
    return Promise.resolve(SAMPLE_CHANNELS);
  }
  if (path.includes('/geofences')) {
    return Promise.resolve([]);
  }
  if (path.includes('/settings')) {
    return Promise.resolve({});
  }
  return Promise.resolve({});
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
}

// Drain microtasks + the AccessibilityInfo / query promise chains inside act so
// every pending setState settles while the tree is still mounted.
async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}

async function renderPage(
  props?: React.ComponentProps<typeof AutomationBuilderPage>,
): Promise<{tree: Tree; client: QueryClient}> {
  const client = makeClient();
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <AutomationBuilderPage {...props} />
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
  request.mockImplementation(defaultRequest);
});

test('create mode renders the header + every builder section + actions', async () => {
  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Page header (create-mode title + subtitle).
  expect(body).toContain('Create Automation');
  expect(body).toContain(
    'Configure supported typed triggers, conditions, and actions',
  );
  // Back link.
  expect(body).toContain('Back to Automations');
  // Four FormSection titles.
  expect(body).toContain('General');
  expect(body).toContain('When (Trigger)');
  expect(body).toContain('Only If (Conditions)');
  expect(body).toContain('Then (Actions)');
  // General fields.
  expect(body).toContain('Name');
  expect(body).toContain('Vehicle');
  expect(body).toContain('All Vehicles');
  expect(body).toContain('Car One');
  // Trigger empty-state (no trigger selected yet).
  expect(body).toContain(
    'Select a supported trigger type to configure',
  );
  // Default seeded action surfaces the Action Type + command builder.
  expect(body).toContain('Action Type');
  expect(body).toContain('Add Condition');
  expect(body).toContain('Add Action');
  // Button row (create mode) + preset hint.
  expect(body).toContain('Create');
  expect(body).toContain('Cancel');
  expect(body).toContain('Not sure where to start');
  // Test Run is hidden in create mode (no saved/automation id yet).
  expect(body).not.toContain('Test Run');

  await teardown(tree, client);
});

test('edit mode hydrates the name from GET /automations/{id} and shows Save + Test Run', async () => {
  const {tree, client} = await renderPage({id: '123'});
  const body = JSON.stringify(tree.toJSON());

  // Edit-mode title.
  expect(body).toContain('Edit Automation');
  // Name input hydrated from the server payload.
  expect(body).toContain('My Automation');
  // Selected signal trigger renders its configurator (Operator field).
  expect(body).toContain('Operator');
  // Edit-mode buttons.
  expect(body).toContain('Save');
  expect(body).toContain('Test Run');
  // Preset hint only shows for new automations.
  expect(body).not.toContain('Not sure where to start');

  expect(request).toHaveBeenCalledWith(
    '/automations/123',
    expect.anything(),
  );

  await teardown(tree, client);
});
