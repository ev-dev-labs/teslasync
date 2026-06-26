import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {BatteryRangeCharts} from '../src/web-parity/features/vehicles/components/vehicle-detail/BatteryRangeCharts';
import type {Drive, VehicleState} from '../src/web-parity/api/types';

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseSettings = useSettings as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function serialize(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

const baseState: VehicleState = {
  vehicle_id: 1,
  state: 'online',
  latitude: 0,
  longitude: 0,
  speed: 0,
  power: 0,
  battery_level: 72,
  rated_range: 402_336, // 250 mi in meters
  ideal_range: 0,
  odometer: 0,
  inside_temp: 0,
  outside_temp: 0,
  is_climate_on: false,
  is_charging: false,
  charger_power: 0,
  charge_rate: 0,
  time_to_full_charge: 0,
  is_locked: true,
  sentry_mode: false,
  software_version: '2026.4',
};

function makeDrive(over: Partial<Drive>): Drive {
  return {
    id: 1,
    vehicle_id: 1,
    start_ts: '2026-04-04T10:00:00Z',
    end_ts: '2026-04-04T10:30:00Z',
    duration_s: 1800,
    distance_m: 16093.44, // 10 mi
    start_address: null,
    end_address: null,
    start_lat: null,
    start_lon: null,
    end_lat: null,
    end_lon: null,
    start_soc_pct: 80,
    end_soc_pct: 70,
    energy_used_wh: null,
    regen_energy_wh: null,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_power_w: null,
    outside_temp_avg_c: null,
    inside_temp_avg_c: null,
    score: null,
    ended_status: null,
    created_at: '2026-04-04T10:30:00Z',
    updated_at: '2026-04-04T10:30:00Z',
    ...over,
  };
}

async function render(props: {state: VehicleState; drives: Drive[] | undefined}) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<BatteryRangeCharts {...props} />);
  });
  return tree;
}

afterEach(() => {
  mockUseSettings.mockReset();
});

test('renders both panels with imperial conversion when unit_of_length is mi', async () => {
  mockUseSettings.mockReturnValue({
    data: {unit_of_length: 'mi', locale: 'en-US'},
  });

  const tree = await render({
    state: baseState,
    drives: [
      makeDrive({id: 1, distance_m: 16093.44, duration_s: 1800}),
      makeDrive({id: 2, distance_m: 32186.88, duration_s: 3600}),
    ],
  });
  const text = serialize(tree);

  // Panel headings.
  expect(text).toContain('Battery Overview');
  expect(text).toContain('Drive Distance Trend');

  // Battery bar chart categories + battery readout.
  expect(text).toContain('Current');
  expect(text).toContain('Remaining');
  expect(text).toContain('72%');

  // Range converted SI->mi (402336 m / 1609.344 = 250 mi) with the mi suffix.
  expect(text).toContain('250 mi');

  // Drive trend legend names carry the active distance unit + duration.
  expect(text).toContain('Distance (mi)');
  expect(text).toContain('Duration');

  // Reversed series: 16093.44 m -> 10 mi / 30 min, 32186.88 m -> 20 mi / 60 min.
  expect(text).toContain('10 mi · 30 min');
  expect(text).toContain('20 mi · 60 min');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('uses metric conversion when unit_of_length is km', async () => {
  mockUseSettings.mockReturnValue({
    data: {unit_of_length: 'km', locale: 'en-US'},
  });

  const tree = await render({
    state: baseState,
    drives: [makeDrive({id: 1, distance_m: 16093.44, duration_s: 1800})],
  });
  const text = serialize(tree);

  // 402336 m / 1000 = 402 km (rounded by fmtNumber decimals 0).
  expect(text).toContain('402 km');
  expect(text).toContain('Distance (km)');
  // 16093.44 m / 1000 = 16 km.
  expect(text).toContain('16 km · 30 min');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('shows the empty state and keeps headings when there are no drives', async () => {
  mockUseSettings.mockReturnValue({data: undefined});

  const tree = await render({state: baseState, drives: []});
  const text = serialize(tree);

  // Sections never disappear.
  expect(text).toContain('Battery Overview');
  expect(text).toContain('Drive Distance Trend');
  // Empty-state message from the source.
  expect(text).toContain('No drive data for chart');
  // No trend legend when empty.
  expect(text).not.toContain('Distance (');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('treats undefined drives the same as empty (no crash)', async () => {
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'km'}});

  const tree = await render({state: baseState, drives: undefined});
  const text = serialize(tree);

  expect(text).toContain('No drive data for chart');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
