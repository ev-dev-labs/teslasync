// Pure, framework-free model + projections for the EfficiencyPage driving surface — the native analogue of everything
// the web page derives before composing its panels (web/src/features/driving/pages/EfficiencyPage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core SI [Drive] DTO, the
// shared SI converters/formatters, the framework-free [ChartFormat] number helper and the [UnitPreferences] resolver),
// so the composable stays a thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest
// gate.
//
// The web page threads its loaded `drives` array through a `useMemo` chain — date-range filter ▸ daily efficiency
// trend ▸ speed-vs-efficiency scatter ▸ temp-vs-efficiency scatter ▸ speed-range distribution ▸ temperature-bucketed
// table — plus the `useDrivingStats` aggregate that drives the hero gauges, the four stat cards, the metric bars and
// the energy-insights grid. This file ports that whole fold verbatim, so the screen only resolves i18n + draws.
//
// SI boundary (unit-conversion.instructions / Phase-48 SI-canonical): per-drive efficiency stays Wh/km, distance metres,
// speed m/s, temperature °C end to end; the only display conversion lives in the explicit [EfficiencyDisplayPrefs]
// helpers used at the render boundary ([convertDistanceFromSI]/[convertSpeedFromSI]/[convertTempFromSI] + the
// Wh/km→Wh/mi efficiency factor + the shared `formatEnergy`/`formatDuration`), exactly as the web converts only inside
// its `toDistanceDisplay`/`toSpeedDisplay`/`toEfficiencyDisplay`/`formatEnergy`/`formatDuration` callbacks.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.efficiency

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import io.teslasync.shared.core.units.convertTempFromSI
import io.teslasync.shared.core.units.formatDuration as siFormatDuration
import io.teslasync.shared.core.units.formatEnergy as siFormatEnergy
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.floor

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `EfficiencyPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("efficiency", "/efficiency", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/efficiency` deep link) without the nav module depending on it.
 */
object EfficiencyPageRegistration {
    /** The navigation destination id (Destinations.kt `page("efficiency", "/efficiency", …)`). */
    const val ROUTE_ID: String = "efficiency"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/efficiency"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/drive id. */
    const val SLUG: String = "EfficiencyPage"

    /** The web default range: `now()` minus this many days (`d.setDate(d.getDate() - 30)`). */
    const val DEFAULT_RANGE_DAYS: Long = 30

    /** The web `dailyTrend` cap (`.slice(0, 30)`). */
    const val TREND_LIMIT: Int = 30

    /** The web gate to render the daily-trend area chart (`dailyTrend.length > 2`). */
    const val MIN_TREND_POINTS: Int = 2

    /** The web gate to render either scatter (`*.length > 3`). */
    const val MIN_SCATTER_POINTS: Int = 3
}

/** Em dash shown for a missing value (web `'—'`). */
const val EFFICIENCY_EM_DASH: String = "\u2014"

/** Radial-gauge ceiling for the average-consumption hero (web `RadialGauge max={300}`). */
const val EFFICIENCY_GAUGE_MAX: Double = 300.0

/** Metric-bar ceilings (web `MetricBar max`). */
const val CONSUMPTION_BAR_MAX: Double = 300.0
const val SPEED_BAR_MAX: Double = 150.0
const val REGEN_BAR_MAX: Double = 100.0

/** The web drive-time bar floor (`Math.max(stats.totalDurationS, 36000)`). */
const val DRIVE_TIME_FLOOR_S: Double = 36000.0

/** The web estimated tariff for the cost-per-km figure (`(whKm / 1000) * 0.12`). */
private const val COST_PER_KWH: Double = 0.12

/** 1 mile = 1609.344 m exactly — the web `whPerKm * 1.609344` Wh/km → Wh/mi factor. */
private const val WH_PER_KM_TO_WH_PER_MI: Double = 1.609344

/** 1 kWh = 1000 Wh — the web `1000 / whPerKm` (km/kWh) + `whKm / 1000` (cost) bridge. */
private const val WH_PER_KWH: Double = 1000.0

/** The web `getEfficiency` battery-to-energy factor (`battUsed * 0.75`). */
private const val USABLE_PACK_FACTOR: Double = 0.75

/** Default number/percentage fraction digits (web `_globalPrecision` fallback). */
private const val DEFAULT_PRECISION: Int = 2

/** Percent scaling for regen ratio (web `regenRatio * 100`). */
private const val PERCENT_SCALE: Double = 100.0

/** Efficiency-tier thresholds in Wh/km (web `efficiencyColor`). */
private const val EFF_EXCELLENT_MAX: Double = 140.0
private const val EFF_GOOD_MAX: Double = 170.0
private const val EFF_FAIR_MAX: Double = 200.0
private const val EFF_POOR_MAX: Double = 240.0

/** Speed-range bucket bounds in the user's display speed (web `speedDist` buckets). */
private const val SPEED_B1: Double = 30.0
private const val SPEED_B2: Double = 60.0
private const val SPEED_B3: Double = 90.0
private const val SPEED_B4: Double = 120.0
private const val SPEED_BUCKET_OPEN: Double = 999.0

/** Temperature bucket bounds in SI Celsius (web `tempBuckets` ranges, same °C bounds for °C/°F labels). */
private const val TEMP_OPEN_LO: Double = -999.0
private const val TEMP_B0: Double = 0.0
private const val TEMP_B10: Double = 10.0
private const val TEMP_B20: Double = 20.0
private const val TEMP_B30: Double = 30.0
private const val TEMP_OPEN_HI: Double = 999.0

// ── Efficiency tier (web `efficiencyColor` — render maps a tier to a design-token Color) ─────────────────────────

/**
 * The five efficiency tiers the web `efficiencyColor(wh)` maps to (lower Wh/km is better). Framework-free so the
 * thresholds are JVM-tested; the page maps each tier to a design-token [androidx.compose.ui.graphics.Color]
 * (ADR-005 — no hardcoded hex in the surface).
 */
enum class EfficiencyTier { Excellent, Good, Fair, Poor, Bad }

/** Maps a raw SI efficiency (Wh/km) to its [EfficiencyTier] — the verbatim web `efficiencyColor` thresholds. */
fun efficiencyTier(whPerKm: Double): EfficiencyTier =
    when {
        whPerKm < EFF_EXCELLENT_MAX -> EfficiencyTier.Excellent
        whPerKm < EFF_GOOD_MAX -> EfficiencyTier.Good
        whPerKm < EFF_FAIR_MAX -> EfficiencyTier.Fair
        whPerKm < EFF_POOR_MAX -> EfficiencyTier.Poor
        else -> EfficiencyTier.Bad
    }

/**
 * Per-drive efficiency in Wh/km — the verbatim port of the web `getEfficiency`. `null` when the drive lacks the
 * inputs (no positive battery delta, zero distance), so callers skip it in arithmetic.
 */
fun getEfficiency(drive: Drive): Double? {
    val batteryUsed = 1.0 * (drive.startBatteryPct ?: 0L) - 1.0 * (drive.endBatteryPct ?: 0L)
    if (drive.distanceM > 0.0 && batteryUsed > 0.0) {
        return (batteryUsed * USABLE_PACK_FACTOR * WH_PER_KWH) / (drive.distanceM / WH_PER_KWH)
    }
    return null
}

// ── Aggregate stats (web useDrivingStats → DrivingStats) ─────────────────────────────────────────────────────────

/**
 * The decoded `/drives/stats` aggregate (web `DrivingStats`). Carried as raw SI [JsonElement] by the shared driving
 * repository (no generated DTO), so this is the surface's own null-safe decode. [hasData] gates the stats-driven
 * panels exactly as the web `stats ?` truthiness does: a JSON-null / empty body resolves to the no-stats empty state.
 *
 * Field names mirror the web `DrivingStats` interface; the unit-suffixed names (`*Km`, `*Kmh`, `*WhKm`) are carried
 * verbatim so the same display conversions the web applies (e.g. `toDistanceDisplay(stats.totalDistanceKm)`) reproduce
 * the identical figures.
 */
data class EfficiencyStats(
    val hasData: Boolean,
    val totalDrives: Int,
    val totalDistanceKm: Double,
    val totalDurationS: Double,
    val avgEfficiencyWhKm: Double,
    val avgSpeedKmh: Double,
    val topSpeedKmh: Double,
    val regenRatio: Double,
    val regenEnergyWh: Double,
    val co2SavedKg: Double,
) {
    companion object {
        /** The no-stats sentinel — every panel that gates on it renders its empty surface (web `!stats`). */
        val EMPTY: EfficiencyStats = EfficiencyStats(false, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    }
}

/** Decodes the raw `/drives/stats` body into [EfficiencyStats]; a non-object / empty body resolves to [EfficiencyStats.EMPTY]. */
fun parseEfficiencyStats(json: JsonElement): EfficiencyStats {
    val obj = json as? JsonObject ?: return EfficiencyStats.EMPTY
    if (obj.isEmpty()) return EfficiencyStats.EMPTY
    return EfficiencyStats(
        hasData = true,
        totalDrives = obj.int("total_drives"),
        totalDistanceKm = obj.double("total_distance_km"),
        totalDurationS = obj.double("total_duration_s"),
        avgEfficiencyWhKm = obj.double("avg_efficiency_wh_km"),
        avgSpeedKmh = obj.double("avg_speed_kmh"),
        topSpeedKmh = obj.double("top_speed_kmh"),
        regenRatio = obj.double("regen_ratio"),
        regenEnergyWh = obj.double("regen_energy_wh"),
        co2SavedKg = obj.double("co2_saved_kg"),
    )
}

// ── Display preferences (web useUnits / useSettings) ─────────────────────────────────────────────────────────────

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits`/`useSettings` reads from
 * the `/settings` document: the [distanceUnit] (distances + the Wh/km↔Wh/mi efficiency unit), the [speedUnit], the
 * [temperatureUnit] (the °C/°F bucket labels), the number [precision] (web `_globalPrecision`) and the [locale] used
 * for grouped-number formatting. SI input only — every helper converts at the render boundary, never stores converted.
 */
data class EfficiencyDisplayPrefs(
    val unitPref: UnitPref,
    val precision: Int,
    val locale: Locale,
) {
    val distanceUnit: DistanceUnitPref get() = unitPref.distance
    val speedUnit: SpeedUnitPref get() = unitPref.speed
    val temperatureUnit: TemperatureUnitPref get() = unitPref.temperature

    /** The distance unit's display label (e.g. "km" / "mi"). */
    val distanceLabel: String get() = unitPref.distance.label

    /** The speed unit's display label (e.g. "km/h" / "mph") — web `speedUnit`. */
    val speedLabel: String get() = unitPref.speed.label

    /** The temperature unit's display label (e.g. "°C" / "°F") — web `tempUnit`. */
    val temperatureLabel: String get() = unitPref.temperature.label

    /** The efficiency unit (web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    val efficiencyUnit: String get() = if (unitPref.distance == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** True when the user reads Fahrenheit (web `isFahrenheit`) — selects the °F bucket labels. */
    val isFahrenheit: Boolean get() = unitPref.temperature == TemperatureUnitPref.FAHRENHEIT

    /** SI metres → the user's display distance (web `toDistanceDisplay`). */
    fun toDistance(meters: Double): Double = convertDistanceFromSI(meters, unitPref.distance)

    /** SI metres-per-second → the user's display speed (web `toSpeedDisplay`). */
    fun toSpeed(mps: Double): Double = convertSpeedFromSI(mps, unitPref.speed)

    /** SI Celsius → the user's display temperature (web `toTemperatureDisplay`). */
    fun toTemperature(celsius: Double): Double = convertTempFromSI(celsius, unitPref.temperature)

    /** Wh/km → the user's display efficiency unit (web `toEfficiencyDisplay`: Wh/km, or Wh/mi via the mile factor). */
    fun toEfficiency(whPerKm: Double): Double =
        if (unitPref.distance == DistanceUnitPref.MI) whPerKm * WH_PER_KM_TO_WH_PER_MI else whPerKm

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(value: Double, decimals: Int): String = ChartFormat.number(value, decimals, locale)

    /** Grouped number at the user's default precision (web `fmtNumber(value)`). */
    fun number(value: Double): String = number(value, precision)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** SI seconds → display duration (web `formatDuration(seconds, { precision })`) via the shared formatter. */
    fun formatDuration(seconds: Double, decimals: Int): String = siFormatDuration(seconds, unitPref, decimals)

    /** SI watt-hours → display energy (web `formatEnergy(wh, { precision })`) via the shared formatter. */
    fun formatEnergy(wh: Double, decimals: Int): String = siFormatEnergy(wh, unitPref, decimals)

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: EfficiencyDisplayPrefs =
            EfficiencyDisplayPrefs(UnitPreferences.fromSettings(null), DEFAULT_PRECISION, Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`/`useSettings`). */
        fun fromSettings(settings: JsonElement?): EfficiencyDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return EfficiencyDisplayPrefs(
                unitPref = unit,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

// ── Derived chart/table series (the web useMemo chain) ───────────────────────────────────────────────────────────

/** One daily-trend sample (web `dailyTrend`): a short date [label] + the rounded display efficiency. */
data class EfficiencyTrendPoint(val label: String, val efficiency: Double)

/** One speed-vs-efficiency scatter sample (web `speedVsEff`), both in the user's display units. */
data class SpeedEfficiencyPoint(val speed: Double, val efficiency: Double)

/** One temperature-vs-efficiency scatter sample (web `tempVsEff`), both in the user's display units. */
data class TempEfficiencyPoint(val temp: Double, val efficiency: Double)

/** One speed-range distribution bar (web `speedDist`): the labelled [range], its rounded avg display efficiency + count. */
data class SpeedRangeBucket(val range: String, val avgEfficiency: Double, val count: Int)

/**
 * One temperature-bucket table row (web `tempBuckets`). [avgEfficiencyWhKm] stays SI (the column converts + colors at
 * render); [totalDistanceDisplay] / [avgSpeedDisplay] are accumulated already-converted exactly as the web does, so the
 * table renders the identical figures.
 */
data class TempBucketRow(
    val range: String,
    val count: Int,
    val avgEfficiencyWhKm: Double,
    val totalDistanceDisplay: Double,
    val avgSpeedDisplay: Double,
)

/** The full derived dataset the page panels read — the output of the web page's `useMemo` chain over `filteredDrives`. */
data class EfficiencyChartData(
    val filteredCount: Int,
    val dailyTrend: List<EfficiencyTrendPoint>,
    val speedVsEfficiency: List<SpeedEfficiencyPoint>,
    val tempVsEfficiency: List<TempEfficiencyPoint>,
    val speedDistribution: List<SpeedRangeBucket>,
    val tempBuckets: List<TempBucketRow>,
) {
    companion object {
        val EMPTY: EfficiencyChartData = EfficiencyChartData(0, emptyList(), emptyList(), emptyList(), emptyList(), emptyList())
    }
}

private data class SpeedBucketAcc(val label: String, val min: Double, val max: Double, var count: Int = 0, var totalEff: Double = 0.0)

private data class TempBucketAcc(
    val label: String,
    val min: Double,
    val max: Double,
    var count: Int = 0,
    var totalEff: Double = 0.0,
    var totalDist: Double = 0.0,
    var totalSpeed: Double = 0.0,
)

/**
 * Folds the loaded `drives` into every series the panels read — the verbatim port of the web page's `filteredDrives`
 * (date-range filter) + `dailyTrend` + `speedVsEff` + `tempVsEff` + `speedDist` + `tempBuckets` `useMemo`s. Stays SI
 * (Wh/km, m/s, °C, m) and converts only through [prefs] at the boundary.
 *
 * @param startEpochDay inclusive lower date bound (web `from`); a drive whose day is below it is dropped.
 * @param endEpochDay inclusive upper date bound (web `to`); a drive whose day is above it is dropped.
 * @param zone the zone used to resolve a drive's calendar day + its trend label (defaults to the device zone).
 */
fun deriveEfficiencyData(
    drives: List<Drive>,
    prefs: EfficiencyDisplayPrefs,
    startEpochDay: Long?,
    endEpochDay: Long?,
    zone: ZoneId = ZoneId.systemDefault(),
): EfficiencyChartData {
    if (drives.isEmpty()) return EfficiencyChartData.EMPTY
    val filtered = drives.filter { driveInRange(it, startEpochDay, endEpochDay, zone) }
    return EfficiencyChartData(
        filteredCount = filtered.size,
        dailyTrend = dailyTrend(filtered, prefs, zone),
        speedVsEfficiency = speedVsEfficiency(filtered, prefs),
        tempVsEfficiency = tempVsEfficiency(filtered, prefs),
        speedDistribution = speedDistribution(filtered, prefs),
        tempBuckets = tempBuckets(filtered, prefs),
    )
}

private fun driveInRange(drive: Drive, startEpochDay: Long?, endEpochDay: Long?, zone: ZoneId): Boolean {
    val day = driveDay(drive, zone) ?: return true
    if (startEpochDay != null && day.toEpochDay() < startEpochDay) return false
    if (endEpochDay != null && day.toEpochDay() > endEpochDay) return false
    return true
}

private fun dailyTrend(drives: List<Drive>, prefs: EfficiencyDisplayPrefs, zone: ZoneId): List<EfficiencyTrendPoint> =
    drives
        .mapNotNull { drive -> getEfficiency(drive)?.let { drive to it } }
        .take(EfficiencyPageRegistration.TREND_LIMIT)
        .reversed()
        .map { (drive, eff) ->
            EfficiencyTrendPoint(
                label = trendLabel(drive, prefs.locale, zone),
                efficiency = roundHalfUp(prefs.toEfficiency(eff)),
            )
        }

private fun speedVsEfficiency(drives: List<Drive>, prefs: EfficiencyDisplayPrefs): List<SpeedEfficiencyPoint> =
    drives.mapNotNull { drive ->
        val speed = drive.avgSpeedMps?.takeIf { it != 0.0 } ?: return@mapNotNull null
        val eff = getEfficiency(drive) ?: return@mapNotNull null
        SpeedEfficiencyPoint(roundHalfUp(prefs.toSpeed(speed)), roundHalfUp(prefs.toEfficiency(eff)))
    }

private fun tempVsEfficiency(drives: List<Drive>, prefs: EfficiencyDisplayPrefs): List<TempEfficiencyPoint> =
    drives.mapNotNull { drive ->
        val temp = drive.outsideTempAvgC ?: return@mapNotNull null
        val eff = getEfficiency(drive) ?: return@mapNotNull null
        TempEfficiencyPoint(roundHalfUp(prefs.toTemperature(temp)), roundHalfUp(prefs.toEfficiency(eff)))
    }

private fun speedDistribution(drives: List<Drive>, prefs: EfficiencyDisplayPrefs): List<SpeedRangeBucket> {
    val buckets =
        listOf(
            SpeedBucketAcc("0\u201330", 0.0, SPEED_B1),
            SpeedBucketAcc("30\u201360", SPEED_B1, SPEED_B2),
            SpeedBucketAcc("60\u201390", SPEED_B2, SPEED_B3),
            SpeedBucketAcc("90\u2013120", SPEED_B3, SPEED_B4),
            SpeedBucketAcc("120+", SPEED_B4, SPEED_BUCKET_OPEN),
        )
    drives.forEach { drive ->
        val speed = drive.avgSpeedMps ?: return@forEach
        val eff = getEfficiency(drive) ?: return@forEach
        val displaySpeed = prefs.toSpeed(speed)
        val bucket = buckets.firstOrNull { displaySpeed >= it.min && displaySpeed < it.max } ?: return@forEach
        bucket.count++
        bucket.totalEff += eff
    }
    return buckets.filter { it.count > 0 }.map {
        SpeedRangeBucket(
            range = "${it.label} ${prefs.speedLabel}",
            avgEfficiency = roundHalfUp(prefs.toEfficiency(it.totalEff / it.count)),
            count = it.count,
        )
    }
}

private fun tempBuckets(drives: List<Drive>, prefs: EfficiencyDisplayPrefs): List<TempBucketRow> {
    val buckets =
        if (prefs.isFahrenheit) {
            listOf(
                TempBucketAcc("< 32\u00B0F", TEMP_OPEN_LO, TEMP_B0),
                TempBucketAcc("32\u201350\u00B0F", TEMP_B0, TEMP_B10),
                TempBucketAcc("50\u201368\u00B0F", TEMP_B10, TEMP_B20),
                TempBucketAcc("68\u201386\u00B0F", TEMP_B20, TEMP_B30),
                TempBucketAcc("> 86\u00B0F", TEMP_B30, TEMP_OPEN_HI),
            )
        } else {
            listOf(
                TempBucketAcc("< 0\u00B0C", TEMP_OPEN_LO, TEMP_B0),
                TempBucketAcc("0\u201310\u00B0C", TEMP_B0, TEMP_B10),
                TempBucketAcc("10\u201320\u00B0C", TEMP_B10, TEMP_B20),
                TempBucketAcc("20\u201330\u00B0C", TEMP_B20, TEMP_B30),
                TempBucketAcc("> 30\u00B0C", TEMP_B30, TEMP_OPEN_HI),
            )
        }
    drives.forEach { drive ->
        val celsius = drive.outsideTempAvgC ?: return@forEach
        val eff = getEfficiency(drive) ?: return@forEach
        val bucket = buckets.firstOrNull { celsius >= it.min && celsius < it.max } ?: return@forEach
        bucket.count++
        bucket.totalEff += eff
        bucket.totalDist += prefs.toDistance(drive.distanceM)
        bucket.totalSpeed += prefs.toSpeed(drive.avgSpeedMps ?: 0.0)
    }
    return buckets.filter { it.count > 0 }.map {
        TempBucketRow(
            range = it.label,
            count = it.count,
            avgEfficiencyWhKm = it.totalEff / it.count,
            totalDistanceDisplay = it.totalDist,
            avgSpeedDisplay = it.totalSpeed / it.count,
        )
    }
}

// ── Computed metric strings (web `costPerKm` / `kmPerKwh`) ────────────────────────────────────────────────────────

/** Estimated cost-per-km string (web `costPerKm`): `(whKm / 1000) * 0.12` at 3dp, gated on positive total distance. */
fun efficiencyCostPerKm(stats: EfficiencyStats, prefs: EfficiencyDisplayPrefs): String =
    if (stats.hasData && stats.totalDistanceKm > 0.0) {
        prefs.number((stats.avgEfficiencyWhKm / WH_PER_KWH) * COST_PER_KWH, 3)
    } else {
        EFFICIENCY_EM_DASH
    }

/** km-per-kWh string (web `kmPerKwh`): `1000 / whKm` at 1dp, gated on positive average efficiency. */
fun efficiencyKmPerKwh(stats: EfficiencyStats, prefs: EfficiencyDisplayPrefs): String =
    if (stats.hasData && stats.avgEfficiencyWhKm > 0.0) prefs.number(WH_PER_KWH / stats.avgEfficiencyWhKm, 1) else EFFICIENCY_EM_DASH

/** The numeric km-per-kWh for the hero count-up (web `Number(kmPerKwh) || 0`). */
fun efficiencyKmPerKwhValue(stats: EfficiencyStats): Double =
    if (stats.avgEfficiencyWhKm > 0.0) WH_PER_KWH / stats.avgEfficiencyWhKm else 0.0

/** A temperature bucket's km-per-kWh cell (web `b.avgEff > 0 ? fmtNumber(1000 / toEff(b.avgEff)) : '—'`). */
fun tempBucketKmPerKwh(row: TempBucketRow, prefs: EfficiencyDisplayPrefs): String =
    if (row.avgEfficiencyWhKm > 0.0) prefs.number(WH_PER_KWH / prefs.toEfficiency(row.avgEfficiencyWhKm)) else EFFICIENCY_EM_DASH

/** Regen ratio as a 0-100 percentage (web `stats.regenRatio * 100`). */
fun efficiencyRegenPercent(stats: EfficiencyStats): Double = stats.regenRatio * PERCENT_SCALE

/** The drive-time bar value ceiling (web `Math.max(stats.totalDurationS, 36000)`). */
fun efficiencyDriveTimeMax(stats: EfficiencyStats): Double = maxOf(stats.totalDurationS, DRIVE_TIME_FLOOR_S)

// ── Default date range (web `from`/`to` defaults: last 30 days) ───────────────────────────────────────────────────

/** The immutable inclusive day range the charts filter on — the web `from`/`to` URL cells (defaulting to last 30 days). */
data class EfficiencyDateRange(val startEpochDay: Long, val endEpochDay: Long) {
    companion object {
        /** The web default: today and today − 30 days. */
        fun default(today: LocalDate = LocalDate.now()): EfficiencyDateRange =
            EfficiencyDateRange(today.minusDays(EfficiencyPageRegistration.DEFAULT_RANGE_DAYS).toEpochDay(), today.toEpochDay())
    }
}

// ── Resource projection + diagnostics ────────────────────────────────────────────────────────────────────────────

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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [EfficiencyPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle/drive id or telemetry payload.
 */
fun recordEfficiencyPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to EfficiencyPageRegistration.SLUG))
}

// ── Small framework-free helpers ─────────────────────────────────────────────────────────────────────────────────

/** The calendar day a drive started on, in [zone] (web `d.startTs.split('T')[0]`); null when the stamp is unreadable. */
private fun driveDay(drive: Drive, zone: ZoneId): LocalDate? =
    runCatching { Instant.ofEpochMilli(drive.startTs.toEpochMilliseconds()).atZone(zone).toLocalDate() }.getOrNull()

/** A short trend x-axis label for a drive's start (web `formatDateShort`: `{ month:'short', day:'numeric' }`, e.g. "Jan 5"). */
private fun trendLabel(drive: Drive, locale: Locale, zone: ZoneId): String =
    driveDay(drive, zone)?.format(DateTimeFormatter.ofPattern("MMM d", locale)) ?: EFFICIENCY_EM_DASH

/** Half-up rounding to a whole number, matching the web `Math.round` used for chart values. */
private fun roundHalfUp(value: Double): Double = floor(value + 0.5)

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0
