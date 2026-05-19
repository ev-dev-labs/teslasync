// AUTO-SPLIT from web/src/api/types.ts (P2 #3).
// See @/api/types barrel for the public re-export surface.

// === Core Types ===

export interface Vehicle {
  id: number
  vehicle_id: number
  vin: string
  display_name: string
  model: string
  trim_badging: string
  exterior_color: string
  wheel_type: string
  state: string
  healthy: boolean
  /** IANA tz database name reported by Tesla (e.g. "America/Los_Angeles"). 'UTC' = unknown — frontend falls back to user TZ. */
  timezone?: string
  created_at: string
  updated_at: string
}

// VehicleLiveState removed — vehicle_live_state table dropped (phase-14/13).
// Use VehicleState (from /vehicles/{id}/state via SignalStore) or
// VehicleLiveState from hooks/useVehicleLive (SSE) instead.

// Position mirrors the post-migration `positions` hypertable(Phase 3,
// migration 000142_baseline_typed). High-frequency GPS + motion sample.
// Typed-only — no raw_json / JSONB carve-outs (ADR-001, ADR-005).
// Matches Go model in internal/models/position.go.
export interface Position {
  vehicle_id: number
  ts: string
  latitude: number
  longitude: number
  heading: number | null
  speed_mph: number | null
  /** Elevation in meters (SI). */
  elevation_m: number | null
  gps_state: string | null
  source: string
}

export interface Drive {
  id: number
  vehicle_id: number
  start_ts: string
  end_ts: string | null
  /** Drive duration in seconds (SI canonical). */
  duration_s: number
  /** Distance travelled in meters (SI canonical). */
  distance_m: number
  start_address: string | null
  end_address: string | null
  start_lat: number | null
  start_lon: number | null
  end_lat: number | null
  end_lon: number | null
  start_soc_pct: number
  end_soc_pct: number | null
  /** Energy used in watt-hours (Wh, SI canonical). */
  energy_used_wh: number | null
  /** Energy recovered via regen in watt-hours (Wh, SI canonical). */
  regen_energy_wh: number | null
  /** Average speed in meters per second (SI canonical). */
  avg_speed_mps: number | null
  /** Maximum speed in meters per second (SI canonical). */
  max_speed_mps: number | null
  /** Average power in watts (W, SI canonical). */
  avg_power_w: number | null
  /** Average ambient temperature in degrees Celsius (SI). */
  outside_temp_avg_c: number | null
  /** Average inside cabin temperature in degrees Celsius (SI; nullable, column dropped Phase-42). */
  inside_temp_avg_c: number | null
  score: number | null
  ended_status: string | null
  created_at: string
  updated_at: string
}

export interface ChargingSession {
  id: number
  vehicle_id: number
  started_at: string
  ended_at: string | null
  start_soc_pct: number
  end_soc_pct: number | null
  delta_soc_pct: number | null
  start_odometer_m: number | null
  end_odometer_m: number | null
  start_lat: number | null
  start_lng: number | null
  start_place: string | null
  /** Energy added in watt-hours (Wh, SI canonical). */
  total_energy_added_wh: number
  /** Peak charger power in watts (W, SI canonical). */
  peak_power_w: number | null
  /** Average charger power in watts (W, SI canonical). */
  avg_power_w: number | null
  cost_decimal: number | null
  cost_currency: string | null
  charger_type: string | null
  cable_type: string | null
  live?: boolean
  start_ts?: string
  end_ts?: string | null
  startedAt: string
  duration_min: number
  cost?: number | null
  ended_status?: string | null
}

export interface DriveTelemetryReading {
  id: number
  drive_id: number
  vehicle_id: number
  latitude: number | null
  longitude: number | null
  elevation: number | null
  heading: number | null
  odometer: number | null
  speed: number | null
  power: number | null
  battery_level: number | null
  soc: number | null
  usable_soc: number | null
  rated_range: number | null
  ideal_range: number | null
  est_range: number | null
  inside_temp: number | null
  outside_temp: number | null
  driver_temp: number | null
  passenger_temp: number | null
  fan_status: number | null
  is_climate_on: boolean | null
  tire_pressure_fl: number | null
  tire_pressure_fr: number | null
  tire_pressure_rl: number | null
  tire_pressure_rr: number | null
  battery_heater_on: boolean | null
  created_at: string
}

export interface ChargeTelemetryReading {
  session_id: number | null
  vehicle_id: number
  ts: string
  ac_charging_power_w: number | null
  dc_charging_power_w: number | null
  ac_charging_energy_in_wh: number | null
  dc_charging_energy_in_wh: number | null
  charger_voltage_v: number | null
  charger_actual_current_a: number | null
  charger_pilot_current_a: number | null
  charger_phases: number | null
  battery_heater_on: boolean | null
  battery_heater_power_w: number | null
  charge_limit_soc_pct: number | null
  charge_request: string | null
  fast_charger_type: string | null
  charging_cable_type: string | null
  charge_port_door_open: boolean | null
  charge_port_latch: string | null
  created_at: string
  battery_level?: number | null
  soc?: number | null
  power_kw?: number | null
  energy_added?: number | null
  rated_range?: number | null
  battery_temp?: number | null
  inside_temp?: number | null
  outside_temp?: number | null
  voltage?: number | null
  current_amps?: number | null
}

export interface Geofence {
  id: number
  name: string
  latitude: number
  longitude: number
  radius: number
  cost_per_kwh: number | null
  created_at: string
  updated_at?: string
}

export interface AppSettings {
  unit_of_length: string
  unit_of_temp: string
  unit_of_pressure: string
  preferred_range: string
  language: string
  base_cost_per_kwh: number
  api_suspended: boolean
  theme: string
  mode: string
  custom_primary: string
  custom_accent: string
  gas_price_per_unit: number
  gas_unit: string
  gas_efficiency_mpg: number
  decimal_precision: number
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
  alert_digest_mode: string
  polling_config?: PollingConfig
  /** Unicode currency glyph (e.g. "$", "€"). Stored verbatim — no ISO 4217 lookup. */
  currency_symbol?: string
  /** BCP-47 locale tag for `Intl.NumberFormat` (e.g. "en-US", "de-DE"). */
  locale?: string
  /**
   * Default timezone-display mode used by `<DateTime>` when no explicit
   * `in` prop is set. 'vehicle' = car local time (falls back to user TZ
   * when the vehicle has no learned tz); 'user' = browser local; 'utc'
   * = literal UTC. Defaults to 'vehicle'. (Phase 40 / 22.)
   */
  tz_display_default?: 'vehicle' | 'user' | 'utc'
  /**
   * Optional override of the user's browser-detected timezone (IANA
   * name, e.g. "America/Los_Angeles"). Empty string = use browser TZ.
   * Server-side validated against Go's tzdata.
   */
  timezone_user?: string
  /**
   * When true (default), the app prefixes `document.title` with the
   * unread-notification count `(N)` and paints a coloured dot on the
   * favicon. Disable to keep the tab title/icon static. (Phase 40 / 32.)
   */
  tab_badge_enabled?: boolean
  /**
   * When true (default), the app briefly flashes
   * `"(!) ALERT — "` in front of `document.title` when a critical
   * alert fires while the tab is in the background. Disabled
   * automatically for users with `prefers-reduced-motion: reduce`.
   * (Phase 40 / 32.)
   */
  critical_flash_enabled?: boolean
  /**
   * Global UI information-density preference. Flows from this single
   * setting to:
   *   - CSS variables (`--density-row-h`, `--density-pad-x`, ...) on
   *     `body[data-density="..."]`, consumed by Tailwind utilities
   *     `min-h-d-row`, `px-d-pad-x`, `py-d-pad-y`, `gap-d-gap`,
   *     `text-d-base`.
   *   - Shared components when called with `density="auto"` /
   *     `padding="auto"` / `size="auto"`.
   *
   * Defaults to `'comfortable'` so existing users see no visual
   * change. (Phase 40 / 44.)
   */
  ui_density?: 'compact' | 'comfortable' | 'spacious'
  /**
   * Default visible format for `<TimeStamp>` when no explicit `format`
   * prop is set. 'relative' renders "2h ago" with an absolute hover
   * tooltip; 'absolute' renders "Apr 4, 2:30 AM" with a relative hover
   * tooltip. Defaults to 'relative'. (Phase-45 / 22.)
   */
  time_format_default?: 'relative' | 'absolute'
  /**
   * User's preferred chart series palette.
   *   - 'cb_safe' (default) → Okabe-Ito color-blind-safe palette.
   *   - 'neon'              → original stylistic neon palette.
   * Consumed by the reactive `useChartPalette()` hook in
   * `@/hooks/useChartPalette`. The static `CHART_COLORS` constant
   * always renders CB-safe regardless of this preference.
   * (Phase-45 / 23.)
   */
  chart_palette?: 'cb_safe' | 'neon'
  /**
   * Phase-50 / F0 — AI-Off Contract (ADR-015).
   *
   * Top-level gate. `'off'` (default) blocks every AI surface
   * end-to-end: backend handlers return 404, frontend wrappers render
   * `null`, ESLint blocks unwrapped AI components, and the database
   * stores no AI rows. `'local'` permits providers on RFC1918 /
   * loopback only; `'cloud'` permits any provider. The gate must be
   * flipped before any per-feature toggle in {@link ai_features} has
   * effect.
   */
  ai_mode?: 'off' | 'local' | 'cloud'
  /**
   * Phase-50 / F0 — per-feature opt-in map keyed by registry feature
   * ID (see `web/src/ai/features.ts`, generated from
   * `internal/ai/features/registry.go`). Default `{}` means every
   * feature is off; setting `ai_features['chatbot-llm'] = true`
   * combined with `ai_mode != 'off'` is what `useAiEnabled('chatbot-llm')`
   * checks.
   */
  ai_features?: Record<string, boolean>
  /**
   * Phase-50 / F0 — adapter-specific configuration (`base_url`,
   * `model`, `api_key_ref`, etc.). The backend redacts this field
   * from Settings GET responses whenever `ai_mode === 'off'`
   * (ADR-015 §I9), so the SPA must not rely on it being present in
   * off mode and must handle `undefined` gracefully.
   */
  ai_provider_config?: Record<string, unknown>
  /**
   * Phase-50 / F0 — daily AI cost cap in cents. `0` (default) means
   * unset (the per-feature rate limiters still apply). Enforced by
   * the cost-tracker slice F9.
   */
  ai_cost_cap_cents?: number
  /**
   * Phase-50 / F2 — snapshot of the per-feature opt-in map preserved
   * at the moment `ai_mode` was set to `'off'`. Per ADR-015 §I7 the
   * mode→off transition CLEARS `ai_features` so a subsequent
   * re-enable cannot silently restore the prior selection. The
   * archive lets the Settings → AI panel offer an explicit
   * "Restore previous selection?" suggestion — restore is never
   * silent. The backend redacts this field whenever
   * `ai_mode === 'off'` (same rationale as `ai_provider_config`),
   * so consumers must handle `undefined` gracefully.
   */
  ai_features_archived?: Record<string, boolean>
}

/** Per-endpoint toggle config for Tesla Fleet API calls. */
export interface PollingConfig {
  // Polling endpoints (automatic)
  vehicle_discovery: boolean
  charge_state: boolean
  climate_state: boolean
  drive_state: boolean
  location_data: boolean
  vehicle_state: boolean
  vehicle_config: boolean
  // On-demand counterparts for polling endpoints (user-triggered)
  on_demand_vehicle_discovery: boolean
  on_demand_charge_state: boolean
  on_demand_climate_state: boolean
  on_demand_drive_state: boolean
  on_demand_location_data: boolean
  on_demand_vehicle_state: boolean
  on_demand_vehicle_config: boolean
  // On-demand only endpoints
  nearby_charging_sites: boolean
  release_notes: boolean
  recent_alerts: boolean
  service_data: boolean
  // Commands
  wake_up: boolean
  commands: boolean
  // Telemetry capture (raw signal recording to MongoDB)
  telemetry_capture: boolean
  telemetry_capture_retention_days: number
}

export interface VehicleState {
  vehicle_id: number
  state: string
  since?: string
  latitude: number
  longitude: number
  heading?: number | null
  speed: number
  power: number
  battery_level: number
  rated_range: number
  ideal_range: number
  odometer: number
  inside_temp: number
  outside_temp: number
  is_climate_on: boolean
  is_charging: boolean
  charger_power: number
  charge_rate: number
  time_to_full_charge: number
  is_locked: boolean
  sentry_mode: boolean
  software_version: string
}

/**
 * Wire shape of `GET /api/v1/vehicles/{id}/state`. The handler returns one of
 * two formats depending on whether a fresh telemetry sample is available:
 *
 *   - Live  : { state: VehicleState, live: true, ...session fields }
 *   - Cached: { vehicle: Vehicle, position: Position+legacy, live: false,
 *               ...session fields }
 *
 * Callers normalise both into `{ state?: VehicleState; live: boolean }`
 * via `getVehicleState` / `useVehicleState` / `fetchVehicleState`. The
 * shared response type below makes that normalisation type-safe without
 * resorting to `any`. The cached branch is currently unreachable on the
 * production handler (it always emits the live shape) but the legacy
 * payload shape is preserved here so older deployments stay parseable.
 */
export interface VehicleStateResponse {
  state?: VehicleState
  vehicle?: Vehicle | null
  position?: VehicleStateLegacyPosition | null
  live?: boolean
  is_charging?: boolean
  charger_power?: number
  charge_rate?: number
  time_to_full_charge?: number
  is_locked?: boolean
  sentry_mode?: boolean
  software_version?: string
}

/**
 * Superset of {@link Position} that documents the optional fields older
 * versions of the `/vehicles/{id}/state` handler attached to the `position`
 * envelope. Only the cached/fallback branch of {@link VehicleStateResponse}
 * uses these.
 */
export interface VehicleStateLegacyPosition extends Partial<Position> {
  speed?: number | null
  power?: number | null
  battery_level?: number | null
  rated_range?: number | null
  ideal_range?: number | null
  odometer?: number | null
  inside_temp?: number | null
  outside_temp?: number | null
  is_climate_on?: boolean | null
  is_locked?: boolean | null
}

export interface AuthStatus {
  authenticated: boolean
  expires_at?: string
  expired?: boolean
}

// === New Feature Types ===

export interface EnergyStats {
  /** Energy in watt-hours (Wh, SI). */
  total_energy_used_wh: number
  /** Energy in watt-hours (Wh, SI). */
  total_energy_charged_wh: number
  total_wh: number
  /** Energy intensity in watt-hours per meter (Wh/m, SI). */
  avg_efficiency_wh_per_m: number
  /** Distance in meters (m, SI). */
  total_distance_m: number
  total_cost: number
  /** CO2 saved in kilograms (kg, SI). */
  co2_saved_kg: number
  daily_breakdown: { date: string; energy_wh: number; distance_m: number; efficiency_wh_per_m: number }[]
}

export interface BatteryReport {
  vehicle_id: number
  current_capacity_pct: number
  degradation_pct: number
  /** Estimated range when new in kilometers (km, derived SI). */
  estimated_range_new_km: number
  /** Current estimated range in kilometers (km, derived SI). */
  estimated_range_current_km: number
  total_cycles: number
  health_score: number
  monthly_trend: { month: string; capacity_pct: number; range_km: number }[]
}

export interface Alert {
  id: number
  vehicle_id: number
  /** Free-form alert type. The backend slugifies the alert rule name; legacy
   *  values include 'geofence_exit', 'low_battery', 'charging_complete', etc.
   *  Always treat as `string` and tolerate unknown values at the UI layer. */
  type: string
  severity: 'info' | 'warning' | 'critical' | string
  title: string
  message: string
  is_read: boolean
  created_at: string
  /** Drill-through metadata (Phase 40 / Prompt 14). Populated when the
   *  notification log links to a still-existing alert rule. Used by
   *  `getAlertDrillthroughHref()` (web/src/lib/alertDrillthrough.ts) to
   *  deep-link from the alert into the relevant context page. */
  rule_id?: number | null
  rule_signal?: string | null
  rule_severity?: AlertRuleSeverity | string | null
  /** Phase-46 / Prompt 20 — acknowledgement state. Populated by
   *  GET /alerts/{id} and by the ack/reopen mutations. List endpoint also
   *  returns these when the row is acknowledged so the inbox can show a
   *  badge without a per-row detail fetch. */
  acknowledged_at?: string | null
  acknowledged_by?: string | null
  acknowledgement_note?: string | null
}

/** Phase-46 / Prompt 20 — entry in an alert's audit timeline. The synthetic
 *  `created` event has `id: 0` and is reconstructed from
 *  `notification_logs.created_at` server-side; persisted events have a
 *  positive `id` from `notification_log_events`. */
export type AlertEventKind = 'created' | 'acknowledged' | 'reopened' | 'commented' | string

export interface AlertEvent {
  id: number
  occurred_at: string
  actor?: string | null
  kind: AlertEventKind
  note?: string | null
}

/** Phase-46 / Prompt 20 — wire shape of GET /alerts/{id}. Extends Alert with
 *  the ack columns (already optional on Alert) and an always-present events
 *  array (oldest first, includes synthetic `created`). */
export interface AlertDetail extends Alert {
  events: AlertEvent[]
}

export type AlertRuleSeverity = 'info' | 'warn' | 'critical'
export type AlertRuleOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'changed' | 'between' | 'outside'
export type AlertRuleTriggerMode = 'once' | 'repeat'
export type AlertRuleKind = 'signal' | 'computed_metric'
export type ComputedMetricOp = '>' | '>=' | '<' | '<=' | '=' | '!=' | '%_change_>' | '%_change_<'

export interface AlertRule {
  id: number
  name: string
  description?: string | null
  enabled: boolean
  vehicle_id?: number | null
  /**
   * Phase-49 / Slice 0005 — sticky-all flag. When `true`, the rule
   * applies to every vehicle in the fleet, including any added after
   * the rule was created. Mutually exclusive with a non-empty
   * `vehicle_ids` array. Optional on read for backward-compat with
   * pre-0005 API responses; transitional hydration falls back to
   * `vehicle_id`.
   */
  all_vehicles?: boolean
  /**
   * Phase-49 / Slice 0005 — explicit subset of vehicle IDs the rule
   * applies to. Always present (`[]` if sticky-all). Optional on read
   * only for backward-compat with pre-0005 API responses.
   */
  vehicle_ids?: number[]
  signal_name: string
  op: AlertRuleOp
  value_num?: number | null
  value_text?: string | null
  value_bool?: boolean | null
  value_min?: number | null
  value_max?: number | null
  severity: AlertRuleSeverity
  cooldown_min: number
  trigger_mode: AlertRuleTriggerMode
  snoozed_until?: string | null
  kind?: AlertRuleKind
  metric_id?: string | null
  metric_window?: string | null
  metric_threshold?: number | null
  metric_op?: ComputedMetricOp | null
  /**
   * Per-rule cap on how many notifications a `repeat`-mode rule may emit
   * between successive falling-edge resets. NULL = unlimited (legacy
   * behaviour). Once-mode rules ignore this field — the latch already
   * caps them at 1 per resolution.
   * Phase-49 / Slice 0003 / Decision D5.
   */
  max_fires_per_resolution?: number | null
  /**
   * Phase-49 / Slice 0009 — two-tier severity escalation. When set,
   * a repeat-mode rule whose underlying condition has stayed
   * unresolved for at least `escalation_after_min` minutes fires at
   * `escalation_severity` instead of the base `severity`. Both fields
   * MUST be set or both MUST be null. Once-mode rules ignore these
   * fields entirely (the latch caps them at 1 fire per resolution).
   * `escalation_severity` MUST rank strictly higher than `severity`
   * under info < warn < critical.
   */
  escalation_after_min?: number | null
  escalation_severity?: AlertRuleSeverity | null
  /**
   * Phase-50 / ADR-014 — per-rule notification body template. NULL
   * means "use the op-aware default rendered by internal/alertmsg".
   * Supports `{{key}}` substitution; whitespace inside the braces is
   * allowed. Max length: 1024 chars.
   */
  msg_template?: string | null
  /**
   * Phase-50 / ADR-014 — when FALSE, transports that render a separate
   * title field (Discord/Slack/Telegram/ntfy/webhook) deliver
   * body-only notifications. Transports that REQUIRE a title (WebPush,
   * email Subject, Pushover) ignore this flag. Defaults to TRUE.
   */
  include_title?: boolean
  created_at: string
  updated_at: string
}

export interface AlertRuleInput {
  name: string
  description?: string | null
  enabled?: boolean
  vehicle_id?: number | null
  /**
   * Phase-49 / Slice 0005 — sticky-all flag. New writes from the
   * editor MUST set this together with `vehicle_ids`; the legacy
   * `vehicle_id` field is no longer written by Alert Studio.
   */
  all_vehicles?: boolean
  /**
   * Phase-49 / Slice 0005 — explicit subset of vehicle IDs. Empty
   * array when `all_vehicles` is true. Always sorted + deduped on the
   * client per slice 0006 / Decision D14.
   */
  vehicle_ids?: number[]
  signal_name?: string
  op?: AlertRuleOp
  value_num?: number | null
  value_text?: string | null
  value_bool?: boolean | null
  value_min?: number | null
  value_max?: number | null
  severity?: AlertRuleSeverity
  cooldown_min?: number
  trigger_mode?: AlertRuleTriggerMode
  snoozed_until?: string | null
  kind?: AlertRuleKind
  metric_id?: string | null
  metric_window?: string | null
  metric_threshold?: number | null
  metric_op?: ComputedMetricOp | null
  max_fires_per_resolution?: number | null
  /**
   * Phase-49 / Slice 0009 — escalation pair. See AlertRule.escalation_*
   * for invariants. Both fields MUST appear together (both null or
   * both populated). Repeat-mode only.
   */
  escalation_after_min?: number | null
  escalation_severity?: AlertRuleSeverity | null
  /** Phase-50 / ADR-014 — see AlertRule.msg_template. */
  msg_template?: string | null
  /** Phase-50 / ADR-014 — see AlertRule.include_title. */
  include_title?: boolean
}

export interface ComputedMetricSummary {
  id: string
  label: string
  unit: string
  windows: string[]
  ops: ComputedMetricOp[]
}

export interface ComputedMetricPreview {
  kind: 'computed_metric'
  metric_id: string
  metric_window: string
  metric_op: ComputedMetricOp
  threshold: number
  value: number
  would_trigger: boolean
  previous_value?: number
  percent_change?: number
}

export type AlertRuleUpdate = Partial<AlertRuleInput>

export interface AlertRuleSnoozeRequest {
  /** Snooze for N minutes from now. Use <= 0 to clear an existing snooze. */
  minutes?: number
  /** ISO timestamp; past timestamps clear an existing snooze. */
  until?: string
}

export interface AlertTestTarget {
  all_channels?: boolean
  channel_ids?: number[]
}

export interface AlertTestRequest {
  message?: string
  target?: AlertTestTarget | null
  /**
   * Phase-50 / ADR-014 — when set, the Test Rule endpoint previews the
   * given template instead of the legacy free-form `message`. Empty
   * string is normalised to "use the op-aware default".
   */
  msg_template?: string | null
  /** Phase-50 / ADR-014 — see AlertRule.include_title. */
  include_title?: boolean
}

/**
 * Phase-50 / ADR-014 — autocomplete suggestion served by
 * GET /api/v1/alerts/message-placeholders. Mirrors
 * internal/alertmsg.Placeholder.
 */
export interface AlertMessagePlaceholder {
  key: string
  label: string
  description?: string
  group: string
  example?: string
}

/**
 * Phase-50 / ADR-014 — curated message-template preset served by
 * GET /api/v1/alerts/message-presets. Mirrors internal/alertmsg.Preset.
 */
export interface AlertMessagePreset {
  id: string
  name: string
  description?: string
  template: string
  kind?: '' | 'signal' | 'computed_metric'
  tags?: string[]
}

/**
 * Phase-50 / ADR-014 — request body for POST /api/v1/alerts/message-preview.
 * Accepts the editor's draft rule shape so the preview renders against
 * the same inputs the production dispatch path uses.
 */
export interface AlertMessagePreviewRequest {
  name?: string
  kind?: AlertRuleKind
  signal_name?: string
  op?: AlertRuleOp
  severity?: AlertRuleSeverity
  vehicle_name?: string
  value_num?: number | null
  value_text?: string | null
  value_bool?: boolean | null
  value_min?: number | null
  value_max?: number | null
  metric_id?: string | null
  metric_window?: string | null
  metric_threshold?: number | null
  metric_op?: ComputedMetricOp | null
  msg_template?: string | null
  include_title?: boolean
  /** Optional sample signal values to feed the renderer. */
  signals?: Record<string, unknown>
}

export interface AlertMessagePreviewResponse {
  title: string
  body: string
}

export interface StatsSummary {
  min: number; max: number; avg: number; median: number; p95: number; count: number
}

export interface FleetAnalytics {
  period_days: number
  total_vehicles: number
  /** Distance in kilometers (km, derived SI). */
  total_distance_km: number
  total_drives: number
  total_charging_sessions: number
  /** Energy in kilowatt-hours (kWh, derived SI). */
  total_energy_kwh: number
  total_cost: number
  /** Energy intensity in watt-hours per kilometer (Wh/km, derived SI). */
  avg_efficiency_wh_km: number
  most_efficient_vehicle: { id: number; name: string; efficiency: number } | null
  vehicle_comparison: { id: number; name: string; distance: number; energy: number; efficiency: number; drives: number }[]

  drive_analytics: {
    hourly_pattern: { hour: number; drives: number; distance: number }[]
    day_of_week: { day: string; drives: number; distance: number; avg_distance: number }[]
    speed_distribution: { range: string; count: number }[]
    distance_distribution: { range: string; count: number }[]
    speed_stats: StatsSummary
    power_stats: StatsSummary
    regen_stats: StatsSummary
    duration_stats: StatsSummary
    distance_stats: StatsSummary
    efficiency_stats: StatsSummary
    daily_trend: { date: string; drives: number; distance: number; efficiency?: number }[]
    temp_vs_efficiency: { temp: number; efficiency: number; distance: number }[]
    duration_distribution?: { range: string; count: number }[]
    temperature: { inside: StatsSummary; outside: StatsSummary }
  }

  charging_analytics: {
    hourly_pattern: { hour: number; charges: number; energy: number }[]
    charger_types: { type: string; count: number }[]
    charger_brands: { brand: string; count: number }[]
    monthly_trend: { month: string; energy: number; cost: number; sessions: number; avg_power: number; gas_cost: number; savings: number }[]
    power_stats: StatsSummary
    duration_stats: StatsSummary
    energy_stats: StatsSummary
    cost_stats: StatsSummary
    start_battery_dist: { range: string; count: number }[]
    efficiency_stats: StatsSummary
  }

  battery_trend: { date: string; health_score: number; capacity_wh: number; degradation_pct: number; range_km: number; cycle_count: number }[]
}

export interface CommandResult {
  success: boolean
  message: string
}

// === New Data Types ===

export interface TirePressureSnapshot {
  id: number
  vehicle_id: number
  front_left: number | null
  front_right: number | null
  rear_left: number | null
  rear_right: number | null
  tpms_hard_warnings?: string
  tpms_soft_warnings?: string
  last_seen_time_fl?: string
  last_seen_time_fr?: string
  last_seen_time_rl?: string
  last_seen_time_rr?: string
  created_at: string
}

// MotorSnapshot matches the JSON response shape from /motor and /motor/latest.
// Backed by signal_log pivot via motorMappings in motor_handler.go.
// Field names are the PivotMapping.Field values; fields with no backing signal
// are optional and will be undefined in the response.
export interface MotorSnapshot {
  id?: number
  ts: string
  created_at: string
  vehicle_id?: number
  /** Front-axle torque in newton-meters (Nm, derived SI). */
  torque_nm_front: number | null
  /** Rear-axle torque in newton-meters (Nm, derived SI). */
  torque_nm_rear: number | null
  di_torque: number | null
  // Axle speed (DiAxleSpeedF/R) — non-SI (rpm)
  motor_rpm_front: number | null
  motor_rpm_rear: number | null
  /** Front motor temperature in degrees Celsius (SI). */
  motor_temp_c_front: number | null
  /** Rear motor temperature in degrees Celsius (SI). */
  motor_temp_c_rear: number | null
  /** Inverter temperature in degrees Celsius (SI). */
  inverter_temp_c: number | null
  inverter_temp_rear: number | null
  heatsink_temp_front: number | null
  heatsink_temp_rear: number | null
  // Motor current (DiMotorCurrentF/R) — amperes (SI)
  motor_current_front: number | null
  motor_current_rear: number | null
  // State (DiStateF/R, Gear)
  state_front: string | null
  state_rear: string | null
  shift_state: string | null
  // Battery voltage (DiVBatF/R) — volts (V, derived SI)
  vbat_front: number | null
  vbat_rear: number | null
  // Derived in motor_handler.go via injectDerivedMotorPower:
  // sum_W = vbat_front × motor_current_front + vbat_rear × motor_current_rear
  // power_kw = max(0, sum_W) / 1000   (drive — motor consuming pack power)
  // regen_kw = max(0, -sum_W) / 1000  (regen — motor sourcing back to pack)
  // Both keys are OMITTED when neither motor has a complete (V, I) pair, so
  // chart consumers can plot true gaps instead of misleading zeros.
  /** Power in kilowatts (kW, derived SI). Drive only; regen is split into regen_kw. */
  power_kw?: number | null
  /** Regen power in kilowatts (kW, derived SI). Always non-negative; magnitude of pack-side reverse flow. */
  regen_kw?: number | null
  /** Battery temperature in degrees Celsius (SI). */
  battery_temp_c?: number | null
  source?: string | null
  di_stator_temp?: number | null
  gear?: string | null
}

// DriveDynamicsSnapshot matches the JSON response shape from
// /drive-dynamics/latest. Backed by signal.LiveStateReader.LiveState
// via driveDynamicsMappings in drive_dynamics_handler.go.
//
// Field naming mirrors the snake_case wire format the backend emits.
// camelCaseKeys() exposes both forms; consumers in this codebase
// uniformly use snake_case for *_latest snapshot reads, so we keep
// that convention here as well.
//
// All fields are optional + nullable: a vehicle whose telemetry has
// never reported (e.g. PedalPosition for a freshly added vehicle)
// will simply omit those keys, and the consuming panels render the
// matching empty-state stat ("—" / "Brake Inactive" / etc).
export interface DriveDynamicsSnapshot {
  /** Lateral acceleration in g (cornering, +ve right). */
  lateral_acceleration?: number | null
  /** Longitudinal acceleration in g (+ve forward, -ve braking). */
  longitudinal_acceleration?: number | null
  /** Throttle pedal position 0..100 (%). */
  pedal_position?: number | null
  /** Brake pedal position 0..100 (%). */
  brake_pedal_position?: number | null
  /** Brake pedal active (true while pedal is depressed). */
  brake_pedal_active?: boolean | null
}

// ClimateSnapshot matches the JSON response shape from /climate and /climate/latest.
// Backed by signal_log after phase-14 rewire.
export interface ClimateSnapshot {
  vehicle_id: number
  ts: string
  /** Cabin inside temperature in degrees Celsius (SI). */
  inside_temp_c: number | null
  /** Outside ambient temperature in degrees Celsius (SI). */
  outside_temp_c: number | null
  /** Driver-side HVAC setpoint in degrees Celsius (SI). */
  driver_setpoint_c: number | null
  /** Passenger-side HVAC setpoint in degrees Celsius (SI). */
  passenger_setpoint_c: number | null
  hvac_state: string | null
  defrost_mode: string | null
  is_climate_on: boolean | null
  is_preconditioning: boolean | null
  fan_status: number | null
  seat_heater_left: number | null
  seat_heater_right: number | null
  seat_heater_rear_left: number | null
  seat_heater_rear_right: number | null
  steering_wheel_heater: boolean | null
  cabin_overheat_protection: boolean | null
  source: string
  // Legacy / compat-view field aliases (pre-migration column names, JSONB
  // carve-out fields). Optional so widgets that still reference these names
  // compile; values are undefined when reading the typed column set.
  inside_temp?: number | null
  outside_temp?: number | null
  driver_temp_setting?: number | null
  passenger_temp_setting?: number | null
  hvac_power?: number | null
  is_ac_on?: boolean | null
  hvac_ac_enabled?: boolean | null
  hvac_fan_status?: number | null
  hvac_fan_speed?: number | null
  hvac_steering_wheel_heat_level?: number | null
  battery_heater?: boolean | null
  battery_heater_on?: boolean | null
  seat_heater_rear_center?: number | null
}

// SecurityEvent mirrors the post-migration `security_events` hypertable
// (Phase 3, migration 000142_baseline_typed). Event-driven door/lock/sentry
// history with 5-year audit retention. Typed-only — no raw_json / JSONB
// carve-outs (ADR-001, ADR-005). Matches Go model in
// internal/models/security.go. PK: (vehicle_id, ts, event_type).
export interface SecurityEvent {
  vehicle_id: number
  ts: string
  event_type: string
  doors_open: string | null
  windows_open: string | null
  locked: boolean | null
  sentry_mode: boolean | null
  user_present: boolean | null
  detail: string | null
  source: string
  // Legacy / compat-view field aliases (pre-migration individual door/window
  // columns, seat/belt/light JSONB carve-outs). Optional so existing widgets
  // compile; values are undefined when reading the typed column set.
  //
  // Post per-field MQTT cutover (Phase-42a) the backend serializes raw
  // `signal.SignalValue` (`interface{}`) — door / window fields can arrive
  // as native booleans (e.g. `false`) or string enums depending on the
  // protomodel emission. Mark them as a union so consumers type-narrow.
  id?: number
  created_at: string
  door_state?: string | boolean | null
  fd_window?: string | boolean | null
  fp_window?: string | boolean | null
  rd_window?: string | boolean | null
  rp_window?: string | boolean | null
  driver_seat_belt?: boolean | null
  passenger_seat_belt?: boolean | null
  driver_seat_occupied?: boolean | null
  lights_high_beams?: boolean | null
  lights_hazards_active?: boolean | null
  lights_turn_signal?: string | null
}

// VehicleMetaSnapshot mirrors the post-migration `vehicle_meta_snapshots`
// consolidated hypertable (Phase 3, migration 000142_baseline_typed). The
// `category` discriminator selects which column group is populated; unused
// groups remain null. Typed-only — no raw_json / JSONB carve-outs
// (ADR-001, ADR-005). Matches Go model in internal/models/vehicle_meta.go.
export type VehicleMetaCategory =
  | 'tire'
  | 'media'
  | 'safety'
  | 'config'
  | 'preference'

export interface VehicleMetaSnapshot {
  vehicle_id: number
  ts: string
  category: VehicleMetaCategory

  // Tire (category='tire')
  tire_pressure_fl_psi?: number | null
  tire_pressure_fr_psi?: number | null
  tire_pressure_rl_psi?: number | null
  tire_pressure_rr_psi?: number | null
  tire_temp_fl_c?: number | null
  tire_temp_fr_c?: number | null
  tire_temp_rl_c?: number | null
  tire_temp_rr_c?: number | null

  // Media (category='media')
  media_source?: string | null
  media_track_title?: string | null
  media_track_artist?: string | null
  media_track_album?: string | null
  media_volume?: number | null
  media_is_playing?: boolean | null
  media_track_duration_sec?: number | null

  // Safety (category='safety')
  autopilot_state?: string | null
  fcw_active?: boolean | null
  blind_spot_active?: boolean | null
  emergency_lane_assist?: boolean | null
  abs_active?: boolean | null
  speed_limit_mode?: string | null

  // Config (category='config')
  software_version?: string | null
  car_type?: string | null
  exterior_color?: string | null
  wheel_type?: string | null
  spoiler_type?: string | null
  has_ludicrous_mode?: boolean | null

  // Preference (category='preference')
  drive_mode?: string | null
  regen_level?: string | null
  steering_mode?: string | null
  acceleration_mode?: string | null
  climate_keeper_mode?: string | null
  pet_mode?: boolean | null

  source: string
}

export interface SoftwareUpdate {
  id: number
  vehicle_id: number
  version: string
  status: string
  scheduled_at: string | null
  installed_at: string | null
  created_at: string
}

export interface VampireDrainEvent {
  id: number
  vehicle_id: number
  start_date: string
  end_date: string | null
  start_battery: number
  end_battery: number | null
  battery_lost: number
  /** Range lost in kilometers (km, derived SI). */
  range_lost_km: number
  duration_hours: number
  drain_rate_pct_per_hour: number
  outside_temp_avg: number | null
  sentry_mode: boolean
  created_at: string
}

export interface VampireDrainStats {
  avg_drain_rate: number
  max_drain_rate: number
  total_range_lost: number
  total_hours: number
  event_count: number
  avg_sentry_drain: number
  avg_nosentry_drain: number
}

export interface DailyMileage {
  id: number
  vehicle_id: number
  date: string
  /** Distance in kilometers (km, derived SI). */
  distance_km: number
  odometer_start: number
  odometer_end: number
  drive_count: number
  /** Energy in kilowatt-hours (kWh, derived SI). */
  energy_used_kwh: number
}

export interface MonthlyMileage {
  month: string
  distance: number
  drives: number
  energy: number
  odometer: number
}

export interface MileageStats {
  total_distance: number
  avg_daily: number
  max_daily: number
  total_energy: number
  total_drives: number
  days_tracked: number
}

export interface VisitedLocation {
  id: number
  vehicle_id: number
  address_id: number | null
  address_name: string
  visit_count: number
  total_duration_s: number
  last_visited: string | null
  created_at: string
}

export interface Trip {
  id: number
  vehicle_id: number
  name: string | null
  start_date: string
  end_date: string | null
  started_at: string
  ended_at: string | null
  /** Distance in meters (SI canonical). */
  total_distance_m: number
  /** Energy in watt-hours (Wh, SI canonical). */
  total_energy_wh: number
  /** Duration in seconds (SI canonical). */
  total_duration_s: number
  total_cost: number
  drive_count: number
  charge_count: number
  created_at: string
  created_by_user?: number | null
  auto_generated?: boolean
  notes?: string | null
}

export interface VehicleStateRecord {
  id: number
  vehicle_id: number
  state: string
  start_date: string
  end_date: string | null
  duration_min: number
  created_at: string
}

export interface StateSummary {
  state: string
  count: number
  total_min: number
}

export interface DailyStateBreakdown {
  day: string
  state: string
  total_min: number
}
