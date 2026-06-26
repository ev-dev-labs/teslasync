import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import GasPriceAutoPollPage from '../src/web-parity/features/admin/pages/GasPriceAutoPollPage';

/**
 * Native parity contract for GasPriceAutoPollPage.
 *
 * The web page is a thin admin wrapper that renders the shared GasPriceSettings
 * surface inside a PageContainer (title + subtitle). The native port keeps the
 * page wrapper and inlines a faithful GasPriceSettings wired to the ported
 * gas-price + settings hooks. These tests render the page through a real
 * QueryClient with the api-client request() mocked so the /settings and
 * /gas-price/status queries resolve, then assert the page header + every
 * GasPriceSettings section renders with API-backed values.
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
  currency_symbol: '$',
};

const ENABLED_STATUS = {
  enabled: true,
  poll_interval: '7d',
  last_poll_time: '2026-01-01T00:00:00Z',
  current_price: 3.5,
  current_price_kwh_eq: 0,
};

const DISABLED_STATUS = {
  enabled: false,
  poll_interval: 'daily',
  last_poll_time: '0001-01-01T00:00:00Z',
  current_price: 0,
  current_price_kwh_eq: 0,
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
        <GasPriceAutoPollPage />
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

test('renders the page wrapper + gas-price sections with API-backed values', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/gas-price/status')) {
      return Promise.resolve(ENABLED_STATUS);
    }
    if (path.includes('/settings')) {
      return Promise.resolve(SAMPLE_SETTINGS);
    }
    return Promise.resolve({});
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  // Page header (title + subtitle).
  expect(body).toContain('Gas Price Auto-Poll');
  expect(body).toContain(
    'Automatically fetch US average gas prices from EIA',
  );
  // GasPriceSettings sections.
  expect(body).toContain('Auto-Poll');
  expect(body).toContain('Poll Interval');
  expect(body).toContain('Current Price');
  expect(body).toContain('Last Polled');
  expect(body).toContain('Poll Now');
  expect(body).toContain('Source: U.S. Energy Information Administration');
  // Interval option labels.
  expect(body).toContain('Weekly');
  expect(body).toContain('Monthly');
  // API-backed state: enabled => "Running", current price formatted per unit.
  expect(body).toContain('Running');
  expect(body).toContain('$3.50/gal');

  await teardown(tree, client);
});

test('renders stopped + never + em-dash placeholders when disabled', async () => {
  request.mockImplementation((path: string) => {
    if (path.includes('/gas-price/status')) {
      return Promise.resolve(DISABLED_STATUS);
    }
    if (path.includes('/settings')) {
      return Promise.resolve(SAMPLE_SETTINGS);
    }
    return Promise.resolve({});
  });

  const {tree, client} = await renderPage();
  const body = JSON.stringify(tree.toJSON());

  expect(body).toContain('Stopped');
  expect(body).toContain('Never');
  // current_price of 0 is falsy => the "—" placeholder.
  expect(body).toContain('—');

  await teardown(tree, client);
});
