import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {useVehicleState} from '../src/web-parity/api/hooks/useVehicles';
import type {Vehicle} from '../src/web-parity/api/types';
import {VehicleCard} from '../src/web-parity/features/vehicles/components/VehicleCard';

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

// useVehicleState is mocked; getVehicleStatus is a tiny pure function reproduced
// here so the test stays hermetic (no react-query infra is loaded).
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicleState: jest.fn(),
  getVehicleStatus: (
    state?: {is_charging?: boolean; speed?: number; state?: string} | null,
  ): string => {
    if (!state) {
      return 'offline';
    }
    if (state.is_charging) {
      return 'charging';
    }
    if (state.speed && state.speed > 0) {
      return 'driving';
    }
    const s = (state.state ?? '').toLowerCase();
    return [
      'online',
      'driving',
      'charging',
      'parked',
      'updating',
      'asleep',
      'offline',
    ].includes(s)
      ? s
      : 'online';
  },
}));

const mockUseVehicleState = useVehicleState as unknown as jest.Mock;
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
  vin: '5YJ3E1EA7KF000000',
  display_name: 'Lightning',
  model: 'Model 3',
  trim_badging: 'P',
  exterior_color: 'red',
  wheel_type: 'sport',
  state: 'online',
  healthy: true,
  created_at: '',
  updated_at: '',
} as unknown as Vehicle;

// VehicleState is SI on the wire (metres / °C). The card converts at the display
// boundary via the inlined useUnits + lib/unitConversion formatters.
function stateStub(
  overrides: Partial<Record<string, number | boolean | string>> = {},
) {
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
        rated_range: 400_000,
        ideal_range: 0,
        odometer: 50_000,
        inside_temp: 21,
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
  };
}

beforeEach(() => {
  mockUseVehicleState.mockReturnValue(stateStub());
  mockUseSettings.mockReturnValue({
    data: {unit_of_length: 'km', unit_of_temp: 'C', decimal_precision: 0},
  });
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

test('renders the card shell, name, status badge and VIN subtitle', async () => {
  const tree = await render(
    <VehicleCard vehicle={VEHICLE} onDelete={jest.fn()} />,
  );
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('vehicle-card');
  expect(raw).toContain('vehicle-card-carviz');
  expect(raw).toContain('vehicle-card-status');
  expect(text).toContain('Lightning');
  // online status -> capitalised label.
  expect(text).toContain('Online');
  // Subtitle: model + trim + VIN.
  expect(text).toContain('Model 3');
  expect(text).toContain('P');
  expect(text).toContain('5YJ3E1EA7KF000000');

  await unmount(tree);
});

test('renders the live stats row with converted battery/range/temp/odometer', async () => {
  const tree = await render(
    <VehicleCard vehicle={VEHICLE} onDelete={jest.fn()} />,
  );
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('vehicle-card-battery-ring');
  // battery_level rendered as a percentage.
  expect(text).toContain('72%');
  // rated_range 400,000 m -> 400 km (precision 0).
  expect(text).toContain('400 km');
  // inside_temp 21 °C -> "21°C".
  expect(text).toContain('21°C');
  expect(text).toContain('Interior');
  // odometer 50,000 m -> 50 km (value + unit label).
  expect(text).toContain('50');
  expect(text).toContain('km');
  // is_locked true -> 'LK' glyph; sentry off -> no 'SH'.
  expect(text).toContain('LK');

  await unmount(tree);
});

test('shows the charging power block only while charging', async () => {
  mockUseVehicleState.mockReturnValue(
    stateStub({is_charging: true, charger_power: 11, sentry_mode: true}),
  );

  const tree = await render(
    <VehicleCard vehicle={VEHICLE} onDelete={jest.fn()} />,
  );
  const text = textOf(tree);

  expect(text).toContain('11 kW');
  expect(text).toContain('Charging');
  // sentry_mode true -> 'SH' glyph.
  expect(text).toContain('SH');
  // is_charging -> getVehicleStatus resolves to 'charging'.
  expect(text).toContain('Charging');

  await unmount(tree);
});

test('hides the stats row but still renders the card when there is no state', async () => {
  mockUseVehicleState.mockReturnValue({data: {state: undefined}});

  const tree = await render(
    <VehicleCard vehicle={VEHICLE} onDelete={jest.fn()} />,
  );
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('vehicle-card');
  expect(raw).toContain('vehicle-card-carviz');
  // No state -> getVehicleStatus -> 'offline'.
  expect(text).toContain('Offline');
  // The stats row (battery ring) is gated behind `state &&`.
  expect(raw).not.toContain('vehicle-card-battery-ring');

  await unmount(tree);
});

test('preserves the /vehicles/:id link target on the name and view links', async () => {
  const tree = await render(
    <VehicleCard vehicle={VEHICLE} onDelete={jest.fn()} />,
  );
  const raw = rawOf(tree);

  expect(raw).toContain('vehicle-card-name-link');
  expect(raw).toContain('vehicle-card-view-link');
  // accessibilityValue.text === the route the web <Link to> targeted.
  expect(raw).toContain('/vehicles/7');
  expect(raw).toContain('"accessibilityRole":"link"');

  await unmount(tree);
});

test('invokes onDelete with the vehicle when the remove button is pressed', async () => {
  const onDelete = jest.fn();
  const tree = await render(<VehicleCard vehicle={VEHICLE} onDelete={onDelete} />);

  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({testID: 'vehicle-card-delete'}).props.onPress();
  });

  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(onDelete).toHaveBeenCalledWith(VEHICLE);

  await unmount(tree);
});

test('converts to miles and Fahrenheit when the settings prefs change', async () => {
  mockUseVehicleState.mockReturnValue(
    stateStub({rated_range: 160_934.4, odometer: 160_934.4, inside_temp: 20}),
  );
  mockUseSettings.mockReturnValue({
    data: {unit_of_length: 'mi', unit_of_temp: 'F', decimal_precision: 0},
  });

  const tree = await render(
    <VehicleCard vehicle={VEHICLE} onDelete={jest.fn()} />,
  );
  const text = textOf(tree);

  // 160,934.4 m / 1609.344 -> 100 mi.
  expect(text).toContain('100 mi');
  // 20 °C -> 68 °F.
  expect(text).toContain('68°F');
  expect(text).not.toContain('km');

  await unmount(tree);
});
