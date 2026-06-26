import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import SecretRotationPage from '../src/web-parity/features/admin/pages/SecretRotationPage';

/**
 * Native parity contract for SecretRotationPage.
 *
 * The web page is the admin "Secret Rotation" observability surface: a
 * PageContainer (title + subtitle + freshness chip) wrapping a FadeIn column
 * with optional AlertBanners, a four-up StatCard grid, and a "Rotation status"
 * GlassPanel whose body is either an EmptyState or a DataTable of
 * SecretRotationStatus rows. The native port keeps the page wrapper and inlines
 * faithful PageContainer / StatCard / DataTable / Badge / PanelTitle / Caption /
 * SectionErrorBoundary equivalents wired to the ported useSecretRotation hook.
 * These tests render the page through a real QueryClient with the api-client
 * request() mocked so the /admin/observability/secret-rotation query resolves,
 * then assert the header + every section renders with API-backed values.
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

const POPULATED = {
  items: [
    {
      kind: 'tesla_refresh_token',
      target_id: '',
      last_rotated: '2026-06-01T00:00:00Z',
      age_days: 24,
      expires_at: '2026-09-01T00:00:00Z',
      days_to_expiry: 68,
      warn_days: 30,
      critical_days: 60,
      severity: 'ok',
    },
    {
      kind: 'mqtt_mtls_cert',
      target_id: 'broker-1',
      last_rotated: '2026-01-01T00:00:00Z',
      age_days: 175,
      expires_at: null,
      days_to_expiry: null,
      warn_days: 90,
      critical_days: 180,
      severity: 'warn',
    },
    {
      kind: 'database_password',
      target_id: '',
      last_rotated: '2025-01-01T00:00:00Z',
      age_days: 540,
      expires_at: '2026-01-01T00:00:00Z',
      days_to_expiry: -100,
      warn_days: 90,
      critical_days: 180,
      severity: 'critical',
    },
  ],
};

const EMPTY = {items: []};

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
        <SecretRotationPage />
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

test('renders header, stat cards, overdue banner, and the rotation table', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/admin/observability/secret-rotation')) {
      return Promise.resolve(POPULATED);
    }
    return Promise.resolve({});
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Page header (title + subtitle).
  expect(body).toContain('Secret Rotation');
  expect(body).toContain('Status of every tracked credential');

  // Critical-tier danger banner.
  expect(body).toContain('Overdue rotations');
  expect(body).toContain(
    'past their critical rotation threshold',
  );

  // StatCard labels.
  expect(body).toContain('Tracked secrets');
  expect(body).toContain('Warn');
  expect(body).toContain('Critical');

  // Table headers.
  expect(body).toContain('Kind');
  expect(body).toContain('Last rotated');
  expect(body).toContain('Age (days)');
  expect(body).toContain('Expires');
  expect(body).toContain('Warn / critical');
  expect(body).toContain('Severity');

  // Kind labels (friendly map) + a target id.
  expect(body).toContain('Tesla refresh token');
  expect(body).toContain('MQTT mTLS certificate');
  expect(body).toContain('Database password');
  expect(body).toContain('broker-1');

  // Severity badge labels.
  expect(body).toContain('Rotate soon');
  expect(body).toContain('Overdue');

  // API-backed cell values: age + days-to-expiry + thresholds.
  expect(body).toContain('24.00');
  expect(body).toContain('68d remaining');
  expect(body).toContain('30.00');
  expect(body).toContain('60.00');

  await teardown(tree, client);
});

test('renders the empty state when no secrets are tracked', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/admin/observability/secret-rotation')) {
      return Promise.resolve(EMPTY);
    }
    return Promise.resolve({});
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Panel title always renders.
  expect(body).toContain('Rotation status');
  // EmptyState (no rows, not loading, not subsystem-missing).
  expect(body).toContain('No tracked secrets');
  expect(body).toContain('No rotation events have been recorded yet');
  // No data => no stat grid, no danger banner, no subsystem banner.
  expect(body).not.toContain('Tracked secrets');
  expect(body).not.toContain('Overdue rotations');
  expect(body).not.toContain('Subsystem unavailable');

  await teardown(tree, client);
});
