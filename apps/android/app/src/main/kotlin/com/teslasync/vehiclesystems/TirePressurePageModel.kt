// Pure, framework-free model + projections for the TirePressurePage vehicle-systems surface — the native analogue of
// everything the web page derives before composing its panels
// (web/src/features/vehicle-systems/pages/TirePressurePage.tsx). No Compose, no Android UI, no HTTP: every declaration
// here is plain Kotlin (it references only the framework-free UiState projection's Resource + the shared-core unit
// converter + the JVM ChartFormat number/date helper), so the composable stays a thin render layer and all of this is
// exercised off-device by the :app:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the two raw reads — `/tire-pressure/latest`
// (the four corner pressures + the TPMS hard/soft warning JSON strings) and `/tire-pressure` (the history list) — into
// typed, null-safe models; (2) the interim raw→Pa coercion the web `normaliseTpmsToPa` performs (codec values that
// skipped `units.ToSI` land as bar/psi/kPa and are normalized to Pa by value range); (3) the threshold bands the web
// `pressureColor` / `pressureStatus` switch on (normal 250–350 kPa, soft 200–400 kPa, else critical); (4) the
// TPMS-warning truthiness the web `hasTpmsWarning` derives from the warning JSON string; and (5) the summary scalars
// (mean / min corner pressure, out-of-band warning count) + the chronological history ordering + the display
// formatting (pressure converted SI→user unit, localized date/time).
//
// Units note (unit-conversion.instructions / frontend-si-cutover): the four corner pressures arrive as SI Pascals;
// this layer keeps them SI and converts to the user's display unit (bar/psi) ONLY at the formatting boundary via the
// shared `convertPressureFromSI`, exactly like the web `convertPressureFromSI(pa / 1000, unit)`. Nothing is stored or
// computed in a non-SI unit.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling battery surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.tirepressure

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertPressureFromSI
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Pressure figures render with one fraction digit at the display boundary (web `fmtNumber`). */
private const val PRESSURE_DECIMALS = 1

// ── SI threshold bands (Pascals), ported verbatim from the web constants ──────────────────────────────────────────

/** Normal band lower bound — web `NORMAL_MIN_PA` (2.5 bar). */
const val NORMAL_MIN_PA: Double = 250_000.0

/** Normal band upper bound — web `NORMAL_MAX_PA` (3.5 bar). */
const val NORMAL_MAX_PA: Double = 350_000.0

/** Soft-warning lower bound — web `SOFT_LOW_PA` (2.0 bar). */
const val SOFT_LOW_PA: Double = 200_000.0

/** Soft-warning upper bound — web `SOFT_HIGH_PA` (4.0 bar). */
const val SOFT_HIGH_PA: Double = 400_000.0

/** The gauge sweep ceiling — web `GAUGE_MAX_PA` (5.0 bar). */
const val GAUGE_MAX_PA: Double = 500_000.0

private const val PA_ALREADY = 50_000.0
private const val PA_FROM_KPA = 100.0
private const val PA_FROM_PSI = 10.0
private const val KPA_TO_PA = 1_000.0
private const val PSI_TO_PA = 6_894.757
private const val BAR_TO_PA = 100_000.0
private const val PA_PER_KPA = 1_000.0

/**
 * Interim adapter that coerces a raw TPMS value to Pa — the verbatim port of the web `normaliseTpmsToPa`. When a
 * vehicle lacks a `vehicle_unit_history` row the codec cannot run `units.ToSI`, so the raw bar/psi/kPa value reaches
 * the API; this detects the plausible source unit by value range and normalizes to Pa so the gauges render accurate
 * readings today (a `0`/null/non-finite reading collapses to `0`).
 */
fun normaliseTpmsToPa(raw: Double?): Double {
    if (raw == null || !raw.isFinite() || raw <= 0.0) return 0.0
    return when {
        raw >= PA_ALREADY -> raw
        raw >= PA_FROM_KPA -> raw * KPA_TO_PA
        raw >= PA_FROM_PSI -> raw * PSI_TO_PA
        else -> raw * BAR_TO_PA
    }
}

/** The four corner positions, in the web `TIRE_POSITIONS` order. */
enum class TirePosition { FL, FR, RL, RR }

/** Stable sort-column keys for the history table (web `Column.key`); the four corners share their lower-case ids. */
object TireSortKey {
    const val TIME = "created_at"
    const val FL = "fl"
    const val FR = "fr"
    const val RL = "rl"
    const val RR = "rr"
}

/** The four-level pressure status the per-corner badge shows (web `pressureStatus`). */
enum class PressureStatus { Normal, Low, High, Critical }

/** The three-level gauge color tier the radial gauge sweeps in (web `pressureColor` green/amber/red). */
enum class GaugeTier { Normal, Soft, Critical }

/** The badge tone a [PressureStatus] maps to (web `statusVariant`: normal→success, critical→danger, else→warning). */
enum class StatusTone { Success, Warning, Danger }

/** Maps a Pa pressure to its [PressureStatus] (web `pressureStatus`). */
fun pressureStatus(pa: Double): PressureStatus =
    when {
        pa < SOFT_LOW_PA -> PressureStatus.Critical
        pa < NORMAL_MIN_PA -> PressureStatus.Low
        pa > SOFT_HIGH_PA -> PressureStatus.Critical
        pa > NORMAL_MAX_PA -> PressureStatus.High
        else -> PressureStatus.Normal
    }

/** Maps a Pa pressure to its gauge color tier (web `pressureColor`). */
fun gaugeTier(pa: Double): GaugeTier =
    when {
        pa in NORMAL_MIN_PA..NORMAL_MAX_PA -> GaugeTier.Normal
        pa in SOFT_LOW_PA..SOFT_HIGH_PA -> GaugeTier.Soft
        else -> GaugeTier.Critical
    }

/** Maps a [PressureStatus] to its badge tone (web `statusVariant`). */
fun statusTone(status: PressureStatus): StatusTone =
    when (status) {
        PressureStatus.Normal -> StatusTone.Success
        PressureStatus.Critical -> StatusTone.Danger
        PressureStatus.Low, PressureStatus.High -> StatusTone.Warning
    }

private val LENIENT_JSON = Json { ignoreUnknownKeys = true; isLenient = true }

/**
 * True when a TPMS warning JSON string contains any `true` value — the verbatim port of the web `hasTpmsWarning`. A
 * blank/null value is false; a JSON object with any true member is true; an unparseable non-blank string is true
 * unless it is the literal `"false"` (the web fallback).
 */
fun hasTpmsWarning(value: String?): Boolean {
    if (value.isNullOrEmpty()) return false
    val parsed = runCatching { LENIENT_JSON.parseToJsonElement(value) as? JsonObject }.getOrNull()
    if (parsed != null) {
        return parsed.values.any { (it as? JsonPrimitive)?.booleanOrNull == true }
    }
    return value != "false" && value.isNotEmpty()
}

/**
 * One decoded tire-pressure row — the native analogue of the web `TirePressureReading`. The four corner pressures are
 * SI Pascals already normalized through [normaliseTpmsToPa]; the warning strings keep their raw JSON so the
 * truthiness check matches the web, and [createdAt] keeps its raw ISO string so the render layer localizes it.
 */
data class TirePressureReading(
    val id: Long,
    val frontLeftPa: Double,
    val frontRightPa: Double,
    val rearLeftPa: Double,
    val rearRightPa: Double,
    val tpmsHardWarnings: String?,
    val tpmsSoftWarnings: String?,
    val createdAt: String,
) {
    /** The normalized Pa value for [pos] (web `getTirePressureValue`). */
    fun pressurePa(pos: TirePosition): Double =
        when (pos) {
            TirePosition.FL -> frontLeftPa
            TirePosition.FR -> frontRightPa
            TirePosition.RL -> rearLeftPa
            TirePosition.RR -> rearRightPa
        }

    /** True when either TPMS warning string is truthy (web `hasTpmsWarning(hard) || hasTpmsWarning(soft)`). */
    val hasAnyWarning: Boolean get() = hasTpmsWarning(tpmsHardWarnings) || hasTpmsWarning(tpmsSoftWarnings)
}

/** The mean / min corner pressure (Pa) + the count of corners outside the normal band (web `summaryStats`). */
data class TireSummary(
    val avgPa: Double,
    val minPa: Double,
    val warningCount: Int,
)

/**
 * The decoded two-read snapshot the page renders — the native analogue of the web page's combined
 * `latest` + `history` state. [latest] is the most-recent reading (null before it loads / when absent); [historyAsc]
 * is the chronological (oldest-first) history the chart + table share; [historyLoading] / [historyError] carry the
 * history feed's own lifecycle so the chart/table show their own loading/empty surfaces independently of the page.
 */
data class TirePressureSnapshot(
    val latest: TirePressureReading?,
    val historyAsc: List<TirePressureReading>,
    val historyLoading: Boolean,
    val historyError: Boolean,
) {
    /** The warning-banner gate (web `hasTpmsWarning(latest?.hard) || hasTpmsWarning(latest?.soft)`). */
    val hasWarning: Boolean get() = latest?.hasAnyWarning == true

    /** True when the latest reading reports a hard TPMS warning (web `hasTpmsWarning(latest?.tpms_hard_warnings)`). */
    val hasHardWarning: Boolean get() = hasTpmsWarning(latest?.tpmsHardWarnings)

    /** The summary scalars derived from the four latest corner pressures, or null before a reading loads. */
    val summary: TireSummary?
        get() {
            val reading = latest ?: return null
            val values = TirePosition.entries.map { reading.pressurePa(it) }
            val avg = values.sum() / values.size
            val min = values.min()
            val warnings = values.count { it < NORMAL_MIN_PA || it > NORMAL_MAX_PA }
            return TireSummary(avg, min, warnings)
        }

    /** The newest history timestamp (web `lastUpdatedAt`), or null when the window is empty. */
    val lastUpdatedAt: String? get() = historyAsc.lastOrNull()?.createdAt

    companion object {
        /** The empty snapshot, surfaced before any read lands. */
        val EMPTY: TirePressureSnapshot = TirePressureSnapshot(null, emptyList(), historyLoading = false, historyError = false)
    }
}

/**
 * Orders the history [rows] by the active column [key] (one of [TireSortKey]) and direction — the native analogue of
 * the web `useSortToggle` + `sortFn` with its numeric corner accessors (corners sort by Pa magnitude, not badge
 * label). An unknown / null key leaves the order untouched. Pure + framework-free so it runs in the JVM gate.
 */
fun sortReadings(
    rows: List<TirePressureReading>,
    key: String?,
    descending: Boolean,
): List<TirePressureReading> {
    val comparator: Comparator<TirePressureReading> =
        when (key) {
            TireSortKey.TIME -> compareBy { it.createdAt }
            TireSortKey.FL -> compareBy { it.pressurePa(TirePosition.FL) }
            TireSortKey.FR -> compareBy { it.pressurePa(TirePosition.FR) }
            TireSortKey.RL -> compareBy { it.pressurePa(TirePosition.RL) }
            TireSortKey.RR -> compareBy { it.pressurePa(TirePosition.RR) }
            else -> return rows
        }
    val sorted = rows.sortedWith(comparator)
    return if (descending) sorted.asReversed() else sorted
}

/**
 * The user's display preferences this surface needs — the pressure unit (bar/psi/kPa) + the locale used for
 * grouped-number + localized date/time formatting. Resolved from the `/settings` document exactly like the web
 * `useUnits()` (web `unitPrefs.pressure`) + `useFormatting()` locale. All pressure math goes through the shared
 * `convertPressureFromSI`; nothing here stores a non-SI value.
 */
data class TireDisplayPrefs(
    val pressureUnit: PressureUnitPref,
    val locale: Locale,
) {
    /** The pressure unit label shown beside values + on the gauge (web `pressureUnit`). */
    val unitLabel: String get() = pressureUnit.label

    /** Converts an SI Pascal pressure to the user's display unit number (web `convertPressureFromSI(pa / 1000, unit)`). */
    fun displayValue(pa: Double): Double = convertPressureFromSI(pa / PA_PER_KPA, pressureUnit)

    /** The display pressure as a localized number, one fraction digit (web `fmtNumber(displayValue)`). */
    fun pressureText(pa: Double): String = ChartFormat.number(displayValue(pa), PRESSURE_DECIMALS, locale)

    /** The display pressure with its unit suffix (web `${fmtNumber(displayValue)} ${pressureUnit}`). */
    fun pressureWithUnit(pa: Double): String = "${pressureText(pa)} $unitLabel"

    /** A whole count rendered verbatim (web `summaryStats.warningCount` passed straight to the MetricCard). */
    fun count(value: Int): String = value.toString()

    /** A localized medium date + short time for the chart axis / table / "Last Updated" (web `formatDateTime`). */
    fun dateTime(raw: String?): String {
        if (raw.isNullOrBlank()) return EM_DASH
        val parsed = runCatching { OffsetDateTime.parse(raw) }.getOrNull() ?: return raw
        val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale)
        return parsed.toLocalDateTime().format(formatter)
    }

    companion object {
        /** The metric default used before settings load (web default pressure = bar, locale en-US). */
        val DEFAULT: TireDisplayPrefs = TireDisplayPrefs(PressureUnitPref.BAR, Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits` + `useFormatting`). */
        fun fromSettings(settings: JsonElement?): TireDisplayPrefs {
            val pref: UnitPref = UnitPreferences.fromSettings(settings)
            val locale =
                pref.locale
                    ?.takeIf { it.isNotBlank() }
                    ?.let(Locale::forLanguageTag)
                    ?: Locale.US
            return TireDisplayPrefs(pressureUnit = pref.pressure, locale = locale)
        }
    }
}

/**
 * Identity of the surface for the navigation registry + diagnostics — the native mirror of the web `TirePressurePage`
 * route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("tirePressure", "/tire-pressure", …)`, so the host binds this surface to that destination without the nav
 * module depending on it.
 */
object TirePressurePageRegistration {
    /** The navigation destination id (Destinations.kt `page("tirePressure", "/tire-pressure", …)`). */
    const val ROUTE_ID: String = "tirePressure"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/tire-pressure"

    /** Diagnostics surface slug emitted with the `view.opened` event. Carries no vehicle id. */
    const val SLUG: String = "TirePressurePage"
}

/**
 * Decodes the raw `/tire-pressure/latest` [json] envelope into a [TirePressureReading], or null when the payload is
 * absent / not an object (web `!latest` → zero gauges). Each corner pressure is normalized to Pa through
 * [normaliseTpmsToPa]; missing scalars collapse to `0` exactly like the web optional reads.
 */
fun parseTirePressureLatest(json: JsonElement?): TirePressureReading? {
    val row = json as? JsonObject ?: return null
    if (row.isEmpty()) return null
    return row.toReading(0L)
}

/**
 * Decodes the raw `/tire-pressure` history [json] array into chronological (oldest-first) [TirePressureReading]s — the
 * native analogue of the web `historyAsc` sort. A non-array payload yields an empty list; rows are sorted by
 * `created_at` ascending so the chart draws left=oldest and the "Last Updated" label reads the newest.
 */
fun parseTirePressureHistory(json: JsonElement?): List<TirePressureReading> {
    val array = json as? JsonArray ?: return emptyList()
    return array
        .mapIndexedNotNull { index, element ->
            (element as? JsonObject)?.toReading(index.toLong())
        }.sortedBy { it.createdAt }
}

private fun JsonObject.toReading(fallbackId: Long): TirePressureReading =
    TirePressureReading(
        id = longField("id") ?: fallbackId,
        frontLeftPa = normaliseTpmsToPa(doubleField("front_left")),
        frontRightPa = normaliseTpmsToPa(doubleField("front_right")),
        rearLeftPa = normaliseTpmsToPa(doubleField("rear_left")),
        rearRightPa = normaliseTpmsToPa(doubleField("rear_right")),
        tpmsHardWarnings = stringField("tpms_hard_warnings"),
        tpmsSoftWarnings = stringField("tpms_soft_warnings"),
        createdAt = stringField("created_at") ?: "",
    )

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TirePressurePageRegistration.SLUG]. Kept free of
 * Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition. Carries no
 * vehicle id / pressure figure / location payload.
 */
fun recordTirePressureOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TirePressurePageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.longField(key: String): Long? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return primitive.longOrNull ?: primitive.contentOrNull?.toLongOrNull()
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
