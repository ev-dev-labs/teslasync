import { apiUrl, buildQueryPath, request } from '../src/api/client';
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
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.TESLASYNC_API_BASE_URL = 'https://teslasync.example.test/';
  });

  afterEach(() => {
    globalThis.TESLASYNC_API_BASE_URL = undefined;
    globalThis.fetch = originalFetch;
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

  test('includes proxy cookies for forward-auth API calls without adding a token header', async () => {
    const response = new Response(JSON.stringify({mode: 'open'}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
    const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    mockFetch.mockResolvedValue(response);
    globalThis.fetch = mockFetch as typeof fetch;

    await request('/system/auth-mode');

    const [, init] = mockFetch.mock.calls[0];
    expect(init).toEqual(
      expect.objectContaining({
        credentials: 'include',
      }),
    );
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).has('Authorization')).toBe(false);
  });
});
