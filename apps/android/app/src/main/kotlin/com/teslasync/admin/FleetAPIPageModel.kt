// Pure, framework-free model + derivations for the FleetAPIPage admin surface — the native analogue of
// everything the web page computes before it returns JSX (web/src/features/admin/pages/FleetAPIPage.tsx, the
// Tesla Fleet API polling/endpoint control panel). No Compose, no Android framework, no HTTP lives here:
// every type is exercised off-device, keeping the composable a thin render layer.
//
// The four feeds arrive as the already-decoded shared S8 SettingsStore payloads: the raw settings document
// (`GET /settings`, a verbatim JsonElement whose `api_suspended` flag is the only field this page reads), the
// typed PollingConfig (`GET /settings/polling-config`), the typed CaptureStats
// (`GET /dev-tools/telemetry-capture/stats`) and the typed VersionInfo (`GET /system/version`). So this file
// owns only the client-side derivations the web component does inline: the per-key polling-endpoint toggle
// read/flip (web `pollingConfig[key]` / `{ ...pollingConfig, [key]: !pollingConfig[key] }`), the enabled /
// total endpoint count (web `enabledCount` / `totalCount` over the `allEndpointKeys` set), the retention-day
// option set, and the `api_suspended` parse. No field here is telemetry-unit-bearing (booleans, counts, a
// retention-day integer, version strings), so there is no SI conversion — locale number formatting is applied
// at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling ApiLogsPage / FeedbackQueuePage admin surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.fleetapi

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.PollingConfig
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, and the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11).
 */
object FleetApiRegistration {
    /** The navigation destination id (Destinations.kt `page("fleetApi", "/fleet-api", …)`). */
    const val ROUTE_ID: String = "fleetApi"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/fleet-api"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FleetAPIPage"
}

/**
 * The settings-document projection this page binds to. The web page reads exactly one field from the ~40-field
 * settings blob — `api_suspended` — so the native snapshot carries only that, parsed off the raw shared
 * JsonElement so the composable never touches JSON.
 */
data class FleetApiSettings(
    val apiSuspended: Boolean,
)

/** A single Fleet-API endpoint toggle key (web `pollingEndpoints` / `onDemandEndpoints` / `commandEndpoints`). */
const val KEY_VEHICLE_DISCOVERY: String = "vehicle_discovery"
const val KEY_CHARGE_STATE: String = "charge_state"
const val KEY_CLIMATE_STATE: String = "climate_state"
const val KEY_DRIVE_STATE: String = "drive_state"
const val KEY_LOCATION_DATA: String = "location_data"
const val KEY_VEHICLE_STATE: String = "vehicle_state"
const val KEY_VEHICLE_CONFIG: String = "vehicle_config"
const val KEY_ON_DEMAND_VEHICLE_DISCOVERY: String = "on_demand_vehicle_discovery"
const val KEY_ON_DEMAND_CHARGE_STATE: String = "on_demand_charge_state"
const val KEY_ON_DEMAND_CLIMATE_STATE: String = "on_demand_climate_state"
const val KEY_ON_DEMAND_DRIVE_STATE: String = "on_demand_drive_state"
const val KEY_ON_DEMAND_LOCATION_DATA: String = "on_demand_location_data"
const val KEY_ON_DEMAND_VEHICLE_STATE: String = "on_demand_vehicle_state"
const val KEY_ON_DEMAND_VEHICLE_CONFIG: String = "on_demand_vehicle_config"
const val KEY_NEARBY_CHARGING_SITES: String = "nearby_charging_sites"
const val KEY_RELEASE_NOTES: String = "release_notes"
const val KEY_RECENT_ALERTS: String = "recent_alerts"
const val KEY_SERVICE_DATA: String = "service_data"
const val KEY_WAKE_UP: String = "wake_up"
const val KEY_COMMANDS: String = "commands"
const val KEY_TELEMETRY_CAPTURE: String = "telemetry_capture"

/** The Polling-Endpoints group keys, in web source order (`pollingEndpoints`). */
val POLLING_ENDPOINT_KEYS: List<String> =
    listOf(
        KEY_VEHICLE_DISCOVERY,
        KEY_CHARGE_STATE,
        KEY_CLIMATE_STATE,
        KEY_DRIVE_STATE,
        KEY_LOCATION_DATA,
        KEY_VEHICLE_STATE,
        KEY_VEHICLE_CONFIG,
    )

/** The On-Demand-Endpoints group keys, in web source order (`onDemandEndpoints`). */
val ON_DEMAND_ENDPOINT_KEYS: List<String> =
    listOf(
        KEY_ON_DEMAND_VEHICLE_DISCOVERY,
        KEY_ON_DEMAND_CHARGE_STATE,
        KEY_ON_DEMAND_CLIMATE_STATE,
        KEY_ON_DEMAND_DRIVE_STATE,
        KEY_ON_DEMAND_LOCATION_DATA,
        KEY_ON_DEMAND_VEHICLE_STATE,
        KEY_ON_DEMAND_VEHICLE_CONFIG,
        KEY_NEARBY_CHARGING_SITES,
        KEY_RELEASE_NOTES,
        KEY_RECENT_ALERTS,
        KEY_SERVICE_DATA,
    )

/** The Commands group keys, in web source order (`commandEndpoints`). */
val COMMAND_ENDPOINT_KEYS: List<String> = listOf(KEY_WAKE_UP, KEY_COMMANDS)

/**
 * Every toggle key that counts toward the header's `enabledCount/totalCount` (web `allEndpointKeys`): the three
 * visible groups plus `telemetry_capture`. The web builds this as a Set; the order here is irrelevant to the
 * count but kept stable for the test.
 */
val ALL_TOGGLE_KEYS: List<String> =
    POLLING_ENDPOINT_KEYS + ON_DEMAND_ENDPOINT_KEYS + COMMAND_ENDPOINT_KEYS + KEY_TELEMETRY_CAPTURE

/** The configured-endpoint rows the API-Endpoints panel lists, in web source order. */
const val ENDPOINT_API: String = "api"
const val ENDPOINT_WEB: String = "web"
const val ENDPOINT_OAUTH_CALLBACK: String = "oauth_callback"
const val ENDPOINT_TESLA_API: String = "tesla_api"

/** The configured-endpoint keys the API-Endpoints panel renders when present (web inline array). */
val CONFIGURED_ENDPOINT_KEYS: List<String> = listOf(ENDPOINT_API, ENDPOINT_WEB, ENDPOINT_OAUTH_CALLBACK, ENDPOINT_TESLA_API)

/** The telemetry-capture retention-day options, in web source order (the Select `options`). */
val RETENTION_DAY_OPTIONS: List<Int> = listOf(1, 3, 7, 14, 30)

/** The web fallback retention when the server value is missing/zero (`telemetry_capture_retention_days || 7`). */
const val DEFAULT_RETENTION_DAYS: Int = 7

/** Reads a single endpoint toggle's current value by its wire key (web `pollingConfig[key]`). */
fun PollingConfig.isEnabled(key: String): Boolean =
    when (key) {
        KEY_VEHICLE_DISCOVERY -> vehicleDiscovery
        KEY_CHARGE_STATE -> chargeState
        KEY_CLIMATE_STATE -> climateState
        KEY_DRIVE_STATE -> driveState
        KEY_LOCATION_DATA -> locationData
        KEY_VEHICLE_STATE -> vehicleState
        KEY_VEHICLE_CONFIG -> vehicleConfig
        KEY_ON_DEMAND_VEHICLE_DISCOVERY -> onDemandVehicleDiscovery
        KEY_ON_DEMAND_CHARGE_STATE -> onDemandChargeState
        KEY_ON_DEMAND_CLIMATE_STATE -> onDemandClimateState
        KEY_ON_DEMAND_DRIVE_STATE -> onDemandDriveState
        KEY_ON_DEMAND_LOCATION_DATA -> onDemandLocationData
        KEY_ON_DEMAND_VEHICLE_STATE -> onDemandVehicleState
        KEY_ON_DEMAND_VEHICLE_CONFIG -> onDemandVehicleConfig
        KEY_NEARBY_CHARGING_SITES -> nearbyChargingSites
        KEY_RELEASE_NOTES -> releaseNotes
        KEY_RECENT_ALERTS -> recentAlerts
        KEY_SERVICE_DATA -> serviceData
        KEY_WAKE_UP -> wakeUp
        KEY_COMMANDS -> commands
        KEY_TELEMETRY_CAPTURE -> telemetryCapture
        else -> false
    }

/**
 * Returns a copy with the [key]'s toggle flipped (web `{ ...pollingConfig, [key]: !pollingConfig[key] }`).
 * An unknown key returns the config unchanged so a stale call can never corrupt the submitted document.
 */
fun PollingConfig.toggling(key: String): PollingConfig =
    when (key) {
        KEY_VEHICLE_DISCOVERY -> copy(vehicleDiscovery = !vehicleDiscovery)
        KEY_CHARGE_STATE -> copy(chargeState = !chargeState)
        KEY_CLIMATE_STATE -> copy(climateState = !climateState)
        KEY_DRIVE_STATE -> copy(driveState = !driveState)
        KEY_LOCATION_DATA -> copy(locationData = !locationData)
        KEY_VEHICLE_STATE -> copy(vehicleState = !vehicleState)
        KEY_VEHICLE_CONFIG -> copy(vehicleConfig = !vehicleConfig)
        KEY_ON_DEMAND_VEHICLE_DISCOVERY -> copy(onDemandVehicleDiscovery = !onDemandVehicleDiscovery)
        KEY_ON_DEMAND_CHARGE_STATE -> copy(onDemandChargeState = !onDemandChargeState)
        KEY_ON_DEMAND_CLIMATE_STATE -> copy(onDemandClimateState = !onDemandClimateState)
        KEY_ON_DEMAND_DRIVE_STATE -> copy(onDemandDriveState = !onDemandDriveState)
        KEY_ON_DEMAND_LOCATION_DATA -> copy(onDemandLocationData = !onDemandLocationData)
        KEY_ON_DEMAND_VEHICLE_STATE -> copy(onDemandVehicleState = !onDemandVehicleState)
        KEY_ON_DEMAND_VEHICLE_CONFIG -> copy(onDemandVehicleConfig = !onDemandVehicleConfig)
        KEY_NEARBY_CHARGING_SITES -> copy(nearbyChargingSites = !nearbyChargingSites)
        KEY_RELEASE_NOTES -> copy(releaseNotes = !releaseNotes)
        KEY_RECENT_ALERTS -> copy(recentAlerts = !recentAlerts)
        KEY_SERVICE_DATA -> copy(serviceData = !serviceData)
        KEY_WAKE_UP -> copy(wakeUp = !wakeUp)
        KEY_COMMANDS -> copy(commands = !commands)
        KEY_TELEMETRY_CAPTURE -> copy(telemetryCapture = !telemetryCapture)
        else -> this
    }

/** Returns a copy with the telemetry-capture retention set to [days] (web retention Select `onChange`). */
fun PollingConfig.withRetentionDays(days: Int): PollingConfig = copy(telemetryCaptureRetentionDays = days)

/** The effective retention to show in the Select (web `telemetry_capture_retention_days || 7`). */
fun PollingConfig.effectiveRetentionDays(): Int =
    if (telemetryCaptureRetentionDays > 0) telemetryCaptureRetentionDays else DEFAULT_RETENTION_DAYS

/** How many of the [ALL_TOGGLE_KEYS] are enabled (web `enabledCount`). */
fun PollingConfig.enabledToggleCount(): Int = ALL_TOGGLE_KEYS.count { isEnabled(it) }

/** The total toggle count the header denominator shows (web `totalCount`, the size of `allEndpointKeys`). */
val TOTAL_TOGGLE_COUNT: Int = ALL_TOGGLE_KEYS.size

/**
 * Parses the `api_suspended` flag from the raw settings document (web `settings?.api_suspended`). Reads the
 * snake_case wire key first (the verbatim server shape) and tolerates a camelCase mirror; absent/non-boolean
 * resolves to `false` (polling active) so a partial document degrades safely.
 */
fun parseApiSuspended(document: JsonElement?): Boolean {
    val obj = document as? JsonObject ?: return false
    val primitive = (obj["api_suspended"] ?: obj["apiSuspended"]) as? JsonPrimitive ?: return false
    return primitive.booleanOrNull ?: false
}

/** Projects the raw settings [Resource] onto the [FleetApiSettings] snapshot, preserving the freshness phase. */
fun Resource<JsonElement>.asSettingsSnapshot(): Resource<FleetApiSettings> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { FleetApiSettings(parseApiSuspended(it)) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(FleetApiSettings(parseApiSuspended(data)), fetchedAt, stale)
        is Resource.Error ->
            Resource.Error(cached?.let { FleetApiSettings(parseApiSuspended(it)) }, fetchedAt, stale, error)
    }

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no settings content. */
internal fun recordFleetApiPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FleetApiRegistration.SLUG))
}
