import { apiUrl, buildQueryPath } from '../src/api/client';
import {
  buildChargeTelemetryPath,
  buildChargingSessionPath,
  buildChargingListPath,
  buildDriveDetailPath,
  buildDriveListPath,
  buildDriveTelemetryPath,
  buildNotificationLogsPath,
  buildVehiclePath,
  buildVehicleEnergyPath,
  buildVehicleStatePath,
} from '../src/api/hooks';

describe('native API URL construction', () => {
  beforeEach(() => {
    globalThis.TESLASYNC_API_BASE_URL = 'https://teslasync.example.test/';
  });

  afterEach(() => {
    globalThis.TESLASYNC_API_BASE_URL = undefined;
  });

  test('client adds a single api prefix for relative hook paths', () => {
    expect(apiUrl('/vehicles')).toBe('https://teslasync.example.test/api/v1/vehicles');
    expect(apiUrl('vehicles')).toBe('https://teslasync.example.test/api/v1/vehicles');
    expect(apiUrl('/api/v1/vehicles')).toBe('https://teslasync.example.test/api/v1/vehicles');
  });

  test('serializes hook query params with backend snake_case names', () => {
    expect(buildDriveListPath({vehicle_id: 42, limit: 20, offset: 5})).toBe(
      '/drives?vehicle_id=42&limit=20&offset=5',
    );
    expect(buildChargingListPath({vehicle_id: 42, start: '2026-06-01', end: '2026-06-23'})).toBe(
      '/charging?vehicle_id=42&start=2026-06-01&end=2026-06-23',
    );
    expect(buildVehicleEnergyPath(42, 14)).toBe('/vehicles/42/energy?days=14');
    expect(buildVehiclePath(42)).toBe('/vehicles/42');
    expect(buildVehicleStatePath(42)).toBe('/vehicles/42/state');
    expect(buildDriveDetailPath(3)).toBe('/drives/3');
    expect(buildDriveTelemetryPath(3)).toBe('/drives/3/telemetry');
    expect(buildChargingSessionPath(9)).toBe('/charging/9');
    expect(buildChargeTelemetryPath(9)).toBe('/charging/9/telemetry');
    expect(
      buildNotificationLogsPath({
        vehicle_id: [42, 43],
        rule_id: [7],
        read: false,
        group_key: 'abc123',
        limit: 10,
      }),
    ).toBe('/notifications/logs?vehicle_id=42%2C43&rule_id=7&read=false&group_key=abc123&limit=10');
  });

  test('omits nullish query params without inventing defaults', () => {
    expect(buildQueryPath('/system/status', {vehicle_id: null, limit: undefined})).toBe(
      '/system/status',
    );
  });
});
