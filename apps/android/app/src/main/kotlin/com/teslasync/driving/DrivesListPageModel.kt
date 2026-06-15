// Pure, framework-free model + projections for the DrivesListPage driving surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/driving/pages/DrivesListPage.tsx
// + web/src/lib/drivesAggregation.ts). No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin
// (it references only the shared-core SI [Drive] DTO, the shared SI converters, and the framework-free
// ChartFormat number helper), so the composable stays a thin render layer.
//
// The web page threads its loaded `drives` array through a long `useMemo` chain — date-range filter ▸ period
// stats (current + prior) ▸ anomaly/notable/commute collections ▸ collection filter ▸ search filter ▸ sort ▸
// paginate ▸ date-group ▸ daily-trend series. This file ports that chain verbatim from drivesAggregation.ts plus
// the page-local derivations, so the whole fold is asserted off-device and the screen only resolves i18n + draws.
//
// SI boundary (unit-conversion instructions): the aggregation stays SI end to end (meters, m/s, Wh, seconds);
// the only display conversion lives in the explicit [DrivesDisplayPrefs] helpers used at the render boundary
// ([convertDistanceFromSI]/[convertSpeedFromSI] + the Wh/km→Wh/mi efficiency factor + the currency formatter),
// exactly as the web page converts only inside its `toDistanceDisplay`/`toSpeedDisplay`/`formatEnergyCost`
// callbacks (Phase-48 SI-canonical rule; ADR-013 keeps the cache itself SI).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.driveslist

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DrivesListPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("drives", "/drives", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface to that
 * destination (and its `/drives` deep link) without the nav module depending on it.
 */
object DrivesListPageRegistration {
    /** The navigation destination id (Destinations.kt `page("drives", "/drives", …)`). */
    const val ROUTE_ID: String = "drives"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/drives"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle/drive id. */
    const val SLUG: String = "DrivesListPage"

    /** The web `useUrlNumber('size', 50)` default page size. */
    const val PAGE_SIZE: Int = 50

    /** The web default range: `now()` minus this many days (`d.setDate(d.getDate() - 30)`). */
    const val DEFAULT_RANGE_DAYS: Long = 30

    /** The web commute-detection minimum recurrence (`detectCommutes(d, 3)`). */
    const val COMMUTE_MIN_OCCURRENCES: Int = 3
}

// ── Grades (web drivesAggregation `gradeFromEfficiency` / `gradeFromNumeric`) ──────────────────────────────────

/** Letter grade for a drive — the web `GradeLabel` union (`A+`/`A`/`B`/`C`/`D`/`—`). */
enum class DriveGrade(
    val label: String,
    /** Numeric weight for averaging across many drives; `null` for the ungraded `—` sentinel. */
    val numeric: Double?,
) {
    APlus("A+", 4.5),
    A("A", 4.0),
    B("B", 3.0),
    C("C", 2.0),
    D("D", 1.0),
    None("\u2014", null),
}

/**
 * Per-drive efficiency in Wh/km — the verbatim port of the web `getEfficiency`. `null` when the drive lacks
 * the inputs (no positive battery delta, zero distance), so callers skip it in arithmetic.
 */
fun getEfficiency(drive: Drive): Double? {
    val batteryUsed = 1.0 * (drive.startBatteryPct ?: 0L) - 1.0 * (drive.endBatteryPct ?: 0L)
    if (drive.distanceM > 0.0 && batteryUsed > 0.0) {
        return (batteryUsed * 0.75 * 1000.0) / (drive.distanceM / 1000.0)
    }
    return null
}

/** Maps an efficiency value (Wh/km, lower is better) to a letter grade — the web `gradeFromEfficiency`. */
fun gradeFromEfficiency(eff: Double?): DriveGrade {
    if (eff == null) return DriveGrade.None
    return when {
        eff < 130.0 -> DriveGrade.APlus
        eff < 160.0 -> DriveGrade.A
        eff < 190.0 -> DriveGrade.B
        eff < 220.0 -> DriveGrade.C
        else -> DriveGrade.D
    }
}

/** Maps an averaged grade-numeric back to a letter grade — the web `gradeFromNumeric`. */
fun gradeFromNumeric(numeric: Double?): DriveGrade {
    if (numeric == null || !numeric.isFinite()) return DriveGrade.None
    return when {
        numeric >= 4.25 -> DriveGrade.APlus
        numeric >= 3.5 -> DriveGrade.A
        numeric >= 2.5 -> DriveGrade.B
        numeric >= 1.5 -> DriveGrade.C
        else -> DriveGrade.D
    }
}

// ── Period stats (web drivesAggregation `computePeriodStats` / `priorPeriod`) ──────────────────────────────────

/** Inclusive `YYYY-MM-DD` day range — the web `{ start, end }` window. */
data class DateRange(
    val start: String,
    val end: String,
)

/** Headline window stats — the SI-canonical port of the web `PeriodStats`. */
data class PeriodStats(
    val count: Int,
    val totalDistanceM: Double,
    val totalDurationS: Double,
    val avgEfficiencyWhKm: Double?,
    val bestEfficiencyWhKm: Double?,
    val topSpeedMps: Double,
    val longest: Drive?,
    val avgGradeNumeric: Double?,
    val totalEnergyKwh: Double,
)

/** `true` when [drive]'s [localDayKey] lies within the inclusive `[startDate, endDate]` bounds (web `inDateRange`). */
private fun inDateRange(
    drive: Drive,
    startDate: String?,
    endDate: String?,
    zone: ZoneId,
): Boolean {
    val day = localDayKey(drive, zone) ?: return true
    if (startDate != null && day < startDate) return false
    if (endDate != null && day > endDate) return false
    return true
}

/** Aggregates a window of drives into headline stats — the verbatim port of the web `computePeriodStats`. */
fun computePeriodStats(
    drives: List<Drive>,
    startDate: String?,
    endDate: String?,
    zone: ZoneId,
): PeriodStats {
    var count = 0
    var totalDistanceM = 0.0
    var totalDurationS = 0.0
    var topSpeedMps = 0.0
    var longest: Drive? = null
    var effSum = 0.0
    var effN = 0
    var bestEff: Double? = null
    var gradeSum = 0.0
    var gradeN = 0
    var totalEnergyKwh = 0.0

    for (d in drives) {
        if (!inDateRange(d, startDate, endDate, zone)) continue
        count += 1
        totalDistanceM += d.distanceM
        totalDurationS += 1.0 * d.durationS
        val maxSpeed = d.maxSpeedMps ?: 0.0
        if (maxSpeed > topSpeedMps) topSpeedMps = maxSpeed
        if (longest == null || d.distanceM > longest.distanceM) longest = d

        val eff = getEfficiency(d)
        if (eff != null) {
            effSum += eff
            effN += 1
            if (bestEff == null || eff < bestEff) bestEff = eff
        }

        val numeric = gradeFromEfficiency(eff).numeric
        if (numeric != null) {
            gradeSum += numeric
            gradeN += 1
        }

        val start = d.startBatteryPct
        val end = d.endBatteryPct
        if (start != null && end != null && start > end) {
            totalEnergyKwh += (start - end) * 0.75
        }
    }

    return PeriodStats(
        count = count,
        totalDistanceM = totalDistanceM,
        totalDurationS = totalDurationS,
        topSpeedMps = topSpeedMps,
        longest = longest,
        avgEfficiencyWhKm = if (effN > 0) effSum / effN else null,
        bestEfficiencyWhKm = bestEff,
        avgGradeNumeric = if (gradeN > 0) gradeSum / gradeN else null,
        totalEnergyKwh = totalEnergyKwh,
    )
}

/**
 * The prior window of equal length immediately before `[startDate, endDate]` — the verbatim port of the web
 * `priorPeriod`. Pure epoch-day arithmetic so the result is timezone-independent (the web string-day contract).
 */
fun priorPeriod(
    startDate: String?,
    endDate: String?,
): DateRange? {
    if (startDate == null || endDate == null) return null
    val startDay = parseYmd(startDate) ?: return null
    val endDay = parseYmd(endDate) ?: return null
    val lengthDays = maxOf(1L, endDay.toEpochDay() - startDay.toEpochDay() + 1L)
    val priorEnd = startDay.minusDays(1L)
    val priorStart = priorEnd.minusDays(lengthDays - 1L)
    return DateRange(start = priorStart.toString(), end = priorEnd.toString())
}

private fun parseYmd(key: String): LocalDate? = runCatching { LocalDate.parse(key) }.getOrNull()

// ── Collections (web drivesAggregation `detectAnomalies` / `detectNotable` / `detectCommutes`) ─────────────────

/** Drives whose efficiency grade is D — the worst tier (web `detectAnomalies`). */
fun detectAnomalies(drives: List<Drive>): List<Drive> =
    drives.filter { gradeFromEfficiency(getEfficiency(it)) == DriveGrade.D }

/** Drives in the top decile by distance OR with grade A+ (web `detectNotable`, capped at 50). */
fun detectNotable(drives: List<Drive>): List<Drive> {
    if (drives.isEmpty()) return emptyList()
    val sorted = drives.sortedByDescending { it.distanceM }
    val cutoffIdx = minOf(50, maxOf(1, Math.ceil(drives.size * 0.1).toInt()))
    val longTrips = sorted.take(cutoffIdx).map { it.id }.toHashSet()
    val result = mutableListOf<Drive>()
    val seen = HashSet<Long>()
    for (d in drives) {
        val isAplus = gradeFromEfficiency(getEfficiency(d)) == DriveGrade.APlus
        if ((longTrips.contains(d.id) || isAplus) && !seen.contains(d.id)) {
            result.add(d)
            seen.add(d.id)
        }
    }
    return result
}

private fun normaliseAddress(addr: String?): String? {
    if (addr.isNullOrBlank()) return null
    return addr.trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")
}

/** Drives on a recurring origin↔end pair seen at least [minOccurrences] times (web `detectCommutes`). */
fun detectCommutes(
    drives: List<Drive>,
    minOccurrences: Int = DrivesListPageRegistration.COMMUTE_MIN_OCCURRENCES,
): List<Drive> {
    val counts = HashMap<String, Int>()
    for (d in drives) {
        val key = commuteKey(d) ?: continue
        counts[key] = (counts[key] ?: 0) + 1
    }
    return drives.filter { d ->
        val key = commuteKey(d) ?: return@filter false
        (counts[key] ?: 0) >= minOccurrences
    }
}

private fun commuteKey(drive: Drive): String? {
    val a = normaliseAddress(drive.startAddress) ?: return null
    val b = normaliseAddress(drive.endAddress) ?: return null
    return if (a < b) "$a::$b" else "$b::$a"
}

// ── Date grouping + daily trend (web drivesAggregation `groupByDate` / `dailyTrend` / `localDayKey`) ──────────

/** One day-cluster of drives — the web `DateGroup`. */
data class DriveDateGroup(
    val dateKey: String,
    val items: List<Drive>,
)

/**
 * The `YYYY-MM-DD` key of [drive]'s `start_ts` in [zone] — the web `localDayKey`. The web anchors this on the
 * active vehicle's IANA tz; with no per-vehicle zone wired on Android yet, the page passes the device zone (the
 * same "browser local" fallback the web hook applies when the vehicle tz is unknown).
 */
fun localDayKey(
    drive: Drive,
    zone: ZoneId,
): String? =
    runCatching {
        Instant.ofEpochMilli(drive.startTs.toEpochMilliseconds()).atZone(zone).toLocalDate().toString()
    }.getOrNull()

/** Buckets drives by day key, most-recent day first — the web `groupByDate`. */
fun groupByDate(
    drives: List<Drive>,
    zone: ZoneId,
): List<DriveDateGroup> {
    val buckets = LinkedHashMap<String, MutableList<Drive>>()
    for (d in drives) {
        val key = localDayKey(d, zone) ?: continue
        buckets.getOrPut(key) { mutableListOf() }.add(d)
    }
    return buckets.entries
        .sortedByDescending { it.key }
        .map { DriveDateGroup(it.key, it.value) }
}

/** The switchable trend metric — the web `TrendMetric` union. */
enum class TrendMetric(val key: String) {
    Drives("drives"),
    Distance("distance"),
    Score("score"),
    Efficiency("efficiency"),
    Cost("cost"),
    ;

    companion object {
        fun fromKey(key: String): TrendMetric = entries.firstOrNull { it.key == key } ?: Drives
    }
}

/** A `(YYYY-MM-DD, value)` trend sample — the web `TrendPoint` (value SI; the caller converts). */
data class TrendPoint(
    val date: String,
    val value: Double,
)

/** Daily aggregation of a [metric] across [drives] — the verbatim port of the web `dailyTrend`. */
fun dailyTrend(
    drives: List<Drive>,
    metric: TrendMetric,
    zone: ZoneId,
): List<TrendPoint> {
    class Bucket(var sum: Double = 0.0, var count: Int = 0)
    val buckets = LinkedHashMap<String, Bucket>()
    for (d in drives) {
        val day = localDayKey(d, zone) ?: continue
        val b = buckets.getOrPut(day) { Bucket() }
        when (metric) {
            TrendMetric.Drives -> b.sum += 1.0
            TrendMetric.Distance -> b.sum += d.distanceM
            TrendMetric.Efficiency -> {
                val eff = getEfficiency(d)
                if (eff != null) {
                    b.sum += eff
                    b.count += 1
                }
            }
            TrendMetric.Score -> {
                val numeric = gradeFromEfficiency(getEfficiency(d)).numeric
                if (numeric != null) {
                    b.sum += numeric
                    b.count += 1
                }
            }
            TrendMetric.Cost -> {
                val start = d.startBatteryPct
                val end = d.endBatteryPct
                if (start != null && end != null && start > end) {
                    b.sum += (start - end) * 0.75
                }
            }
        }
    }
    return buckets.entries
        .map { (date, b) ->
            val value =
                if (metric == TrendMetric.Efficiency || metric == TrendMetric.Score) {
                    if (b.count > 0) b.sum / b.count else 0.0
                } else {
                    b.sum
                }
            TrendPoint(date, value)
        }
        .sortedBy { it.date }
}

// ── Page-local UI state (web `useUrlEnum`/`useUrlNumber`/`useState` cells) ──────────────────────────────────────

/** The drive collection facet — the web `Collection` union (`all`/`anomalies`/`notable`/`commutes`/`tagged`). */
enum class DriveCollection(val key: String) {
    All("all"),
    Anomalies("anomalies"),
    Notable("notable"),
    Commutes("commutes"),
    Tagged("tagged"),
    ;

    companion object {
        fun fromKey(key: String): DriveCollection = entries.firstOrNull { it.key == key } ?: All
    }
}

/** The list sort facet — the web `sortBy` union (`date`/`distance`/`efficiency`). */
enum class DriveSort(val key: String) {
    Date("date"),
    Distance("distance"),
    Efficiency("efficiency"),
    ;

    companion object {
        fun fromKey(key: String): DriveSort = entries.firstOrNull { it.key == key } ?: Date
    }
}

/**
 * The page's local interaction snapshot — the union of the web URL-persisted cells (`sort`, `coll`, `trend`,
 * `page`, `q`) plus the bulk-selection `useState`. Immutable; the view-model swaps a copy on each change.
 */
data class DrivesListInteraction(
    val sort: DriveSort = DriveSort.Date,
    val collection: DriveCollection = DriveCollection.All,
    val trendMetric: TrendMetric = TrendMetric.Drives,
    val page: Int = 1,
    val search: String = "",
    val selectedIds: Set<Long> = emptySet(),
)

// ── Display preferences (web `useUnits` + `useFormatting`) ─────────────────────────────────────────────────────

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` + `useFormatting`
 * reads from the `/settings` document: the [distance]/[speed] units, the currency [symbol] (blank → "$"), the
 * currency [precision] (web `decimal_precision`, floored & non-negative, else 2), the [costPerKwh] energy rate
 * (web `base_cost_per_kwh ?? 0.12`), and the [locale] used for number grouping.
 */
data class DrivesDisplayPrefs(
    val distance: DistanceUnitPref,
    val speed: SpeedUnitPref,
    val symbol: String,
    val precision: Int,
    val costPerKwh: Double,
    val locale: Locale,
) {
    /** Distance unit short label (web `unitPrefs.distance`: "mi" / "km"). */
    val distanceLabel: String get() = distance.label

    /** Speed unit short label (web `unitPrefs.speed`: "mph" / "km/h"). */
    val speedLabel: String get() = speed.label

    /** Efficiency unit label (web `unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    val efficiencyLabel: String get() = if (distance == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** SI meters → display distance (web `toDistanceDisplay` / `convertDistanceFromSI`). */
    fun toDistance(meters: Double): Double = convertDistanceFromSI(meters, distance)

    /** SI m/s → display speed (web `toSpeedDisplay` / `convertSpeedFromSI`). */
    fun toSpeed(mps: Double): Double = convertSpeedFromSI(mps, speed)

    /** Wh/km → display efficiency (web `whPerKm * 1.609344` for miles, else identity). */
    fun toEfficiency(whPerKm: Double): Double = if (distance == DistanceUnitPref.MI) whPerKm * 1.609344 else whPerKm

    /** Currency of an amount (web `formatCurrency`: symbol + grouped number). */
    fun formatCurrency(
        amount: Double,
        decimals: Int = precision,
    ): String = "$symbol${ChartFormat.number(amount, decimals, locale)}"

    /** Cost of [kwh] energy at [costPerKwh] (web `formatEnergyCost`). */
    fun formatEnergyCost(kwh: Double): String = formatCurrency(kwh * costPerKwh)

    companion object {
        private const val DEFAULT_CURRENCY = "$"
        private const val DEFAULT_PRECISION = 2
        private const val DEFAULT_COST_PER_KWH = 0.12
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val KEY_COST_PER_KWH = "base_cost_per_kwh"

        /** Metric + `$` + 2dp + $0.12/kWh defaults used before settings load (matches the web defaults). */
        fun default(): DrivesDisplayPrefs =
            DrivesDisplayPrefs(
                distance = DistanceUnitPref.KM,
                speed = SpeedUnitPref.KMH,
                symbol = DEFAULT_CURRENCY,
                precision = DEFAULT_PRECISION,
                costPerKwh = DEFAULT_COST_PER_KWH,
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits` / `useFormatting`). */
        fun fromSettings(settings: JsonElement?): DrivesDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val obj = settings as? JsonObject
            val rawSymbol = (obj?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive)?.contentOrNull?.trim()
            val rawCost = (obj?.get(KEY_COST_PER_KWH) as? JsonPrimitive)?.doubleOrNull
            return DrivesDisplayPrefs(
                distance = unit.distance,
                speed = unit.speed,
                symbol = if (!rawSymbol.isNullOrEmpty()) rawSymbol else DEFAULT_CURRENCY,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                costPerKwh = rawCost?.takeIf { it.isFinite() } ?: DEFAULT_COST_PER_KWH,
                locale = runCatching { Locale.forLanguageTag(unit.locale ?: "en-US") }.getOrDefault(Locale.US),
            )
        }
    }
}

// ── Search (web `parseSearchQuery` / `matchesTokens` / `compareNumeric`) ───────────────────────────────────────

private data class SearchToken(
    val key: String?,
    val op: String,
    val value: String,
)

private fun parseSearchQuery(query: String): List<SearchToken> {
    val trimmed = query.trim()
    if (trimmed.isEmpty()) return emptyList()
    return trimmed.split(Regex("\\s+")).mapNotNull { raw ->
        val colon = raw.indexOf(':')
        if (colon <= 0) {
            SearchToken(key = null, op = "=", value = raw.lowercase(Locale.ROOT))
        } else {
            val key = raw.substring(0, colon).lowercase(Locale.ROOT)
            var rest = raw.substring(colon + 1)
            var op = "="
            if (rest.startsWith(">") || rest.startsWith("<")) {
                op = rest.substring(0, 1)
                rest = rest.substring(1)
            }
            if (rest.isEmpty()) null else SearchToken(key = key, op = op, value = rest.lowercase(Locale.ROOT))
        }
    }
}

private fun compareNumeric(
    actual: Double,
    op: String,
    target: Double,
): Boolean =
    when (op) {
        ">" -> actual > target
        "<" -> actual < target
        else -> kotlin.math.abs(actual - target) < 0.5
    }

private fun matchesSearch(
    drive: Drive,
    tokens: List<SearchToken>,
    prefs: DrivesDisplayPrefs,
    zone: ZoneId,
): Boolean {
    if (tokens.isEmpty()) return true
    return tokens.all { token ->
        when (token.key) {
            null -> {
                val grade = gradeFromEfficiency(getEfficiency(drive)).label
                val haystack =
                    listOfNotNull(
                        drive.startAddress,
                        drive.endAddress,
                        grade,
                        ChartFormat.number(prefs.toDistance(drive.distanceM), 1, prefs.locale),
                    ).joinToString(" ").lowercase(Locale.ROOT)
                haystack.contains(token.value)
            }
            "score" -> gradeFromEfficiency(getEfficiency(drive)).label.lowercase(Locale.ROOT) == token.value.trim()
            "from" -> {
                val day = localDayKey(drive, zone) ?: return@all false
                val month =
                    runCatching {
                        LocalDate.parse(day).month.getDisplayName(TextStyle.FULL, prefs.locale)
                    }.getOrNull()?.lowercase(Locale.ROOT) ?: return@all false
                month.contains(token.value.trim())
            }
            "distance" -> {
                val target = token.value.toDoubleOrNull() ?: return@all true // parity:allow numeric search-token parse, not a TODO stub
                compareNumeric(prefs.toDistance(drive.distanceM), token.op, target)
            }
            else -> true
        }
    }
}

// ── Render-ready fold (the union of the web page's useMemo chain) ──────────────────────────────────────────────

/**
 * The render-ready model the stateless content layer needs, computed once from the loaded [drives] + the current
 * [interaction] + the user prefs — the native fold of the web page's full `useMemo` chain. Keeping it pure and
 * Compose-free lets the whole derivation be asserted off-device.
 */
data class DrivesListData(
    val range: DateRange,
    val currentStats: PeriodStats,
    val priorStats: PeriodStats?,
    val priorRange: DateRange?,
    val priorHasData: Boolean,
    val anomalyDrives: List<Drive>,
    val notableDrives: List<Drive>,
    val commuteDrives: List<Drive>,
    val anomalyIds: Set<Long>,
    val allCount: Int,
    val filteredDrives: List<Drive>,
    val sortedDrives: List<Drive>,
    val paginatedGroups: List<DriveDateGroup>,
    val trendSeries: Map<TrendMetric, List<TrendPoint>>,
    val avgGrade: DriveGrade,
) {
    /** Total result count after collection + search filters (web `filteredDrives.length`). */
    val filteredCount: Int get() = filteredDrives.size

    /** Whether the active collection's working set is empty after filtering (web list-empty branch). */
    val hasResults: Boolean get() = filteredDrives.isNotEmpty()
}

/** Builds the default `[today - 30d, today]` range in [zone] — the web `defaultStart`/`defaultEnd` useMemo. */
fun defaultRange(zone: ZoneId): DateRange {
    val today = LocalDate.now(zone)
    return DateRange(
        start = today.minusDays(DrivesListPageRegistration.DEFAULT_RANGE_DAYS).toString(),
        end = today.toString(),
    )
}

/**
 * Derives the full page content model from the loaded [drives], the [interaction] and the [prefs] — the native
 * fold of every web `useMemo`: default range ▸ date filter ▸ current/prior stats ▸ anomaly/notable/commute
 * collections ▸ collection filter ▸ search filter ▸ sort ▸ paginate ▸ date-group ▸ daily-trend series. The page
 * never re-implements any of it; it only resolves i18n + draws.
 */
fun deriveDrivesListData(
    drives: List<Drive>,
    interaction: DrivesListInteraction,
    prefs: DrivesDisplayPrefs,
    zone: ZoneId,
): DrivesListData {
    val range = defaultRange(zone)
    val dateFiltered = drives.filter { inDateRange(it, range.start, range.end, zone) }

    val currentStats = computePeriodStats(dateFiltered, null, null, zone)
    val priorRange = priorPeriod(range.start, range.end)
    val priorStats = priorRange?.let { computePeriodStats(drives, it.start, it.end, zone) }
    val priorHasData = priorStats != null && priorStats.count > 0

    val anomalies = detectAnomalies(dateFiltered)
    val notable = detectNotable(dateFiltered)
    val commutes = detectCommutes(dateFiltered)
    val anomalyIds = anomalies.map { it.id }.toHashSet()

    val collectionFiltered =
        when (interaction.collection) {
            DriveCollection.Anomalies -> anomalies
            DriveCollection.Notable -> notable
            DriveCollection.Commutes -> commutes
            DriveCollection.Tagged -> emptyList()
            DriveCollection.All -> dateFiltered
        }

    val tokens = parseSearchQuery(interaction.search)
    val searchFiltered =
        if (tokens.isEmpty()) collectionFiltered else collectionFiltered.filter { matchesSearch(it, tokens, prefs, zone) }

    val sorted =
        when (interaction.sort) {
            DriveSort.Distance -> searchFiltered.sortedByDescending { it.distanceM }
            DriveSort.Efficiency -> searchFiltered.sortedBy { getEfficiency(it) ?: 999.0 }
            DriveSort.Date -> searchFiltered.sortedByDescending { it.startTs.toEpochMilliseconds() }
        }

    val pageSize = DrivesListPageRegistration.PAGE_SIZE
    val from = (interaction.page - 1) * pageSize
    val paginated =
        if (from in sorted.indices) sorted.subList(from, minOf(from + pageSize, sorted.size)) else emptyList()

    val trend = TrendMetric.entries.associateWith { metric -> dailyTrend(dateFiltered, metric, zone) }

    return DrivesListData(
        range = range,
        currentStats = currentStats,
        priorStats = priorStats,
        priorRange = priorRange,
        priorHasData = priorHasData,
        anomalyDrives = anomalies,
        notableDrives = notable,
        commuteDrives = commutes,
        anomalyIds = anomalyIds,
        allCount = dateFiltered.size,
        filteredDrives = searchFiltered,
        sortedDrives = sorted,
        paginatedGroups = groupByDate(paginated, zone),
        trendSeries = trend,
        avgGrade = gradeFromNumeric(currentStats.avgGradeNumeric),
    )
}

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DrivesListPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, drive id, address, or cost figure.
 */
fun recordDrivesListPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DrivesListPageRegistration.SLUG))
}
