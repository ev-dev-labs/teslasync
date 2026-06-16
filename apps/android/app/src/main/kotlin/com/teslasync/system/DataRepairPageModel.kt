// Pure, framework-free model + derivations for the DataRepairPage system surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/system/pages/DataRepairPage.tsx, the "fix incomplete or stale sessions" repair surface).
// No Compose, no Android UI lives here. The stale-sessions feed arrives as the typed [DataRepairStaleData]
// payload (the `GET /data-repair/stale-sessions` read), so this file owns only the client-side derivations the
// web component does inline: the stale roll-up (web `staleCharging.length + staleDrives.length`), the
// clean/needs-repair status fold (web `totalStale === 0`), the "hours open" age formatter (web `hoursOpen`),
// the battery-percent render fallback (web `pct ?? '—'`), the only-present-fields repair-body builders (web
// `if (form.x) data.x = ...`), and the one PII-safe `view.opened` diagnostic. The repair form mirrors the web
// edit form's exact field set and labels (SI metres/seconds/mps for drives, the legacy kW/kWh/min the operator
// types for charging), passed through verbatim to the same repair endpoints — the page is a raw operator tool,
// so values round-trip unconverted exactly as the web page does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/system — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling admin surfaces do. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.datarepair

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException
import kotlin.math.floor
import kotlin.math.roundToLong

/**
 * Canonical metadata for this surface. The web page is a top-level system route, so this object carries the
 * cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the
 * diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object DataRepairPageRegistration {
    /** The navigation destination id (Destinations.kt `page("dataRepair", "/data-repair", …)`). */
    const val ROUTE_ID: String = "dataRepair"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/data-repair"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no record ids. */
    const val SLUG: String = "DataRepairPage"
}

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Lenient decoder for the raw repair feed — tolerates extra/absent fields so a schema drift never bricks it. */
internal val dataRepairJson: Json =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

// ── Feed payload (web `StaleData` / `ChargingSession` / `Drive`) ──────────────────────────────────────────────

/**
 * The stale-sessions feed (web `StaleData`): the two lists of open/incomplete records the repair surface lets
 * an operator fix. Both default to empty so a partial body still decodes.
 */
@Serializable
data class DataRepairStaleData(
    @SerialName("stale_charging") val staleCharging: List<DataRepairChargingSession> = emptyList(),
    @SerialName("stale_drives") val staleDrives: List<DataRepairDrive> = emptyList(),
) {
    /** Total open records across both kinds (web `staleCharging.length + staleDrives.length`). */
    val totalStale: Int get() = staleCharging.size + staleDrives.size

    /** Whether nothing needs repair (web `totalStale === 0` → "Clean"). */
    val isClean: Boolean get() = totalStale == 0
}

/** One stale charging session (web `ChargingSession`). Optional fields render with the [EM_DASH] fallback. */
@Serializable
data class DataRepairChargingSession(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("start_ts") val startTs: String,
    @SerialName("start_battery_pct") val startBatteryPct: Double? = null,
    @SerialName("end_battery_pct") val endBatteryPct: Double? = null,
    @SerialName("total_energy_added_wh") val totalEnergyAddedWh: Double? = null,
    @SerialName("peak_power_w") val peakPowerW: Double? = null,
    @SerialName("duration_min") val durationMin: Double? = null,
    val cost: Double? = null,
)

/** One stale drive (web `Drive`). Optional fields render with the [EM_DASH] fallback. */
@Serializable
data class DataRepairDrive(
    val id: Long,
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("start_ts") val startTs: String,
    @SerialName("start_battery_pct") val startBatteryPct: Double? = null,
    @SerialName("end_battery_pct") val endBatteryPct: Double? = null,
    @SerialName("distance_m") val distanceM: Double? = null,
    @SerialName("duration_s") val durationS: Double? = null,
    @SerialName("max_speed_mps") val maxSpeedMps: Double? = null,
)

// ── Edit-form state + only-present repair bodies (web `useState` form + `if (form.x)` body) ───────────────────

/**
 * The charging repair form (web `ChargingEditForm` `useState`). Every field is a raw text value the operator
 * types; [toRequestBody] folds them into the PUT body, including a field only when it is non-blank — the exact
 * web `if (form.x) data.x = ...` guard. Numeric fields are sent as numbers, the end timestamp as a string.
 */
data class DataRepairChargingForm(
    val endTs: String = "",
    val totalEnergyAddedWh: String = "",
    val endBatteryPct: String = "",
    val peakPowerW: String = "",
    val durationMin: String = "",
    val cost: String = "",
) {
    fun toRequestBody(): JsonObject =
        buildJsonObject {
            putText("end_ts", endTs)
            putNumber("total_energy_added_wh", totalEnergyAddedWh)
            putNumber("end_battery_pct", endBatteryPct)
            putNumber("peak_power_w", peakPowerW)
            putNumber("duration_min", durationMin)
            putNumber("cost", cost)
        }

    companion object {
        /** Pre-fill from the session being repaired (web `useState({ ...session })`), end timestamp left blank. */
        fun from(session: DataRepairChargingSession): DataRepairChargingForm =
            DataRepairChargingForm(
                totalEnergyAddedWh = session.totalEnergyAddedWh.toFieldText(),
                endBatteryPct = session.endBatteryPct.toFieldText(),
                peakPowerW = session.peakPowerW.toFieldText(),
                durationMin = session.durationMin.toFieldText(),
                cost = session.cost.toFieldText(),
            )
    }
}

/**
 * The drive repair form (web `DriveEditForm` `useState`). SI distance/duration/speed plus end battery, folded
 * into the PUT body with the same only-present-fields guard as [DataRepairChargingForm].
 */
data class DataRepairDriveForm(
    val endTs: String = "",
    val distanceM: String = "",
    val durationS: String = "",
    val endBatteryPct: String = "",
    val maxSpeedMps: String = "",
) {
    fun toRequestBody(): JsonObject =
        buildJsonObject {
            putText("end_ts", endTs)
            putNumber("distance_m", distanceM)
            putNumber("duration_s", durationS)
            putNumber("end_battery_pct", endBatteryPct)
            putNumber("max_speed_mps", maxSpeedMps)
        }

    companion object {
        /** Pre-fill from the drive being repaired (web `useState({ ...drive })`), end timestamp left blank. */
        fun from(drive: DataRepairDrive): DataRepairDriveForm =
            DataRepairDriveForm(
                distanceM = drive.distanceM.toFieldText(),
                durationS = drive.durationS.toFieldText(),
                endBatteryPct = drive.endBatteryPct.toFieldText(),
                maxSpeedMps = drive.maxSpeedMps.toFieldText(),
            )
    }
}

// ── Derivations / formatters (web inline helpers) ─────────────────────────────────────────────────────────────

/**
 * The "hours open" age label (web `hoursOpen`): under a day it is `"Nh"`; a day or more it is `"Dd Hh"`. The
 * elapsed span is measured from [startTs] (an ISO-8601 timestamp) to [nowMillis]; an unparseable timestamp
 * yields the [EM_DASH] so a malformed row never throws.
 */
fun hoursOpenLabel(
    startTs: String,
    nowMillis: Long,
): String {
    val startMillis = parseIsoMillis(startTs) ?: return EM_DASH
    val hours = (nowMillis - startMillis) / MILLIS_PER_HOUR
    val safeHours = if (hours < 0.0) 0.0 else hours
    if (safeHours < HOURS_PER_DAY) return "${safeHours.roundToLong()}h"
    val days = floor(safeHours / HOURS_PER_DAY).toLong()
    val remainder = (safeHours % HOURS_PER_DAY).roundToLong()
    return "${days}d ${remainder}h"
}

/** Battery-percent render fallback (web `pct != null ? `${pct}%` : '—'`). */
fun batteryPercentLabel(pct: Double?): String = if (pct == null) EM_DASH else "${formatPercent(pct)}%"

/** A short record id label (web `#${id}`). */
fun recordIdLabel(id: Long): String = "#$id"

/** Parses an ISO-8601 timestamp to epoch millis, or `null` when it cannot be read. */
internal fun parseIsoMillis(value: String): Long? =
    try {
        OffsetDateTime.parse(value).toInstant().toEpochMilli()
    } catch (_: DateTimeParseException) {
        null
    }

/** Whole-number percents render without a trailing `.0`; fractional ones keep their value. */
private fun formatPercent(pct: Double): String =
    if (pct % 1.0 == 0.0) pct.toLong().toString() else pct.toString()

/** A nullable numeric pre-fill rendered as the form text the operator edits (whole numbers drop the `.0`). */
private fun Double?.toFieldText(): String =
    when {
        this == null -> ""
        this % 1.0 == 0.0 -> toLong().toString()
        else -> toString()
    }

/** Adds a string field only when [value] is non-blank (web `if (form.x) data.x = value`). */
private fun JsonObjectBuilder.putText(
    key: String,
    value: String,
) {
    val trimmed = value.trim()
    if (trimmed.isNotEmpty()) put(key, JsonPrimitive(trimmed))
}

/** Adds a numeric field only when [value] parses to a finite number (web `if (form.x) data.x = Number(...)`). */
private fun JsonObjectBuilder.putNumber(
    key: String,
    value: String,
) {
    val parsed = parseFiniteDouble(value.trim()) ?: return
    put(key, JsonPrimitive(parsed))
}

/** Parses [text] to a finite double, or null when it is blank / malformed / non-finite (web `Number(...)`). */
private fun parseFiniteDouble(text: String): Double? =
    if (text.isEmpty()) {
        null
    } else {
        try {
            java.lang.Double.parseDouble(text).takeIf { it.isFinite() }
        } catch (_: NumberFormatException) {
            null
        }
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DataRepairPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no record id, VIN, or count.
 */
fun recordDataRepairPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DataRepairPageRegistration.SLUG))
}

private const val MILLIS_PER_HOUR: Double = 3_600_000.0
private const val HOURS_PER_DAY: Double = 24.0
