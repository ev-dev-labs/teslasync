import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { ChargingScreen } from '../src/screens/ChargingScreen';
import { DrivingScreen } from '../src/screens/DrivingScreen';
import { VehiclesScreen } from '../src/screens/VehiclesScreen';

const vehicle = {
  id: 1,
  vehicle_id: 42,
  vin: '5YJTESLASYNC0001',
  display_name: 'Roadrunner',
  model: 'Model Y',
  trim_badging: 'Performance',
  exterior_color: 'Pearl White',
  wheel_type: 'Uberturbine',
  state: 'online',
  healthy: true,
  timezone: 'America/Los_Angeles',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-23T20:00:00Z',
};

const vehicleState = {
  vehicle_id: 42,
  state: 'driving',
  latitude: 37.42,
  longitude: -122.08,
  speed_mps: 12.5,
  power_w: 23000,
  battery_level: 81,
  is_charging: false,
  is_locked: true,
  software_version: '2026.20.1',
};

const chargingSession = {
  id: 9,
  vehicle_id: 42,
  started_at: '2026-06-23T07:00:00Z',
  ended_at: '2026-06-23T09:00:00Z',
  start_soc_pct: 42,
  end_soc_pct: 80,
  total_energy_added_wh: 28600,
  peak_power_w: 11200,
  avg_power_w: 8500,
  charger_type: 'Wall Connector',
  cable_type: 'type2',
  cost_decimal: 4.72,
  cost_currency: 'USD',
  live: false,
};

const drive = {
  id: 3,
  vehicle_id: 42,
  start_ts: '2026-06-23T18:00:00Z',
  end_ts: '2026-06-23T18:32:00Z',
  duration_s: 1920,
  distance_m: 24400,
  energy_used_wh: 5100,
  regen_energy_wh: 800,
  avg_speed_mps: 12,
  max_speed_mps: 31,
  avg_power_w: 9600,
  start_address: 'Home',
  end_address: 'Office',
  start_soc_pct: 82,
  end_soc_pct: 79,
  ended_status: 'complete',
  score: 96,
};

const chargeTelemetry = [
  {
    session_id: 9,
    vehicle_id: 42,
    ts: '2026-06-23T07:15:00Z',
    ac_charging_power_w: 7200,
    dc_charging_power_w: null,
    ac_charging_energy_in_wh: 1800,
    dc_charging_energy_in_wh: null,
    charger_voltage_v: 240,
    charger_actual_current_a: 30,
    charger_pilot_current_a: 32,
    battery_heater_on: false,
    created_at: '2026-06-23T07:15:00Z',
  },
];

const driveTelemetry = [
  {
    id: 1,
    drive_id: 3,
    vehicle_id: 42,
    ts: '2026-06-23T18:05:00Z',
    latitude: 37.2,
    longitude: -122.1,
    heading: 90,
    speed_mps: 8,
    power_w: 7000,
    battery_level: 81,
    created_at: '2026-06-23T18:05:00Z',
  },
  {
    id: 2,
    drive_id: 3,
    vehicle_id: 42,
    ts: '2026-06-23T18:25:00Z',
    latitude: 37.6,
    longitude: -121.8,
    heading: 94,
    speed_mps: 22,
    power_w: 11000,
    battery_level: 79,
    created_at: '2026-06-23T18:25:00Z',
  },
];

let mockVehiclesData: typeof vehicle[] | undefined;
let mockVehicleDetailData: typeof vehicle | undefined;
let mockVehicleStateData: {state: typeof vehicleState; live: boolean} | undefined;
let mockChargingSessionsData: typeof chargingSession[] | undefined;
let mockChargingSessionData: typeof chargingSession | undefined;
let mockChargeTelemetryData: typeof chargeTelemetry | undefined;
let mockDrivesData: typeof drive[] | undefined;
let mockDriveData: typeof drive | undefined;
let mockDriveTelemetryData: typeof driveTelemetry | undefined;
let mockVehiclesError: Error | null;
let mockChargingError: Error | null;
let mockDrivesError: Error | null;

beforeEach(() => {
  mockVehiclesData = [vehicle];
  mockVehicleDetailData = vehicle;
  mockVehicleStateData = {state: vehicleState, live: true};
  mockChargingSessionsData = [chargingSession];
  mockChargingSessionData = chargingSession;
  mockChargeTelemetryData = chargeTelemetry;
  mockDrivesData = [drive];
  mockDriveData = drive;
  mockDriveTelemetryData = driveTelemetry;
  mockVehiclesError = null;
  mockChargingError = null;
  mockDrivesError = null;
});

jest.mock('../src/api/hooks', () => ({
  useVehicles: () => ({
    data: mockVehiclesData,
    isLoading: false,
    isFetching: false,
    error: mockVehiclesError,
  }),
  useVehicle: (vehicleId: number | null) => ({
    data: vehicleId ? mockVehicleDetailData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehiclesError,
  }),
  useVehicleState: (vehicleId: number | null) => ({
    data: vehicleId ? mockVehicleStateData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehiclesError,
  }),
  useChargingSessions: () => ({
    data: mockChargingSessionsData,
    isLoading: false,
    isFetching: false,
    error: mockChargingError,
  }),
  useChargingSession: (sessionId: number | null) => ({
    data: sessionId ? mockChargingSessionData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockChargingError,
  }),
  useChargeTelemetry: (sessionId: number | null) => ({
    data: sessionId ? mockChargeTelemetryData : [],
    isLoading: false,
    isFetching: false,
    error: mockChargingError,
  }),
  useDrives: () => ({
    data: mockDrivesData,
    isLoading: false,
    isFetching: false,
    error: mockDrivesError,
  }),
  useDrive: (driveId: number | null) => ({
    data: driveId ? mockDriveData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockDrivesError,
  }),
  useDriveTelemetry: (driveId: number | null) => ({
    data: driveId ? mockDriveTelemetryData : [],
    isLoading: false,
    isFetching: false,
    error: mockDrivesError,
  }),
}));

async function render(element: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });

  return JSON.stringify(tree?.toJSON());
}

test('renders vehicle list, detail, and route readiness sections', async () => {
  const serialized = await render(<VehiclesScreen />);

  expect(serialized).toContain('Fleet garage overview');
  expect(serialized).toContain('Vehicle detail shell');
  expect(serialized).toContain('Roadrunner');
  expect(serialized).toContain('37.4200, -122.0800');
  expect(serialized).toContain('"/vehicles/1"');
  expect(serialized).toContain('/vehicles/1/state');
  expect(serialized).toContain('Live map coordinates');
  expect(serialized).toContain('Access routes are represented with typed route evidence');
});

test('renders charging sessions, detail, telemetry chart, and readiness sections', async () => {
  const serialized = await render(<ChargingScreen />);

  expect(serialized).toContain('Charging overview');
  expect(serialized).toContain('Charge detail and telemetry');
  expect(serialized).toContain('Wall Connector');
  expect(serialized).toContain('"/charging/9"');
  expect(serialized).toContain('/charging/9/telemetry');
  expect(serialized).toContain('Charging curve summary');
  expect(serialized).toContain('Latest charger power');
  expect(serialized).toContain('Charging vampire drain');
});

test('renders drive list, trip detail, route replay, and readiness sections', async () => {
  const serialized = await render(<DrivingScreen />);

  expect(serialized).toContain('Driving overview');
  expect(serialized).toContain('Drives and trips');
  expect(serialized).toContain('Trip parity summary');
  expect(serialized).toContain('Drive-backed trip detail');
  expect(serialized).toContain('"/drives/3"');
  expect(serialized).toContain('/drives/3/telemetry');
  expect(serialized).toContain('Drive detail shell');
  expect(serialized).toContain('Drive route route summary from Home to Office');
  expect(serialized).toContain('Replay speed summary');
  expect(serialized).toContain('Trips list parity');
});

test('renders empty states without hiding detail or readiness sections', async () => {
  mockVehiclesData = [];
  mockVehicleDetailData = undefined;
  mockVehicleStateData = undefined;
  mockChargingSessionsData = [];
  mockChargingSessionData = undefined;
  mockChargeTelemetryData = [];
  mockDrivesData = [];
  mockDriveData = undefined;
  mockDriveTelemetryData = [];

  const vehiclesSerialized = await render(<VehiclesScreen />);
  const chargingSerialized = await render(<ChargingScreen />);
  const drivingSerialized = await render(<DrivingScreen />);

  expect(vehiclesSerialized).toContain('No vehicles yet');
  expect(vehiclesSerialized).toContain('No selected vehicle');
  expect(vehiclesSerialized).toContain('Vehicle route readiness');
  expect(chargingSerialized).toContain('No charging sessions');
  expect(chargingSerialized).toContain('No selected charging session');
  expect(chargingSerialized).toContain('Charging route readiness');
  expect(drivingSerialized).toContain('No drives returned');
  expect(drivingSerialized).toContain('No selected trip');
  expect(drivingSerialized).toContain('No selected drive');
  expect(drivingSerialized).toContain('No replay drive selected');
  expect(drivingSerialized).toContain('Driving and trips route readiness');
});

test('renders API error states without inventing fleet data', async () => {
  mockVehiclesData = [];
  mockChargingSessionsData = [];
  mockDrivesData = [];
  mockVehiclesError = new Error('vehicle API failed');
  mockChargingError = new Error('charging API failed');
  mockDrivesError = new Error('drive API failed');

  const vehiclesSerialized = await render(<VehiclesScreen />);
  const chargingSerialized = await render(<ChargingScreen />);
  const drivingSerialized = await render(<DrivingScreen />);

  expect(vehiclesSerialized).toContain('Vehicle API unavailable');
  expect(chargingSerialized).toContain('Charging API unavailable');
  expect(drivingSerialized).toContain('Drive API unavailable');
  expect(drivingSerialized).toContain('Trip source API unavailable');
});
