// Pure, framework-free model + projections for the ChargingHeatmapPage surface — the native analogue of everything the
// web page derives before composing its panels (web/src/features/charging/pages/ChargingHeatmapPage.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is plain Kotlin (it references only the generated SI DTO, the shared units
// module, the framework-free ChartFormat + UnitPreferences and java.time), so the composable stays a thin render layer
// and all of this is exercised off-device by the :app:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the day×hour heat grid (web `buildGrid`) with the running max +
// favorite day/hour; (2) the four summary aggregates (web `stats` — session count, total energy, total cost, average
// duration); (3) the top-locations ranking (web `locationData` — ≥2 sessions, top ten); (4) the heat-tier classifier
// (web `heatColor`) reduced to a 0..4 level the render layer maps to design tokens; and (5) the display-boundary unit
// derivation from the `/settings` document (web `useUnits` / `useSettings`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): session energy stays SI watt-hours and is converted only at
// the display boundary via [formatEnergy]; duration stays SI seconds and is formatted via [formatDuration]. No kWh / min
// value is ever stored — only produced for display. Day-of-week + hour are read in the device time zone, exactly as the
// web page's `new Date(started_at).getDay()/getHours()` (local-time) derivation.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling BatteryHealthPage does.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingheatmap

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatDuration
import io.teslasync.shared.core.units.formatEnergy
import kotlinx.serialization.json.JsonElement
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToLong

/** Static identity of the surface — the navigation id, the web route it mirrors, and the diagnostics slug. */
object ChargingHeatmapPageRegistration {
    /** The navigation destination id (Destinations.kt `page("chargingHeatmap", "/charging-heatmap", …)`). */
    const val ROUTE_ID: String = "chargingHeatmap"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/charging-heatmap"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "ChargingHeatmapPage"
}

/** Days per week + hours per day — the heat grid dimensions (web `Array.from({length:7})` × `{length:24}`). */
const val DAYS_PER_WEEK: Int = 7
const val HOURS_PER_DAY: Int = 24

/** Minimum sessions a location needs to enter the ranking, and the ranking size (web `c >= 2` + `slice(0, 10)`). */
private const val LOCATION_MIN_SESSIONS = 2
private const val LOCATION_TOP_N = 10

/** Heat-tier ratio thresholds (web `heatColor`: <0.25 / <0.5 / <0.75 / else). */
private const val TIER_1_RATIO = 0.25
private const val TIER_2_RATIO = 0.5
private const val TIER_3_RATIO = 0.75

/** Seconds in a minute — the SI bridge from web per-session whole-minute durations to the SI [formatDuration] input. */
private const val SECONDS_PER_MINUTE = 60.0
private const val MILLIS_PER_MINUTE = 60_000.0

/** Default number fraction digits (web `_globalPrecision` fallback) and the one-decimal energy display. */
private const val DEFAULT_PRECISION = 2
const val ENERGY_DECIMALS: Int = 1

/** One day×hour bucket — how many sessions started in it and their cumulative SI energy (web `HeatCell`). */
data class HeatCell(
    val count: Int = 0,
    val totalEnergyWh: Double = 0.0,
)

/** The full 7×24 grid plus the running maximum and the favorite (most-used) day/hour (web `buildGrid` return). */
data class HeatGrid(
    val cells: List<List<HeatCell>>,
    val maxCount: Int,
    val favoriteDay: Int,
    val favoriteHour: Int,
) {
    /** A day×hour bucket, or the empty bucket when the grid has not been built (web `grid[day]?.[hour] ?? {…}`). */
    fun cell(day: Int, hour: Int): HeatCell = cells.getOrNull(day)?.getOrNull(hour) ?: HeatCell()

    /** Whether any session has been bucketed — gates the favorite panel + the grid's content vs empty surface. */
    val hasData: Boolean get() = maxCount > 0

    companion object {
        /** The all-zero grid shown before any session loads (web `{ grid: [], maxCount: 0, … }`). */
        val EMPTY: HeatGrid = HeatGrid(cells = emptyList(), maxCount = 0, favoriteDay = 0, favoriteHour = 0)
    }
}

/** The four summary-card aggregates (web `stats`): session count, SI energy/cost totals, and SI average duration. */
data class HeatStats(
    val count: Int = 0,
    val totalEnergyWh: Double = 0.0,
    val totalCost: Double = 0.0,
    val avgDurationSeconds: Double = 0.0,
) {
    companion object {
        val EMPTY: HeatStats = HeatStats()
    }
}

/** One row of the top-locations ranking — the place name and how many sessions started there (web `locationData`). */
data class LocationCount(
    val name: String,
    val count: Int,
)

/**
 * The device-time-zone day-of-week (0 = Sunday … 6 = Saturday, web `Date.getDay()`) and hour-of-day (0..23, web
 * `Date.getHours()`) a [session] started at. The generated SI DTO carries a `kotlin.time.Instant`; it is bridged to
 * `java.time` through epoch milliseconds (the established Android pattern) so this stays pure java.time logic.
 */
fun dayAndHour(session: ChargingSession, zone: ZoneId): Pair<Int, Int> {
    val local = Instant.ofEpochMilli(session.startedAt.toEpochMilliseconds()).atZone(zone)
    val jsDay = local.dayOfWeek.value % DAYS_PER_WEEK
    return jsDay to local.hour
}

/**
 * Buckets every [sessions] entry into the 7×24 heat grid in [zone], accumulating the count + SI energy per cell and
 * tracking the running maximum-count cell as the favorite day/hour — a faithful port of the web `buildGrid`. An empty
 * input yields [HeatGrid.EMPTY].
 */
fun buildGrid(sessions: List<ChargingSession>, zone: ZoneId): HeatGrid {
    if (sessions.isEmpty()) return HeatGrid.EMPTY
    val counts = Array(DAYS_PER_WEEK) { IntArray(HOURS_PER_DAY) }
    val energy = Array(DAYS_PER_WEEK) { DoubleArray(HOURS_PER_DAY) }
    var maxCount = 0
    var favoriteDay = 0
    var favoriteHour = 0
    for (session in sessions) {
        val (day, hour) = dayAndHour(session, zone)
        counts[day][hour] += 1
        energy[day][hour] += session.totalEnergyAddedWh ?: 0.0
        if (counts[day][hour] > maxCount) {
            maxCount = counts[day][hour]
            favoriteDay = day
            favoriteHour = hour
        }
    }
    val cells =
        (0 until DAYS_PER_WEEK).map { day ->
            (0 until HOURS_PER_DAY).map { hour -> HeatCell(counts[day][hour], energy[day][hour]) }
        }
    return HeatGrid(cells = cells, maxCount = maxCount, favoriteDay = favoriteDay, favoriteHour = favoriteHour)
}

/**
 * The four summary aggregates over [sessions] (web `stats`): the session count, the SI energy + cost totals, and the
 * average per-session duration in SI seconds (each session rounded to whole minutes first, exactly as the web
 * `durationMinutes`, then averaged). An empty input yields [HeatStats.EMPTY].
 */
fun computeStats(sessions: List<ChargingSession>): HeatStats {
    if (sessions.isEmpty()) return HeatStats.EMPTY
    var energy = 0.0
    var cost = 0.0
    var minutes = 0.0
    for (session in sessions) {
        energy += session.totalEnergyAddedWh ?: 0.0
        cost += session.costDecimal ?: 0.0
        minutes += durationMinutes(session)
    }
    val avgMinutes = minutes / sessions.size
    return HeatStats(
        count = sessions.size,
        totalEnergyWh = energy,
        totalCost = cost,
        avgDurationSeconds = avgMinutes * SECONDS_PER_MINUTE,
    )
}

/**
 * Whole-minute duration of a [session] (web `durationMinutes`): zero when it has not ended or the end is not after the
 * start, else the millisecond delta rounded to minutes.
 */
fun durationMinutes(session: ChargingSession): Long {
    val end = session.endedAt ?: return 0L
    val deltaMillis = end.toEpochMilliseconds() - session.startedAt.toEpochMilliseconds()
    return if (deltaMillis <= 0L) 0L else (deltaMillis / MILLIS_PER_MINUTE).roundToLong()
}

/**
 * The top charging locations over [sessions] (web `locationData`): count by `start_place` (missing → [unknownName]),
 * keep only places with at least two sessions, sort by descending count, and take the top ten.
 */
fun topLocations(sessions: List<ChargingSession>, unknownName: String): List<LocationCount> {
    if (sessions.isEmpty()) return emptyList()
    val counts = LinkedHashMap<String, Int>()
    for (session in sessions) {
        val name = session.startPlace ?: unknownName
        counts[name] = (counts[name] ?: 0) + 1
    }
    return counts.entries
        .filter { it.value >= LOCATION_MIN_SESSIONS }
        .sortedByDescending { it.value }
        .take(LOCATION_TOP_N)
        .map { LocationCount(it.key, it.value) }
}

/**
 * The heat tier (0 = empty … 4 = hottest) of a [count] against the grid [maxCount] — the web `heatColor` thresholds
 * reduced to a level the render layer maps to a design-token color (never a hard-coded CSS value).
 */
fun heatLevel(count: Int, maxCount: Int): Int {
    if (count == 0 || maxCount == 0) return 0
    val ratio = count * 1.0 / maxCount
    return when {
        ratio < TIER_1_RATIO -> 1
        ratio < TIER_2_RATIO -> 2
        ratio < TIER_3_RATIO -> 3
        else -> 4
    }
}

/** The localized day-of-week name for a grid day index (0 = Sunday … 6 = Saturday) in [style] for [locale]. */
fun dayName(dayIndex: Int, style: TextStyle, locale: Locale): String {
    val dow = if (dayIndex == 0) DayOfWeek.SUNDAY else DayOfWeek.of(dayIndex)
    return dow.getDisplayName(style, locale)
}

/** A zero-padded `HH:00` clock label for an hour index (web `favHour.toString().padStart(2,'0') + ':00'`). */
fun hourLabel(hour: Int, locale: Locale): String = String.format(locale, "%02d:00", hour)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), carrying no vehicle id / session /
 * location payload. Called once from the composable's first composition.
 */
fun recordChargingHeatmapOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ChargingHeatmapPageRegistration.SLUG))
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits`/`useSettings` reads from
 * the `/settings` document: the unit bag (energy is always rendered in kWh and duration in minutes here, matching the
 * web page's fixed units), the number [precision] (web `_globalPrecision`), and the [locale] for grouped numbers.
 */
data class ChargingHeatmapDisplayPrefs(
    val unit: UnitPref,
    val precision: Int,
    val locale: Locale,
) {
    /** SI watt-hours → a `"x.x kWh"` display string (web `fmtNumber(convertEnergyFromSI(wh,'kWh'), 1) + ' kWh'`). */
    fun energy(wh: Double, decimals: Int = ENERGY_DECIMALS): String =
        formatEnergy(wh, unit.copy(energy = EnergyUnitPref.KWH), decimals)

    /** SI seconds → an integer-minute display string (web `fmtInt(avgDuration) + ' min'`). */
    fun duration(seconds: Double): String = formatDuration(seconds, unit.copy(duration = DurationUnitPref.MINUTES), 0)

    /** Grouped integer in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** Grouped integer from a whole count in the user's locale (web `fmtInt(value)`). */
    fun integer(value: Int): String = ChartFormat.number(value * 1.0, 0, locale)

    /** Grouped number with [decimals] fraction digits in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(value: Double, decimals: Int): String = ChartFormat.number(value, decimals, locale)

    companion object {
        /** Metric + 2dp + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: ChargingHeatmapDisplayPrefs = fromSettings(null)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): ChargingHeatmapDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return ChargingHeatmapDisplayPrefs(
                unit = unit,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}
