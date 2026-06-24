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

const tirePressure = {
  front_left: 295000,
  front_right: 296000,
  rear_left: 301000,
  rear_right: 300000,
};

const climate = {
  inside_temp: 21.5,
  outside_temp: 18.2,
  driver_temp_setting: 20,
  passenger_temp_setting: 20,
  hvac_power: 'on',
  is_ac_on: true,
  fan_speed: 3,
  climate_keeper_mode: 'off',
  rear_defrost_enabled: false,
  battery_heater: false,
  overheat_protection: 'fan_only',
  wiper_heat_enabled: false,
  seat_vent_enabled: false,
};

const security = {
  locked: true,
  sentry_mode: true,
  door_state: 'closed',
  fd_window: 'closed',
  fp_window: 'closed',
  rd_window: 'closed',
  rp_window: 'closed',
  valet_mode_enabled: false,
  service_mode: 'off',
  paired_phone_key_count: 2,
};

const safety = {
  automatic_emergency_braking_off: false,
  automatic_blind_spot_camera: true,
  pin_to_drive_enabled: true,
  cruise_follow_distance: 4,
};

const media = {
  playback_status: 'playing',
  now_playing_title: 'Electric Feel',
  now_playing_artist: 'MGMT',
  now_playing_album: 'Oracular Spectacular',
  playback_source: 'Bluetooth',
  audio_volume: 6,
  audio_volume_max: 11,
  now_playing_elapsed: 42,
  now_playing_duration: 230,
};

const vehicleConfig = {
  car_type: 'Model Y',
  trim_badging: 'Performance',
  exterior_color: 'Pearl White',
  wheel_type: 'Uberturbine',
  software_version: '2026.20.1',
};

const softwareUpdate = {
  id: 12,
  vehicle_id: 42,
  version: '2026.20.1',
  status: 'installed',
  installed_at: '2026-06-20T08:00:00Z',
  scheduled_at: null,
  created_at: '2026-06-20T08:00:00Z',
};

const maintenanceItem = {
  id: 1,
  vehicle_id: 42,
  category: 'tires',
  name: 'Tire Rotation',
  description: 'Rotate tires for even wear',
  due_date: null,
  due_mileage: 20000,
  current_mileage: 12500,
  last_service_date: null,
  last_service_mileage: null,
  interval_months: null,
  interval_miles: 10000,
  status: 'good' as const,
  created_at: '2026-06-01T00:00:00Z',
};

const serviceRecord = {
  id: 3,
  vehicle_id: 42,
  date: '2026-05-01',
  description: 'Cabin air filter replaced',
  mileage: 11800,
  cost: 42,
  provider: 'Tesla Service',
  notes: 'Routine service',
  created_at: '2026-05-01T00:00:00Z',
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

let mockVehiclesData: (typeof vehicle)[] | undefined;
let mockVehicleDetailData: typeof vehicle | undefined;
let mockVehicleStateData:
  | { state: typeof vehicleState; live: boolean }
  | undefined;
let mockChargingSessionsData: (typeof chargingSession)[] | undefined;
let mockChargingSessionData: typeof chargingSession | undefined;
let mockChargeTelemetryData: typeof chargeTelemetry | undefined;
let mockDrivesData: (typeof drive)[] | undefined;
let mockDriveData: typeof drive | undefined;
let mockDriveTelemetryData: typeof driveTelemetry | undefined;
let mockTirePressureData: typeof tirePressure | undefined;
let mockClimateData: typeof climate | undefined;
let mockSecurityData: typeof security | undefined;
let mockSafetyData: typeof safety | undefined;
let mockMediaData: typeof media | undefined;
let mockVehicleConfigData: typeof vehicleConfig | undefined;
let mockSoftwareUpdatesData: (typeof softwareUpdate)[] | undefined;
let mockMaintenanceItemsData: (typeof maintenanceItem)[] | undefined;
let mockServiceRecordsData: (typeof serviceRecord)[] | undefined;
let mockVehiclesError: Error | null;
let mockChargingError: Error | null;
let mockDrivesError: Error | null;
let mockVehicleSystemsError: Error | null;

beforeEach(() => {
  mockVehiclesData = [vehicle];
  mockVehicleDetailData = vehicle;
  mockVehicleStateData = { state: vehicleState, live: true };
  mockChargingSessionsData = [chargingSession];
  mockChargingSessionData = chargingSession;
  mockChargeTelemetryData = chargeTelemetry;
  mockDrivesData = [drive];
  mockDriveData = drive;
  mockDriveTelemetryData = driveTelemetry;
  mockTirePressureData = tirePressure;
  mockClimateData = climate;
  mockSecurityData = security;
  mockSafetyData = safety;
  mockMediaData = media;
  mockVehicleConfigData = vehicleConfig;
  mockSoftwareUpdatesData = [softwareUpdate];
  mockMaintenanceItemsData = [maintenanceItem];
  mockServiceRecordsData = [serviceRecord];
  mockVehiclesError = null;
  mockChargingError = null;
  mockDrivesError = null;
  mockVehicleSystemsError = null;
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
  useTirePressureLatest: (vehicleId: number | null) => ({
    data: vehicleId ? mockTirePressureData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useClimateLatest: (vehicleId: number | null) => ({
    data: vehicleId ? mockClimateData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useSecurityLatest: (vehicleId: number | null) => ({
    data: vehicleId ? mockSecurityData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useSafetyLatest: (vehicleId: number | null) => ({
    data: vehicleId ? mockSafetyData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useMediaLatest: (vehicleId: number | null) => ({
    data: vehicleId ? mockMediaData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useVehicleConfigLatest: (vehicleId: number | null) => ({
    data: vehicleId ? mockVehicleConfigData : undefined,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useSoftwareUpdates: () => ({
    data: mockSoftwareUpdatesData,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useMaintenanceItems: () => ({
    data: mockMaintenanceItemsData,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
  }),
  useServiceRecords: () => ({
    data: mockServiceRecordsData,
    isLoading: false,
    isFetching: false,
    error: mockVehicleSystemsError,
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
  expect(serialized).toContain('Live map route surface');
  expect(serialized).toContain('Live route parser');
  expect(serialized).toContain('Live map coordinates');
  expect(serialized).toContain('dedicated live map route surface');
  expect(serialized).toContain('Vehicle access and digital twin routes');
  expect(serialized).toContain('Tire pressure route');
  expect(serialized).toContain('Climate and climate-control routes');
  expect(serialized).toContain(
    'Security access, guard mode, and safety settings routes',
  );
  expect(serialized).toContain('Media player route');
  expect(serialized).toContain('Software updates and vehicle software routes');
  expect(serialized).toContain('Maintenance route');
  expect(serialized).toContain('295 kPa');
  expect(serialized).toContain('Electric Feel');
  expect(serialized).toContain('Tire Rotation');
  expect(serialized).toContain('Native renders selected vehicle access state');
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
  expect(serialized).toContain('Charging cost analysis');
  expect(serialized).toContain('Charging action route evidence');
  expect(serialized).toContain('Smart charge route');
  expect(serialized).toContain('Powershare route');
  expect(serialized).toContain('Charging heatmap');
  expect(serialized).toContain('Charging heatmap energy');
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
  expect(serialized).toContain('Native parity status');
  expect(serialized).toContain('Route summary ready');
  expect(serialized).toContain('Replay speed summary');
  expect(serialized).toContain('Accessible chart data table');
  expect(serialized).toContain('Shared drive token route surface');
  expect(serialized).toContain('Shared drive token resolver');
  expect(serialized).toContain('Token route pattern');
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
  mockTirePressureData = undefined;
  mockClimateData = undefined;
  mockSecurityData = undefined;
  mockSafetyData = undefined;
  mockMediaData = undefined;
  mockVehicleConfigData = undefined;
  mockSoftwareUpdatesData = [];
  mockMaintenanceItemsData = [];
  mockServiceRecordsData = [];

  const vehiclesSerialized = await render(<VehiclesScreen />);
  const chargingSerialized = await render(<ChargingScreen />);
  const drivingSerialized = await render(<DrivingScreen />);

  expect(vehiclesSerialized).toContain('No vehicles yet');
  expect(vehiclesSerialized).toContain('No selected vehicle');
  expect(vehiclesSerialized).toContain('No tire pressure payload');
  expect(vehiclesSerialized).toContain('No climate payload');
  expect(vehiclesSerialized).toContain('No security payload');
  expect(vehiclesSerialized).toContain('No media payload');
  expect(vehiclesSerialized).toContain('No software update history');
  expect(vehiclesSerialized).toContain('No maintenance items');
  expect(vehiclesSerialized).toContain('Vehicle route readiness');
  expect(chargingSerialized).toContain('No charging sessions');
  expect(chargingSerialized).toContain('No selected charging session');
  expect(chargingSerialized).toContain('No charging cost rows');
  expect(chargingSerialized).toContain('No charging heatmap buckets');
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
  mockVehicleSystemsError = new Error('vehicle systems failed');
  mockTirePressureData = undefined;
  mockClimateData = undefined;
  mockSecurityData = undefined;
  mockSafetyData = undefined;
  mockMediaData = undefined;
  mockVehicleConfigData = undefined;
  mockSoftwareUpdatesData = [];
  mockMaintenanceItemsData = [];
  mockServiceRecordsData = [];

  const vehiclesSerialized = await render(<VehiclesScreen />);
  const chargingSerialized = await render(<ChargingScreen />);
  const drivingSerialized = await render(<DrivingScreen />);

  expect(vehiclesSerialized).toContain('Vehicle API unavailable');
  expect(vehiclesSerialized).toContain('Tire pressure unavailable');
  expect(vehiclesSerialized).toContain('Climate payload unavailable');
  expect(vehiclesSerialized).toContain('Security routes unavailable');
  expect(vehiclesSerialized).toContain('Media payload unavailable');
  expect(vehiclesSerialized).toContain('Software update history unavailable');
  expect(vehiclesSerialized).toContain('Maintenance schedule unavailable');
  expect(chargingSerialized).toContain('Charging API unavailable');
  expect(chargingSerialized).toContain('Charging cost API unavailable');
  expect(chargingSerialized).toContain('Charging heatmap unavailable');
  expect(drivingSerialized).toContain('Drive API unavailable');
  expect(drivingSerialized).toContain('Trip source API unavailable');
});
