import React from 'react';

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import {useWeeklyDigest} from '../src/web-parity/features/analytics/components/weekly-digest/useWeeklyDigest';

/**
 * Native parity contract for useWeeklyDigest.
 *
 * The web module is a non-visual data hook that owns the Weekly Digest screen's
 * week-offset + vehicle state, runs the drives / charging / alerts queries, and
 * derives every aggregated metric, the daily distance/energy bins, the alert
 * pie data, the "fun fact", and the prev/next-week navigation. These tests
 * drive the ported hook through a real QueryClient with the api-client
 * request() mocked so /vehicles, /settings, /drives, /charging, and /alerts
 * resolve, then assert the derived shape matches the web computations 1:1.
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
type HookResult = ReturnType<typeof useWeeklyDigest>;

let captured: HookResult | undefined;

function Probe(): null {
  captured = useWeeklyDigest();
  return null;
}

const NOW = new Date().toISOString();

const VEHICLES = [
  {id: 1, vehicle_id: 1, vin: 'VIN1', display_name: 'Car One'},
];

const SETTINGS = {locale: 'en-US', decimal_precision: 2};

const DRIVES = [
  {
    id: 1,
    start_date: NOW,
    distance: 100,
    duration_min: 30,
    efficiency_wh_km: 150,
    energy_used: 15,
  },
  {
    id: 2,
    start_date: NOW,
    distance: 50,
    duration_min: 20,
    efficiency_wh_km: 170,
    energy_used: 8,
  },
];

const CHARGING = [
  {
    id: 1,
    start_ts: NOW,
    total_energy_added_wh: 10000,
    cost: 5,
    duration_min: 60,
    start_battery_pct: 20,
    end_battery_pct: 80,
  },
];

const ALERTS = [
  {id: 1, severity: 'warning', created_at: NOW},
  {id: 2, severity: 'critical', created_at: NOW},
];

function mockRequest(): void {
  request.mockImplementation((path: string) => {
    if (path.startsWith('/vehicles')) {
      return Promise.resolve(VEHICLES);
    }
    if (path.startsWith('/settings')) {
      return Promise.resolve(SETTINGS);
    }
    if (path.startsWith('/drives')) {
      return Promise.resolve(DRIVES);
    }
    if (path.startsWith('/charging')) {
      return Promise.resolve(CHARGING);
    }
    if (path.startsWith('/alerts')) {
      return Promise.resolve(ALERTS);
    }
    return Promise.resolve([]);
  });
}

function makeClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false}}});
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}

async function renderHook(): Promise<{tree: Tree; client: QueryClient}> {
  const client = makeClient();
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <Probe />
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
  captured = undefined;
});

test('derives metrics, charts, alert pie, and fun fact from the week data', async () => {
  mockRequest();
  const {tree, client} = await renderHook();

  expect(captured).toBeDefined();
  const r = captured as HookResult;

  // Vehicle selection.
  expect(r.selectedVehicleId).toBe('1');
  expect(r.vehicleOptions).toEqual([{value: '1', label: 'Car One'}]);

  // Week framing.
  expect(r.isCurrentWeek).toBe(true);
  expect(r.hasData).toBe(true);
  expect(r.weekLabel).toContain('–'); // en dash separator

  // Aggregated metrics.
  expect(r.metrics.totalDistance).toBe(150);
  expect(r.metrics.totalDrives).toBe(2);
  expect(r.metrics.avgEfficiency).toBe(160);
  expect(r.metrics.energyUsed).toBe(23);
  expect(r.metrics.totalDuration).toBe(50);
  expect(r.metrics.chargingSessionCount).toBe(1);
  expect(r.metrics.chargeEnergyAdded).toBe(10000);
  expect(r.metrics.avgChargeRate).toBe(10000);
  expect(r.metrics.batteryStart).toBe(20);
  expect(r.metrics.batteryEnd).toBe(80);
  expect(r.metrics.chargingCost).toBe(5);
  expect(r.metrics.alertTotal).toBe(2);
  expect(r.metrics.alertsByType).toEqual({warning: 1, critical: 1});

  // Daily bins: 7 days, totals preserved.
  expect(r.dailyDistanceData).toHaveLength(7);
  expect(r.dailyDistanceData.reduce((s, b) => s + b.distance, 0)).toBe(150);
  expect(r.dailyEnergyData).toHaveLength(7);
  expect(r.dailyEnergyData.reduce((s, b) => s + b.energy, 0)).toBe(10000);

  // Alert pie: severity-titled, severity-colored.
  expect(r.alertPieData).toHaveLength(2);
  const warning = r.alertPieData.find(e => e.name === 'Warning');
  const critical = r.alertPieData.find(e => e.name === 'Critical');
  expect(warning).toEqual({name: 'Warning', value: 1, color: '#f59e0b'});
  expect(critical).toEqual({name: 'Critical', value: 1, color: '#ef4444'});

  // Fun fact: 150km -> closest city pair (NY–Boston, 350km), 0.4x.
  expect(r.funFact).toEqual({from: 'New York', to: 'Boston', times: '0.4'});

  await teardown(tree, client);
});

test('prev/next-week navigation moves the window and clears in-week data', async () => {
  mockRequest();
  const {tree, client} = await renderHook();

  const currentLabel = (captured as HookResult).weekLabel;

  // Step back one week: the "now" rows fall out of range.
  await ReactTestRenderer.act(async () => {
    (captured as HookResult).goToPrevWeek();
  });
  await flush();

  expect((captured as HookResult).isCurrentWeek).toBe(false);
  expect((captured as HookResult).weekLabel).not.toBe(currentLabel);
  expect((captured as HookResult).hasData).toBe(false);
  expect((captured as HookResult).metrics.totalDistance).toBe(0);

  // Step forward again: back to the current week with data.
  await ReactTestRenderer.act(async () => {
    (captured as HookResult).goToNextWeek();
  });
  await flush();

  expect((captured as HookResult).isCurrentWeek).toBe(true);
  expect((captured as HookResult).hasData).toBe(true);
  expect((captured as HookResult).metrics.totalDistance).toBe(150);

  await teardown(tree, client);
});
