import { request } from './client';

export interface Geofence {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  cost_per_kwh: number | null;
  created_at: string;
  updated_at?: string;
}

export interface PollingConfig {
  vehicle_discovery: boolean;
  charge_state: boolean;
  climate_state: boolean;
  drive_state: boolean;
  location_data: boolean;
  vehicle_state: boolean;
  vehicle_config: boolean;
  on_demand_vehicle_discovery: boolean;
  on_demand_charge_state: boolean;
  on_demand_climate_state: boolean;
  on_demand_drive_state: boolean;
  on_demand_location_data: boolean;
  on_demand_vehicle_state: boolean;
  on_demand_vehicle_config: boolean;
  nearby_charging_sites: boolean;
  release_notes: boolean;
  recent_alerts: boolean;
  service_data: boolean;
  wake_up: boolean;
  commands: boolean;
  telemetry_capture: boolean;
  telemetry_capture_retention_days: number;
}

export interface AppSettings {
  unit_of_length: string;
  unit_of_temp: string;
  unit_of_pressure: string;
  preferred_range: string;
  language: string;
  base_cost_per_kwh: number;
  api_suspended: boolean;
  theme: string;
  mode: string;
  custom_primary: string;
  custom_accent: string;
  gas_price_per_unit: number;
  gas_unit: string;
  gas_efficiency_mpg: number;
  decimal_precision: number;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  alert_digest_mode: string;
  polling_config?: PollingConfig;
  currency_symbol?: string;
  locale?: string;
  tz_display_default?: 'vehicle' | 'user' | 'utc';
  timezone_user?: string;
  tab_badge_enabled?: boolean;
  critical_flash_enabled?: boolean;
  ui_density?: 'compact' | 'comfortable' | 'spacious';
  time_format_default?: 'relative' | 'absolute';
  chart_palette?: 'cb_safe' | 'neon';
  ai_mode?: 'off' | 'local' | 'cloud';
  ai_features?: Record<string, boolean>;
  ai_provider_config?: Record<string, unknown>;
  ai_cost_cap_cents?: number;
  ai_features_archived?: Record<string, boolean>;
}

export type AlertRuleSeverity = 'info' | 'warn' | 'critical';
export type AlertRuleOp =
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'changed'
  | 'between'
  | 'outside';
export type AlertRuleTriggerMode = 'once' | 'repeat';
export type AlertRuleKind = 'signal' | 'computed_metric';
export type ComputedMetricOp =
  | '>'
  | '>='
  | '<'
  | '<='
  | '='
  | '!='
  | '%_change_>'
  | '%_change_<';

export interface Alert {
  id: number;
  vehicle_id: number;
  type: string;
  severity: 'info' | 'warning' | 'critical' | string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  rule_id?: number | null;
  rule_signal?: string | null;
  rule_severity?: AlertRuleSeverity | string | null;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  acknowledgement_note?: string | null;
}

export interface AlertRule {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  vehicle_id?: number | null;
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  signal_name: string;
  op: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity: AlertRuleSeverity;
  cooldown_min: number;
  trigger_mode: AlertRuleTriggerMode;
  snoozed_until?: string | null;
  kind?: AlertRuleKind;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: ComputedMetricOp | null;
  max_fires_per_resolution?: number | null;
  escalation_after_min?: number | null;
  escalation_severity?: AlertRuleSeverity | null;
  msg_template?: string | null;
  include_title?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertRuleInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  vehicle_id?: number | null;
  all_vehicles?: boolean;
  vehicle_ids?: number[];
  signal_name?: string;
  op?: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity?: AlertRuleSeverity;
  cooldown_min?: number;
  trigger_mode?: AlertRuleTriggerMode;
  snoozed_until?: string | null;
  kind?: AlertRuleKind;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_threshold?: number | null;
  metric_op?: ComputedMetricOp | null;
  max_fires_per_resolution?: number | null;
  escalation_after_min?: number | null;
  escalation_severity?: AlertRuleSeverity | null;
  msg_template?: string | null;
  include_title?: boolean;
}

export type AlertRuleUpdate = Partial<AlertRuleInput>;

export type NotificationChannelKind =
  | 'discord'
  | 'slack'
  | 'telegram'
  | 'email'
  | 'webhook'
  | 'ntfy'
  | 'pushover';

export interface NotificationChannelBase {
  id: number;
  name: string;
  kind: NotificationChannelKind;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationChannelDiscord extends NotificationChannelBase {
  kind: 'discord';
  webhook_url: string;
  username: string | null;
  avatar_url: string | null;
}

export interface NotificationChannelSlack extends NotificationChannelBase {
  kind: 'slack';
  webhook_url: string;
  channel: string | null;
  username: string | null;
}

export interface NotificationChannelTelegram extends NotificationChannelBase {
  kind: 'telegram';
  bot_token: string;
  chat_id: string;
}

export interface NotificationChannelEmail extends NotificationChannelBase {
  kind: 'email';
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  from_address: string;
  to_addresses: string[];
  use_tls: boolean;
}

export interface NotificationChannelWebhook extends NotificationChannelBase {
  kind: 'webhook';
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  headers: Record<string, string>;
  body_template: string;
}

export interface NotificationChannelNtfy extends NotificationChannelBase {
  kind: 'ntfy';
  server_url: string;
  topic: string;
  priority: 1 | 2 | 3 | 4 | 5;
  username: string | null;
  password: string | null;
}

export interface NotificationChannelPushover extends NotificationChannelBase {
  kind: 'pushover';
  user_key: string;
  app_token: string;
  device: string | null;
  priority: -2 | -1 | 0 | 1 | 2;
}

export type NotificationChannel =
  | NotificationChannelDiscord
  | NotificationChannelSlack
  | NotificationChannelTelegram
  | NotificationChannelEmail
  | NotificationChannelWebhook
  | NotificationChannelNtfy
  | NotificationChannelPushover;

export interface NotificationLog {
  id: number;
  channel_id: number;
  alert_id: number | null;
  title: string;
  message: string;
  status: 'pending' | 'sent' | 'failed' | 'deferred_dnd';
  severity?: string;
  error: string;
  created_at: string;
  sent_at: string | null;
  scheduled_at?: string;
  latency_ms?: number;
  read_at?: string | null;
  archived_at?: string | null;
}

export interface NotificationStats {
  total_sent: number;
  sent: number;
  failed: number;
  pending: number;
  total_channels: number;
  enabled_channels: number;
}

export interface NotificationSchedule {
  id: number;
  channel_id: number;
  title: string;
  message: string;
  cron_expr: string | null;
  scheduled_at: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  enabled: boolean;
  created_at: string;
}

export interface NotificationPreference {
  id: number;
  channel_id: number;
  event_type: string;
  enabled: boolean;
}

export interface NotificationAnalytics {
  total_sent: number;
  total_failed: number;
  delivery_rate: number;
  avg_latency_ms: number;
  active_channels: number;
  period_days: number;
}

export interface NotificationMetric {
  id: number;
  channel_id: number;
  date: string;
  total_sent: number;
  total_failed: number;
  avg_latency_ms: number;
}

export interface GasPriceStatus {
  enabled: boolean;
  poll_interval: string;
  last_poll_time: string;
  current_price: number;
  current_price_kwh_eq: number;
}

export interface GasPriceHistory {
  id: number;
  price_per_unit: number;
  unit: string;
  efficiency_mpg: number;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface MapConfig {
  provider: 'free' | 'azure' | 'google';
  api_key: string;
}

// === Settings ===
/** Fetches current application settings (units, language, cost). */
export const getSettings = () => request<AppSettings>('/settings');
/** Persists updated application settings. */
export const updateSettings = (s: AppSettings) =>
  request<AppSettings>('/settings', { method: 'PUT', body: JSON.stringify(s) });
/** Toggles the Tesla API suspension flag (blocks all Tesla Fleet API calls). */
export const toggleAPISuspend = (suspended: boolean) =>
  request<{ api_suspended: boolean }>('/settings/suspend-api', {
    method: 'POST',
    body: JSON.stringify({ suspended }),
  });
/** Fetches the current polling endpoint configuration. */
export const getPollingConfig = () =>
  request<PollingConfig>('/settings/polling-config');
/** Updates the polling endpoint configuration. */
export const updatePollingConfig = (pc: PollingConfig) =>
  request<PollingConfig>('/settings/polling-config', {
    method: 'PUT',
    body: JSON.stringify(pc),
  });

// === Geofences ===
/** Fetches all geofences. */
export const getGeofences = () => request<Geofence[]>('/geofences');
/** Creates a new geofence with the given location and radius. */
export const createGeofence = (g: Omit<Geofence, 'id'>) =>
  request<Geofence>('/geofences', { method: 'POST', body: JSON.stringify(g) });
/** Updates an existing geofence by ID. */
export const updateGeofence = (id: number, g: Omit<Geofence, 'id'>) =>
  request<Geofence>(`/geofences/${id}`, {
    method: 'PUT',
    body: JSON.stringify(g),
  });
/** Deletes a geofence by ID. */
export const deleteGeofence = (id: number) =>
  request<void>(`/geofences/${id}`, { method: 'DELETE' });

// === Alerts ===
/** Fetches paginated alerts (most recent first). */
export const getAlerts = (limit = 50, offset = 0) =>
  request<Alert[]>(`/alerts?limit=${limit}&offset=${offset}`);
/** Marks an alert as read. */
export const markAlertRead = (id: number) =>
  request<void>(`/alerts/${id}/read`, { method: 'POST' });
/** Fetches all configured alert rules. */
export const getAlertRules = () => request<AlertRule[]>('/alerts/rules');
/** Updates an alert rule using the typed operand contract. */
export const updateAlertRule = (id: number, r: AlertRuleUpdate) =>
  request<AlertRule>(`/alerts/rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(r),
  });
/** Creates a new alert rule. */
export const createAlertRule = (r: AlertRuleInput) =>
  request<AlertRule>('/alerts/rules', {
    method: 'POST',
    body: JSON.stringify(r),
  });
/** Deletes an alert rule by ID. */
export const deleteAlertRule = (id: number) =>
  request<void>(`/alerts/rules/${id}`, { method: 'DELETE' });

// === Notifications ===
/** Fetches all notification channels (discord, email, slack, etc.). */
export const getNotificationChannels = () =>
  request<NotificationChannel[]>('/notifications');
/** Fetches a single notification channel by ID. */
export const getNotificationChannel = (id: number) =>
  request<NotificationChannel>(`/notifications/${id}`);
/** Creates a new notification channel with the given type and config. */
export const createNotificationChannel = (
  ch: Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'>,
) =>
  request<NotificationChannel>('/notifications', {
    method: 'POST',
    body: JSON.stringify(ch),
  });
/** Updates an existing notification channel by ID. */
export const updateNotificationChannel = (
  id: number,
  ch: Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'>,
) =>
  request<NotificationChannel>(`/notifications/${id}`, {
    method: 'PUT',
    body: JSON.stringify(ch),
  });
/** Deletes a notification channel by ID. */
export const deleteNotificationChannel = (id: number) =>
  request<void>(`/notifications/${id}`, { method: 'DELETE' });
/** Toggles a notification channel on or off. */
export const toggleNotificationChannel = (id: number, enabled: boolean) =>
  request<void>(`/notifications/${id}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
/** Sends a test message through a notification channel to verify its config. */
export const testNotificationChannel = (id: number) =>
  request<{ success: boolean; error?: string; message?: string }>(
    `/notifications/${id}/test`,
    { method: 'POST' },
  );
/** Fetches paginated notification delivery logs. */
export const getNotificationLogs = (limit = 50, offset = 0) =>
  request<NotificationLog[]>(
    `/notifications/logs?limit=${limit}&offset=${offset}`,
  );
/** Fetches aggregate notification statistics (sent, failed, pending counts). */
export const getNotificationStats = () =>
  request<NotificationStats>('/notifications/stats');

// === Notification Scheduling ===
export const getNotificationSchedules = () =>
  request<NotificationSchedule[]>('/notifications/schedules');
export const createNotificationSchedule = (
  data: Partial<NotificationSchedule>,
) =>
  request<NotificationSchedule>('/notifications/schedules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const deleteNotificationSchedule = (id: number) =>
  request<void>(`/notifications/schedules/${id}`, { method: 'DELETE' });

// === Notification Preferences ===
export const getNotificationPreferences = (channelId: number) =>
  request<NotificationPreference[]>(
    `/notifications/${channelId}/preferences`,
  );
export const updateNotificationPreference = (
  channelId: number,
  eventType: string,
  enabled: boolean,
) =>
  request<void>(`/notifications/${channelId}/preferences`, {
    method: 'PUT',
    body: JSON.stringify({ event_type: eventType, enabled }),
  });

// === Notification Analytics ===
export const getNotificationAnalytics = (days?: number) =>
  request<NotificationAnalytics>(
    `/notifications/analytics${days ? `?days=${days}` : ''}`,
  );
export const getChannelMetrics = (channelId: number, days?: number) =>
  request<NotificationMetric[]>(
    `/notifications/${channelId}/metrics${days ? `?days=${days}` : ''}`,
  );

// === Gas Price Auto-Poll ===
/** Fetches current gas price poll status. */
export const getGasPriceStatus = () =>
  request<GasPriceStatus>('/gas-price/status');
/** Triggers an immediate gas price poll from the EIA API. */
export const pollGasPrice = () =>
  request<{ status: string }>('/gas-price/poll', { method: 'POST' });
/** Toggles gas price auto-polling on or off. */
export const toggleGasPrice = (enabled: boolean) =>
  request<{ enabled: boolean }>('/gas-price/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
/** Updates the gas price poll interval. */
export const updateGasPriceConfig = (pollInterval: string) =>
  request<{ poll_interval: string }>('/gas-price/config', {
    method: 'PUT',
    body: JSON.stringify({ poll_interval: pollInterval }),
  });
/** Fetches gas price history records. */
export const getGasPriceHistory = (limit = 50, offset = 0) =>
  request<GasPriceHistory[]>(
    `/gas-price/history?limit=${limit}&offset=${offset}`,
  );

// === Map Config ===
export const getMapConfig = () => request<MapConfig>('/system/map-config');
