/**
 * @module api/types
 *
 * Every exported interface and type alias used across the API layer.
 *
 * === SI Unit Conventions ===
 *
 * Field names carry their unit as a suffix. Fields marked `(SI)` are stored
 * and transported in canonical SI (or derived-SI) form; the frontend
 * unit-conversion layer (`@/lib/unitConversion`) is the only place that
 * converts to user-display units.
 *
 *   `_m`        -> meters                    (SI: length)
 *   `_km`       -> kilometers                (derived SI)
 *   `_c`        -> degrees Celsius           (SI: temperature)
 *   `_pa`       -> pascals                   (SI: pressure)
 *   `_kg`       -> kilograms                 (SI: mass)
 *   `_kwh`      -> kilowatt-hours            (derived SI: energy)
 *   `_kw`       -> kilowatts                 (derived SI: power)
 *   `_wh_km`    -> watt-hours per kilometer  (derived SI: energy intensity)
 *   `_v` /
 *   `_voltage`  -> volts                     (derived SI: electric potential)
 *   `_amps`     -> amperes                   (SI: electric current)
 *   `_nm`       -> newton-meters             (derived SI: torque)
 *   `_rpm`      -> revolutions per minute    (NON-SI; angular velocity)
 *   `_sec`      -> seconds                   (SI: time)
 *   `_ms`       -> milliseconds              (derived SI: time)
 *
 * NON-SI suffixes (legacy / display-only): `_mi`, `_mph`, `_psi`, `_f`,
 * `_min`, `_hr`. These mirror Go struct fields in source units; the API
 * does NOT convert them — `lib/unitConversion.ts` does on the boundary.
 *
 * Rule of thumb: any field tagged `(SI)` in JSDoc below is safe to feed
 * directly into `metersToKm()` / `celsiusToF()` / `pascalsToPsi()` etc.
 *
 * Mirrors Go structs under `internal/api/*`, `internal/models/*`, and
 * `internal/tesla/protomodel/*`.
 */

import type {
  Automation as AutomationModel,
  AutomationActionInput,
  AutomationConditionInput,
  AutomationTriggerInput,
} from '@/types/automations'

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

/** JSON values returned by Tesla-controlled, undocumented Fleet API schemas. */
export type TeslaJSONValue =
  | string
  | number
  | boolean
  | null
  | TeslaJSONValue[]
  | TeslaOpaqueObject

/** Opaque Tesla-controlled JSON object for undocumented request schemas. */
export type TeslaOpaqueObject = { [key: string]: TeslaJSONValue }

/** Cached vehicle-management response stored in tesla_user_config. */
export interface VehicleInfoEnvelope<T = TeslaOpaqueObject> {
  data: T | null
  fetched_at: string | null
}

/** Non-persisted response from an opaque Vehicle Management mutation. */
export interface VehicleManagementResult {
  data: TeslaJSONValue
}

export interface VehiclePricingVariables {
  payload: TeslaOpaqueObject
}

export interface EnterprisePayerVariables {
  payload: TeslaOpaqueObject
  confirmed: boolean
}

// VehicleLiveState removed — vehicle_live_state table dropped.
// Use VehicleState (from /vehicles/{id}/state via SignalStore) or
// VehicleLiveState from hooks/useVehicleLive (SSE) instead.

// Position mirrors the typed `positions` hypertable.
// High-frequency GPS + motion sample.
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
  /** Average inside cabin temperature in degrees Celsius (SI; nullable, column dropped). */
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

// === Geofences / Charging Places ===
//
// Canonical snake_case wire shape for GET/POST/PUT /geofences and the
// charging-place pricing feature's endpoints beneath
// /geofences/{geofenceID}/... (see internal/api/geofence/rate_handler.go
// and internal/models/system/{system,geofence_rate}.go — the source of
// truth for every field below).
//
// `rate_per_wh` is the ONLY canonical electricity-rate unit on the wire —
// never `_kwh`. Convert to currency/kWh strictly at the render/request
// boundary (see features/maps/components/charging-places/helpers.ts).

/** How a geofence came to exist. */
export type GeofenceOrigin = 'manual' | 'charging_discovery'

/** Optional category tag a geofence may carry. */
export type GeofenceCategory = 'home' | 'work' | 'restricted' | 'custom'

/**
 * A geofence ("charging place" once it has rates/sessions attached).
 *
 * `latitude` / `longitude` / `radius` are NOT stored columns — the backend's
 * `Geofence.MarshalJSON` derives them on every read from `polygon_wkt`
 * (centroid + max-vertex-distance in meters) so the web client never parses
 * WKT itself. `category` / `archived_at` use `omitempty` on the Go side:
 * they are ABSENT from the payload (not `null`) when unset.
 */
export interface Geofence {
  id: number
  name: string
  polygon_wkt: string
  category?: GeofenceCategory | null
  enabled: boolean
  alert_on_entry: boolean
  alert_on_exit: boolean
  origin: GeofenceOrigin
  needs_review: boolean
  archived_at?: string | null
  created_at: string
  updated_at: string
  /** Computed centroid latitude, degrees — see MarshalJSON note above. */
  latitude: number
  /** Computed centroid longitude, degrees — see MarshalJSON note above. */
  longitude: number
  /** Computed bounding radius, meters — see MarshalJSON note above. */
  radius: number
}

/**
 * One time-versioned electricity-rate row for a geofence. The canonical,
 * append-only source of truth — there is no separate mutable "current
 * rate" column anywhere. The active rate for any instant `t` is whichever
 * row's half-open `[effective_from, effective_to)` interval contains `t`;
 * `effective_to: null` means "still open" (the current version).
 */
export interface GeofenceRate {
  id: number
  geofence_id: number
  /** Currency units per **watt-hour** — SI-canonical, never per-kWh. */
  rate_per_wh: number
  /** ISO-4217 currency code, e.g. "USD". */
  currency: string
  effective_from: string
  effective_to?: string | null
  created_at: string
}

/** Request body for `POST /geofences/{geofenceID}/rates`. */
export interface GeofenceRateCreateRequest {
  rate_per_wh: number
  currency: string
  effective_from: string
  effective_to?: string | null
}

/**
 * Charging-session cost provenance values, mirroring the
 * `charging_sessions.cost_source` CHECK constraint. Precedence (highest to
 * lowest confidence): manual actual > tesla_actual > geofence_tariff >
 * default_estimate > unknown.
 */
export type CostSource =
  | 'manual'
  | 'tesla_actual'
  | 'geofence_tariff'
  | 'default_estimate'
  | 'unknown'

/**
 * Read-only "what would applying this rate do" response for
 * `GET /geofences/{geofenceID}/rates/{rateID}/preview` — no rows written.
 * `eligible_sessions` is the subset of `matched_sessions` an apply call is
 * actually allowed to touch (unpriced or previously geofence-derived);
 * `protected_sessions` already carry a manual/Tesla-actual cost and are
 * matched (in scope by place + time) but will never be overwritten.
 */
export interface GeofenceRateImpactPreview {
  geofence_id: number
  rate_id: number
  currency: string
  matched_sessions: number
  eligible_sessions: number
  protected_sessions: number
  total_energy_wh: number
  estimated_cost_decimal: number
}

/**
 * Outcome of an explicit apply/backfill action —
 * `POST /geofences/{geofenceID}/rates/{rateID}/apply`. The
 * write-performing counterpart of {@link GeofenceRateImpactPreview}.
 */
export interface GeofenceRateApplyResult {
  geofence_id: number
  rate_id: number
  currency: string
  matched_sessions: number
  priced_sessions: number
  skipped_sessions: number
  total_energy_wh: number
  total_cost_decimal: number
}

/**
 * A geofence's priced charging activity totals for ONE currency —
 * `GET /geofences/{geofenceID}/charging-summary` always returns an array,
 * one entry per currency ever seen at this place. Different currencies are
 * NEVER summed into a single total; callers must group/scope by currency.
 */
export interface GeofenceChargingSummary {
  geofence_id: number
  currency: string
  session_count: number
  total_energy_wh: number
  total_cost_decimal: number
}

/**
 * One line item in a geofence's charging-session activity feed —
 * `GET /geofences/{geofenceID}/charging-activity` (paginated via
 * `limit`/`offset` query params; any pricing state, not just priced rows).
 */
export interface GeofenceChargingActivity {
  session_id: number
  vehicle_id: number
  started_at: string
  ended_at?: string | null
  energy_wh?: number | null
  cost_decimal?: number | null
  cost_currency?: string | null
  cost_source?: CostSource | null
  rate_id?: number | null
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
  /**
   * DB-persisted list of onboarding tours the user has completed or skipped,
   * as `"{tourId}:{version}"` tokens (e.g. "main:1"). Mirrors the per-tour
   * localStorage flags so completion survives a cookies/site-data clear and
   * syncs across devices. Optional for backward-compat with older responses.
   */
  completed_tours?: string[]
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
   * = literal UTC. Defaults to 'vehicle'.
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
   * favicon. Disable to keep the tab title/icon static.
   */
  tab_badge_enabled?: boolean
  /**
   * When true (default), the app briefly flashes
   * `"(!) ALERT — "` in front of `document.title` when a critical
   * alert fires while the tab is in the background. Disabled
   * automatically for users with `prefers-reduced-motion: reduce`.
   *
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
   * change.
   */
  ui_density?: 'compact' | 'comfortable' | 'spacious'
  /**
   * Default visible format for `<TimeStamp>` when no explicit `format`
   * prop is set. 'relative' renders "2h ago" with an absolute hover
   * tooltip; 'absolute' renders "Apr 4, 2:30 AM" with a relative hover
   * tooltip. Defaults to 'relative'.
   */
  time_format_default?: 'relative' | 'absolute'
  /**
   * User's preferred chart series palette.
   *   - 'cb_safe' (default) → Okabe-Ito color-blind-safe palette.
   *   - 'neon'              → original stylistic neon palette.
   * Consumed by the reactive `useChartPalette()` hook in
   * `@/hooks/useChartPalette`. The static `CHART_COLORS` constant
   * always renders CB-safe regardless of this preference.
   *
   */
  chart_palette?: 'cb_safe' | 'neon'
  /**
   * Typography preferences (Typography Unit 0). Round-tripped by the
   * FontProvider, which applies them to the `--font-*` CSS variables at the
   * display boundary. All optional — an absent field falls back to the
   * server-side default (mirrors DEFAULT_FONT_PREFS in FontProvider.tsx).
   */
  font_family?: string
  font_mono?: string
  font_custom_sans?: string
  font_custom_mono?: string
  font_scale?: number
  font_leading?: number
  font_tracking?: string
  font_heading_weight?: number
  /**
   * AI-Off Contract (ADR-015).
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
   * per-feature opt-in map keyed by registry feature
   * ID (see `web/src/ai/features.ts`, generated from
   * `internal/ai/features/registry.go`). Default `{}` means every
   * feature is off; setting `ai_features['chatbot-llm'] = true`
   * combined with `ai_mode != 'off'` is what `useAiEnabled('chatbot-llm')`
   * checks.
   */
  ai_features?: Record<string, boolean>
  /**
   * adapter-specific configuration (`base_url`,
   * `model`, `api_key_ref`, etc.). The backend redacts this field
   * from Settings GET responses whenever `ai_mode === 'off'`
   * (ADR-015 §I9), so the SPA must not rely on it being present in
   * off mode and must handle `undefined` gracefully.
   */
  ai_provider_config?: Record<string, unknown>
  /**
   * daily AI cost cap in cents. `0` (default) means
   * unset (the per-feature rate limiters still apply). Enforced by
   * the cost-tracker slice F9.
   */
  ai_cost_cap_cents?: number
  /**
   * snapshot of the per-feature opt-in map preserved
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
  /** Canonical alert-rule scope. `null`/omitted means the originating rule
   * no longer exists or the row is a fleet-wide system notification. */
  all_vehicles?: boolean | null
  vehicle_ids?: number[] | null
  /** Drill-through metadata. Populated when the
   *  notification log links to a still-existing alert rule. Used by
   *  `getAlertDrillthroughHref()` (web/src/lib/alertDrillthrough.ts) to
   *  deep-link from the alert into the relevant context page. */
  rule_id?: number | null
  rule_signal?: string | null
  rule_severity?: AlertRuleSeverity | string | null
  /** acknowledgement state. Populated by
   *  GET /alerts/{id} and by the ack/reopen mutations. List endpoint also
   *  returns these when the row is acknowledged so the inbox can show a
   *  badge without a per-row detail fetch. */
  acknowledged_at?: string | null
  acknowledged_by?: string | null
  acknowledgement_note?: string | null
}

/** entry in an alert's audit timeline. The synthetic
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

/** wire shape of GET /alerts/{id}. Extends Alert with
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
   * sticky-all flag. When `true`, the rule
   * applies to every vehicle in the fleet, including any added after
   * the rule was created. Mutually exclusive with a non-empty
   * `vehicle_ids` array. Optional on read for backward-compat with
   * pre-0005 API responses; transitional hydration falls back to
   * `vehicle_id`.
   */
  all_vehicles?: boolean
  /**
   * explicit subset of vehicle IDs the rule
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
   * Decision D5.
   */
  max_fires_per_resolution?: number | null
  /**
   * two-tier severity escalation. When set,
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
   * ADR-014 — per-rule notification body template. NULL
   * means "use the op-aware default rendered by internal/alertmsg".
   * Supports `{{key}}` substitution; whitespace inside the braces is
   * allowed. Max length: 1024 chars.
   */
  msg_template?: string | null
  /**
   * ADR-014 — when FALSE, transports that render a separate
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
   * sticky-all flag. New writes from the
   * editor MUST set this together with `vehicle_ids`; the legacy
   * `vehicle_id` field is no longer written by Alert Studio.
   */
  all_vehicles?: boolean
  /**
   * explicit subset of vehicle IDs. Empty
   * array when `all_vehicles` is true. Always sorted + deduped on the
   * client per Decision D14.
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
   * escalation pair. See AlertRule.escalation_*
   * for invariants. Both fields MUST appear together (both null or
   * both populated). Repeat-mode only.
   */
  escalation_after_min?: number | null
  escalation_severity?: AlertRuleSeverity | null
  /** ADR-014 — see AlertRule.msg_template. */
  msg_template?: string | null
  /** ADR-014 — see AlertRule.include_title. */
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
   * ADR-014 — when set, the Test Rule endpoint previews the
   * given template instead of the legacy free-form `message`. Empty
   * string is normalised to "use the op-aware default".
   */
  msg_template?: string | null
  /** ADR-014 — see AlertRule.include_title. */
  include_title?: boolean
}

/**
 * ADR-014 — autocomplete suggestion served by
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
 * ADR-014 — curated message-template preset served by
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
 * ADR-014 — request body for POST /api/v1/alerts/message-preview.
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

// === Notification Types ===

export type {
  NotificationChannel,
  NotificationChannelKind,
  NotificationChannelBase,
  NotificationChannelDiscord,
  NotificationChannelSlack,
  NotificationChannelTelegram,
  NotificationChannelEmail,
  NotificationChannelWebhook,
  NotificationChannelNtfy,
  NotificationChannelPushover,
} from '@/types/notifications'

// webhook channel test endpoint result.
//
// Mirrors `webhookTestResponse` in
// internal/api/notification_channel_handler.go. The handler returns
// the SAME shape on transport-level failures (`status_code === 0`,
// `error` populated) and HTTP-level failures (`status_code >= 400`,
// `success === false`), so the UI renders both cases uniformly.
export interface WebhookTestResult {
  success: boolean
  status_code: number
  latency_ms: number
  body_preview?: string
  truncated?: boolean
  signature?: string
  error?: string
}

// request shape for the signature preview
// utility endpoint. `body` is the verbatim bytes the receiver would
// HMAC-validate; the server signs them with `secret` and returns the
// resulting `sha256=<hex>` value.
export interface WebhookSignaturePreviewRequest {
  secret: string
  body: string
}

// preview-signature endpoint response. Always
// non-empty when the request validated (empty `secret` is rejected
// with 400 server-side, never echoed back as an empty signature).
export interface WebhookSignaturePreviewResult {
  signature: string
}

export interface NotificationLog {
  id: number
  channel_id: number
  alert_id: number | null
  title: string
  message: string
  status: 'pending' | 'sent' | 'failed' | 'deferred_dnd'
  severity?: string
  error: string
  created_at: string
  sent_at: string | null
  scheduled_at?: string
  latency_ms?: number
  read_at?: string | null
  archived_at?: string | null
}

// server-aggregated notification "thread".
//
// A group represents repeated deliveries of the same alert rule + severity
// (the canonical key is `sha256(alert_rule_id + "|" + severity_lc)`).
// Singleton rows — anything without a derivable group_key (NULL alert_id,
// blank severity, or fully ad-hoc notifications) — are returned as
// one-row groups with `group_key = null`.
//
// `count` and `unread_count` reflect the FILTERED subset that was sent
// to /notifications/logs?grouped=true; e.g. `read=false` makes
// `count == unread_count`. The frontend should render the count chip
// without implying it's a global tally.
//
// `vehicle_ids` is `array_remove(array_agg(DISTINCT alert_rules.vehicle_id), NULL)`
// so it can be empty when every member belonged to a vehicle-less rule.
//
// Members are NOT inlined — clients fetch them on expand via
// /notifications/logs?group_key=<group_key>&view=flat.
export interface NotificationLogGroup {
  group_key: string | null
  latest: NotificationLog
  count: number
  unread_count: number
  vehicle_ids: number[]
}

// Do-Not-Disturb / quiet hours window.
// Server-backed CRUD lives at /api/v1/notifications/quiet-hours.
// Times are local-clock HH:MM strings, evaluated against `timezone`
// (IANA name); `weekdays` is a 7-bit mask Sun=1..Sat=64.
// `bypass_severities` is the allow-list that escapes DND.
export interface QuietHoursWindow {
  id: number
  user_id: string
  enabled: boolean
  start_local: string
  end_local: string
  timezone: string
  weekdays: number
  bypass_severities: string[]
  created_at: string
  updated_at: string
}

// Patch payload for POST/PATCH against the quiet-hours endpoints. All
// fields optional so the same body shape works for create and partial
// update.
export interface QuietHoursWindowInput {
  enabled?: boolean
  start_local?: string
  end_local?: string
  timezone?: string
  weekdays?: number
  bypass_severities?: string[]
}

export interface NotificationStats {
  total_sent: number
  sent: number
  failed: number
  pending: number
  total_channels: number
  enabled_channels: number
}

// === Worker Health Types ===

export interface WorkerStatus {
  name: string
  host: string
  status: 'healthy' | 'unhealthy' | 'down'
  latency_ms: number
  error?: string
}

export interface WorkersHealth {
  workers: WorkerStatus[]
  total: number
  healthy_count: number
}

// === Chatbot Types ===

export interface ChatMessage {
  id: number
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatResponse {
  response: string
  session_id: string
}

/**
 * Per-session metadata used to render the chatbot sidebar.
 * `title` is null when the user hasn't renamed the session — the UI then
 * falls back to `first_message`.
 */
export interface ChatSessionInfo {
  id: string
  title: string | null
  first_message: string | null
  message_count: number
  last_message_at: string | null
  created_at: string | null
}

import { resolveStyle, VEHICLE_STATE_ENTRIES, VEHICLE_STATES } from '@/types/fsm'
import type { BadgeVariant, VehicleState as _VehicleState } from '@/types/fsm'
export type { BadgeVariant } from '@/types/fsm'

/* ── Vehicle status — single source from @/types/fsm ── */

export type VehicleStatus = _VehicleState
export const VEHICLE_STATUSES = VEHICLE_STATES as unknown as VehicleStatus[]

/** Derives a display-friendly status from live vehicle state. */
export function deriveVehicleStatus(state?: VehicleState | null): VehicleStatus {
  if (!state) return 'offline'
  if (state.is_charging) return 'charging'
  if (state.speed && state.speed > 0) return 'driving'
  const s = (state.state ?? '').toLowerCase()
  if ((VEHICLE_STATES as readonly string[]).includes(s)) return s as VehicleStatus
  return 'online'
}

/** Maps VehicleStatus → badge variant. */
export function statusVariant(status: VehicleStatus | string): BadgeVariant {
  const entry = VEHICLE_STATE_ENTRIES[status as _VehicleState]
  return entry?.variant ?? 'danger'
}

/** Maps VehicleStatus → Tailwind badge dot color class. */
export function statusDotColor(status: VehicleStatus | string): string {
  const entry = VEHICLE_STATE_ENTRIES[status as _VehicleState]
  if (!entry) return 'bg-gray-400'
  return resolveStyle(entry).badgeDot
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
// Backed by signal_log.
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
  hvac_power?: boolean | null
  is_ac_on?: boolean | null
  hvac_ac_enabled?: boolean | null
  hvac_fan_status?: number | null
  hvac_fan_speed?: number | null
  /** `/climate/latest` projection of the HvacFanSpeed signal. */
  fan_speed?: number | null
  hvac_steering_wheel_heat_level?: number | null
  battery_heater?: boolean | null
  battery_heater_on?: boolean | null
  seat_heater_rear_center?: number | null
}

// SecurityEvent mirrors the typed `security_events` hypertable.
// Event-driven door/lock/sentry history with 5-year audit retention.
// Typed-only — no raw_json / JSONB carve-outs.
// Matches Go model in internal/models/security.go.
// PK: (vehicle_id, ts, event_type).
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
  // The backend serializes raw `signal.SignalValue` (`interface{}`) — door /
  // window fields can arrive as native booleans (e.g. `false`) or string enums
  // depending on the protomodel emission. Mark them as a union so consumers
  // type-narrow.
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

// VehicleMetaSnapshot mirrors the typed `vehicle_meta_snapshots` hypertable.
// The `category` discriminator selects which column group is populated;
// unused groups remain null. Typed-only — no raw_json / JSONB carve-outs.
// Matches Go model in internal/models/vehicle_meta.go.
// Category-specific column groups not in use stay null.
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
  started_at: string
  ended_at: string
  duration_hours: number
  start_battery_pct: number
  end_battery_pct: number
  drain_pct: number
  drain_pct_per_day: number
  /** SI degrees Celsius; nullable when the parked window has no ambient join. */
  ambient_temp_c_avg: number | null
}

export interface VampireDrainEventsResponse {
  vehicle_id: number
  events: VampireDrainEvent[]
}

export interface VampireDrainStats {
  event_count: number
  total_observed_hours: number
  avg_drain_pct_per_day: number | null
  median_drain_pct_per_day: number | null
  p95_drain_pct_per_day: number | null
  sample_window_days: number
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

/** One drive inside a trip, as returned by `GET /trips/{trip_id}`. */
export interface TripDriveSummary {
  id: number
  started_at: string
  ended_at: string | null
  /** Distance in meters (SI). Null when the drive has no recorded distance. */
  distance_m: number | null
  /** Energy in watt-hours (Wh, SI). Null when unrecorded. */
  energy_used_wh: number | null
  /** Duration in seconds (SI). Null when unrecorded. */
  duration_s: number | null
  /** Resolved start place name, when geocoded. */
  start_place: string | null
  /** Resolved end place name, when geocoded. */
  end_place: string | null
}

/**
 * `GET /trips/{trip_id}` response — a SUPERSET of {@link Trip} (the list
 * shape) that additionally carries the per-drive breakdown and the
 * `energy_used_wh` alias emitted by `internal/api/tripsdetail`. Only the
 * detail endpoint returns `drives`.
 */
export interface TripDetail extends Trip {
  /** Alias of `total_energy_wh` emitted by the detail handler (Wh, SI). */
  energy_used_wh: number
  drives: TripDriveSummary[]
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

// === API Keys ===

export interface APIKey {
  id: number
  name: string
  key_prefix: string
  permissions: string
  last_used_at?: string
  created_at: string
  expires_at?: string
}

// === Audit Logs ===

export interface AuditLog {
  id: number
  action: string
  resource: string
  details: string
  ip: string
  created_at: string
}

// === System / Admin ===

export interface APIUsage {
  total_requests: number
  skipped_polls: number
  estimated_cost: number
  cost_per_request: number
  monthly_credit: number
  estimated_remaining: number
}

export interface CompressionStats {
  total: number
  compressed: number
  savings_percent: number
  total_positions: number
  compressed_positions: number
  estimated_saved_rows: number
  estimated_saved_bytes: number
}

export interface ExtendedHealthComponent {
  status: string
  latency_ms?: number
  last_check?: string
  consecutive_failures?: number
  [key: string]: unknown
}

export type ExtendedHealthComponents = Record<string, ExtendedHealthComponent> & {
  database?: ExtendedHealthComponent & {
    latency_ms: number
  }
  database_pool?: ExtendedHealthComponent & {
    total_conns: number
    idle_conns: number
    acquired_conns: number
  }
  system?: ExtendedHealthComponent & {
    goroutines: number
    go_version: string
    uptime_seconds: number
  }
}

export interface ExtendedHealthResponse {
  status: string
  components: ExtendedHealthComponents
  checked_at?: string
  mode?: 'ok' | 'degraded' | 'maintenance'
  source?: 'env' | 'db' | 'default'
  maintenance_message?: string
  maintenance_until?: string
  maintenance_updated_at?: string
}

// === Aggregated diagnostic / self-test ===

export type DiagnosticCheckStatus = 'ok' | 'warn' | 'fail'
export type DiagnosticOverallStatus = 'ok' | 'degraded' | 'down'

export interface DiagnosticCheck {
  id: string
  name: string
  status: DiagnosticCheckStatus
  detail: string
  remediation?: string
  duration_ms: number
}

export interface DiagnosticReport {
  generated_at: string
  overall_status: DiagnosticOverallStatus
  checks: DiagnosticCheck[]
}

export interface BackupStats {
  database_size: string
  table_count: number
  row_counts: Record<string, number>
}

export interface ErrorStatsByCode {
  count: number
  last_seen: string
  last_message: string
}

export interface ErrorStats {
  total_errors: number
  uptime: string
  by_code: Record<string, ErrorStatsByCode>
}

export interface MapConfig {
  provider: 'free' | 'azure' | 'google'
  api_key: string
}

// === API Call Logs ===

export interface APICallLog {
  id: number
  ts: string
  vehicle_id: number | null
  service: string
  http_method: string
  endpoint: string
  status_code: number | null
  duration_ms: number
  error_message: string | null
  rate_limited: boolean
  request_body: string | null
  response_body: string | null
}

export interface APICallLogResponse {
  data: APICallLog[]
  total: number
  limit: number
  offset: number
}

export interface APICallLogStats {
  total_calls: number
  by_method: Record<string, number>
  by_service: Record<string, number>
  error_rate: number
  error_count: number
  avg_duration_ms: number
  last_24h: number
}

// === Version & Update Check ===

export interface VersionInfo {
  app_version: string
  chart_version: string
  go_version: string
  os: string
  arch: string
  uptime_seconds: number
  goroutines: number
  require_cookie_consent?: boolean
  endpoints?: Record<string, string | undefined> & {
    api?: string
    web?: string
    oauth_callback?: string
    tesla_api?: string
  }
}

export interface UpdateCheckResult {
  current: string
  latest: string
  update_available: boolean
  checked_at?: string
  message?: string
}

// === Notification Scheduling ===

export interface NotificationSchedule {
  id: number
  channel_id: number
  title: string
  message: string
  cron_expr: string | null
  scheduled_at: string | null
  last_run_at: string | null
  next_run_at: string | null
  enabled: boolean
  created_at: string
}

// === Notification Preferences ===

export interface NotificationPreference {
  id: number
  channel_id: number
  event_type: string
  enabled: boolean
}

export interface NotificationEventType {
  event_type: string
  component: string
  transition: 'outage' | 'recovery'
  default_enabled: boolean
  description: string
}

// === Notification Analytics ===

export interface NotificationAnalytics {
  total_sent: number
  total_failed: number
  delivery_rate: number
  avg_latency_ms: number
  active_channels: number
  period_days: number
}

export interface NotificationMetric {
  id: number
  channel_id: number
  date: string
  total_sent: number
  total_failed: number
  avg_latency_ms: number
}

// === Export Jobs (Async) ===

export interface ExportJobSummary {
  id: string
  type: string
  format: string
  status: 'queued' | 'processing' | 'ready' | 'failed'
  file_name: string
  file_size: number
  record_count: number
  error_message: string
  created_at: string
  completed_at: string | null
}

export interface ExportJobSubmitRequest {
  type: 'drives' | 'charging' | 'backup' | 'analytics' | 'import_drives' | 'import_charging'
  format?: 'csv' | 'json'
  vehicle_id?: number
  start?: string
  end?: string
}

export interface ExportJobSubmitResponse {
  id: string
  type: string
  format: string
  status: string
  message: string
}

// === Fleet Telemetry ===

export interface TelemetryStatus {
  enabled: boolean
  mode: string
  endpoint: string
  protocol: string
  supported_signals: string[]
  mqtt_publishing: boolean
  speed_comparison?: {
    fleet_telemetry_latency: string
    fleet_api_polling: string
    speedup: string
  }
  aggregate_stats?: {
    streaming_vehicles: number
    total_vehicles_seen: number
    total_signals_received: number
    total_batches_processed: number
    avg_signals_per_second: string
    stale_timeout: string
  }
  streaming_vehicles: Record<string, {
    vin: string
    last_received: string
    first_received: string
    signal_count: number
    batch_count: number
    is_streaming: boolean
    data_source: string
    signals_per_second: number
    latency_ms: number
    uptime_seconds: number
    last_signals?: Record<string, unknown>
  }>
}

// === Gas Price Auto-Poll ===

export interface GasPriceStatus {
  enabled: boolean
  poll_interval: string
  last_poll_time: string
  current_price: number
  current_price_kwh_eq: number
}

export interface GasPriceHistory {
  id: number
  price_per_unit: number
  unit: string
  efficiency_mpg: number
  effective_from: string
  effective_to: string | null
  created_at: string
}

// === Data Repair ===

export interface StaleSessionsResponse {
  stale_charging: ChargingSession[]
  stale_drives: Drive[]
}

// === Telemetry Capture ===

export interface CaptureStats {
  mongodb_enabled: boolean
  capture_enabled: boolean
  total_documents: number
  distinct_vins: string[]
}

// === Charging Heatmap ===

export interface ChargingHeatmapCell {
  day_of_week: number
  hour_of_day: number
  session_count: number
  avg_energy_wh: number
  avg_cost: number
}

export interface ChargingLocationBreakdown {
  location: string
  count: number
  total_wh: number
  total_cost: number
  avg_power_w: number
}

export interface ChargingHeatmapSummary {
  total_sessions: number
  total_wh: number
  total_cost: number
  avg_duration_s: number
}

export interface ChargingHeatmapData {
  heatmap: ChargingHeatmapCell[]
  locations: ChargingLocationBreakdown[]
  summary: ChargingHeatmapSummary
}

// === Speed Profile ===

export interface SpeedBucket {
  speed_bucket: string
  readings: number
  avg_power_kw: number
}

export interface EfficiencyCategory {
  category: string
  drive_count: number
  avg_speed: number
  battery_pct_per_100km: number
}

export interface EfficiencyPoint {
  speed_avg: number
  distance: number
  efficiency: number
}

export interface SpeedProfileData {
  distribution: SpeedBucket[]
  categories: EfficiencyCategory[]
  points: EfficiencyPoint[]
  avgSpeedMps: number
  peakSpeedMps: number
  optimalSpeedMps: number
}

// === Temperature Impact ===

export interface TempEfficiencyBucket {
  temp_bucket: string
  drive_count: number
  avg_distance_km: number
  avg_duration_s: number
  avg_battery_pct_per_100km: number
  avg_temp: number
}

export interface VampireDrainBucket {
  temp_bucket: string
  avg_drain_rate: number
  event_count: number
}

export interface MonthlyTempTrend {
  month: string
  avg_temp: number
  avg_efficiency: number
  drive_count: number
  total_distance: number
}

export interface TemperatureImpactData {
  efficiency: TempEfficiencyBucket[]
  vampire_drain: VampireDrainBucket[]
  monthly_trend: MonthlyTempTrend[]
}

// === Route Efficiency ===

export interface RouteSummary {
  start_location: string
  end_location: string
  trip_count: number
  avg_distance_km: number
  avg_duration_s: number
  avg_efficiency: number
  best_efficiency: number
  worst_efficiency: number
  avg_speed: number
  avg_temp: number
}

export interface RouteDriveDetail {
  id: number
  start_date: string
  distance: number
  duration_s: number
  avg_speed_mps: number
  start_battery_level: number
  end_battery_level: number
  outside_temp_avg: number
  efficiency: number
}

export interface RouteEfficiencyData {
  routes: RouteSummary[]
}

export interface RouteDetailData {
  drives: RouteDriveDetail[]
}

// === Charging Telemetry ===

// ChargingTelemetry matches the JSON response shape from /charging-telemetry
// and /charging-telemetry/latest. Backed by signal_log.
export interface ChargingTelemetry {
  vehicle_id: number
  ts: string
  session_id: number | null
  battery_level: number | null
  battery_range_mi: number | null
  charging_state: string | null
  /** Charger voltage in volts (V, derived SI). */
  charger_voltage: number | null
  /** Charger actual current in amperes (SI). */
  charger_actual_current: number | null
  /** Charger power in watts (W, SI canonical). */
  charger_power_w: number | null
  charger_phases: number | null
  /** Energy added in watt-hours (Wh, SI canonical). */
  charge_energy_added_wh: number | null
  range_added_meters: number | null
  range_added_meters_per_hour: number | null
  /** Charger pilot current in amperes (SI). */
  charger_pilot_current: number | null
  scheduled_charging_at: string | null
  source: string
  // Legacy / compat-view field aliases (BMS/module/energy JSONB carve-outs,
  // charge-port & navigation helpers). Optional so existing pages compile;
  // values are undefined when reading the typed column set.
  bms_fullcharge_complete?: boolean | null
  module_temp_max?: number | null
  module_temp_min?: number | null
  num_module_temp_max?: number | null
  num_module_temp_min?: number | null
  battery_heater_on?: boolean | null
  lifetime_energy_used?: number | null
  expected_energy_pct_at_arrival?: number | null
  not_enough_power_to_heat?: boolean | null
  charge_port_door_open?: boolean | null
}

// === Media ===

export interface MediaSnapshot {
  id: number
  vehicle_id: number
  now_playing_title?: string
  now_playing_artist?: string
  now_playing_album?: string
  now_playing_station?: string
  now_playing_duration?: number
  now_playing_elapsed?: number
  playback_status?: string
  playback_source?: string
  audio_volume?: number
  audio_volume_max?: number
  audio_volume_increment?: number
  created_at: string
}

// === Vehicle Config ===

export interface VehicleConfigSnapshot {
  id: number
  vehicle_id: number
  car_type?: string
  trim?: string
  exterior_color?: string
  roof_color?: string
  wheel_type?: string
  rear_seat_heaters?: string
  sunroof_installed?: string
  efficiency_package?: string
  europe_vehicle?: boolean
  right_hand_drive?: boolean
  remote_start_enabled?: boolean
  charge_port?: string
  offroad_lightbar_present?: boolean
  version?: string
  vehicle_name?: string
  software_update_version?: string
  software_update_download_pct?: number
  software_update_install_pct?: number
  software_update_expected_duration?: number
  software_update_scheduled_start?: string
  created_at: string
}

// === Location Snapshots ===

export interface LocationSnapshot {
  id: number
  vehicle_id?: number
  // Position & GPS (from signal_log pivot)
  latitude?: number
  longitude?: number
  heading?: number
  gps_state?: string
  /** Elevation in meters (SI). */
  elevation_m?: number
  speed_mph?: number
  // Navigation & route
  destination_name?: string
  miles_to_arrival?: number
  minutes_to_arrival?: number
  route_traffic_delay_s?: number
  route_last_updated?: string
  // Destination/origin coords (Latest only — from unpacked compounds)
  destination_lat?: number
  destination_lon?: number
  origin_lat?: number
  origin_lon?: number
  // Presence
  located_at_home?: boolean
  located_at_work?: boolean
  located_at_favorite?: boolean
  homelink_nearby?: boolean
  // Timestamps
  created_at: string
}

// === Safety ===

export interface SafetySnapshot {
  id: number
  vehicle_id: number
  automatic_blind_spot_camera?: boolean
  automatic_emergency_braking_off?: boolean
  blind_spot_collision_warning?: boolean
  cruise_follow_distance?: string
  emergency_lane_departure_avoidance?: boolean
  forward_collision_warning?: string
  lane_departure_avoidance?: string
  speed_limit_warning?: string
  pin_to_drive_enabled?: boolean
  miles_since_reset?: number
  self_driving_miles_since_reset?: number
  created_at: string
}

// === User Preferences ===

export interface UserPreferenceSnapshot {
  id: number
  vehicle_id: number
  setting_24hr_time?: boolean
  setting_charge_unit?: string
  setting_distance_unit?: string
  setting_temperature_unit?: string
  setting_tire_pressure_unit?: string
  created_at: string
}

// === Backup & Restore ===

export interface BackupConfig {
  id: number
  name: string
  enabled: boolean
  backup_type: string
  frequency_days: number
  max_retention: number
  provider: string
  provider_config: Record<string, string>
  include_tables: string[] | null
  compress: boolean
  encrypt: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export interface BackupRun {
  id: number
  config_id: number | null
  run_type: string
  backup_type: string
  status: string
  provider: string
  file_name: string | null
  file_path: string | null
  file_size: number
  record_count: number
  table_count: number
  checksum: string | null
  duration_ms: number
  error_message: string | null
  metadata: Record<string, unknown>
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// === True Cost of Ownership (TCO) ===

export interface TCOAnalytics {
  vehicle_id: number
  total_charging_cost: number
  /** Total charged energy in watt-hours (Wh, SI canonical). */
  total_wh: number
  total_sessions: number
  /** Total distance in kilometers (km, derived SI). */
  total_km: number
  first_date: string
  last_date: string
  months_of_ownership: number
  cost_per_km_ev: number
  cost_per_km_ice: number
  equivalent_gas_cost: number
  total_savings: number
  monthly_savings: number
  maintenance_savings_estimate: number
  gas_price: number
  gas_efficiency_mpg: number
  /** Base electricity cost per kilowatt-hour. */
  base_cost_per_kwh: number
  monthly_breakdown: {
    month: string
    ev_cost: number
    equiv_gas_cost: number
    savings: number
    cumulative_savings: number
    energy_wh: number
  }[]
}

// === Sleep Efficiency ===

export interface SleepAnalytics {
  vehicle_id: number
  period_days: number
  state_distribution: { state: string; count: number; total_minutes: number }[]
  sleep_efficiency_pct: number
  time_to_sleep_avg_min: number
  sentry_comparison: {
    sentry_mode: boolean
    count: number
    avg_drain_rate: number
    avg_duration_hours: number
    avg_battery_lost: number
    avg_temp: number
  }[]
  sentry_on_drain_rate: number
  sentry_off_drain_rate: number
  sentry_monthly_kwh: number
  sentry_monthly_cost: number
  sentry_extra_drain_rate: number
  sentry_extra_monthly_kwh: number
  sentry_extra_monthly_cost: number
  battery_capacity_wh: number
  base_cost_per_kwh: number
  recent_events: {
    id: number
    start_date: string
    end_date: string
    duration_hours: number
    battery_lost: number
    drain_rate: number
    sentry_mode: boolean
    outside_temp: number | null
    start_battery: number
    end_battery: number
  }[]
  total_events: number
  avg_sentry_duration_hours: number
}

// === Regen Braking ===

export interface RegenData {
  vehicle_id: number
  total_regen_wh: number
  total_drive_wh: number
  regen_ratio: number
  monthly_avg_regen: number
  free_charges: number
  monthly_summary: {
    month: string
    drive_count: number
    avg_regen_power_kw: number
    avg_speed: number
    avg_efficiency: number
  }[]
  drives: {
    id: number
    start_date: string
    distance: number
    duration_min: number
    speed_avg: number | null
    power_max: number | null
    power_min: number | null
    start_battery_level: number | null
    end_battery_level: number | null
    efficiency: number
    regen_score: number
  }[]
}

// === Battery Degradation ===

export interface BatteryDegradationData {
  vehicle_id: number
  current_health: number
  current_capacity: number
  current_degradation: number
  current_range: number
  current_cycles: number
  current_temp: number
  monthly_trend: {
    month: string
    avg_health: number
    avg_capacity: number
    avg_degradation: number
    avg_range: number
    max_cycles: number
    avg_cell_temp: number
  }[]
  snapshots: {
    id: number
    health_score: number
    /** Battery capacity in kilowatt-hours (kWh, derived SI). */
    capacity_wh: number
    degradation_pct: number
    /** Estimated range in kilometers (km, derived SI). */
    est_range_km: number
    cycle_count: number
    /** Average cell temperature in degrees Celsius (SI). */
    avg_cell_temp_c: number
    created_at: string
  }[]
  charging_habits: {
    fast_charge_count: number
    slow_charge_count: number
    deep_discharge_count: number
    charge_to_full_count: number
    avg_energy_per_session: number
  }
  prediction: {
    slope_per_year: number
    years_to_80_pct: number
    predicted_date: string
    has_enough_data: boolean
    projection_points: { month: string; health: number }[]
  }
  stress_level: string
  fast_charge_ratio: number
}

// === Automation Types ===

export interface AutomationConflict {
  automation_id: number
  automation_name: string
  reason: string
  severity: 'warning' | 'info'
}

type RemovedAutomationTriggerTypeKey = `trigger_${'type'}`
type RemovedAutomationTriggerConfigKey = `trigger_${'config'}`
type RemovedAutomationRootCompatibilityKey =
  | RemovedAutomationTriggerTypeKey
  | RemovedAutomationTriggerConfigKey
  | 'conditions'
  | 'actions'

type RemovedAutomationRootCompatibility = {
  [K in RemovedAutomationRootCompatibilityKey]: never
}

export type Automation = AutomationModel & {
  stop_on_failure: boolean
  notify_on_run: boolean
  notify_on_failure: boolean
  seasonal_start: number | null
  seasonal_end: number | null
  last_triggered_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  execution_count: number
  failure_count: number
  consecutive_failures: number
  auto_disabled: boolean
  auto_disabled_reason: string | null
  preset_id: string | null
  next_fire_time?: string | null
  conflicts?: AutomationConflict[]
} & RemovedAutomationRootCompatibility

// === Automation Preset Types ===

export interface AutomationPresetCategory {
  id: string
  name: string
  description: string
  icon: string
}

export interface AutomationPreset {
  id: string
  name: string
  description: string
  category: string
  icon: string
  triggers: AutomationTriggerInput[]
  conditions?: AutomationConditionInput[]
  actions: AutomationActionInput[]
  stop_on_failure: boolean
  notify_on_run: boolean
  notify_on_failure: boolean
}

export interface AutomationPresetsResponse {
  categories: AutomationPresetCategory[]
  presets: AutomationPreset[]
}

export type AutomationHistoryStatus = 'running' | 'success' | 'partial' | 'failed' | 'skipped' | 'cancelled' | 'test' | 'undo'

export interface AutomationHistory {
  id: number
  automation_id: number
  automation_name: string
  vehicle_id: number | null
  triggered_at: string
  completed_at: string | null
  duration_ms: number | null
  trigger_type: string
  trigger_snapshot: Record<string, unknown> | null
  conditions_met: boolean
  conditions_snapshot: Record<string, unknown>[] | null
  actions_executed: Record<string, unknown>[] | null
  actions_total: number
  actions_succeeded: number
  actions_failed: number
  status: AutomationHistoryStatus
  error: string | null
  fsm_state: string | null
  created_at: string
}

export interface AutomationHistoryStats {
  total_executions: number
  succeeded: number
  failed: number
  partial: number
  success_rate: number
  avg_duration_ms: number
}

/** Per-signal history response from /signals/{vehicleID}/{signalName}/history */
// SignalHistoryResp matches the typed `/api/v1/signals/{vid}/{name}/history`
// response from signal_handler.go. Each row carries the
// row's source-of-truth `value_kind` discriminator and the typed value
// in a single `value` field — UI code should call
// `adaptSignalHistoryRow` to project it into the legacy
// `SignalLogEntry` shape consumed by SignalHistoryTable, the chart,
// and stats panels.
export interface SignalHistoryResp {
  vehicle_id: number
  signal: string
  /** Expected ValueKind for the signal (per protomodel registry). */
  expected_kind?: string
  from?: string
  to?: string
  count: number
  data: SignalHistoryPoint[]
}

export interface SignalHistoryPoint {
  ts: string
  /** Row's source-of-truth ValueKind (e.g. "ValueKindDouble"). */
  kind: string
  value: number | string | boolean | null
}

export interface AutomationHistoryListResponse {
  items: AutomationHistory[]
  total: number
  limit: number
  offset: number
  summary: AutomationHistoryStats
}

// === Automation SSE Events ===

export type AutomationSSEEventType =
  | 'automation.triggered'
  | 'automation.succeeded'
  | 'automation.failed'
  | 'automation.skipped'
  | 'automation.state_changed'

export interface AutomationTriggeredEvent {
  automation_id: number
  name: string
  vehicle: string
  trigger: string
  at: string
  mode: 'live' | 'test'
}

export interface AutomationSucceededEvent {
  automation_id: number
  name: string
  duration_ms: number
  actions: number
  mode: 'live' | 'test'
}

export interface AutomationFailedEvent {
  automation_id: number
  name: string
  error: string
  action_index: number
  mode: 'live' | 'test'
}

export interface AutomationSkippedEvent {
  automation_id: number
  name: string
  reason: string
  mode: 'live' | 'test'
}

export interface AutomationStateChangedEvent {
  automation_id: number
  name: string
  from: string
  to: string
  trigger: string
  at: string
  retry_count: number
  consecutive_failures: number
  mode: 'live' | 'test'
}

export type AutomationSSEEvent =
  | { type: 'automation.triggered'; data: AutomationTriggeredEvent }
  | { type: 'automation.succeeded'; data: AutomationSucceededEvent }
  | { type: 'automation.failed'; data: AutomationFailedEvent }
  | { type: 'automation.skipped'; data: AutomationSkippedEvent }
  | { type: 'automation.state_changed'; data: AutomationStateChangedEvent }

// === Vehicle Access (Drivers & Invitations) ===

export interface VehicleDriver {
  id: number
  vehicle_id: number
  share_user_id: number | null
  driver_email: string | null
  driver_name: string | null
  role: string | null
  fetched_at: string
}

export interface VehicleInvitation {
  id: number
  vehicle_id: number
  invitation_id: string
  invite_url: string | null
  status: string
  expires_at: string | null
  created_by: string | null
  fetched_at: string
  created_at: string
}

// === Year in Review Types ===

export interface YearReviewDriveHighlight {
  drive_id: number
  date: string
  /** Distance in kilometers (km, derived SI). */
  distance_km: number
  duration_min: number
  start_address: string
  end_address: string
  /** Energy intensity in watt-hours per kilometer (Wh/km, derived SI). */
  efficiency_wh_km: number
}

export interface YearReviewMonthStat {
  month: number
  drives: number
  /** Distance in kilometers (km, derived SI). */
  distance_km: number
  /**
   * Energy in kilowatt-hours (kWh, derived SI). Matches the backend
   * `monthStat` JSON tag `energy_kwh` (SUM(total_energy_added_wh) / 1000).
   */
  energy_kwh: number
  cost: number
}

export interface YearReviewComparison {
  label: string
  value: string
  emoji: string
}

export interface YearReview {
  year: number
  vehicle: {
    id: number
    display_name: string
    model: string
  }

  // Headline stats
  total_drives: number
  /** Total distance in kilometers (km, derived SI). */
  total_distance_km: number
  /** Total energy in kilowatt-hours (kWh, derived SI). */
  total_energy_kwh: number
  total_charge_sessions: number
  total_driving_minutes: number
  total_charging_cost: number
  gas_savings: number
  /** CO2 offset in kilograms (kg, SI). */
  co2_offset_kg: number

  // Extremes
  longest_drive: YearReviewDriveHighlight | null
  shortest_drive: YearReviewDriveHighlight | null
  most_efficient_drive: YearReviewDriveHighlight | null
  least_efficient_drive: YearReviewDriveHighlight | null
  fastest_speed_kmh: number
  /** Coldest drive temperature in degrees Celsius (SI). */
  coldest_drive_temp_c: number
  /** Hottest drive temperature in degrees Celsius (SI). */
  hottest_drive_temp_c: number

  // Monthly breakdown
  monthly_stats: YearReviewMonthStat[]

  // Patterns
  most_active_day_of_week: string
  most_active_hour: number
  avg_drives_per_week: number
  /** Average distance per drive in kilometers (km, derived SI). */
  avg_distance_per_drive_km: number
  /** Average energy intensity in watt-hours per kilometer (Wh/km, derived SI). */
  avg_efficiency_wh_km: number

  // Charging habits
  supercharger_pct: number
  dc_fast_pct: number
  ac_other_pct: number
  avg_charge_start_soc: number

  // Fun comparisons
  comparisons: YearReviewComparison[]
}

export type {
  SignalObservation,
  SignalSource,
  SignalCatalogEntry,
  SignalValueType,
} from '@/types/signals';

/** One result from the global /search endpoint. */
export type SearchHitType =
  | 'vehicle'
  | 'drive'
  | 'charging'
  | 'alert'
  | 'notification'
  | 'geofence'
  | 'automation'
  | 'location'
  | 'trip';

export interface SearchHit {
  type: SearchHitType
  id: number
  title: string
  subtitle?: string
  url: string
  score: number
  when?: string
}

export interface SearchResponse {
  hits: SearchHit[]
  query: string
}

export type {
  AutomationActionInput,
  AutomationActionStep,
  AutomationConditionInput,
  AutomationConditionStep,
  AutomationFull,
  AutomationStep,
  AutomationStepBase,
  AutomationStepKind,
  AutomationStepLane,
  AutomationStepSummary,
  AutomationTriggerInput,
  AutomationTriggerStep,
} from '@/types/automations';

// === Pinned items ===

export type PinnedItemType =
  | 'vehicle'
  | 'widget'
  | 'alert_rule'
  | 'location'
  | 'geofence'
  | 'automation'
  | 'dashboard'
  | 'command'

export interface PinnedItem {
  id: number
  user_id?: number | null
  item_type: PinnedItemType
  item_id: string
  position: number
  pinned_at: string
  context?: string | null
}

// === Saved views ===

export interface SavedView {
  id: number
  user_id?: number | null
  name: string
  route: string
  query: string
  is_default: boolean
  is_pinned: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface SavedViewCreateInput {
  name: string
  route: string
  query: string
  is_default?: boolean
  is_pinned?: boolean
  sort_order?: number
}

export interface SavedViewUpdateInput {
  name?: string
  query?: string
  is_default?: boolean
  is_pinned?: boolean
  sort_order?: number
}

// ── Web Push ────────────────────────────────────────

/**
 * One row of `push_subscriptions`. Mirrors `internal/models.PushSubscription`.
 * The `keys` shape is intentionally NOT a nested object because the server
 * stores `p256dh` / `auth` flat alongside `endpoint` (the wire shape is
 * snake_case to match Go JSON tags; `camelCaseKeys()` also exposes
 * camelCase aliases on every response).
 */
export interface PushSubscriptionRow {
  id: number
  user_id: number | null
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  last_used_at: string | null
}

/**
 * Browser-side PushSubscription.toJSON() shape — POST body for
 * `/push/subscribe`. The server validates `endpoint` is a well-formed
 * https:// URL and that both keys are non-empty.
 */
export interface PushSubscribeBody {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

// === Typed signal envelope =====================================//
// Live/history payloads carry typed values.
// The live/history payload uses the typed envelope `{kind, value, ts}`
// instead of raw strings. The frontend hooks normalize the backend's
// protomodel.ValueKind discriminator (e.g. "ValueKindFloat" or the
// integer enum on SSE) into the compact `SignalKind` union below so
// React components can switch on `kind` and trust the typed `value`
// without re-parsing strings. Forward-only — no fallback for the
// legacy string-only shape.

/**
 * Compact discriminator for a typed signal value. Maps to the backend's
 * `protomodel.ValueKind` after normalization in the consuming hook:
 *   string  ← ValueKindString
 *   bool    ← ValueKindBool
 *   int     ← ValueKindInt32 / ValueKindInt64 / ValueKindEnum
 *   float   ← ValueKindFloat / ValueKindDouble
 *   time    ← ValueKindTime
 *   unknown ← ValueKindUnknown / ValueKindCompound / ValueKindInvalid
 */
export type SignalKind =
  | 'string'
  | 'bool'
  | 'int'
  | 'float'
  | 'time'
  | 'unknown'

/** Typed primitive carried by a SignalEnvelope. `value` is the JSON-decoded
 *  scalar matching `kind`; `null` indicates the typed column was empty. */
export type SignalValue = string | boolean | number | null

/** Typed live/history envelope returned by /signals/* and SSE signal_change.
 *  `ts` is RFC3339 / ISO 8601. */
export interface SignalEnvelope {
  kind: SignalKind
  value: SignalValue
  ts: string
}

/** UnitKind discriminator surfaced by /signals/{vehicleID}/available.
 *  Mirrors `protomodel.UnitKind` (none/distance/temperature/pressure/
 *  charge); `speed` is included so the frontend can flag distance-derived
 *  rate signals separately even though the backend currently rolls them
 *  into UnitKindNone. */
export type SignalUnitKind =
  | 'none'
  | 'distance'
  | 'temperature'
  | 'pressure'
  | 'charge'
  | 'speed'

/** A single entry in the /signals/{vehicleID}/available catalog. */
export interface SignalDescriptor {
  name: string
  category: string
  value_kind: SignalKind
  unit_kind: SignalUnitKind
  is_compound: boolean
  is_setting_unit: boolean
}

/** SSE `signal_change` event from EventHub.BroadcastSignalChange.
 *  Per-signal companion to the existing `vehicle_update` batch event so
 *  dashboards can apply O(1) keyed updates. */
export interface SignalChangeEvent extends SignalEnvelope {
  /** Process-lifetime epoch; changes when the serving SSE hub restarts. */
  stream_id: string
  /** Monotonic sequence within stream_id, used to detect dropped frames. */
  sequence: number
  vehicle_id: number
  field: string
}

/** Response shape of GET /signals/{vehicleID}/live. */
export interface LiveSignalsResponse {
  vehicle_id: number
  count: number
  at: string
  signals: Record<string, SignalEnvelope>
}

/** Response shape of GET /signals/{vehicleID}/available. */
export interface AvailableSignalsResponse {
  vehicle_id: number
  count: number
  source: string
  signals: SignalDescriptor[]
}

/** Response shape of GET /signals/{vehicleID}/{signalName}/history. */
export interface SignalHistoryResponseTyped {
  vehicle_id: number
  signal: string
  expected_kind: string
  from: string
  to: string
  count: number
  data: SignalEnvelope[]
}

/** One row of the per-category routing destination map served by
 *  GET /tesla/fleet-telemetry/coverage. */
export interface FleetTelemetryFieldCoverage {
  field: string
  destination: string
  column?: string
  also_signal_log?: boolean
  subscribed: boolean
}

/** A single category bucket in the coverage response. */
export interface FleetTelemetryCategoryCoverage {
  category: string
  total_fields: number
  destinations: Record<string, number>
  fields: FleetTelemetryFieldCoverage[]
}

/** Response shape of GET /tesla/fleet-telemetry/coverage. */
export interface FleetTelemetryCoverageResponse {
  categories: FleetTelemetryCategoryCoverage[]
  destination_totals: Record<string, number>
  orphan_fields?: string[]
}

// === Auth Session Info ===

/**
 * Snapshot of the upstream ForwardAuth session, returned by
 * `GET /api/v1/auth/session`. The endpoint is mounted OUTSIDE the
 * /api/v1 ForwardAuth subrouter and ALWAYS responds 200 OK so the
 * SPA's polling hook never trips the hard-401 path on itself.
 *
 * `mode === 'open'` indicates the deployment has FORWARD_AUTH_HEADER
 * unset — there is no auth proxy and therefore no session to expire.
 * The {@link useSessionMonitor} hook short-circuits all expiry logic
 * in this branch.
 *
 * `expires_at` is the RFC3339 timestamp the upstream proxy reports for
 * cookie expiry; null when the proxy doesn't expose it. `expires_in`
 * is the same value pre-computed against the server clock — preferred
 * by the SPA so the countdown is immune to client clock skew.
 */
export interface SessionInfo {
  authenticated: boolean
  mode: 'open' | 'session'
  expires_at: string | null
  expires_in: number | null
  user: { sub: string; email?: string } | null
  renewable: boolean
}




// ─────────────────────────────────────────────────────────────────────────────
// In-app feedback widget
// ─────────────────────────────────────────────────────────────────────────────

export type FeedbackCategory = 'bug' | 'feature' | 'other'
export type FeedbackStatus = 'new' | 'triaged' | 'closed'

export interface FeedbackEntry {
  id: number
  created_at: string
  category: FeedbackCategory
  title: string
  body: string
  page_route: string
  user_agent: string
  app_version: string
  user_email: string
  recent_errors: unknown
  console_tail: string
  status: FeedbackStatus
  github_issue_url: string
  submitter_subject: string
  submitter_ip: string
  triaged_at: string | null
  triaged_by: string
}

export interface FeedbackSubmitInput {
  category: FeedbackCategory
  title: string
  body: string
  page_route?: string
  user_agent?: string
  app_version?: string
  user_email?: string
  recent_errors?: unknown
  console_tail?: string
}

export interface FeedbackUpdateInput {
  status?: FeedbackStatus
  github_issue_url?: string
  forward_to_github?: boolean
}

export interface FeedbackListResponse {
  items: FeedbackEntry[]
  total: number
  limit: number
  offset: number
  github_bridge_enabled: boolean
  github_repo?: string
}

// per-user TOTP enrollment.
//
// Status response from GET /api/v1/auth/totp. The discriminator is
// `mode`: `'open'` means the install runs without a forward-auth
// header so per-user TOTP cannot be wired (the SPA renders an inline
// "feature requires authenticated mode" placeholder). `'session'` means
// per-user TOTP is available; `activated` then gates between
// "Enrolled" and "Not enrolled" pills.
export type TOTPStatus =
  | { mode: 'open' }
  | {
      mode: 'session'
      activated: boolean
      last_used_at?: string
      backup_codes_remaining: number
    }

// Returned by POST /api/v1/auth/totp/enroll. The plain-text backup
// codes are returned exactly once — re-enrolling generates a fresh
// set. The SPA must surface a copy/download step before the user
// closes the modal.
export interface TOTPEnrollment {
  secret: string
  otpauth_uri: string
  qr_data_uri: string
  backup_codes: string[]
  expires_at: string
}

// Returned by POST /api/v1/auth/totp/sudo. Same shape as the password
// reauth response from so the SPA's reauth interceptor can
// consume it without a discriminator.
export interface TOTPSudoToken {
  mode: 'session'
  sudo_token: string
  expires_at: string
}

// Returned by POST /api/v1/auth/totp/backup-codes/regenerate. Just a
// fresh set of plain-text codes — the secret itself is unchanged.
export interface TOTPBackupCodesResponse {
  backup_codes: string[]
}

// Active sessions / device management.
//
// One row per TeslaSync-issued device cookie binding. Provider-agnostic:
// TeslaSync mints its OWN cookie and persists the binding here, so
// revoking a row only invalidates this app's session — the upstream
// IdP cookie/session is untouched.
//
// Keys are snake_case to mirror the rest of the API surface; the
// camelCaseKeys transformer exposes both forms for SPA consumers.
export interface ActiveSession {
  id: string
  user_agent: string
  ip: string
  created_at: string
  last_seen_at: string
  revoked_at?: string
  current: boolean
}

// GET /api/v1/auth/sessions response shape. The discriminator is
// `mode`: `'open'` means the install runs without a forward-auth
// header so per-device sessions cannot be tracked (the SPA renders
// an inline placeholder); `'session'` carries the active rows.
export type ActiveSessionsResponse =
  | { mode: 'open' }
  | { mode: 'session'; sessions: ActiveSession[] }

// DELETE /api/v1/auth/sessions/all-others response shape.
export interface RevokeAllOthersResponse {
  mode: 'session'
  revoked: number
}

// === Rate-limit status ===

/** Single scope row returned by GET /api/v1/system/rate-limits. */
export type RateLimitSeverity = 'ok' | 'warn' | 'critical'

export interface ScopeBudget {
  /** Stable scope identifier; see backend RateLimitScope* constants. */
  id: string
  /** Human-readable label rendered next to the bar. */
  name: string
  /** Observed usage in the same unit as `limit`. */
  current: number
  /** Per-window cap. */
  limit: number
  /** Sliding-window length in seconds. Zero means a token-bucket snapshot. */
  window_seconds: number
  /** Optional UTC instant at which the bucket fully refills. */
  reset_at?: string | null
  /** Colour band the panel renders. */
  severity: RateLimitSeverity
  /** Operator-facing footnote shown under the row. */
  detail?: string
}

/** Envelope for GET /api/v1/system/rate-limits. */
export interface RateLimitStatusResponse {
  generated_at: string
  scopes: ScopeBudget[]
}

// === Job queue status ===

/** Heartbeat staleness band rendered by the queue status panel. */
export type QueueHeartbeatSeverity = 'ok' | 'warn' | 'critical' | 'down'

/** Canonical worker identifiers exposed by the backend. Mirror of database.WorkerName*. */
export type QueueWorkerName = 'notification' | 'export' | 'automation'

/**
 * Single worker row returned by GET /api/v1/system/queues.
 *
 * Counts come from each worker's domain table (notification_logs,
 * export_jobs, automation_history) aggregated over the last 24
 * hours. Heartbeat fields come from the Redis worker_status key
 * each worker writes via internal/worker/heartbeat.Heartbeater.
 */
export interface QueueStat {
  /** Stable worker identifier — use for routing the drawer. */
  worker: string
  /** Human-readable label (English fallback; SPA may translate). */
  display_name: string
  /** Items waiting to be picked up by the worker. */
  pending: number
  /** Items currently being processed. */
  in_progress: number
  /** Items completed successfully in the last 24 hours. */
  succeeded_24h: number
  /** Items that failed terminally in the last 24 hours. */
  failed_24h: number
  /** Age in seconds of the oldest pending item (0 = none). */
  oldest_pending_age_seconds: number
  /** Color band the panel renders for the heartbeat freshness. */
  heartbeat_severity: QueueHeartbeatSeverity
  /** Operator-facing footnote (e.g. "Last beat 7m ago"). */
  heartbeat_detail: string
  /** ISO timestamp of the worker's most recent heartbeat. */
  last_heartbeat_at?: string | null
  /** ISO timestamp the current worker process started. */
  started_at?: string | null
  /** Hostname the worker is running on. */
  host?: string
  /** Build version reported by the worker. */
  version?: string
}

/** Envelope for GET /api/v1/system/queues. */
export interface QueueStatusResponse {
  generated_at: string
  workers: QueueStat[]
}

/**
 * Single recent-job row rendered inside the per-worker drawer.
 * Mirrors the backend QueueJobView struct.
 */
export interface QueueJobView {
  id: string
  worker: string
  status: string
  title: string
  started_at: string
  finished_at?: string | null
  duration_ms?: number | null
  error?: string
}

/** Envelope for GET /api/v1/system/queues/{worker}/jobs. */
export interface QueueJobsResponse {
  worker: string
  jobs: QueueJobView[]
}

/* Per-vehicle settings layer
 * ───────────────────────────────────────────────────
 * The resolver returns one EffectiveSetting per supported key, each
 * tagged with the layer that produced its value. The SPA's
 * VehicleSettingsTab renders a "source" pill from this discriminator.
 *
 * Sources:
 *  - 'override': vehicle_settings row exists for (vehicleID, key)
 *  - 'user'    : install-global SettingsRepo provided the value
 *  - 'vehicle' : vehicles base table (e.g. nickname → display_name)
 *  - 'default' : hard-coded fallback in the Go database package
 *
 * Backend source: internal/database/vehicle_settings_repo.go ::
 * EffectiveSettingSource + internal/api/vehicle_settings_handler.go.
 */
export type EffectiveSettingSource = 'override' | 'user' | 'vehicle' | 'default'

/**
 * One resolved per-vehicle setting row. `value` is rendered by the
 * SPA against the per-key UnitInput / picker / datetime control; the
 * pill renders `source` so the user can tell which layer produced
 * the current effective value.
 *
 * The wire shape is {key, value, source} — the resolver always
 * fills `value` (no nulls) so the SPA can render every row without
 * presence checks.
 */
export interface EffectiveSetting {
  key: string
  value: unknown
  source: EffectiveSettingSource
}

/** Envelope for GET /api/v1/vehicles/{vehicleID}/settings. */
export interface VehicleSettingsResponse {
  settings: EffectiveSetting[]
}

/**
 * Per-key value type for the PUT body. The handler dispatches on
 * the key's kind (text|number|boolean|timestamp) and rejects values
 * that don't match — see decodeValueForKey in
 * internal/api/vehicle_settings_handler.go.
 *
 * The SPA builds these from typed inputs, so the union is
 * intentionally narrow rather than `any`.
 */
export type VehicleSettingValue = string | number | boolean


// ─────────────────────────────────────────────────────────────────────────────
// RBAC matrix admin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RBAC permission catalog entry as emitted by GET /admin/rbac/matrix.
 * IDs are stable, lowercase, dotted strings (e.g. `fleet.read`); the
 * admin matrix UI groups rows by `category` and renders `name` as
 * the user-visible label.
 */
export interface RbacPermission {
  id: string
  name: string
  category: string
}

/**
 * RBAC role identity. `id` is the upstream proxy group name verbatim
 * (or the implicit `user` default when no groups header is
 * configured); `name` is the matrix-column label — currently identical
 * to `id` but split out so a future "display label" pass doesn't
 * break the API contract.
 */
export interface RbacRole {
  id: string
  name: string
}

/**
 * Matrix payload. `matrix[role_id][perm_id]` is true when the role
 * grants the permission. A missing `role_id` row OR a missing
 * `perm_id` cell within a row both mean "no opinion → deny".
 *
 * `effective_for_me` is the merged grant map for the calling subject
 * across `my_roles`; the SPA renders it as a "what I can do right
 * now" pill so the operator can sanity-check their own role
 * assignment before publishing matrix edits.
 *
 * `mode === 'open'` is the synthetic envelope returned by the
 * useRbacMatrix hook when the backend reports AUTH_MODE_OPEN — the
 * SPA renders an inline "configure forward-auth" placeholder instead
 * of a 401/501 toast.
 */
export type RbacMatrixResponse =
  | RbacMatrixSessionResponse
  | RbacMatrixOpenModeResponse

export interface RbacMatrixSessionResponse {
  mode: 'session'
  roles: RbacRole[]
  permissions: RbacPermission[]
  categories: string[]
  matrix: Record<string, Record<string, boolean>>
  effective_for_me: Record<string, boolean>
  my_roles: string[]
  groups_header_name?: string
}

export interface RbacMatrixOpenModeResponse {
  mode: 'open'
}

/**
 * Single cell in a PUT /admin/rbac/matrix batch. The handler caps a
 * single request at `MaxRBACUpsertCells` (1000) cells; the SPA is
 * expected to send only the cells the operator actually toggled, so
 * realistic payloads are tiny.
 */
export interface RbacUpsertCell {
  role_id: string
  permission_id: string
  allowed: boolean
}

export interface RbacUpsertRequest {
  cells: RbacUpsertCell[]
}


// Admin impersonation API contracts.
//
// The state endpoint returns one of three modes: 'open' (501 in open-
// mode installs), 'inactive' (forward-auth, no cookie present), or
// 'active' (forward-auth, valid cookie). Discriminated unions let the
// banner hide / show without mode-string string-comparisons in the
// component.
export type ImpersonationStatus =
  | { mode: 'open' }
  | { mode: 'inactive' }
  | {
      mode: 'active'
      original_admin: string
      target: string
      expires_at: string
    }

// Single row in the candidates list. Subject is the opaque
// proxy-issued identity; the SPA renders it verbatim because the
// future may add a display-name column without changing
// this contract.
export interface ImpersonationCandidate {
  subject: string
}

export type ImpersonationCandidatesResponse =
  | { mode: 'open' }
  | {
      mode: 'session'
      candidates: ImpersonationCandidate[]
    }

export interface ImpersonationStartRequest {
  subject: string
}


/**
 * Vehicle photo upload types.
 *
 * The backend stores three rendered sizes per upload (thumb 256,
 * medium 1024, full 2048 pixels along the longer edge); GET /photo
 * returns metadata only and the SPA builds the actual bytes URL via
 * vehiclePhotoUrl() with uploaded_at as the cache buster.
 */
export type VehiclePhotoSize = 'thumb' | 'medium' | 'full'

export interface VehiclePhotoSizes {
  thumb: VehiclePhotoSize
  medium: VehiclePhotoSize
  full: VehiclePhotoSize
}

export interface VehiclePhotoMeta {
  has_photo: boolean
  uploaded_at?: string
  sizes?: VehiclePhotoSizes
}

// === Auth-mode contract ===

/**
 * Two-state classification returned by GET /api/v1/system/auth-mode.
 *
 *   - `open`         — no upstream identity provider configured
 *                      (FORWARD_AUTH_HEADER unset). The SPA should
 *                      replace every auth-coupled section with the
 *                      <RequiresAuth> placeholder.
 *   - `forward_auth` — a ForwardAuth-shaped reverse proxy is in
 *                      front of TeslaSync (Authentik, Authelia,
 *                      oauth2-proxy, Keycloak, …) and is supplying
 *                      the identity header named in `subject_header`.
 *
 * The string is the source of truth; never derive the mode from
 * `subject_header` being set, because the proxy can momentarily
 * strip the header on a single request even when the deployment
 * is configured for forward-auth.
 */
export type AuthMode = 'open' | 'forward_auth'

/**
 * Per-feature gate the SPA uses to decide whether to mount an
 * auth-coupled section or replace it with the inline <RequiresAuth>
 * placeholder. Every field is `false` in open mode and `true` in
 * forward-auth mode (the per-feature *preconditions* live inside
 * each feature's own handler — this matrix only reports whether
 * the deployment's auth mode allows the feature to exist at all).
 *
 * Keep these keys in lock-step with `internal/api.AuthModeCapabilities`
 * — drift here silently disables the corresponding section.
 */
export interface AuthModeCapabilities {
  step_up_reauth: boolean
  totp_enrollment: boolean
  session_list: boolean
  impersonation: boolean
  rbac: boolean
}

/** Envelope returned by `GET /api/v1/system/auth-mode`. */
export interface AuthModeResponse {
  mode: AuthMode
  /** Header name TeslaSync reads (e.g. "X-Forwarded-User"). Omitted in open mode. */
  subject_header?: string
  /**
   * The current request's resolved subject (the value of
   * `subject_header`). `null` / undefined in open mode AND when
   * the proxy stripped the header for this specific request.
   */
  subject?: string | null
  /**
   * Operator-supplied free text — typically the upstream IdP's
   * brand name. The SPA renders this verbatim in the
   * <RequiresAuth> empty state and the session-timeout banner;
   * it is NEVER used as a routing key.
   */
  provider_hint?: string
  capabilities: AuthModeCapabilities
}
