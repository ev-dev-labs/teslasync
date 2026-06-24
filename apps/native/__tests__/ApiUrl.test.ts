import { apiUrl, buildQueryPath, request } from '../src/api/client';
import {
  buildAuthDisconnectPath,
  buildAuthModePath,
  buildAuthRefreshPath,
  buildAuthStatusPath,
  buildAuthUrlPath,
  buildAutomationHistoryPath,
  buildAutomationsPath,
  buildChargeTelemetryPath,
  buildChargingSessionPath,
  buildChargingListPath,
  buildAvailableSignalsPath,
  buildBatteryDegradationAnalyticsPath,
  buildBatteryHealthPath,
  buildDriveDetailPath,
  buildDriveListPath,
  buildDriveTelemetryPath,
  buildFleetAnalyticsPath,
  buildFleetTelemetryCoveragePath,
  buildFleetTelemetryErrorsPath,
  buildFleetTelemetryErrorVINsPath,
  buildLiveSignalsPath,
  buildNotificationLogsPath,
  buildNotificationChannelsPath,
  buildNotificationStatsPath,
  buildQuietHoursPath,
  buildRateLimitStatusPath,
  buildRegenAnalyticsPath,
  buildRouteEfficiencyPath,
  buildRevokeAllOtherSessionsPath,
  buildSessionPath,
  buildSessionsPath,
  buildSettingsPath,
  buildSleepAnalyticsPath,
  buildSpeedProfilePath,
  buildSystemHealthPath,
  buildSystemStatusPath,
  buildSystemVersionPath,
  buildTCOAnalyticsPath,
  buildTemperatureImpactPath,
  buildTOTPBackupCodesPath,
  buildTOTPEnrollPath,
  buildTOTPSudoPath,
  buildTOTPStatusPath,
  buildTOTPVerifyPath,
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
    expect(apiUrl('/vehicles')).toBe(
      'https://teslasync.example.test/api/v1/vehicles',
    );
    expect(apiUrl('vehicles')).toBe(
      'https://teslasync.example.test/api/v1/vehicles',
    );
    expect(apiUrl('/api/v1/vehicles')).toBe(
      'https://teslasync.example.test/api/v1/vehicles',
    );
  });

  test('serializes hook query params with backend snake_case names', () => {
    expect(buildDriveListPath({ vehicle_id: 42, limit: 20, offset: 5 })).toBe(
      '/drives?vehicle_id=42&limit=20&offset=5',
    );
    expect(
      buildChargingListPath({
        vehicle_id: 42,
        start: '2026-06-01',
        end: '2026-06-23',
      }),
    ).toBe('/charging?vehicle_id=42&start=2026-06-01&end=2026-06-23');
    expect(buildVehicleEnergyPath(42, 14)).toBe('/vehicles/42/energy?days=14');
    expect(buildBatteryHealthPath(42)).toBe('/vehicles/42/battery');
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
    ).toBe(
      '/notifications/logs?vehicle_id=42%2C43&rule_id=7&read=false&group_key=abc123&limit=10',
    );
  });

  test('builds typed N0006 analytics, telemetry, and signal paths', () => {
    expect(buildFleetAnalyticsPath({ days: 14 })).toBe(
      '/analytics/fleet?days=14',
    );
    expect(
      buildFleetAnalyticsPath({
        start: '2026-06-01',
        end: '2026-06-23',
      }),
    ).toBe('/analytics/fleet?start=2026-06-01&end=2026-06-23');
    expect(buildTCOAnalyticsPath(42)).toBe('/analytics/tco?vehicle_id=42');
    expect(buildSleepAnalyticsPath(42, 7)).toBe(
      '/analytics/sleep?vehicle_id=42&days=7',
    );
    expect(buildRegenAnalyticsPath(42)).toBe(
      '/analytics/regen?vehicle_id=42',
    );
    expect(buildBatteryDegradationAnalyticsPath(42)).toBe(
      '/analytics/battery-degradation?vehicle_id=42',
    );
    expect(buildSpeedProfilePath(42)).toBe(
      '/analytics/speed-profile?vehicle_id=42',
    );
    expect(buildTemperatureImpactPath(42)).toBe(
      '/analytics/temperature-impact?vehicle_id=42',
    );
    expect(buildRouteEfficiencyPath(42)).toBe(
      '/analytics/route-efficiency?vehicle_id=42',
    );
    expect(buildFleetTelemetryCoveragePath()).toBe(
      '/tesla/fleet-telemetry/coverage',
    );
    expect(buildFleetTelemetryErrorVINsPath()).toBe(
      '/tesla/fleet-telemetry/error-vins',
    );
    expect(buildFleetTelemetryErrorsPath('5YJTESLASYNC0001')).toBe(
      '/tesla/fleet-telemetry/errors?vin=5YJTESLASYNC0001',
    );
    expect(buildFleetTelemetryErrorsPath('   ')).toBe(
      '/tesla/fleet-telemetry/errors',
    );
    expect(buildAvailableSignalsPath(42)).toBe('/signals/42/available');
    expect(buildLiveSignalsPath(42)).toBe('/signals/42/live');
  });

  test('builds auth, settings, notification, and system paths without api prefix', () => {
    expect(buildAuthModePath()).toBe('/system/auth-mode');
    expect(buildAuthStatusPath()).toBe('/auth/status');
    expect(buildAuthUrlPath()).toBe('/auth/url');
    expect(buildAuthRefreshPath()).toBe('/auth/refresh');
    expect(buildAuthDisconnectPath()).toBe('/auth/disconnect');
    expect(buildSessionsPath()).toBe('/auth/sessions');
    expect(buildSessionPath('session/id with spaces')).toBe(
      '/auth/sessions/session%2Fid%20with%20spaces',
    );
    expect(buildRevokeAllOtherSessionsPath()).toBe('/auth/sessions/all-others');
    expect(buildTOTPStatusPath()).toBe('/auth/totp');
    expect(buildTOTPEnrollPath()).toBe('/auth/totp/enroll');
    expect(buildTOTPVerifyPath()).toBe('/auth/totp/verify');
    expect(buildTOTPSudoPath()).toBe('/auth/totp/sudo');
    expect(buildTOTPBackupCodesPath()).toBe(
      '/auth/totp/backup-codes/regenerate',
    );
    expect(buildSettingsPath()).toBe('/settings');
    expect(buildAutomationsPath()).toBe('/automations');
    expect(buildAutomationHistoryPath(8)).toBe('/automations/history?limit=8');
    expect(buildNotificationChannelsPath()).toBe('/notifications');
    expect(buildNotificationStatsPath()).toBe('/notifications/stats');
    expect(buildQuietHoursPath()).toBe('/notifications/quiet-hours');
    expect(buildSystemStatusPath()).toBe('/system/status');
    expect(buildSystemHealthPath()).toBe('/system/health');
    expect(buildSystemVersionPath()).toBe('/system/version');
    expect(buildRateLimitStatusPath()).toBe('/system/rate-limits');
  });

  test('omits nullish query params without inventing defaults', () => {
    expect(
      buildQueryPath('/system/status', { vehicle_id: null, limit: undefined }),
    ).toBe('/system/status');
  });

  test('includes proxy cookies for forward-auth API calls without adding a token header', async () => {
    const response = new Response(JSON.stringify({ mode: 'open' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const mockFetch = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >();
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
