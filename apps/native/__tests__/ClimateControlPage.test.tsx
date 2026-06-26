import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native vehicle-systems / vehicles / settings hooks are mocked so
// ClimateControlPage resolves its queries synchronously without a
// QueryClientProvider, network, or open handles (the MileagePage mocking
// precedent). The AI recommender is mocked to a no-op so the withAiFeature
// machinery is not exercised here. All referenced module variables are
// `mock`-prefixed so the jest.mock factories may close over them.
type Query<T> = {
  data?: T;
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => unknown;
};

type ClimateState = {
  id?: number;
  timestamp?: string;
  created_at?: string;
  insideTemp?: number | null;
  outsideTemp?: number | null;
  driverTempSetting?: number | null;
  passengerTempSetting?: number | null;
  hvacPower?: string | null;
  isAcOn?: boolean | null;
  hvacAutoMode?: string | null;
  fanSpeed?: number | null;
  hvacFanStatus?: number | null;
  climateKeeperMode?: string | null;
  defrostMode?: string | null;
  batteryHeater?: boolean | null;
  overheatProtection?: string | null;
  hvacSteeringWheelHeatLevel?: number | null;
  hvacSteeringWheelHeatAuto?: boolean | null;
  seatHeaterLeft?: number | null;
  seatHeaterRight?: number | null;
  seatHeaterRearLeft?: number | null;
  seatHeaterRearCenter?: number | null;
  seatHeaterRearRight?: number | null;
  autoSeatClimateLeft?: boolean | null;
  autoSeatClimateRight?: boolean | null;
  climateSeatCoolingFrontLeft?: number | null;
  climateSeatCoolingFrontRight?: number | null;
  seatVentEnabled?: boolean | null;
};

type Vehicle = {id: number; vehicle_id: number; vin: string; display_name: string};

const LATEST: ClimateState = {
  id: 1,
  timestamp: '2026-06-26T12:00:00Z',
  insideTemp: 22,
  outsideTemp: 18,
  driverTempSetting: 21,
  passengerTempSetting: 21,
  hvacPower: 'On',
  isAcOn: true,
  hvacAutoMode: 'On',
  fanSpeed: 4,
  hvacFanStatus: 1,
  climateKeeperMode: 'Off',
  defrostMode: 'Off',
  batteryHeater: false,
  overheatProtection: 'On',
  hvacSteeringWheelHeatLevel: 0,
  hvacSteeringWheelHeatAuto: false,
  seatHeaterLeft: 2,
  seatHeaterRight: 1,
  seatHeaterRearLeft: 0,
  seatHeaterRearCenter: 0,
  seatHeaterRearRight: 0,
  autoSeatClimateLeft: true,
  autoSeatClimateRight: false,
  climateSeatCoolingFrontLeft: 1,
  climateSeatCoolingFrontRight: null,
  seatVentEnabled: true,
};

const HISTORY: ClimateState[] = [
  {
    id: 10,
    timestamp: '2026-06-26T11:00:00Z',
    insideTemp: 24,
    outsideTemp: 17,
    driverTempSetting: 21,
    fanSpeed: 3,
    isAcOn: true,
    climateKeeperMode: 'Off',
  },
  {
    id: 11,
    timestamp: '2026-06-26T12:00:00Z',
    insideTemp: 22,
    outsideTemp: 18,
    driverTempSetting: 21,
    fanSpeed: 4,
    isAcOn: true,
    climateKeeperMode: 'Off',
  },
];

let mockClimate: Query<ClimateState> = {
  data: LATEST,
  isLoading: false,
  error: null,
  refetch: jest.fn(),
};
let mockHistory: Query<ClimateState[]> = {data: HISTORY, isLoading: false};
let mockCharging: Query<{not_enough_power_to_heat?: boolean | null}> = {
  data: {not_enough_power_to_heat: false},
};
let mockVehicles: Query<Vehicle[]> = {
  data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
};
let mockSettings: Query<{unit_of_length: string; unit_of_temp: string}> = {
  data: {unit_of_length: 'km', unit_of_temp: 'C'},
};

jest.mock('../src/web-parity/api/hooks/useVehicleSystems', () => ({
  useClimate: () => mockClimate,
  useClimateHistory: () => mockHistory,
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => mockVehicles,
  useChargingTelemetryLatest: () => mockCharging,
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => mockSettings,
}));

jest.mock('../src/web-parity/components/ai/AIPreheatPrecoolRecommender', () => ({
  AIPreheatPrecoolRecommender: () => null,
}));

import ClimateControlPage from '../src/web-parity/features/vehicle-systems/pages/ClimateControlPage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

afterEach(() => {
  mockClimate = {data: LATEST, isLoading: false, error: null, refetch: jest.fn()};
  mockHistory = {data: HISTORY, isLoading: false};
  mockCharging = {data: {not_enough_power_to_heat: false}};
  mockVehicles = {
    data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
  };
  mockSettings = {data: {unit_of_length: 'km', unit_of_temp: 'C'}};
  jest.restoreAllMocks();
});

/* ── scaffold + header ── */

test('renders the page scaffold with title, subtitle, and vehicle picker', () => {
  const tree = render(<ClimateControlPage />);
  expect(hasHost(tree, 'climate-control-page')).toBe(true);
  expect(hasHost(tree, 'vehicle-select')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Climate Control');
  expect(text).toContain('HVAC status, temperatures, and seat heaters');
  expect(text).toContain('Bluey');
  expect(text).toContain('Refresh');
});

/* ── HVAC status banner ── */

test('renders the HVAC banner with Active + comfort badges', () => {
  const tree = render(<ClimateControlPage />);
  const text = allText(tree);
  expect(text).toContain('HVAC System');
  expect(text).toContain('Active');
  // insideTemp 22 vs driverTempSetting 21 → delta 1 → Comfortable.
  expect(text).toContain('Comfortable');
});

/* ── temperature gauges with converted (°C) values ── */

test('renders the three temperature gauges with converted values', () => {
  const tree = render(<ClimateControlPage />);
  const text = allText(tree);
  expect(text).toContain('Inside Temp');
  expect(text).toContain('Outside Temp');
  expect(text).toContain('Driver Set Temp');
  // °C pref → 22 stays 22.0, 18 → 18.0, 21 → 21.0.
  expect(text).toContain('22.0');
  expect(text).toContain('18.0');
});

/* ── climate status + protection + efficiency cards ── */

test('renders the climate status, protection, and efficiency cards', () => {
  const tree = render(<ClimateControlPage />);
  const text = allText(tree);
  expect(text).toContain('HVAC Power');
  expect(text).toContain('Fan Speed');
  expect(text).toContain('Steering Wheel Heater');
  expect(text).toContain('Overheat Protection');
  expect(text).toContain('Passenger Setting');
  expect(text).toContain('Climate Efficiency');
  expect(text).toContain('AC On Time');
});

/* ── thermal comfort + seat heaters ── */

test('renders thermal comfort indicator and seat heaters', () => {
  const tree = render(<ClimateControlPage />);
  const text = allText(tree);
  expect(text).toContain('Thermal Comfort');
  expect(text).toContain('Comfort Score');
  expect(text).toContain('Seat Heaters');
  expect(text).toContain('Front Left');
  expect(text).toContain('Seat Cooling');
});

/* ── chart panels render (native-safe placeholders, not empty states) ── */

test('renders both chart panels when history is present', () => {
  const tree = render(<ClimateControlPage />);
  const text = allText(tree);
  expect(text).toContain('Temperature History');
  expect(text).toContain('AC State & Fan Speed');
  expect(text).not.toContain('No temperature history available.');
  expect(text).not.toContain('No HVAC history available.');
});

/* ── climate history table ── */

test('renders the climate history table with rows', () => {
  const tree = render(<ClimateControlPage />);
  expect(hasHost(tree, 'vehicle-systems:climate-history')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Climate History');
});

/* ── insufficient-power-to-heat alert ── */

test('renders the insufficient-power-to-heat badge when charging telemetry flags it', () => {
  mockCharging = {data: {not_enough_power_to_heat: true}};
  const tree = render(<ClimateControlPage />);
  expect(allText(tree)).toContain('Insufficient Power to Heat');
});

/* ── empty history states ── */

test('shows the empty states when history is empty', () => {
  mockHistory = {data: [], isLoading: false};
  const tree = render(<ClimateControlPage />);
  const text = allText(tree);
  expect(text).toContain('No temperature history available.');
  expect(text).toContain('No HVAC history available.');
  expect(text).toContain('No history records found.');
});

/* ── loading state gates the body behind the spinner ── */

test('shows the loading spinner and hides the body while climate is loading', () => {
  mockClimate = {...mockClimate, isLoading: true, data: undefined};
  const tree = render(<ClimateControlPage />);
  expect(hasHost(tree, 'climate-loading')).toBe(true);
  expect(allText(tree)).not.toContain('Thermal Comfort');
});

/* ── imperial unit preference flows through ── */

test('uses Fahrenheit when the settings unit_of_temp is F', () => {
  mockSettings = {data: {unit_of_length: 'mi', unit_of_temp: 'F'}};
  const tree = render(<ClimateControlPage />);
  const text = allText(tree);
  // 22 °C → 71.6 °F; the gauge value text renders the converted figure.
  expect(text).toContain('71.6');
  expect(text).toContain('\u00B0F');
});
