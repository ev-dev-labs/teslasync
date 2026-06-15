// Pure, framework-free model + projections for the RegenEfficiencyPage driving surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/driving/pages/RegenEfficiencyPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core SI
// [Drive] DTO, the shared SI converters, and the framework-free ChartFormat number helper), so the composable stays a
// thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page reads two sources: the backend-side `useRegenEfficiency` analytics envelope (`GET /analytics/regen`,
// which powers the hero gauge + the six stat cards + the four metric bars) and the client-side `useDrives` feed (which
// it narrows to the picked window and folds into the monthly-regen-trend composed chart + the recent-regen-drives
// table). This file ports both: the JSON decode of the analytics envelope ([parseRegenAnalytics]) and the verbatim
// `useMemo` derivations over the windowed drives ([monthlyTrend]/[recentRegenDrives] + [regenRatioOf]).
//
// SI boundary (unit-conversion.instructions): the aggregation stays SI end to end (meters, Wh, watts); the only display
// conversion lives in the explicit [RegenDisplayPrefs] helpers used at the render boundary (`convertDistanceFromSI` +
// the shared `formatEnergy`/`formatPower` + `convertEnergyFromSI`), exactly as the web page converts only inside its
// `toDistanceDisplay`/`formatEnergy`/`formatPower` callbacks (Phase-48 SI-canonical rule; ADR-013 keeps the cache SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.regenefficiency

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertEnergyFromSI
import io.teslasync.shared.core.units.formatEnergy
import io.teslasync.shared.core.units.formatPower
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `RegenEfficiencyPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("regenEfficiency", "/regen-efficiency", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface
 * to that destination (and its `/regen-efficiency` deep link) without the nav module depending on it.
 */
object RegenEfficiencyPageRegistration {
    /** The navigation destination id (Destinations.kt `page("regenEfficiency", "/regen-efficiency", …)`). */
    const val ROUTE_ID: String = "regenEfficiency"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/regen-efficiency"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/drive id. */
    const val SLUG: String = "RegenEfficiencyPage"

    /** The recent-regen-drives table caps at the 20 most-recent drives (web `.slice(0, 20)`). */
    const val RECENT_DRIVES_LIMIT: Int = 20

    /** The monthly-trend chart keeps the trailing 12 months (web `.slice(-12)`). */
    const val MONTHLY_TREND_MONTHS: Int = 12

    /** The lower bound for the default "all time" range (web `resolveAllTimeStart` fallback `2015-01-01`). */
    val ALL_TIME_START: LocalDate = LocalDate.of(2015, 1, 1)
}

/* ------------------------------------------------------------------ */
/*  Date range                                                        */
/* ------------------------------------------------------------------ */

/**
 * The inclusive `[start, end]` date window the page reads — the native mirror of the web `useRangeState` value
 * (`{ start, end }` ISO `YYYY-MM-DD` strings). It scopes the backend `/analytics/regen` read and narrows the
 * client-side drives feed that powers the trend chart + recent-drives table. Defaults to the web `defaultPresetId:
 * 'all'` window (a wide lower bound through today) so the first frame shows everything.
 */
data class RegenRange(
    val start: LocalDate,
    val end: LocalDate,
) {
    /** The `start` query value (`YYYY-MM-DD`) for `GET /analytics/regen` (web `params.set('start', start)`). */
    val startParam: String get() = start.toString()

    /** The `end` query value (`YYYY-MM-DD`) for `GET /analytics/regen` (web `params.set('end', end)`). */
    val endParam: String get() = end.toString()

    companion object {
        /** The web `'all'` preset: a 2015-01-01 lower bound through [today]. */
        fun allTime(today: LocalDate = LocalDate.now()): RegenRange =
            RegenRange(RegenEfficiencyPageRegistration.ALL_TIME_START, today)
    }
}

/* ------------------------------------------------------------------ */
/*  Analytics envelope (GET /analytics/regen)                         */
/* ------------------------------------------------------------------ */

/**
 * The decoded `/analytics/regen` payload — the native analogue of the web `RegenEfficiencyData` interface the hero
 * gauge, the six stat cards, and the four metric bars read (internal/api/regen/handler.go). Every figure is raw on the
 * wire (SI watt-hours / watts / a 0–100 percentage / a count), converted/formatted only at the render boundary.
 * [present] mirrors the web `data ?` truthiness guard: a missing / empty object (the no-vehicle scope) routes to the
 * friendly `regen.noData` empty surface instead of a grid of zeros.
 */
data class RegenEfficiencyAnalytics(
    val present: Boolean,
    val totalRegenWh: Double,
    val totalDriveWh: Double,
    val regenRatio: Double,
    val monthlyAvgRegen: Double,
    val freeCharges: Double,
) {
    companion object {
        /** The "no payload" snapshot, surfaced for a null / non-object / empty body (and the no-vehicle scope). */
        val ABSENT: RegenEfficiencyAnalytics = RegenEfficiencyAnalytics(false, 0.0, 0.0, 0.0, 0.0, 0.0)
    }
}

/**
 * Decodes the raw `/analytics/regen` [json] (SI, snake_case on the wire) into a [RegenEfficiencyAnalytics]. A
 * non-object input or an empty object (the synthetic no-vehicle payload) yields [RegenEfficiencyAnalytics.ABSENT]; a
 * missing or JSON-null field collapses to zero — reproducing the web optional reads (`data.totalRegenWh ?? 0`).
 */
fun parseRegenAnalytics(json: JsonElement?): RegenEfficiencyAnalytics {
    val obj = json as? JsonObject ?: return RegenEfficiencyAnalytics.ABSENT
    if (obj.isEmpty()) return RegenEfficiencyAnalytics.ABSENT
    return RegenEfficiencyAnalytics(
        present = true,
        totalRegenWh = obj.double("total_regen_wh"),
        totalDriveWh = obj.double("total_drive_wh"),
        regenRatio = obj.double("regen_ratio"),
        monthlyAvgRegen = obj.double("monthly_avg_regen"),
        freeCharges = obj.double("free_charges"),
    )
}

/* ------------------------------------------------------------------ */
/*  Drive-derived projections (useDrives)                             */
/* ------------------------------------------------------------------ */

/** One point in the monthly-regen-trend composed chart — the web `monthlyTrend[]` row. */
data class RegenMonthlyPoint(
    /** The `YYYY-MM` bucket key (web `d.startTs.substring(0, 7)`, UTC). */
    val month: String,
    /** Total regen for the month in kWh, rounded to 1 decimal (web `parseFloat(fmtNumber(totalRegen / 1000, 1))`). */
    val regenKwh: Double,
    /** The number of drives in the month (web `count`). */
    val drives: Int,
    /** Total distance for the month in the user's display unit, rounded (web `Math.round(toDistanceDisplay(...))`). */
    val distance: Int,
)

/** One row in the recent-regen-drives table — the web `regenDrives[]` row (already display-formatted). */
data class RegenDriveRow(
    val id: Long,
    /** The drive's short local date (web `formatDateShort(d.startTs)`). */
    val date: String,
    /** The drive's distance in the user's display unit + unit (web `fmtWithUnit(toDistanceDisplay(...), distanceUnit)`). */
    val distance: String,
    /** The drive's recovered energy in kWh + unit (web `fmtWithUnit(d.regenEnergyWh / 1000, 'kWh')`). */
    val maxRegen: String,
    /** The drive's regen ratio (0–100), or `null` when the inputs are missing (web `getRegenRatio`); colors the cell. */
    val ratioPercent: Double?,
    /** The formatted ratio cell — `fmtPercent(ratio)` or the em dash when [ratioPercent] is null (web `ratio ? … : '—'`). */
    val ratioLabel: String,
)

/**
 * Per-drive regen ratio (0–100) — the verbatim port of the web `getRegenRatio`. `null` when the drive lacks a positive
 * average power or a positive recovered/used energy pair, so callers render the em dash and skip it in coloring.
 */
fun regenRatioOf(drive: Drive): Double? {
    val power = drive.avgPowerW ?: 0.0
    if (power <= 0.0) return null
    val regen = drive.regenEnergyWh ?: 0.0
    val used = drive.energyUsedWh ?: 0.0
    if (regen <= 0.0 || used <= 0.0) return null
    return (regen / used) * PERCENT
}

/**
 * Narrows [drives] to the inclusive `[range.start 00:00, range.end 23:59:59.999]` window in [zone] — the web
 * `allDrives.filter` that keeps the client-side trend + table in sync with the backend-side gauges/cards. A drive with
 * an unparseable timestamp is dropped (web `if (!d.startTs) return false`).
 */
fun filterDrivesToRange(
    drives: List<Drive>,
    range: RegenRange,
    zone: ZoneId,
): List<Drive> {
    val startMs = range.start.atStartOfDay(zone).toInstant().toEpochMilli()
    val endMs = range.end.atTime(END_OF_DAY).atZone(zone).toInstant().toEpochMilli()
    return drives.filter { drive ->
        val t = runCatching { drive.startTs.toEpochMilliseconds() }.getOrNull() ?: return@filter false
        t in startMs..endMs
    }
}

/**
 * Buckets [drives] by their UTC `YYYY-MM` month, summing recovered energy + distance + count, then keeps the trailing
 * 12 months ascending — the verbatim port of the web `monthlyTrend` `useMemo`. Distances are converted to the user's
 * display unit via [prefs]; the regen total is rounded to 1 decimal kWh exactly like the web.
 */
fun monthlyTrend(
    drives: List<Drive>,
    prefs: RegenDisplayPrefs,
): List<RegenMonthlyPoint> {
    if (drives.isEmpty()) return emptyList()
    val byMonth = LinkedHashMap<String, MonthAccumulator>()
    drives.forEach { drive ->
        val month = utcMonthKey(drive) ?: return@forEach
        val acc = byMonth.getOrPut(month) { MonthAccumulator() }
        acc.totalRegenWh += drive.regenEnergyWh ?: 0.0
        acc.count += 1
        acc.totalDistM += drive.distanceM
    }
    return byMonth.entries
        .sortedBy { it.key }
        .takeLast(RegenEfficiencyPageRegistration.MONTHLY_TREND_MONTHS)
        .map { (month, acc) ->
            RegenMonthlyPoint(
                month = month,
                regenKwh = roundToTenth(acc.totalRegenWh / WH_PER_KWH),
                drives = acc.count,
                distance = Math.round(prefs.toDistanceDisplay(acc.totalDistM)).toInt(),
            )
        }
}

/**
 * Projects the drives that recovered energy into the recent-regen-drives table rows, capped at the 20 most-recent —
 * the verbatim port of the web `regenDrives` `useMemo`. All display conversion happens here via [prefs]; dates are
 * formatted in [zone] with the user's locale.
 */
fun recentRegenDrives(
    drives: List<Drive>,
    prefs: RegenDisplayPrefs,
    zone: ZoneId,
): List<RegenDriveRow> =
    drives
        .filter { (it.regenEnergyWh ?: 0.0) > 0.0 }
        .take(RegenEfficiencyPageRegistration.RECENT_DRIVES_LIMIT)
        .map { drive ->
            val ratio = regenRatioOf(drive)
            RegenDriveRow(
                id = drive.id,
                date = shortDate(drive, zone, prefs.locale),
                distance = prefs.withUnit(prefs.toDistanceDisplay(drive.distanceM), prefs.distanceLabel),
                maxRegen = prefs.kwhWithUnit(drive.regenEnergyWh ?: 0.0),
                ratioPercent = ratio,
                ratioLabel = ratio?.let { prefs.percent(it) } ?: EM_DASH,
            )
        }

private class MonthAccumulator {
    var totalRegenWh: Double = 0.0
    var count: Int = 0
    var totalDistM: Double = 0.0
}

private fun utcMonthKey(drive: Drive): String? =
    runCatching {
        Instant.ofEpochMilli(drive.startTs.toEpochMilliseconds())
            .atZone(ZoneOffset.UTC)
            .format(MONTH_KEY_FORMAT)
    }.getOrNull()

private fun shortDate(
    drive: Drive,
    zone: ZoneId,
    locale: Locale,
): String =
    runCatching {
        Instant.ofEpochMilli(drive.startTs.toEpochMilliseconds())
            .atZone(zone)
            .toLocalDate()
            .format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
    }.getOrDefault(EM_DASH)

private fun roundToTenth(value: Double): Double =
    if (value.isFinite()) Math.round(value * TENTHS) / TENTHS else 0.0

/* ------------------------------------------------------------------ */
/*  Display preferences (useUnits / useFormatting)                    */
/* ------------------------------------------------------------------ */

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the `/settings`
 * document: the distance unit (the table + monthly-distance figures), and the energy/power formatters + locale used by
 * the gauge caption, the stat cards, and the metric bars. The backend stores and serves SI; this is the single place a
 * preference becomes a display unit so the SI source is never stored converted (Phase-48; ADR-013 keeps the cache SI).
 */
data class RegenDisplayPrefs(
    val unitPref: UnitPref,
) {
    /** The user's locale for grouped-number formatting (web `_globalLocale`, en-US fallback). */
    val locale: Locale =
        runCatching { Locale.forLanguageTag(unitPref.locale ?: DEFAULT_LOCALE) }.getOrDefault(Locale.US)

    /** The user's default fraction digits (web `_globalPrecision`, floored & non-negative, else 2). */
    val precision: Int = unitPref.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION

    /** The distance unit preference (web `unitPrefs.distance`). */
    val distanceUnit: DistanceUnitPref get() = unitPref.distance

    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = unitPref.distance.label

    /** SI meters → the user's display distance (web `toDistanceDisplay` / `convertDistanceFromSI`). */
    fun toDistanceDisplay(meters: Double): Double = convertDistanceFromSI(meters, unitPref.distance)

    /** SI watt-hours → the user's display energy string with unit, e.g. "12.3 kWh" (web `formatEnergy`). */
    fun energy(
        wh: Double,
        precision: Int? = null,
    ): String = formatEnergy(wh, unitPref, precision)

    /** SI watts → the user's display power string with unit, e.g. "5.0 kW" (web `formatPower`). */
    fun power(
        watts: Double,
        precision: Int? = null,
    ): String = formatPower(watts, unitPref, precision)

    /** SI watt-hours → a bare kWh number with [decimals] digits (no unit), for the "kWh"-suffixed gauge caption. */
    fun energyKwhBare(
        wh: Double,
        decimals: Int,
    ): String = number(convertEnergyFromSI(wh, unitPref.energy), decimals)

    /** SI watt-hours → a kWh number + literal "kWh" unit (web table `fmtWithUnit(d.regenEnergyWh / 1000, 'kWh')`). */
    fun kwhWithUnit(
        wh: Double,
        decimals: Int = precision,
    ): String = withUnit(convertEnergyFromSI(wh, EnergyUnitPref.KWH), KWH_LABEL, decimals)

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`); defaults to the user's precision. */
    fun number(
        value: Double,
        decimals: Int = precision,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped percentage in the user's locale (web `fmtPercent(value)`). */
    fun percent(
        value: Double,
        decimals: Int = precision,
    ): String = "${ChartFormat.number(value, decimals, locale)}%"

    /** Grouped number + a trailing [unit] (web `fmtWithUnit(value, unit)`). */
    fun withUnit(
        value: Double,
        unit: String,
        decimals: Int = precision,
    ): String = "${ChartFormat.number(value, decimals, locale)} $unit"

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        fun default(): RegenDisplayPrefs = RegenDisplayPrefs(UnitPreferences.fromSettings(null))

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): RegenDisplayPrefs =
            RegenDisplayPrefs(UnitPreferences.fromSettings(settings))
    }
}

/* ------------------------------------------------------------------ */
/*  Diagnostics + Resource mapping                                    */
/* ------------------------------------------------------------------ */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RegenEfficiencyPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, distance, or energy payload.
 */
fun recordRegenEfficiencyPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to RegenEfficiencyPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private const val DEFAULT_LOCALE = "en-US"
private const val DEFAULT_PRECISION = 2
private const val PERCENT = 100.0
private const val WH_PER_KWH = 1000.0
private const val TENTHS = 10.0
private const val KWH_LABEL = "kWh"
private const val EM_DASH = "\u2014"
private val END_OF_DAY = java.time.LocalTime.of(23, 59, 59, 999_000_000)
private val MONTH_KEY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM")
