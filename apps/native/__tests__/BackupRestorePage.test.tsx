import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import BackupRestorePage from '../src/web-parity/features/admin/pages/BackupRestorePage';

/**
 * Native parity contract for BackupRestorePage.
 *
 * The web page is the admin "Backup & Restore" surface: a stats grid, a backup
 * configurations table, a backup history table with a Recent Errors list, the
 * portable settings export/import section, and the create/delete/preview modals.
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

const SAMPLE_CONFIGS = [
  {
    id: 1,
    name: 'Daily Full Backup',
    enabled: true,
    backup_type: 'full',
    frequency_days: 1,
    max_retention: 7,
    provider: 'local',
    provider_config: {path: '/backups'},
    compress: true,
    encrypt: false,
    last_run_at: '2026-01-01T00:00:00Z',
    next_run_at: '2026-01-02T00:00:00Z',
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2025-12-01T00:00:00Z',
  },
];

const SAMPLE_RUNS = [
  {
    id: 10,
    config_id: 1,
    run_type: 'backup',
    backup_type: 'full',
    status: 'completed',
    provider: 'local',
    file_name: 'backup-20260101.sql.gz',
    file_path: '/backups/backup-20260101.sql.gz',
    file_size: 1048576,
    record_count: 1000,
    table_count: 5,
    checksum: 'abc',
    duration_ms: 1500,
    error_message: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:00:05Z',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 11,
    config_id: 1,
    run_type: 'backup',
    backup_type: 'full',
    status: 'failed',
    provider: 'local',
    file_name: null,
    file_path: null,
    file_size: 0,
    record_count: 0,
    table_count: 0,
    checksum: null,
    duration_ms: 0,
    error_message: 'disk full',
    started_at: '2026-01-01T01:00:00Z',
    completed_at: null,
    created_at: '2026-01-01T01:00:00Z',
  },
];

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {queries: {retry: false}},
  });
}

// Drain microtasks + the AccessibilityInfo / query promise chains inside act so
// every pending setState settles while the tree is still mounted (avoids the
// "import after teardown" race the slower data path otherwise hits).
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
        <BackupRestorePage />
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

test('renders all core sections with API-backed config + run rows', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/backup/configs')) {
      return Promise.resolve(SAMPLE_CONFIGS);
    }
    if (path.includes('/backup/runs')) {
      return Promise.resolve(SAMPLE_RUNS);
    }
    return Promise.resolve([]);
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  expect(body).toContain('Backup & Restore');
  expect(body).toContain('Backup Configurations');
  expect(body).toContain('Backup History');
  expect(body).toContain('Total Configs');
  expect(body).toContain('Total Backups');
  // API-backed rows.
  expect(body).toContain('Daily Full Backup');
  expect(body).toContain('backup-20260101.sql.gz');
  // Failed run surfaces in the Recent Errors list.
  expect(body).toContain('Recent Errors');
  expect(body).toContain('disk full');
  // Portable settings export/import section.
  expect(body).toContain('Export settings');

  await teardown(tree, client);
});

test('renders empty states when there are no configs or runs', async () => {
  request.mockImplementation(() => Promise.resolve([]));

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  expect(body).toContain('No backup configurations');
  expect(body).toContain('No backup runs yet');

  await teardown(tree, client);
});
