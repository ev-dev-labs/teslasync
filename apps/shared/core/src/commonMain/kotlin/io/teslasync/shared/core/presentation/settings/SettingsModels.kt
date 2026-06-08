package io.teslasync.shared.core.presentation.settings

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/*
 * The cross-platform port of the web Settings hook-domain types
 * (web/src/api/hooks/useSettings.ts + the shared interfaces in web/src/api/types.ts).
 * Every native Settings screen (Android/Apple via KMP, Windows via the C# port) binds to
 * these shapes through the S7 io.teslasync.shared.core.data.repo.SettingsRepository and the
 * S8 SettingsStore.
 *
 * Keys arrive snake_case from the `/api/v1/...` endpoints; they are matched verbatim via
 * SerialName so a cached payload round-trips unchanged. No field here is telemetry-unit-bearing
 * (the cost/efficiency settings are user-entered preference values stored verbatim, not SI
 * telemetry), so there is no SI conversion at this layer — display formatting is the render
 * boundary's job (S5). Every optional server field defaults so a partial payload still decodes
 * (the web `ignoreUnknownKeys` behaviour).
 *
 * The single app-settings document (`GET/PUT /settings`) is intentionally NOT modelled as a
 * fixed struct here: it is a ~40-field, frequently-extended preferences blob and is not
 * unit-bearing, so — exactly like the web `useSaveAiSettings` merge and the AiSettings KMP port —
 * it is carried as a raw [JsonElement] so the exact server shape round-trips byte-for-byte.
 */

/**
 * `GET /auth/status` response — the port of the web `AuthStatus` interface
 * (web/src/api/hooks/useSettings.ts). Reports whether a Tesla Fleet account is connected and,
 * when present, the ISO-8601 token expiry.
 */
@Serializable
public data class AuthStatus(
    val authenticated: Boolean = false,
    @SerialName("expires_at") val expiresAt: String? = null,
)

/**
 * `POST /auth/url` response — the port of the web `{ auth_url }` mutation payload. Carries the
 * Tesla OAuth authorize URL the platform opens in a browser.
 */
@Serializable
public data class AuthUrlResult(
    @SerialName("auth_url") val authUrl: String = "",
)

/**
 * One row of `GET /vehicles` — the port of the web `Vehicle` interface
 * (web/src/api/hooks/useSettings.ts), the lightweight identity shape the Settings page lists.
 */
@Serializable
public data class Vehicle(
    val id: Long,
    val name: String = "",
    val vin: String = "",
)

/**
 * `POST /vehicles/sync` response — the port of the web `{ synced }` mutation payload, reporting
 * how many vehicles were (re)discovered from the Fleet account.
 */
@Serializable
public data class SyncVehiclesResult(
    val synced: Int = 0,
)

/**
 * `GET /user-preferences/latest?vehicle_id=` response — the port of the web `UserPreferenceLatest`
 * interface (web/src/api/hooks/useSettings.ts), the car-reported unit preferences used to seed the
 * "Sync from Car" flow. Every field is optional because a vehicle may not have reported one yet.
 */
@Serializable
public data class CarPreferences(
    @SerialName("setting_distance_unit") val distanceUnit: String? = null,
    @SerialName("setting_temperature_unit") val temperatureUnit: String? = null,
    @SerialName("setting_tire_pressure_unit") val tirePressureUnit: String? = null,
    @SerialName("setting_24hr_time") val use24HourTime: Boolean? = null,
)

/**
 * `GET /gas-price/status` response — the port of the web `GasPriceStatus` interface
 * (web/src/api/types.ts). Prices are plain user-currency values stored verbatim, NOT SI telemetry,
 * so they round-trip unchanged.
 */
@Serializable
public data class GasPriceStatus(
    val enabled: Boolean = false,
    @SerialName("poll_interval") val pollInterval: String = "",
    @SerialName("last_poll_time") val lastPollTime: String = "",
    @SerialName("current_price") val currentPrice: Double = 0.0,
    @SerialName("current_price_kwh_eq") val currentPriceKwhEq: Double = 0.0,
)

/**
 * `POST /gas-price/poll` response — the port of the web `{ status }` mutation payload.
 */
@Serializable
public data class GasPricePollResult(
    val status: String = "",
)

/**
 * `POST /gas-price/toggle` response — the port of the web `{ enabled }` mutation payload, echoing
 * the new tracking-enabled state.
 */
@Serializable
public data class GasPriceToggleResult(
    val enabled: Boolean = false,
)

/**
 * `PUT /gas-price/config` response — the port of the web `{ poll_interval }` mutation payload,
 * echoing the persisted poll interval.
 */
@Serializable
public data class GasPriceConfigResult(
    @SerialName("poll_interval") val pollInterval: String = "",
)

/**
 * `GET/PUT /settings/dashboard-layouts` payload — the port of the web `DashboardLayoutsPayload`
 * interface (web/src/api/hooks/useSettings.ts). The `dashboards` entries are opaque SavedDashboard
 * JSON blobs (the web `unknown[]`), round-tripped verbatim as [JsonElement] so no field is lost on
 * save; `active_id` selects the visible dashboard.
 */
@Serializable
public data class DashboardLayoutsPayload(
    val dashboards: List<JsonElement> = emptyList(),
    @SerialName("active_id") val activeId: String = "",
)

/**
 * `POST /settings/suspend-api` response — the port of the web `{ api_suspended }` mutation payload,
 * echoing the new Fleet-API suspension state.
 */
@Serializable
public data class ApiSuspendResult(
    @SerialName("api_suspended") val apiSuspended: Boolean = false,
)

/**
 * `GET/PUT /settings/polling-config` payload — the port of the web `PollingConfig` interface
 * (web/src/api/hooks/useSettings.ts). Each boolean toggles a Fleet-API poll family; the
 * `on_demand_*` mirrors gate the same families behind an explicit wake. `telemetry_capture` enables
 * raw document capture and `telemetry_capture_retention_days` bounds its retention. Defaults are
 * `false`/`0` so a partial payload still decodes; the full object is re-submitted on save.
 */
@Serializable
public data class PollingConfig(
    @SerialName("vehicle_discovery") val vehicleDiscovery: Boolean = false,
    @SerialName("charge_state") val chargeState: Boolean = false,
    @SerialName("climate_state") val climateState: Boolean = false,
    @SerialName("drive_state") val driveState: Boolean = false,
    @SerialName("location_data") val locationData: Boolean = false,
    @SerialName("vehicle_state") val vehicleState: Boolean = false,
    @SerialName("vehicle_config") val vehicleConfig: Boolean = false,
    @SerialName("on_demand_vehicle_discovery") val onDemandVehicleDiscovery: Boolean = false,
    @SerialName("on_demand_charge_state") val onDemandChargeState: Boolean = false,
    @SerialName("on_demand_climate_state") val onDemandClimateState: Boolean = false,
    @SerialName("on_demand_drive_state") val onDemandDriveState: Boolean = false,
    @SerialName("on_demand_location_data") val onDemandLocationData: Boolean = false,
    @SerialName("on_demand_vehicle_state") val onDemandVehicleState: Boolean = false,
    @SerialName("on_demand_vehicle_config") val onDemandVehicleConfig: Boolean = false,
    @SerialName("nearby_charging_sites") val nearbyChargingSites: Boolean = false,
    @SerialName("release_notes") val releaseNotes: Boolean = false,
    @SerialName("recent_alerts") val recentAlerts: Boolean = false,
    @SerialName("service_data") val serviceData: Boolean = false,
    @SerialName("wake_up") val wakeUp: Boolean = false,
    val commands: Boolean = false,
    @SerialName("telemetry_capture") val telemetryCapture: Boolean = false,
    @SerialName("telemetry_capture_retention_days") val telemetryCaptureRetentionDays: Int = 0,
)

/**
 * `GET /dev-tools/telemetry-capture/stats` response — the port of the web `CaptureStats` interface
 * declared in web/src/api/hooks/useSettings.ts (the three fields the Settings page reads).
 */
@Serializable
public data class CaptureStats(
    @SerialName("mongodb_enabled") val mongodbEnabled: Boolean = false,
    @SerialName("total_documents") val totalDocuments: Long = 0,
    @SerialName("distinct_vins") val distinctVins: List<String> = emptyList(),
)

/**
 * `GET /system/version` response — the port of the web `VersionInfo` interface
 * (web/src/api/hooks/useSettings.ts). [requireCookieConsent] is the server-declared GDPR/ePrivacy
 * gate (optional; defaults absent on existing self-hosted installs).
 */
@Serializable
public data class VersionInfo(
    @SerialName("chart_version") val chartVersion: String = "",
    @SerialName("go_version") val goVersion: String = "",
    val os: String = "",
    val arch: String = "",
    val endpoints: Map<String, String> = emptyMap(),
    @SerialName("require_cookie_consent") val requireCookieConsent: Boolean? = null,
)
