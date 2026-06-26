import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import DataExportPage from '../src/web-parity/features/system/pages/DataExportPage';

/**
 * Native parity contract for DataExportPage.
 *
 * The web page is the "/data-export" surface: a stats row, a GDPR account-export
 * panel, the New-Export wizard (data-type cards, format buttons, column picker,
 * vehicle select, date range), a CSV/JSON preview + Data-Overview row, the Export
 * History table, the auth-gated Scheduled-Exports panel, and a JobProgressDrawer.
 * The native port keeps every section, query, and mutation; these tests render
 * the page through a real QueryClient with the api-client request() mocked so the
 * queries resolve, then assert the core sections + API-backed rows render.
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

const SAMPLE_JOBS = [
  {
    id: 'job-ready',
    type: 'drives',
    format: 'csv',
    status: 'ready',
    vehicle_id: 1,
    record_count: 1234,
    file_size: 2048576,
    duration_ms: 4200,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:00:05Z',
  },
  {
    id: 'job-failed',
    type: 'charging',
    format: 'json',
    status: 'failed',
    vehicle_id: 1,
    record_count: 0,
    file_size: 0,
    error_message: 'export worker crashed',
    created_at: '2026-01-01T01:00:00Z',
  },
];

const SAMPLE_VEHICLES = [
  {
    id: 1,
    vehicle_id: 1,
    vin: '5YJ3000000NEXUS01',
    display_name: 'Nexus',
    model: 'model3',
    trim_badging: 'p',
    exterior_color: 'red',
    wheel_type: 'aero',
    state: 'online',
    healthy: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

const SAMPLE_COLUMNS = {
  type: 'drives',
  supports_selection: true,
  columns: [
    {name: 'distance_m', label: 'Distance', always_included: true},
    {name: 'efficiency_wh_per_m', label: 'Efficiency', always_included: false},
  ],
};

const OPEN_AUTH_MODE = {
  mode: 'open',
  capabilities: {
    step_up_reauth: false,
    totp_enrollment: false,
    session_list: false,
    impersonation: false,
    rbac: false,
  },
};

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

async function renderPage(): Promise<{tree: Tree; client: QueryClient}> {
  const client = makeClient();
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <DataExportPage />
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

test('renders all core sections with API-backed export job rows', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/exports/columns')) {
      return Promise.resolve(SAMPLE_COLUMNS);
    }
    if (path.includes('/export/jobs')) {
      return Promise.resolve(SAMPLE_JOBS);
    }
    if (path.includes('/vehicles')) {
      return Promise.resolve(SAMPLE_VEHICLES);
    }
    if (path.includes('/system/auth-mode')) {
      return Promise.resolve(OPEN_AUTH_MODE);
    }
    return Promise.resolve([]);
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Header + stats.
  expect(body).toContain('Data Export');
  expect(body).toContain('Total Exports');
  expect(body).toContain('Total Size');
  // Account export panel.
  expect(body).toContain('Download my data');
  // Wizard + column picker.
  expect(body).toContain('New Export');
  expect(body).toContain('Distance');
  // Format previews + overview.
  expect(body).toContain('CSV Preview');
  expect(body).toContain('JSON Preview');
  expect(body).toContain('Data Overview');
  // History table + API-backed row content.
  expect(body).toContain('Export History');
  expect(body).toContain('export worker crashed');
  // Auth-gated scheduled exports renders its placeholder in open mode.
  expect(body).toContain('requires authentication mode');

  await teardown(tree, client);
});

test('renders the empty history state when there are no export jobs', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/system/auth-mode')) {
      return Promise.resolve(OPEN_AUTH_MODE);
    }
    return Promise.resolve([]);
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  expect(body).toContain('Data Export');
  expect(body).toContain('No Exports Yet');

  await teardown(tree, client);
});
