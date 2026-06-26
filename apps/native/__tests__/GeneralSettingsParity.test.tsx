import React from 'react';
import {ActivityIndicator} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  useCarPreferences,
  useSaveSettings,
  useSettings,
  useVehicles,
  type AppSettings,
} from '../src/web-parity/api/hooks/useSettings';
import {GeneralSettings} from '../src/web-parity/features/settings/components/GeneralSettings';

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
  useSaveSettings: jest.fn(),
  useVehicles: jest.fn(),
  useCarPreferences: jest.fn(),
}));

const mockUseSettings = useSettings as unknown as jest.Mock;
const mockUseSaveSettings = useSaveSettings as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseCarPreferences = useCarPreferences as unknown as jest.Mock;

const baseSettings: AppSettings = {
  unit_of_length: 'mi',
  unit_of_temp: 'F',
  unit_of_pressure: 'psi',
  preferred_range: 'ideal',
  language: 'de',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 3.5,
  gas_unit: 'liter',
  gas_efficiency_mpg: 30,
  decimal_precision: 3,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  currency_symbol: '$',
  locale: 'en-US',
  tz_display_default: 'user',
  timezone_user: 'America/Los_Angeles',
  tab_badge_enabled: true,
  critical_flash_enabled: true,
  ui_density: 'comfortable',
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

function serialize(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function countByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
): number {
  return (
    tree?.root.findAll(
      node => node.props?.testID === testID && typeof node.type === 'string',
    ).length ?? 0
  );
}

function instanceText(node: ReactTestRenderer.ReactTestInstance): string {
  return node.children
    .map(child =>
      typeof child === 'string' ? child : instanceText(child),
    )
    .join('');
}

function hostTextByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
): string {
  const node = tree?.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  )[0];
  return node ? instanceText(node) : '';
}

function findTextInput(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  return tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onChangeText === 'function');
}

function pressByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  const node = tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onPress === 'function');
  expect(node).toBeDefined();
  node?.props.onPress();
}

async function renderSettings() {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<GeneralSettings />);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSettings.mockReturnValue({data: baseSettings, isLoading: false});
  mockUseSaveSettings.mockReturnValue({mutate: jest.fn(), isPending: false});
  mockUseVehicles.mockReturnValue({data: [{id: 1, name: 'Model 3', vin: 'V1'}]});
  mockUseCarPreferences.mockReturnValue({data: undefined});
});

test('shows five skeletons + the header and Save while settings load', async () => {
  mockUseSettings.mockReturnValue({data: undefined, isLoading: true});

  const tree = await renderSettings();
  const text = serialize(tree);

  // Header always renders.
  expect(text).toContain('Application');
  expect(text).toContain('Units, language, and cost preferences');
  // Save action always renders.
  expect(text).toContain('Save Settings');
  // Five loading placeholders, no field labels yet.
  expect(countByTestId(tree, 'settings-skeleton')).toBe(5);
  expect(text).not.toContain('Distance Unit');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('renders every field, hydrated from the server snapshot', async () => {
  const tree = await renderSettings();
  const text = serialize(tree);

  // All field labels present (sections never hidden).
  expect(text).toContain('Distance Unit');
  expect(text).toContain('Temperature Unit');
  expect(text).toContain('Pressure Unit');
  expect(text).toContain('Preferred Range');
  expect(text).toContain('Decimal Precision');
  expect(text).toContain('Language');
  expect(text).toContain('Currency');
  expect(text).toContain('Number & Date Locale');
  expect(text).toContain('Time Zone Display');
  expect(text).toContain('My Time Zone Override');
  expect(text).toContain('Electricity Cost (per kWh)');
  expect(text).toContain('Gas Price (for EV vs ICE comparison)');
  expect(text).toContain('Comparison Vehicle MPG');

  // Select triggers reflect the hydrated values.
  expect(hostTextByTestId(tree, 'settings-distance-unit')).toContain('Miles');
  expect(hostTextByTestId(tree, 'settings-temperature-unit')).toContain(
    'Fahrenheit',
  );
  expect(hostTextByTestId(tree, 'settings-pressure-unit')).toContain('PSI');
  expect(hostTextByTestId(tree, 'settings-preferred-range')).toContain('Ideal');
  expect(hostTextByTestId(tree, 'settings-language')).toContain('Deutsch');
  expect(hostTextByTestId(tree, 'settings-tz-display')).toContain(
    'My local time',
  );
  expect(hostTextByTestId(tree, 'settings-gas-unit')).toContain('/ liter');

  // Text inputs seeded from settings.
  expect(findTextInput(tree, 'settings-decimal-precision')?.props.value).toBe('3');
  expect(findTextInput(tree, 'settings-timezone-user')?.props.value).toBe(
    'America/Los_Angeles',
  );
  expect(findTextInput(tree, 'settings-comparison-mpg')?.props.value).toBe('30');

  // Decimal-precision preview uses toFixed(3).
  expect(text).toContain('14.249');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('a select popover commits a new value through the trigger', async () => {
  const tree = await renderSettings();

  // Hydrated as Miles.
  expect(hostTextByTestId(tree, 'settings-distance-unit')).toContain('Miles');

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'settings-distance-unit');
  });
  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'settings-distance-unit-option-km');
  });

  expect(hostTextByTestId(tree, 'settings-distance-unit')).toContain(
    'Kilometers',
  );

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('the car-sync + clock banners render and Sync from Car saves', async () => {
  const mutate = jest.fn();
  mockUseSaveSettings.mockReturnValue({mutate, isPending: false});
  // Car reports imperial units; app is on metric defaults so a sync diff exists.
  mockUseSettings.mockReturnValue({
    data: {...baseSettings, unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar'},
    isLoading: false,
  });
  mockUseCarPreferences.mockReturnValue({
    data: {
      setting_distance_unit: 'DistanceUnitMiles',
      setting_temperature_unit: 'TemperatureUnitFahrenheit',
      setting_tire_pressure_unit: 'PressureUnitPsi',
      setting_24hr_time: true,
    },
  });

  const tree = await renderSettings();
  const text = serialize(tree);

  // Car-sync banner with parsed enum display values.
  expect(text).toContain('Car uses');
  expect(text).toContain('Miles');
  expect(text).toContain('Fahrenheit');
  expect(text).toContain('PSI');
  expect(text).toContain('Sync from Car');
  // Read-only clock banner.
  expect(text).toContain('Car clock format');
  expect(text).toContain('24-hour');

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'settings-sync-from-car');
  });

  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate.mock.calls[0][0]).toMatchObject({
    unit_of_length: 'mi',
    unit_of_temp: 'F',
    unit_of_pressure: 'psi',
  });

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('Save Settings commits the form with success/error handlers', async () => {
  const mutate = jest.fn();
  mockUseSaveSettings.mockReturnValue({mutate, isPending: false});

  const tree = await renderSettings();

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'settings-save');
  });

  expect(mutate).toHaveBeenCalledTimes(1);
  const [payload, options] = mutate.mock.calls[0];
  expect(payload).toMatchObject({unit_of_length: 'mi', decimal_precision: 3});
  expect(typeof options.onSuccess).toBe('function');
  expect(typeof options.onError).toBe('function');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('a pending save shows the busy spinner on the Save button', async () => {
  mockUseSaveSettings.mockReturnValue({mutate: jest.fn(), isPending: true});

  const tree = await renderSettings();

  // The ActionButton swaps its glyph for an ActivityIndicator while pending.
  expect(tree?.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  // The label is still present.
  expect(serialize(tree)).toContain('Save Settings');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
