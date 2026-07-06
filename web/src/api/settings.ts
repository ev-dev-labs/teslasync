import { request } from './client'
import type {
  AppSettings,
  PollingConfig,
  Geofence,
  Alert,
  AlertRule,
  AlertRuleInput,
  AlertRuleUpdate,
  NotificationChannel,
  NotificationLog,
  NotificationStats,
  NotificationSchedule,
  NotificationPreference,
  NotificationAnalytics,
  NotificationMetric,
  GasPriceStatus,
  GasPriceHistory,
  MapConfig,
} from './types'

// === Settings ===
/** Fetches current application settings (units, language, cost). */
export const getSettings = () => request<AppSettings>('/settings')
/** Persists updated application settings. */
export const updateSettings = (s: AppSettings) => request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(s) })
/** Toggles the Tesla API suspension flag (blocks all Tesla Fleet API calls). */
export const toggleAPISuspend = (suspended: boolean) =>
  request<{ api_suspended: boolean }>('/settings/suspend-api', { method: 'POST', body: JSON.stringify({ suspended }) })
/** Fetches the current polling endpoint configuration. */
export const getPollingConfig = () => request<PollingConfig>('/settings/polling-config')
/** Updates the polling endpoint configuration. */
export const updatePollingConfig = (pc: PollingConfig) =>
  request<PollingConfig>('/settings/polling-config', { method: 'PUT', body: JSON.stringify(pc) })

// === Geofences ===
/** Fetches all geofences. */
export const getGeofences = () => request<Geofence[]>('/geofences')
/** Creates a new geofence with the given location and radius. */
export const createGeofence = (g: Omit<Geofence, 'id'>) => request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(g) })
/** Updates an existing geofence by ID. */
export const updateGeofence = (id: number, g: Omit<Geofence, 'id'>) => request<Geofence>(`/geofences/${id}`, { method: 'PUT', body: JSON.stringify(g) })
/** Deletes a geofence by ID. */
export const deleteGeofence = (id: number) => request<void>(`/geofences/${id}`, { method: 'DELETE' })

// === Alerts ===
/** Fetches paginated alerts (most recent first). */
export const getAlerts = (limit = 50, offset = 0) => request<Alert[]>(`/alerts?limit=${limit}&offset=${offset}`)
/** Marks an alert as read. */
export const markAlertRead = (id: number) => request<void>(`/alerts/${id}/read`, { method: 'POST' })
/** Fetches all configured alert rules. */
export const getAlertRules = () => request<AlertRule[]>('/alerts/rules')
/** Updates an alert rule using the typed operand contract. */
export const updateAlertRule = (id: number, r: AlertRuleUpdate) => request<AlertRule>(`/alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify(r) })
/** Creates a new alert rule. */
export const createAlertRule = (r: AlertRuleInput) => request<AlertRule>('/alerts/rules', { method: 'POST', body: JSON.stringify(r) })
/** Deletes an alert rule by ID. */
export const deleteAlertRule = (id: number) => request<void>(`/alerts/rules/${id}`, { method: 'DELETE' })

// === Notifications ===
/** Fetches all notification channels (discord, email, slack, etc.). */
export const getNotificationChannels = () => request<NotificationChannel[]>('/notifications')
/** Fetches a single notification channel by ID. */
export const getNotificationChannel = (id: number) => request<NotificationChannel>(`/notifications/${id}`)
/** Creates a new notification channel with the given type and config. */
export const createNotificationChannel = (ch: Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'>) =>
  request<NotificationChannel>('/notifications', { method: 'POST', body: JSON.stringify(ch) })
/** Updates an existing notification channel by ID. */
export const updateNotificationChannel = (id: number, ch: Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'>) =>
  request<NotificationChannel>(`/notifications/${id}`, { method: 'PUT', body: JSON.stringify(ch) })
/** Deletes a notification channel by ID. */
export const deleteNotificationChannel = (id: number) => request<void>(`/notifications/${id}`, { method: 'DELETE' })
/** Toggles a notification channel on or off. */
export const toggleNotificationChannel = (id: number, enabled: boolean) =>
  request<void>(`/notifications/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) })
/** Sends a test message through a notification channel to verify its config. */
export const testNotificationChannel = (id: number) =>
  request<{ success: boolean; error?: string; message?: string }>(`/notifications/${id}/test`, { method: 'POST' })
/** Fetches paginated notification delivery logs. */
export const getNotificationLogs = (limit = 50, offset = 0) =>
  request<NotificationLog[]>(`/notifications/logs?limit=${limit}&offset=${offset}`)
/** Fetches aggregate notification statistics (sent, failed, pending counts). */
export const getNotificationStats = () => request<NotificationStats>('/notifications/stats')

// === Notification Scheduling ===
/** Fetches all scheduled (cron/one-shot) notification jobs. */
export const getNotificationSchedules = () => request<NotificationSchedule[]>('/notifications/schedules')
/** Creates a scheduled notification job from a partial payload. */
export const createNotificationSchedule = (data: Partial<NotificationSchedule>) =>
  request<NotificationSchedule>('/notifications/schedules', { method: 'POST', body: JSON.stringify(data) })
/** Deletes a scheduled notification job by ID. */
export const deleteNotificationSchedule = (id: number) =>
  request<void>(`/notifications/schedules/${id}`, { method: 'DELETE' })

// === Notification Preferences ===
/** Fetches the per-event-type delivery preferences for a channel. */
export const getNotificationPreferences = (channelId: number) =>
  request<NotificationPreference[]>(`/notifications/${channelId}/preferences`)
/** Enables or disables a single event type for a channel. */
export const updateNotificationPreference = (channelId: number, eventType: string, enabled: boolean) =>
  request<void>(`/notifications/${channelId}/preferences`, {
    method: 'PUT',
    body: JSON.stringify({ event_type: eventType, enabled }),
  })

// === Notification Analytics ===
/** Fetches aggregate notification analytics, optionally scoped to the last `days`. */
export const getNotificationAnalytics = (days?: number) =>
  request<NotificationAnalytics>(`/notifications/analytics${days ? `?days=${days}` : ''}`)
/** Fetches per-day delivery metrics for a channel, optionally scoped to the last `days`. */
export const getChannelMetrics = (channelId: number, days?: number) =>
  request<NotificationMetric[]>(`/notifications/${channelId}/metrics${days ? `?days=${days}` : ''}`)

// === Gas Price Auto-Poll ===
/** Fetches current gas price poll status. */
export const getGasPriceStatus = () =>
  request<GasPriceStatus>('/gas-price/status')
/** Triggers an immediate gas price poll from the EIA API. */
export const pollGasPrice = () =>
  request<{ status: string }>('/gas-price/poll', { method: 'POST' })
/** Toggles gas price auto-polling on or off. */
export const toggleGasPrice = (enabled: boolean) =>
  request<{ enabled: boolean }>('/gas-price/toggle', { method: 'POST', body: JSON.stringify({ enabled }) })
/** Updates the gas price poll interval. */
export const updateGasPriceConfig = (pollInterval: string) =>
  request<{ poll_interval: string }>('/gas-price/config', { method: 'PUT', body: JSON.stringify({ poll_interval: pollInterval }) })
/** Fetches gas price history records. */
export const getGasPriceHistory = (limit = 50, offset = 0) =>
  request<GasPriceHistory[]>(`/gas-price/history?limit=${limit}&offset=${offset}`)

// === Map Config ===
/** Fetches the map tile provider configuration (tile URL, attribution, bounds). */
export const getMapConfig = () => request<MapConfig>('/system/map-config')
