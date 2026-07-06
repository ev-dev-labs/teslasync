// Contract tests for the settings/notifications/alerts/gas-price API module.
//
// `settings.ts` is a thin transport layer: every export forwards to the
// resilient `request()` client with a fixed path, HTTP method, and (for
// writes) a JSON body. The value these tests protect is exactly that
// contract — the pieces that silently break a feature when they drift:
//
//   - the exact request PATH (no `/api/v1` double-prefix — the client adds
//     it — and snake_case query params like `limit`/`offset`/`days`);
//   - the HTTP METHOD for every mutation;
//   - the serialized BODY, proving snake_case keys (`event_type`,
//     `poll_interval`, `suspended`, `enabled`) reach the backend verbatim;
//   - the default-argument and conditional-query BRANCHES
//     (`getAlerts()` → `?limit=50&offset=0`; `getNotificationAnalytics(7)`
//     → `?days=7` but `getNotificationAnalytics()` → no query);
//   - RESULT pass-through, so a caller actually receives the decoded body
//     and a rejected request propagates instead of being swallowed.
//
// Network is stubbed at the `request()` boundary (never a real fetch).
// Typed fixtures flow through the real function signatures so any interface
// drift in `./types` fails `tsc --noEmit` alongside these assertions.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type {
  AppSettings,
  PollingConfig,
  Geofence,
  AlertRuleInput,
  AlertRuleUpdate,
  NotificationChannel,
  NotificationSchedule,
} from './types'

vi.mock('./client', () => ({
  request: vi.fn(),
}))

import { request } from './client'
import * as api from './settings'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/** The `[path, options?]` tuple of the most recent `request()` call. */
function lastCall(): [string, RequestInit | undefined] {
  const calls = mockedRequest.mock.calls
  return calls[calls.length - 1] as [string, RequestInit | undefined]
}

/** Parsed JSON body of the most recent `request()` call. */
function lastBody(): unknown {
  const [, opts] = lastCall()
  return JSON.parse((opts as { body: string }).body)
}

// ── Typed fixtures (drift here fails tsc) ─────────────────────────────────────
const appSettings: AppSettings = {
  unit_of_length: 'mi',
  unit_of_temp: 'F',
  unit_of_pressure: 'psi',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.13,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 3.5,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
}

const pollingConfig: PollingConfig = {
  vehicle_discovery: true,
  charge_state: true,
  climate_state: false,
  drive_state: true,
  location_data: true,
  vehicle_state: true,
  vehicle_config: false,
  on_demand_vehicle_discovery: false,
  on_demand_charge_state: false,
  on_demand_climate_state: false,
  on_demand_drive_state: false,
  on_demand_location_data: false,
  on_demand_vehicle_state: false,
  on_demand_vehicle_config: false,
  nearby_charging_sites: false,
  release_notes: false,
  recent_alerts: false,
  service_data: false,
  wake_up: false,
  commands: false,
  telemetry_capture: false,
  telemetry_capture_retention_days: 30,
}

const geofenceInput: Omit<Geofence, 'id'> = {
  name: 'Home',
  latitude: 37.5,
  longitude: -122.3,
  radius: 100,
  cost_per_kwh: 0.12,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
}

const alertRuleInput: AlertRuleInput = {
  name: 'Low battery',
  description: 'Notify when the pack drops below the floor',
  enabled: true,
}

const alertRuleUpdate: AlertRuleUpdate = { enabled: false }

const channelInput: Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'> = {
  name: 'Ops Alerts',
  kind: 'discord',
  enabled: true,
}

const scheduleInput: Partial<NotificationSchedule> = {
  channel_id: 1,
  title: 'Weekly digest',
  message: 'Your week in review',
  cron_expr: '0 9 * * 1',
  enabled: true,
}

beforeEach(() => {
  mockedRequest.mockReset()
  mockedRequest.mockResolvedValue(undefined)
})

// ── Settings ──────────────────────────────────────────────────────────────────
describe('settings endpoints', () => {
  it('getSettings issues a bare GET /settings and returns the decoded body', async () => {
    const payload = { language: 'en' }
    mockedRequest.mockResolvedValueOnce(payload)

    const result = await api.getSettings()

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest).toHaveBeenCalledWith('/settings')
    expect(result).toBe(payload)
  })

  it('updateSettings PUTs /settings with the full settings object serialized', async () => {
    await api.updateSettings(appSettings)

    expect(lastCall()[0]).toBe('/settings')
    expect(lastCall()[1]).toMatchObject({ method: 'PUT' })
    expect(lastBody()).toEqual(appSettings)
  })

  it('toggleAPISuspend POSTs the snake-case-free { suspended } flag', async () => {
    await api.toggleAPISuspend(true)

    expect(lastCall()[0]).toBe('/settings/suspend-api')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(lastBody()).toEqual({ suspended: true })
  })

  it('getPollingConfig / updatePollingConfig target /settings/polling-config', async () => {
    await api.getPollingConfig()
    expect(mockedRequest).toHaveBeenLastCalledWith('/settings/polling-config')

    await api.updatePollingConfig(pollingConfig)
    expect(lastCall()[0]).toBe('/settings/polling-config')
    expect(lastCall()[1]?.method).toBe('PUT')
    expect(lastBody()).toEqual(pollingConfig)
  })
})

// ── Geofences ─────────────────────────────────────────────────────────────────
describe('geofence endpoints', () => {
  it('getGeofences GETs the collection root', async () => {
    mockedRequest.mockResolvedValueOnce([])
    const result = await api.getGeofences()
    expect(mockedRequest).toHaveBeenCalledWith('/geofences')
    expect(result).toEqual([])
  })

  it('createGeofence POSTs the geofence body to the collection root', async () => {
    await api.createGeofence(geofenceInput)
    expect(lastCall()[0]).toBe('/geofences')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(lastBody()).toEqual(geofenceInput)
  })

  it('updateGeofence PUTs to the id-scoped path', async () => {
    await api.updateGeofence(42, geofenceInput)
    expect(lastCall()[0]).toBe('/geofences/42')
    expect(lastCall()[1]?.method).toBe('PUT')
    expect(lastBody()).toEqual(geofenceInput)
  })

  it('deleteGeofence DELETEs the id-scoped path with no body', async () => {
    await api.deleteGeofence(7)
    expect(lastCall()[0]).toBe('/geofences/7')
    expect(lastCall()[1]).toEqual({ method: 'DELETE' })
  })
})

// ── Alerts ────────────────────────────────────────────────────────────────────
describe('alert endpoints', () => {
  it('getAlerts applies the default limit/offset window', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await api.getAlerts()
    expect(mockedRequest).toHaveBeenCalledWith('/alerts?limit=50&offset=0')
  })

  it('getAlerts forwards explicit pagination as snake_case query params', async () => {
    await api.getAlerts(10, 20)
    expect(lastCall()[0]).toBe('/alerts?limit=10&offset=20')
  })

  it('markAlertRead POSTs to the /read sub-path', async () => {
    await api.markAlertRead(99)
    expect(lastCall()[0]).toBe('/alerts/99/read')
    expect(lastCall()[1]?.method).toBe('POST')
  })

  it('getAlertRules GETs /alerts/rules', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await api.getAlertRules()
    expect(mockedRequest).toHaveBeenCalledWith('/alerts/rules')
  })

  it('createAlertRule POSTs the rule input to /alerts/rules', async () => {
    await api.createAlertRule(alertRuleInput)
    expect(lastCall()[0]).toBe('/alerts/rules')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(lastBody()).toEqual(alertRuleInput)
  })

  it('updateAlertRule PUTs the partial update to the id-scoped rule path', async () => {
    await api.updateAlertRule(3, alertRuleUpdate)
    expect(lastCall()[0]).toBe('/alerts/rules/3')
    expect(lastCall()[1]?.method).toBe('PUT')
    expect(lastBody()).toEqual({ enabled: false })
  })

  it('deleteAlertRule DELETEs the id-scoped rule path', async () => {
    await api.deleteAlertRule(3)
    expect(lastCall()[0]).toBe('/alerts/rules/3')
    expect(lastCall()[1]).toEqual({ method: 'DELETE' })
  })
})

// ── Notification channels ─────────────────────────────────────────────────────
describe('notification channel endpoints', () => {
  it('getNotificationChannels GETs the collection root', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await api.getNotificationChannels()
    expect(mockedRequest).toHaveBeenCalledWith('/notifications')
  })

  it('getNotificationChannel GETs the id-scoped channel', async () => {
    await api.getNotificationChannel(5)
    expect(mockedRequest).toHaveBeenLastCalledWith('/notifications/5')
  })

  it('createNotificationChannel POSTs the channel body', async () => {
    await api.createNotificationChannel(channelInput)
    expect(lastCall()[0]).toBe('/notifications')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(lastBody()).toEqual({ name: 'Ops Alerts', kind: 'discord', enabled: true })
  })

  it('updateNotificationChannel PUTs the channel body to the id path', async () => {
    await api.updateNotificationChannel(5, channelInput)
    expect(lastCall()[0]).toBe('/notifications/5')
    expect(lastCall()[1]?.method).toBe('PUT')
    expect(lastBody()).toEqual(channelInput)
  })

  it('deleteNotificationChannel DELETEs the id path', async () => {
    await api.deleteNotificationChannel(5)
    expect(lastCall()[0]).toBe('/notifications/5')
    expect(lastCall()[1]).toEqual({ method: 'DELETE' })
  })

  it('toggleNotificationChannel POSTs { enabled } to the /toggle sub-path', async () => {
    await api.toggleNotificationChannel(5, false)
    expect(lastCall()[0]).toBe('/notifications/5/toggle')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(lastBody()).toEqual({ enabled: false })
  })

  it('testNotificationChannel POSTs to /test and passes the result through', async () => {
    mockedRequest.mockResolvedValueOnce({ success: false, error: 'bad webhook' })
    const result = await api.testNotificationChannel(5)
    expect(lastCall()[0]).toBe('/notifications/5/test')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(result).toEqual({ success: false, error: 'bad webhook' })
  })

  it('getNotificationLogs applies default and explicit pagination', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await api.getNotificationLogs()
    expect(mockedRequest).toHaveBeenLastCalledWith('/notifications/logs?limit=50&offset=0')

    await api.getNotificationLogs(25, 25)
    expect(lastCall()[0]).toBe('/notifications/logs?limit=25&offset=25')
  })

  it('getNotificationStats GETs /notifications/stats', async () => {
    await api.getNotificationStats()
    expect(mockedRequest).toHaveBeenLastCalledWith('/notifications/stats')
  })
})

// ── Notification scheduling / preferences / analytics ─────────────────────────
describe('notification scheduling endpoints', () => {
  it('getNotificationSchedules GETs the schedules collection', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await api.getNotificationSchedules()
    expect(mockedRequest).toHaveBeenCalledWith('/notifications/schedules')
  })

  it('createNotificationSchedule POSTs the partial schedule payload', async () => {
    await api.createNotificationSchedule(scheduleInput)
    expect(lastCall()[0]).toBe('/notifications/schedules')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(lastBody()).toEqual(scheduleInput)
  })

  it('deleteNotificationSchedule DELETEs the id-scoped schedule', async () => {
    await api.deleteNotificationSchedule(8)
    expect(lastCall()[0]).toBe('/notifications/schedules/8')
    expect(lastCall()[1]).toEqual({ method: 'DELETE' })
  })

  it('getNotificationPreferences GETs the channel-scoped preferences', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await api.getNotificationPreferences(4)
    expect(mockedRequest).toHaveBeenCalledWith('/notifications/4/preferences')
  })

  it('updateNotificationPreference PUTs { event_type, enabled } in snake_case', async () => {
    await api.updateNotificationPreference(4, 'drive_started', true)
    expect(lastCall()[0]).toBe('/notifications/4/preferences')
    expect(lastCall()[1]?.method).toBe('PUT')
    expect(lastBody()).toEqual({ event_type: 'drive_started', enabled: true })
  })

  it('getNotificationAnalytics omits the query when no window is given', async () => {
    await api.getNotificationAnalytics()
    expect(lastCall()[0]).toBe('/notifications/analytics')
  })

  it('getNotificationAnalytics appends ?days=N when a window is given', async () => {
    await api.getNotificationAnalytics(7)
    expect(lastCall()[0]).toBe('/notifications/analytics?days=7')
  })

  it('getChannelMetrics scopes to the channel and appends ?days only when set', async () => {
    await api.getChannelMetrics(4)
    expect(lastCall()[0]).toBe('/notifications/4/metrics')

    await api.getChannelMetrics(4, 30)
    expect(lastCall()[0]).toBe('/notifications/4/metrics?days=30')
  })
})

// ── Gas price auto-poll ───────────────────────────────────────────────────────
describe('gas price endpoints', () => {
  it('getGasPriceStatus GETs /gas-price/status', async () => {
    await api.getGasPriceStatus()
    expect(mockedRequest).toHaveBeenLastCalledWith('/gas-price/status')
  })

  it('pollGasPrice POSTs to /gas-price/poll with no body', async () => {
    await api.pollGasPrice()
    expect(lastCall()[0]).toBe('/gas-price/poll')
    expect(lastCall()[1]).toEqual({ method: 'POST' })
  })

  it('toggleGasPrice POSTs { enabled } to /gas-price/toggle', async () => {
    await api.toggleGasPrice(true)
    expect(lastCall()[0]).toBe('/gas-price/toggle')
    expect(lastCall()[1]?.method).toBe('POST')
    expect(lastBody()).toEqual({ enabled: true })
  })

  it('updateGasPriceConfig PUTs the interval under the snake_case { poll_interval } key', async () => {
    await api.updateGasPriceConfig('6h')
    expect(lastCall()[0]).toBe('/gas-price/config')
    expect(lastCall()[1]?.method).toBe('PUT')
    expect(lastBody()).toEqual({ poll_interval: '6h' })
  })

  it('getGasPriceHistory applies default and explicit pagination', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await api.getGasPriceHistory()
    expect(mockedRequest).toHaveBeenLastCalledWith('/gas-price/history?limit=50&offset=0')

    await api.getGasPriceHistory(5, 10)
    expect(lastCall()[0]).toBe('/gas-price/history?limit=5&offset=10')
  })
})

// ── Map config ────────────────────────────────────────────────────────────────
describe('map config endpoint', () => {
  it('getMapConfig GETs /system/map-config', async () => {
    mockedRequest.mockResolvedValueOnce({ tileUrl: 'https://tiles/{z}/{x}/{y}.png' })
    const result = await api.getMapConfig()
    expect(mockedRequest).toHaveBeenCalledWith('/system/map-config')
    expect(result).toEqual({ tileUrl: 'https://tiles/{z}/{x}/{y}.png' })
  })
})

// ── Cross-cutting contract invariants ─────────────────────────────────────────
describe('transport contract invariants', () => {
  it('never double-prefixes a path with /api/v1 (the client adds it)', async () => {
    await Promise.all([
      api.getSettings(),
      api.getGeofences(),
      api.getAlerts(),
      api.getAlertRules(),
      api.getNotificationChannels(),
      api.getNotificationLogs(),
      api.getNotificationStats(),
      api.getNotificationSchedules(),
      api.getNotificationAnalytics(14),
      api.getGasPriceStatus(),
      api.getGasPriceHistory(),
      api.getMapConfig(),
    ])

    const paths = mockedRequest.mock.calls.map((c) => c[0] as string)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true)
      expect(path).not.toContain('/api/v1')
    }
  })

  it('propagates a rejected request instead of swallowing it', async () => {
    const boom = new Error('network down')
    mockedRequest.mockRejectedValueOnce(boom)
    await expect(api.getSettings()).rejects.toThrow('network down')
  })

  it('propagates rejection from a mutation call path as well', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('409 conflict'))
    await expect(api.updateAlertRule(1, alertRuleUpdate)).rejects.toThrow('409 conflict')
  })
})
