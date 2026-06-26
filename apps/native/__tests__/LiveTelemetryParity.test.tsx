import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  LiveTelemetry,
  type ClimateData,
  type LocationData,
  type MediaData,
  type MotorData,
  type SecurityData,
  type TirePressureData,
} from '../src/web-parity/features/dashboard/components/LiveTelemetry';

const motorData: MotorData = {
  di_torque: 320,
  di_stator_temp: 45,
  gear: 'D',
  lateral_accel: 0.2,
  longitudinal_accel: -0.5,
};

const climateData: ClimateData = {
  inside_temp: 21,
  outside_temp: 15,
  hvac_power: 2.5,
  hvac_fan_speed: 3,
  defrost_mode: 'Front',
  battery_heater_on: true,
};

const securityData: SecurityData = {
  locked: true,
  sentry_mode: false,
  door_state: 'DriverFront:Open, PassengerFront:Closed',
  fd_window: 'Closed',
  fp_window: 'PartiallyOpen',
  rd_window: 'Closed',
  rp_window: 'Closed',
};

const tireData: TirePressureData = {
  front_left: 2.5,
  front_right: 2.6,
  rear_left: 2.5,
  rear_right: 2.6,
};

const mediaData: MediaData = {
  now_playing_title: 'Song',
  now_playing_artist: 'Artist',
  playback_status: 'Playing',
  audio_volume: 5,
  audio_volume_max: 10,
};

const locationData: LocationData = {
  destination_name: 'Home',
  miles_to_arrival: 12.3,
  minutes_to_arrival: 8,
  located_at_home: true,
  located_at_work: false,
  located_at_favorite: false,
};

const identity = (n: number) => n;

const baseProps = {
  toTemperatureDisplay: identity,
  toDistanceDisplay: identity,
  toPressureDisplay: identity,
  tempUnit: '°C',
  distanceUnit: 'km',
  pressureUnit: 'bar',
};

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

function countByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
): number {
  // Count only host instances (typeof type === 'string'); react-test-renderer
  // otherwise reports both the RN <View> composite and its host child.
  return (
    tree?.root.findAll(
      node => node.props?.testID === testID && typeof node.type === 'string',
    ).length ?? 0
  );
}

async function render(props: Partial<React.ComponentProps<typeof LiveTelemetry>>) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <LiveTelemetry
        {...baseProps}
        climateData={undefined}
        locationData={undefined}
        mediaData={undefined}
        motorData={undefined}
        securityData={undefined}
        tireData={undefined}
        {...props}
      />,
    );
  });
  return tree;
}

test('renders all six panels with converted values when fully populated', async () => {
  const tree = await render({
    motorData,
    climateData,
    securityData,
    tireData,
    mediaData,
    locationData,
  });

  const text = serialize(tree);

  // Section + panel headings.
  expect(text).toContain('Live Telemetry');
  expect(text).toContain('Drivetrain');
  expect(text).toContain('Climate');
  expect(text).toContain('Security');
  expect(text).toContain('Tire Pressure');
  expect(text).toContain('Media');
  expect(text).toContain('Navigation');

  // Drivetrain: raw torque, converted motor temp, gear badge, g-force.
  expect(text).toContain('320 Nm');
  expect(text).toContain('45°C');
  expect(text).toContain('0.50g');
  expect(text).toContain('D');

  // Climate: cabin/outside/hvac/fan + active mode chips.
  expect(text).toContain('21°C');
  expect(text).toContain('15°C');
  expect(text).toContain('2.5 kW');
  expect(text).toContain('3/6');
  expect(text).toContain('Defrost');
  expect(text).toContain('Bat Heater');

  // Security: lock label + open door/window counts.
  expect(text).toContain('Locked');
  expect(text).toContain('1 Open');

  // Tire: per-tire pressures, unit, and all-normal status.
  expect(text).toContain('2.5');
  expect(text).toContain('2.6');
  expect(text).toContain('bar');
  expect(text).toContain('All Normal');

  // Media: now-playing + status + volume.
  expect(text).toContain('Song');
  expect(text).toContain('Artist');
  expect(text).toContain('Playing');
  expect(text).toContain('5/10');

  // Navigation: destination, converted distance, eta, saved-location chip.
  expect(text).toContain('Home');
  expect(text).toContain('12.3 km');
  expect(text).toContain('8 min');

  // No skeletons when every slice resolved.
  expect(countByTestId(tree, 'telemetry-skeleton')).toBe(0);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('shows a skeleton in every panel while data is undefined, but keeps headings', async () => {
  const tree = await render({});

  const text = serialize(tree);
  // All six panel headings still render (sections never disappear).
  expect(text).toContain('Live Telemetry');
  expect(text).toContain('Drivetrain');
  expect(text).toContain('Climate');
  expect(text).toContain('Security');
  expect(text).toContain('Tire Pressure');
  expect(text).toContain('Media');
  expect(text).toContain('Navigation');

  // One skeleton block per panel (6).
  expect(countByTestId(tree, 'telemetry-skeleton')).toBe(6);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('unlocked + sentry + all-closed renders the inverse security state', async () => {
  const tree = await render({
    securityData: {
      locked: false,
      sentry_mode: true,
      door_state: 'DriverFront:Closed, PassengerFront:Closed',
      fd_window: 'Closed',
      fp_window: 'Closed',
      rd_window: 'Closed',
      rp_window: 'Closed',
    },
  });

  const text = serialize(tree);
  expect(text).toContain('Unlocked');
  expect(text).toContain('Active');
  expect(text).toContain('All Closed');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('out-of-range tire pressure flips the status to Warning', async () => {
  const tree = await render({
    tireData: {
      front_left: 2.0, // below 2.068 -> danger, not all-normal
      front_right: 2.6,
      rear_left: 2.5,
      rear_right: 2.6,
    },
  });

  const text = serialize(tree);
  expect(text).toContain('Warning');
  expect(text).not.toContain('All Normal');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('empty climate modes and no saved location render the muted fallbacks', async () => {
  const tree = await render({
    climateData: {
      inside_temp: 20,
      outside_temp: 10,
      hvac_power: null,
      hvac_fan_speed: 0,
      defrost_mode: 'Off',
      battery_heater_on: false,
    },
    locationData: {
      destination_name: null,
      miles_to_arrival: null,
      minutes_to_arrival: null,
      located_at_home: false,
      located_at_work: false,
      located_at_favorite: false,
    },
  });

  const text = serialize(tree);
  expect(text).toContain('No active modes');
  expect(text).toContain('No saved location');
  // Null HVAC / destination / distance / eta degrade to the em dash.
  expect(text).toContain('—');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('gear R reports the danger badge and <nil> gear degrades to a dash', async () => {
  const rTree = await render({
    motorData: {...motorData, gear: 'R'},
  });
  expect(serialize(rTree)).toContain('R');
  await ReactTestRenderer.act(async () => {
    rTree?.unmount();
  });

  const nilTree = await render({
    motorData: {...motorData, gear: '<nil>'},
  });
  // cleanNil('<nil>') -> undefined -> em-dash placeholder instead of a badge.
  expect(serialize(nilTree)).toContain('—');
  await ReactTestRenderer.act(async () => {
    nilTree?.unmount();
  });
});
