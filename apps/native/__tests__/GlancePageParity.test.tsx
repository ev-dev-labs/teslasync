import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {useVehicleCommand} from '../src/web-parity/api/hooks/useVehicleCommand';
import {
  useLocationSnapshotLatest,
  useVehicles,
  useVehicleState,
} from '../src/web-parity/api/hooks/useVehicles';
import GlancePage from '../src/web-parity/features/dashboard/pages/GlancePage';

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicleCommand', () => ({
  useVehicleCommand: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
  useVehicleState: jest.fn(),
  useLocationSnapshotLatest: jest.fn(),
}));

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseVehicleState = useVehicleState as unknown as jest.Mock;
const mockUseLocationSnapshotLatest =
  useLocationSnapshotLatest as unknown as jest.Mock;
const mockUseVehicleCommand = useVehicleCommand as unknown as jest.Mock;
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

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

const VEHICLE = {
  id: 7,
  vehicle_id: 7,
  vin: 'VIN7',
  display_name: 'Midnight Model 3',
  model: 'Model 3',
  trim_badging: 'LR',
  exterior_color: 'black',
  wheel_type: 'aero',
  state: 'online',
  healthy: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function vehicleStateStub() {
  return {
    data: {
      state: {
        vehicle_id: 7,
        state: 'online',
        latitude: 0,
        longitude: 0,
        speed: 0,
        power: 0,
        battery_level: 72,
        rated_range: 480000,
        ideal_range: 0,
        odometer: 0,
        inside_temp: 21,
        outside_temp: 14,
        is_climate_on: false,
        is_charging: false,
        charger_power: 0,
        charge_rate: 0,
        time_to_full_charge: 0,
        is_locked: true,
        sentry_mode: false,
        software_version: '2026.4',
      },
      live: true,
    },
    dataUpdatedAt: Date.now(),
  };
}

beforeEach(() => {
  mockUseVehicleState.mockReturnValue(vehicleStateStub());
  mockUseLocationSnapshotLatest.mockReturnValue({
    data: {id: 1, located_at_home: true, created_at: '2026-01-01T00:00:00Z'},
  });
  mockUseVehicleCommand.mockReturnValue({
    isPending: false,
    variables: undefined,
    mutate: jest.fn(),
  });
  // 'mi' + 'F' so the SI->display conversions are exercised.
  mockUseSettings.mockReturnValue({
    data: {unit_of_length: 'mi', unit_of_temp: 'F', decimal_precision: 1},
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<GlancePage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('shows a centered spinner while vehicles are loading', async () => {
  mockUseVehicles.mockReturnValue({
    data: undefined,
    isLoading: true,
    error: null,
  });

  const tree = await render();
  const raw = rawOf(tree);

  expect(textOf(tree)).toContain('Quick Glance');
  expect(raw).toContain('glance-page');
  expect(raw).toContain('glance-loading');
  // While loading, the content/empty branches are gated off.
  expect(raw).not.toContain('glance-content');
  expect(raw).not.toContain('glance-empty');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('surfaces the vehicles error message in an error box', async () => {
  mockUseVehicles.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: new Error('vehicle fetch failed'),
  });

  const tree = await render();
  const raw = rawOf(tree);

  expect(raw).toContain('glance-error');
  expect(textOf(tree)).toContain('vehicle fetch failed');
  expect(raw).not.toContain('glance-content');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the no-vehicle EmptyState when the fleet is empty', async () => {
  mockUseVehicles.mockReturnValue({data: [], isLoading: false, error: null});

  const tree = await render();
  const raw = rawOf(tree);

  expect(raw).toContain('glance-empty');
  expect(textOf(tree)).toContain('No vehicle found');
  expect(raw).not.toContain('glance-content');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the glance card with gauge, metrics, actions, freshness, and link', async () => {
  mockUseVehicles.mockReturnValue({
    data: [VEHICLE],
    isLoading: false,
    error: null,
  });

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('glance-content');

  // Name + online status badge.
  expect(text).toContain('Midnight Model 3');
  expect(raw).toContain('glance-status');
  expect(text).toContain('online');

  // Battery gauge (label + %).
  expect(text).toContain('Battery');
  expect(text).toContain('%');

  // Key metrics grid — labels.
  expect(text).toContain('Range');
  expect(text).toContain('Interior');
  expect(text).toContain('Security');
  expect(text).toContain('Location');

  // SI -> display conversions (480000 m -> ~298 mi; 21 C -> 69.8 F).
  expect(text).toContain('298');
  expect(text).toContain('mi');
  expect(text).toContain('69.8');
  expect(text).toContain('°F');

  // Locked security state + Home location label.
  expect(text).toContain('Locked');
  expect(text).toContain('Home');

  // Three quick actions.
  expect(raw).toContain('glance-action-lock');
  expect(raw).toContain('glance-action-climate');
  expect(raw).toContain('glance-action-horn');
  expect(text).toContain('Unlock'); // locked -> action offers Unlock
  expect(text).toContain('Climate On');
  expect(text).toContain('Horn');

  // Open-full-app affordance.
  expect(text).toContain('Open full app');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('disables command actions when the vehicle is offline', async () => {
  mockUseVehicles.mockReturnValue({
    data: [VEHICLE],
    isLoading: false,
    error: null,
  });
  mockUseVehicleState.mockReturnValue({
    data: {
      state: {...vehicleStateStub().data.state, state: 'asleep'},
      live: false,
    },
    dataUpdatedAt: Date.now(),
  });

  const tree = await render();
  const raw = rawOf(tree);

  // Offline -> status badge shows the raw FSM state, actions disabled.
  expect(textOf(tree)).toContain('asleep');
  expect(raw).toContain('"disabled":true');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
