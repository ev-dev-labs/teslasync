import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import BrowserNotificationsPage from '../src/web-parity/features/notifications/pages/BrowserNotificationsPage';

/**
 * Native parity contract for BrowserNotificationsPage.
 *
 * The web page is a thin notifications wrapper that renders the shared
 * NotificationSettings surface inside a PageContainer (title + subtitle +
 * copyLink). The native port keeps the page wrapper and inlines a faithful
 * NotificationSettings: browser push is reported unavailable (RN has no Web
 * Notification API — honest "no fake success"), the tab-signal toggles stay
 * wired to the ported /settings hooks, and the per-channel sound prefs are an
 * in-memory store with playback as a no-op. These tests render the page through
 * a real QueryClient with the api-client request() mocked so the /settings query
 * resolves, then assert the page header + every NotificationSettings section
 * renders.
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
const { request } = require('../src/web-parity/api/client') as {
  request: jest.Mock;
};

type Tree = ReactTestRenderer.ReactTestRenderer;

const SAMPLE_SETTINGS = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'dark',
  mode: 'dark',
  custom_primary: '#000',
  custom_accent: '#fff',
  gas_price_per_unit: 3.5,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'off',
  tab_badge_enabled: true,
  critical_flash_enabled: false,
};

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

// Drain microtasks + the AccessibilityInfo / query promise chains inside act so
// every pending setState settles while the tree is still mounted.
async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}

async function renderPage(): Promise<{ tree: Tree; client: QueryClient }> {
  const client = makeClient();
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <BrowserNotificationsPage />
      </QueryClientProvider>,
    );
  });
  await flush();
  return { tree, client };
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
  request.mockImplementation((path: string) => {
    if (path.includes('/settings')) {
      return Promise.resolve(SAMPLE_SETTINGS);
    }
    return Promise.resolve({});
  });
});

test('renders the page wrapper + every NotificationSettings section', async () => {
  const { tree, client } = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Page header (title + subtitle).
  expect(body).toContain('Browser notifications');
  expect(body).toContain('Native browser push notifications when alerts fire.');

  // NotificationSettings header.
  expect(body).toContain('Browser Notifications');
  expect(body).toContain('Get notified when the app tab is in the background');

  // Browser push is unavailable on native (no Web Notification API).
  expect(body).toContain(
    'Browser notifications are not supported in this browser.',
  );

  // Browser tab signals section (wired to the ported /settings hooks).
  expect(body).toContain('Browser tab signals');
  expect(body).toContain('Show unread count in browser tab');
  expect(body).toContain('Flash tab title on critical alerts');

  // Notification sounds section.
  expect(body).toContain('Notification sounds');
  expect(body).toContain('Enable notification sounds');
  expect(body).toContain('Channels');
  expect(body).toContain('Critical alerts');
  expect(body).toContain('Charge complete');
  expect(body).toContain('Test');
  expect(body).toContain('Volume');
  // Default volume 0.6 -> rounded to 60%.
  expect(body).toContain('60%');

  await teardown(tree, client);
});

test('does not render a fake "enable push" success state on native', async () => {
  const { tree, client } = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // The push permission state machine resolves to unsupported, so neither the
  // "Enabled" badge nor the per-event push toggles are shown — honest parity.
  expect(body).not.toContain('Enable Browser Notifications');
  expect(body).not.toContain('Export completions');

  await teardown(tree, client);
});
