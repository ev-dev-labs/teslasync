import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useVehicleState,
  useVehicles,
} from '../src/web-parity/api/hooks/useVehicles';
import EnergyFlowWidget from '../src/web-parity/features/dashboard/widgets/EnergyFlowWidget';

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
  useVehicleState: jest.fn(),
}));

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseVehicleState = useVehicleState as unknown as jest.Mock;

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

function stateStub(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      state: {
        vehicle_id: 1,
        state: 'online',
        latitude: 0,
        longitude: 0,
        speed: 0,
        power: 0,
        battery_level: 85,
        rated_range: 0,
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
        software_version: '',
        ...overrides,
      },
      live: true,
    },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseVehicleState.mockReturnValue(stateStub());
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(
  element: React.ReactElement,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

async function unmount(
  tree: ReactTestRenderer.ReactTestRenderer,
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

const SIZE = {cols: 2, rows: 2};

test('renders a loading skeleton while the vehicle state query is loading', async () => {
  mockUseVehicleState.mockReturnValue({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<EnergyFlowWidget size={SIZE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('energy-flow-loading');
  expect(raw).not.toContain('energy-flow-widget');

  await unmount(tree);
});

test('renders the consuming flow (battery -> motor) when power is positive', async () => {
  mockUseVehicleState.mockReturnValue(stateStub({power: 12.5}));

  const tree = await render(<EnergyFlowWidget size={SIZE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('energy-flow-widget');
  expect(text).toContain('Energy Flow');
  expect(raw).toContain('energy-flow-diagram');
  expect(raw).toContain('energy-flow-node-battery');
  expect(raw).toContain('energy-flow-node-motor');
  expect(text).toContain('Battery');
  expect(text).toContain('Consuming');
  // Battery node value (85) + motor abs power (12.5), both at 1 decimal.
  expect(text).toContain('85.0');
  expect(text).toContain('12.5');
  // Battery -> Motor arrow is present (the motor node is labelled by its state).
  expect(text).toContain('Battery \u2192 Consuming');
  // Not regenerating / not charging.
  expect(text).not.toContain('Regenerating');
  expect(raw).not.toContain('energy-flow-node-charger');
  // Freshness chip is wired.
  expect(raw).toContain('energy-flow-freshness');

  await unmount(tree);
});

test('renders the regenerating flow (motor -> battery) when power is negative', async () => {
  mockUseVehicleState.mockReturnValue(stateStub({power: -8}));

  const tree = await render(<EnergyFlowWidget size={SIZE} />);
  const text = textOf(tree);

  expect(text).toContain('Regenerating');
  expect(text).toContain('Regenerating \u2192 Battery');
  expect(text).not.toContain('Consuming');
  // abs(-8) at 1 decimal.
  expect(text).toContain('8.0');

  await unmount(tree);
});

test('labels the motor node as standby when power is zero', async () => {
  mockUseVehicleState.mockReturnValue(stateStub({power: 0}));

  const tree = await render(<EnergyFlowWidget size={SIZE} />);
  const text = textOf(tree);

  expect(text).toContain('Standby');
  expect(text).not.toContain('Consuming');
  expect(text).not.toContain('Regenerating');

  await unmount(tree);
});

test('adds the charger node and charger -> battery arrow while charging', async () => {
  mockUseVehicleState.mockReturnValue(
    stateStub({is_charging: true, charger_power: 7, power: 0}),
  );

  const tree = await render(<EnergyFlowWidget size={SIZE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('energy-flow-node-charger');
  expect(text).toContain('Charger');
  expect(text).toContain('Charger \u2192 Battery');
  // charger_power at 1 decimal.
  expect(text).toContain('7.0');

  await unmount(tree);
});

test('renders the empty state when there is no live vehicle state', async () => {
  mockUseVehicleState.mockReturnValue({
    data: {state: undefined, live: false},
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<EnergyFlowWidget size={SIZE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('energy-flow-empty');
  expect(raw).not.toContain('energy-flow-diagram');
  expect(text).toContain('No energy data available');

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<EnergyFlowWidget size={SIZE} />);

  expect(mockUseVehicleState).toHaveBeenCalledWith(7, {refetchInterval: 5000});

  await unmount(tree);
});

test('passes the explicit vehicleId prop to the vehicle state hook', async () => {
  const tree = await render(<EnergyFlowWidget vehicleId={42} size={SIZE} />);

  expect(mockUseVehicleState).toHaveBeenCalledWith(42, {refetchInterval: 5000});

  await unmount(tree);
});
