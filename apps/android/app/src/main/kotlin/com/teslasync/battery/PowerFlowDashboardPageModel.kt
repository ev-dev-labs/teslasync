// Pure, framework-free model + projections for the PowerFlowDashboardPage surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/battery/pages/PowerFlowDashboardPage.tsx). No
// Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// ChartFormat, the shared-core Resource, and the redacting Logger), so the composable stays a thin render layer and all
// of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the two raw SI JSON envelopes the page reads —
// the `/tesla/energy-sites/{siteId}/live-status` snapshot and the `/tesla/energy-sites/{siteId}/live-status/history`
// list — into typed, null-safe models (web optional-chaining → null-safe reads); (2) the watt/watt-hour/percent
// display formatters (web `fmtWatts`/`fmtWh`) applied only at the render boundary; (3) the power-over-time +
// state-of-charge chart series the two charts plot (web `chartData`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): power is SI watts, energy SI watt-hours, charge a 0–100
// percentage. None of these is a unit-system quantity (no miles/°F/psi), so the formatters only scale magnitude
// (W → kW, Wh → kWh) exactly as the web page does — never a metric/imperial conversion.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling BatteryHealthPage does.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.powerflow

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale
import kotlin.math.abs

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** 1 kW = 1000 W and 1 kWh = 1000 Wh — the magnitude scale the formatters apply above the threshold (web `/ 1000`). */
private const val KILO = 1000.0

/** The magnitude at/above which the formatters switch to the kilo prefix (web `Math.abs(x) >= 1000`). */
private const val KILO_THRESHOLD = 1000.0

/** Fraction digits matching the web `fmtNumber(value, n)` calls. */
private const val WHOLE_DECIMALS = 0
private const val KILO_DECIMALS = 1
private const val SOC_DECIMALS = 1

/** Unit literals the web reads verbatim (never i18n), mirroring the BatteryHealthPage `ENERGY_UNIT` precedent. */
private const val WATT_UNIT = "W"
private const val KILOWATT_UNIT = "kW"
private const val WATT_HOUR_UNIT = "Wh"
private const val KILOWATT_HOUR_UNIT = "kWh"
private const val PERCENT_UNIT = "%"

/** The grid-status string the backend reports as "online" (web `gridStatus === 'Active'`). */
const val GRID_STATUS_ACTIVE: String = "Active"

/** Length of the `yyyy-MM-dd` date prefix of an ISO timestamp. */
private const val DATE_PREFIX_LENGTH = 10

/** Minimum `yyyy`,`MM`,`dd` parts an ISO date must split into for the short label (web `formatDateShort`). */
private const val DATE_PART_COUNT = 3

/** Length of the `yyyy-MM-ddTHH:mm` prefix of an ISO timestamp used by the date-time label (web `formatDateTime`). */
private const val DATETIME_PREFIX_LENGTH = 16

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `PowerFlowDashboardPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("powerFlow", "/power-flow", …)`, so the host binds this surface to that destination without the nav module
 * depending on it.
 */
object PowerFlowDashboardPageRegistration {
    /** The navigation destination id (Destinations.kt `page("powerFlow", "/power-flow", …)`). */
    const val ROUTE_ID: String = "powerFlow"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/power-flow"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no site id. */
    const val SLUG: String = "PowerFlowDashboardPage"

    /** The fixed energy-site id the page reads (web `DEFAULT_SITE_ID = 1`; a future picker can select among sites). */
    const val DEFAULT_SITE_ID: Long = 1L
}

// ── Decoded envelopes ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The decoded `/tesla/energy-sites/{siteId}/live-status` snapshot (web `TeslaEnergyLiveStatus`). All power figures are
 * SI watts and the energy figures SI watt-hours; [percentageCharged] is a 0–100 percentage. A response with no [id]
 * is the backend "no data yet" message, so [hasData] is false (web `hasLiveData = liveStatus && 'id' in liveStatus`).
 */
data class PowerFlowLive(
    val id: Long?,
    val solarPowerW: Double?,
    val batteryPowerW: Double?,
    val loadPowerW: Double?,
    val gridPowerW: Double?,
    val gridServicesPowerW: Double?,
    val energyLeftWh: Double?,
    val totalPackEnergyWh: Double?,
    val percentageCharged: Double?,
    val gridStatus: String?,
    val backupCapable: Boolean,
    val stormModeActive: Boolean,
    val timestamp: String?,
) {
    /** Whether the snapshot is a real power-flow reading (web renders the live panels only for a truthy `id`). */
    val hasData: Boolean get() = id != null

    companion object {
        /** The no-snapshot value that routes the page to its empty surface (web `!hasLiveData`). */
        val EMPTY: PowerFlowLive =
            PowerFlowLive(
                id = null,
                solarPowerW = null,
                batteryPowerW = null,
                loadPowerW = null,
                gridPowerW = null,
                gridServicesPowerW = null,
                energyLeftWh = null,
                totalPackEnergyWh = null,
                percentageCharged = null,
                gridStatus = null,
                backupCapable = false,
                stormModeActive = false,
                timestamp = null,
            )
    }
}

/**
 * One decoded `/tesla/energy-sites/{siteId}/live-status/history` row, projected to the chart shape (web `chartData`).
 * Power figures are SI watts and [socPct] a 0–100 percentage; null wire values fold to `0` exactly as web (`?? 0`).
 */
data class PowerFlowSample(
    val timestamp: String,
    val solarW: Double,
    val batteryW: Double,
    val gridW: Double,
    val loadW: Double,
    val socPct: Double,
)

// ── Decoders ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Decodes the raw `/live-status` [json] into a [PowerFlowLive], null-safe per field. */
fun parsePowerFlowLive(json: JsonElement?): PowerFlowLive {
    val obj = json as? JsonObject ?: return PowerFlowLive.EMPTY
    return PowerFlowLive(
        id = obj.longField("id"),
        solarPowerW = obj.doubleOrNull("solar_power"),
        batteryPowerW = obj.doubleOrNull("battery_power"),
        loadPowerW = obj.doubleOrNull("load_power"),
        gridPowerW = obj.doubleOrNull("grid_power"),
        gridServicesPowerW = obj.doubleOrNull("grid_services_power"),
        energyLeftWh = obj.doubleOrNull("energy_left"),
        totalPackEnergyWh = obj.doubleOrNull("total_pack_energy"),
        percentageCharged = obj.doubleOrNull("percentage_charged"),
        gridStatus = obj.stringField("grid_status"),
        backupCapable = obj.boolField("backup_capable") ?: false,
        stormModeActive = obj.boolField("storm_mode_active") ?: false,
        timestamp = obj.stringField("timestamp"),
    )
}

/**
 * Decodes the raw `/live-status/history` [json] array into [PowerFlowSample]s, sorted chronologically so the time-series
 * charts read left-to-right (web plots by the numeric `time` key). Rows without a timestamp are skipped.
 */
fun parsePowerFlowHistory(json: JsonElement?): List<PowerFlowSample> {
    val array = json as? JsonArray ?: return emptyList()
    return array
        .mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val ts = obj.stringField("timestamp") ?: return@mapNotNull null
            PowerFlowSample(
                timestamp = ts,
                solarW = obj.double("solar_power"),
                batteryW = obj.double("battery_power"),
                gridW = obj.double("grid_power"),
                loadW = obj.double("load_power"),
                socPct = obj.double("percentage_charged"),
            )
        }.sortedBy { it.timestamp }
}

// ── Display formatters (render boundary) ────────────────────────────────────────────────────────────────────────

/** Formats SI watts as `W`/`kW` (web `fmtWatts`): a null reads `—`, |w| ≥ 1000 scales to kW at 1 decimal, else W whole. */
fun formatWatts(watts: Double?, locale: Locale = Locale.getDefault()): String {
    if (watts == null) return EM_DASH
    return if (abs(watts) >= KILO_THRESHOLD) {
        "${ChartFormat.number(watts / KILO, KILO_DECIMALS, locale)} $KILOWATT_UNIT"
    } else {
        "${ChartFormat.number(watts, WHOLE_DECIMALS, locale)} $WATT_UNIT"
    }
}

/** Formats SI watt-hours as `Wh`/`kWh` (web `fmtWh`): a null reads `—`, |wh| ≥ 1000 scales to kWh at 1 decimal. */
fun formatWattHours(wh: Double?, locale: Locale = Locale.getDefault()): String {
    if (wh == null) return EM_DASH
    return if (abs(wh) >= KILO_THRESHOLD) {
        "${ChartFormat.number(wh / KILO, KILO_DECIMALS, locale)} $KILOWATT_HOUR_UNIT"
    } else {
        "${ChartFormat.number(wh, WHOLE_DECIMALS, locale)} $WATT_HOUR_UNIT"
    }
}

/** Formats a 0–100 charge percentage at 1 decimal (web `${fmtNumber(soc, 1)}%`); a null reads `—`. */
fun formatPercent(pct: Double?, locale: Locale = Locale.getDefault()): String {
    if (pct == null) return EM_DASH
    return "${ChartFormat.number(pct, SOC_DECIMALS, locale)}$PERCENT_UNIT"
}

/** A short x-axis label for an ISO timestamp (web `formatDateShort`): `yyyy-MM-dd` → `MM/dd`, else the raw string. */
internal fun shortDateLabel(iso: String): String {
    val date = iso.take(DATE_PREFIX_LENGTH)
    val parts = date.split("-")
    return if (parts.size >= DATE_PART_COUNT) "${parts[1]}/${parts[2]}" else iso
}

/** A human "last updated" label for an ISO timestamp (web `formatDateTime`): `2024-01-15T14:30:…` → `2024-01-15 14:30`. */
internal fun dateTimeLabel(iso: String): String = iso.take(DATETIME_PREFIX_LENGTH).replace('T', ' ')

// ── Resource projection + diagnostics ───────────────────────────────────────────────────────────────────────────

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags (the cached
 * value on `Loading`/`Error` and the fresh `Success` value are both transformed; the stamps + error pass through). Pure,
 * so the view-model's `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PowerFlowDashboardPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no site id, power, energy or charge payload.
 */
fun recordPowerFlowOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PowerFlowDashboardPageRegistration.SLUG))
}

// ── Small framework-free JSON helpers ───────────────────────────────────────────────────────────────────────────

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
