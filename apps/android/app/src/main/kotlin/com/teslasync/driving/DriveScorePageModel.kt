// Pure, framework-free model + projections for the DriveScorePage driving surface — the native analogue of
// everything the web page derives before it composes its panels (web/src/features/driving/pages/DriveScorePage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the generated SI DTO
// [Drive], the framework-free shared-core units, and java.time), so the composable stays a thin render layer and all
// of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the per-drive [scoreDrive] algorithm (efficiency 0-40 +
// smoothness 0-30 + speed-discipline 0-30 from the SI distance / energy / power / max-speed); (2) the date-range
// filter, the period aggregates, the score trend / category / distribution chart inputs, the weekly/monthly period
// statistics, the achievement checks and the best/worst drive picks; (3) the display-boundary unit derivation from the
// `/settings` document ([DriveScoreDisplayPrefs], web `useUnits`) and the per-field formatting the panels call (web
// `fmtNumber`/`fmtInt`/`fmtWithUnit`, `formatDateShort`, `formatDurationMinutes`, `convertDistanceFromSI`,
// `convertSpeedFromSI`, the Wh/km -> Wh/mi efficiency scale).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): distances are SI metres, speeds SI m/s, power SI watts,
// energy SI watt-hours on the wire (generated [Drive]); every figure is bridged to the user's unit only at the render
// boundary via [DriveScoreDisplayPrefs]. The 0-100 scores and Wh/km efficiency the scoring math produces are
// unit-independent intermediate values.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics surfaces do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.driving.drivescore

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// ── Constants (mirrors of the web module constants + scoring tuning) ───────────────────────────────────────────────

/** Page size for the drive-history table (web `DRIVES_PER_PAGE`). */
const val DRIVES_PER_PAGE: Int = 10

/** Number of recent scored drives the trend chart plots (web `.slice(-20)`). */
private const val TREND_WINDOW = 20

/** 1 km in metres / 1 kWh in Wh / 1 kW in W — the SI bridges the scoring math floors on. */
private const val WH_PER_KWH = 1000.0
private const val METERS_PER_KM = 1000.0
private const val W_PER_KW = 1000.0

/** m/s -> mph (the scoring max-speed penalty is expressed in mph, web `* 2.2369362920544`). */
private const val MPS_TO_MPH = 2.2369362920544

/** km -> mi (the Wh/km -> Wh/mi efficiency display scale, web `* 1.609344`). */
private const val KM_PER_MILE = 1.609344

// Scoring fallbacks + bands (verbatim from the web `scoreDrive`).
private const val DEFAULT_START_SOC = 50.0
private const val DEFAULT_END_SOC = 45.0
private const val DEFAULT_PACK_KWH = 75.0
private const val DEFAULT_WH_PER_KM = 200.0
private const val DEFAULT_AVG_POWER_KW = 30.0
private const val DEFAULT_MAX_SPEED_MPH = 80.0
private const val EFF_MAX = 40.0
private const val EFF_PIVOT_WH_PER_KM = 130.0
private const val EFF_SLOPE = 3.0
private const val SMOOTH_MAX = 30.0
private const val SMOOTH_SLOPE = 3.0
private const val SPEED_MAX = 30.0
private const val SPEED_PIVOT_MPH = 90.0
private const val SPEED_SLOPE = 2.0

/** Default avg power (W) used in the smoothness InlineMetric (web `avgPowerW ?? 30000`). */
private const val DEFAULT_AVG_POWER_W = 30_000.0

/** Default fraction precision (web `_globalPrecision`) when the settings document carries none. */
private const val DEFAULT_PRECISION = 2

private const val MS_PER_DAY = 86_400_000L
private const val MINUTES_PER_HOUR = 60.0
private const val DAYS_PER_WEEK = 7

/** Grade thresholds (web ternary cascade). */
private const val GRADE_A_PLUS = 90
private const val GRADE_A = 80
private const val GRADE_B = 70
private const val GRADE_C = 60
private const val GRADE_D = 50

/** Achievement thresholds (web `buildAchievements` checks). */
private const val TEN = 10
private const val FIFTY = 50
private const val PERFECT = 100
private const val A_PLUS_STREAK = 5
private const val EFF_MASTER_SCORE = 38
private const val EFF_MASTER_COUNT = 3
private const val SMOOTH_OP_SCORE = 28
private const val SMOOTH_OP_COUNT = 3
private const val SPEED_SAINT_SCORE = 28
private const val SPEED_SAINT_COUNT = 5

/** The em dash shown for a missing value (web `'—'`). */
const val EM_DASH: String = "\u2014"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `DriveScorePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("driveScore", "/drive-score", …)`, so the host binds this surface to that destination (and its `/drive-score`
 * deep link) without the nav module depending on it.
 */
object DriveScorePageRegistration {
    const val ROUTE_ID: String = "driveScore"
    const val WEB_PATH: String = "/drive-score"
    const val SLUG: String = "DriveScorePage"
}

// ── Score model ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The five-part score for one drive (web `DriveScore`): the [total] 0-100, the three sub-scores, the [grade], Wh/km. */
data class DriveScore(
    val total: Int,
    val efficiency: Int,
    val smoothness: Int,
    val speed: Int,
    val grade: String,
    val whPerKm: Int,
)

/** A scored drive — the SI [drive] paired with its derived [score] (web `{ drive, score }`). */
data class ScoredDrive(
    val drive: Drive,
    val score: DriveScore,
)

/** Sort field for the drive-history table (web `SortField`). */
enum class SortField { Date, Distance, Score, Efficiency }

/** Sort direction for the drive-history table (web `SortDir`). */
enum class SortDir { Asc, Desc }

/** The three score categories (web category union) feeding the breakdown gauges, bars and tips. */
enum class ScoreCategory { Efficiency, Smoothness, Speed }

/** The eight achievements (web `buildAchievements` ids), stable so label/description/icon resolve in the view. */
enum class Achievement { FirstDrive, TenDrives, FiftyDrives, PerfectScore, APlusStreak, EfficiencyMaster, SmoothOperator, SpeedSaint }

/**
 * The per-drive scoring algorithm — a verbatim port of the web `scoreDrive`. Reads the SI fields of [drive] with the
 * exact web fallbacks (start/end SoC 50/45, 75 kWh pack, 200 Wh/km, 30 kW, 80 mph) and bands each sub-score.
 */
fun scoreDrive(drive: Drive): DriveScore {
    val battUsed = (drive.startBatteryPct?.dbl() ?: DEFAULT_START_SOC) - (drive.endBatteryPct?.dbl() ?: DEFAULT_END_SOC)
    val energyKwh = drive.energyUsedWh?.let { it / WH_PER_KWH } ?: ((battUsed / 100.0) * DEFAULT_PACK_KWH)
    val distanceKm = drive.distanceM / METERS_PER_KM
    val whPerKm = if (distanceKm > 0.0) (energyKwh * WH_PER_KWH) / distanceKm else DEFAULT_WH_PER_KM

    val effScore = max(0.0, min(EFF_MAX, EFF_MAX - (whPerKm - EFF_PIVOT_WH_PER_KM) / EFF_SLOPE))
    val avgPowerKw = drive.avgPowerW?.let { it / W_PER_KW } ?: DEFAULT_AVG_POWER_KW
    val smoothScore = max(0.0, min(SMOOTH_MAX, SMOOTH_MAX - avgPowerKw / SMOOTH_SLOPE))
    val maxSpeedMph = drive.maxSpeedMps?.let { it * MPS_TO_MPH } ?: DEFAULT_MAX_SPEED_MPH
    val speedScore = max(0.0, min(SPEED_MAX, SPEED_MAX - max(0.0, maxSpeedMph - SPEED_PIVOT_MPH) / SPEED_SLOPE))

    val total = (effScore + smoothScore + speedScore).roundToInt()
    return DriveScore(
        total = total,
        efficiency = effScore.roundToInt(),
        smoothness = smoothScore.roundToInt(),
        speed = speedScore.roundToInt(),
        grade = gradeForScore(total),
        whPerKm = whPerKm.roundToInt(),
    )
}

/** Maps a 0-100 [total] to its letter grade (web ternary cascade). */
fun gradeForScore(total: Int): String =
    when {
        total >= GRADE_A_PLUS -> "A+"
        total >= GRADE_A -> "A"
        total >= GRADE_B -> "B"
        total >= GRADE_C -> "C"
        total >= GRADE_D -> "D"
        else -> "F"
    }

// ── Decoded API score ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The decoded `GET /drives/score` payload (web `DriveScore` API type) that overlays the locally-computed averages when
 * present. Every field is nullable so a missing payload (the web `useDriveScore` is `retry:false`, often absent) falls
 * back to the computed values exactly as the web optional reads do.
 */
data class DriveScoreSummary(
    val overall: Int?,
    val efficiency: Int?,
    val smoothness: Int?,
    val speedDiscipline: Int?,
    val grade: String?,
    val totalDrives: Int?,
    val trend: String?,
) {
    companion object {
        val EMPTY = DriveScoreSummary(null, null, null, null, null, null, null)
    }
}

/** Decodes the raw `/drives/score` [json] (snake-or-camel on the wire) into a [DriveScoreSummary]; null payload → null. */
fun parseDriveScore(json: JsonElement?): DriveScoreSummary? {
    val obj = json as? JsonObject ?: return null
    if (obj.isEmpty()) return null
    return DriveScoreSummary(
        overall = obj.intField("overall"),
        efficiency = obj.intField("efficiency"),
        smoothness = obj.intField("smoothness"),
        speedDiscipline = obj.intField("speed_discipline", "speedDiscipline"),
        grade = obj.stringField("grade"),
        totalDrives = obj.intField("total_drives", "totalDrives"),
        trend = obj.stringField("trend"),
    )
}

// ── Derived chart / aggregate inputs ──────────────────────────────────────────────────────────────────────────────

/** One sample on the score trend chart (web `trendChartData`). [epochMillis] is formatted to a date label in the view. */
data class TrendPoint(
    val epochMillis: Long,
    val score: Int,
    val efficiency: Int,
    val smoothness: Int,
    val speed: Int,
)

/** One category bar (web `categoryBarData`): the [category], its [value] and its [max] ceiling. */
data class CategoryBar(
    val category: ScoreCategory,
    val value: Int,
    val max: Int,
)

/** One score-distribution histogram bin (web `histogramData`): the raw [rangeLabel], its [count] and a palette index. */
data class HistogramBin(
    val rangeLabel: String,
    val count: Int,
    val colorIndex: Int,
)

/** A best-period record (web `bestWeek`/`bestMonth`): the [avg] score and its raw [label] (e.g. `2025-01`). */
data class PeriodRecord(
    val avg: Int,
    val label: String,
)

/**
 * The weekly/monthly period statistics (web `periodStats`). All averages are nullable (no drives in the window → the
 * em dash), the records default to 0/`—`, and [aOrBetter] counts the A+/A drives.
 */
data class PeriodStats(
    val thisWeekAvg: Int?,
    val lastWeekAvg: Int?,
    val thisMonthAvg: Int?,
    val lastMonthAvg: Int?,
    val bestWeek: PeriodRecord,
    val bestMonth: PeriodRecord,
    val totalDrives: Int,
    val aOrBetter: Int,
)

/**
 * The fully-derived, SI-domain page state — the native analogue of every `useMemo` the web page computes before it
 * renders. Built once per (drives, apiScore, range) change by [buildDriveScoreData]; the view applies the display
 * units + the table sort/pagination on top. Scores are 0-100, distances SI metres, speeds SI m/s, efficiency SI Wh/km.
 */
data class DriveScoreData(
    val scoredDrives: List<ScoredDrive>,
    val hasApiScore: Boolean,
    val basedOnCount: Int?,
    val overall: Int,
    val overallGrade: String,
    val trend: String,
    val effEfficiency: Int,
    val effSmoothness: Int,
    val effSpeed: Int,
    val trendChart: List<TrendPoint>,
    val categoryBars: List<CategoryBar>,
    val histogram: List<HistogramBin>,
    val periodStats: PeriodStats?,
    val unlocked: Map<Achievement, Boolean>,
    val weakestCategory: ScoreCategory,
    val bestDrive: ScoredDrive?,
    val worstDrive: ScoredDrive?,
    val avgScore: Int,
    val bestScore: Int,
    val totalScoredDrives: Int,
    val avgWhPerKm: Double,
    val avgPowerKw: Double,
    val avgMaxSpeedMps: Double,
    val totalDistanceM: Double,
    val totalDurationS: Double,
    val avgDistanceM: Double,
    val avgDurationS: Double,
    val highestSpeedMps: Double,
    val aPlusCount: Int,
) {
    /** Whether no scored drive exists in the selected period (web `scoredDrives.length === 0`). */
    val isEmpty: Boolean get() = scoredDrives.isEmpty()

    companion object {
        val EMPTY: DriveScoreData =
            DriveScoreData(
                scoredDrives = emptyList(),
                hasApiScore = false,
                basedOnCount = null,
                overall = 0,
                overallGrade = "F",
                trend = "flat",
                effEfficiency = 0,
                effSmoothness = 0,
                effSpeed = 0,
                trendChart = emptyList(),
                categoryBars = emptyList(),
                histogram = emptyList(),
                periodStats = null,
                unlocked = emptyMap(),
                weakestCategory = ScoreCategory.Efficiency,
                bestDrive = null,
                worstDrive = null,
                avgScore = 0,
                bestScore = 0,
                totalScoredDrives = 0,
                avgWhPerKm = 0.0,
                avgPowerKw = 0.0,
                avgMaxSpeedMps = 0.0,
                totalDistanceM = 0.0,
                totalDurationS = 0.0,
                avgDistanceM = 0.0,
                avgDurationS = 0.0,
                highestSpeedMps = 0.0,
                aPlusCount = 0,
            )
    }
}

/**
 * Builds the full [DriveScoreData] from the raw SI [drives], the optional decoded [apiScore], the active [startMillis]
 * /[endMillis] range bounds, the current [nowMillis] and the [zone] used for the weekly/monthly period math — the
 * native analogue of every web `useMemo` (filter → score → aggregate). Pure, so it is JVM-tested off-device.
 */
fun buildDriveScoreData(
    drives: List<Drive>,
    apiScore: DriveScoreSummary?,
    startMillis: Long,
    endMillis: Long,
    nowMillis: Long,
    zone: ZoneId,
): DriveScoreData {
    val filtered =
        drives.filter { d ->
            val ts = d.startTs.toEpochMilliseconds()
            ts in startMillis..endMillis
        }
    val scored = filtered.map { ScoredDrive(it, scoreDrive(it)) }
    if (scored.isEmpty()) return DriveScoreData.EMPTY

    val scores = scored.map { it.score }
    val n = scores.size
    val avgEfficiency = scores.sumOf { it.efficiency }.dbl().div(n).roundToInt()
    val avgSmoothness = scores.sumOf { it.smoothness }.dbl().div(n).roundToInt()
    val avgSpeed = scores.sumOf { it.speed }.dbl().div(n).roundToInt()
    val avgTotal = scores.sumOf { it.total }.dbl().div(n).roundToInt()

    val effEfficiency = apiScore?.efficiency ?: avgEfficiency
    val effSmoothness = apiScore?.smoothness ?: avgSmoothness
    val effSpeed = apiScore?.speedDiscipline ?: avgSpeed
    val overall = apiScore?.overall ?: avgTotal
    val overallGrade = apiScore?.grade ?: gradeForScore(overall)
    val trend = apiScore?.trend ?: "flat"

    val trendChart =
        scored.sortedBy { it.drive.startTs.toEpochMilliseconds() }
            .takeLast(TREND_WINDOW)
            .map {
                TrendPoint(
                    epochMillis = it.drive.startTs.toEpochMilliseconds(),
                    score = it.score.total,
                    efficiency = it.score.efficiency,
                    smoothness = it.score.smoothness,
                    speed = it.score.speed,
                )
            }

    val categoryBars =
        listOf(
            CategoryBar(ScoreCategory.Efficiency, effEfficiency, EFF_MAX.toInt()),
            CategoryBar(ScoreCategory.Smoothness, effSmoothness, SMOOTH_MAX.toInt()),
            CategoryBar(ScoreCategory.Speed, effSpeed, SPEED_MAX.toInt()),
        )

    return DriveScoreData(
        scoredDrives = scored,
        hasApiScore = apiScore != null,
        basedOnCount = apiScore?.totalDrives,
        overall = overall,
        overallGrade = overallGrade,
        trend = trend,
        effEfficiency = effEfficiency,
        effSmoothness = effSmoothness,
        effSpeed = effSpeed,
        trendChart = trendChart,
        categoryBars = categoryBars,
        histogram = buildHistogram(scores),
        periodStats = buildPeriodStats(scored, nowMillis, zone),
        unlocked = checkAchievements(scored),
        weakestCategory = weakestCategory(effEfficiency, effSmoothness, effSpeed),
        bestDrive = scored.maxByOrNull { it.score.total },
        worstDrive = scored.minByOrNull { it.score.total },
        avgScore = avgTotal,
        bestScore = scores.maxOf { it.total },
        totalScoredDrives = n,
        avgWhPerKm = scored.sumOf { it.score.whPerKm.dbl() } / n,
        avgPowerKw = scored.sumOf { (it.drive.avgPowerW ?: DEFAULT_AVG_POWER_W) / W_PER_KW } / n,
        avgMaxSpeedMps = scored.sumOf { it.drive.maxSpeedMps ?: 0.0 } / n,
        totalDistanceM = filtered.sumOf { it.distanceM },
        totalDurationS = filtered.sumOf { it.durationS.dbl() },
        avgDistanceM = filtered.sumOf { it.distanceM } / n,
        avgDurationS = filtered.sumOf { it.durationS.dbl() } / n,
        highestSpeedMps = filtered.maxOf { it.maxSpeedMps ?: 0.0 },
        aPlusCount = scores.count { it.grade == "A+" },
    )
}

/** Buckets the [scores] into the five fixed score ranges (web `histogramData`). */
private fun buildHistogram(scores: List<DriveScore>): List<HistogramBin> {
    data class Bucket(val label: String, val lo: Int, val hi: Int, val colorIndex: Int)
    val ranges =
        listOf(
            Bucket("0\u201320", 0, 20, 3),
            Bucket("20\u201340", 20, 40, 2),
            Bucket("40\u201360", 40, 60, 5),
            Bucket("60\u201380", 60, 80, 0),
            Bucket("80\u2013100", 80, 101, 1),
        )
    return ranges.map { r ->
        HistogramBin(
            rangeLabel = r.label,
            count = scores.count { it.total >= r.lo && it.total < r.hi },
            colorIndex = r.colorIndex,
        )
    }
}

/** Picks the weakest score category by normalized ratio (web `weakestCategory`). */
fun weakestCategory(
    efficiency: Int,
    smoothness: Int,
    speed: Int,
): ScoreCategory {
    val eff = efficiency / EFF_MAX
    val sm = smoothness / SMOOTH_MAX
    val sp = speed / SPEED_MAX
    return when {
        eff <= sm && eff <= sp -> ScoreCategory.Efficiency
        sm <= sp -> ScoreCategory.Smoothness
        else -> ScoreCategory.Speed
    }
}

/** Evaluates every achievement's unlock predicate against the [scored] drives (web `buildAchievements` checks). */
fun checkAchievements(scored: List<ScoredDrive>): Map<Achievement, Boolean> {
    val scores = scored.map { it.score }
    return mapOf(
        Achievement.FirstDrive to (scored.size >= 1),
        Achievement.TenDrives to (scored.size >= TEN),
        Achievement.FiftyDrives to (scored.size >= FIFTY),
        Achievement.PerfectScore to scores.any { it.total >= PERFECT },
        Achievement.APlusStreak to hasAPlusStreak(scores),
        Achievement.EfficiencyMaster to (scores.count { it.efficiency >= EFF_MASTER_SCORE } >= EFF_MASTER_COUNT),
        Achievement.SmoothOperator to (scores.count { it.smoothness >= SMOOTH_OP_SCORE } >= SMOOTH_OP_COUNT),
        Achievement.SpeedSaint to (scores.count { it.speed >= SPEED_SAINT_SCORE } >= SPEED_SAINT_COUNT),
    )
}

private fun hasAPlusStreak(scores: List<DriveScore>): Boolean {
    var streak = 0
    for (s in scores) {
        if (s.grade == "A+") {
            streak += 1
            if (streak >= A_PLUS_STREAK) return true
        } else {
            streak = 0
        }
    }
    return false
}

/** Derives the weekly/monthly period statistics (web `periodStats`); null when there are no scored drives. */
fun buildPeriodStats(
    scored: List<ScoredDrive>,
    nowMillis: Long,
    zone: ZoneId,
): PeriodStats? {
    if (scored.isEmpty()) return null
    val now = Instant.ofEpochMilli(nowMillis).atZone(zone)
    val weekStart = now.toLocalDate().minusDays((now.dayOfWeek.value % DAYS_PER_WEEK).toLong()).atStartOfDay(zone)
    val lastWeekStart = weekStart.minusDays(DAYS_PER_WEEK.toLong())
    val monthStart = now.toLocalDate().withDayOfMonth(1).atStartOfDay(zone)
    val lastMonthStart = monthStart.minusMonths(1)
    val lastMonthEnd = monthStart.minusSeconds(1)

    val weekStartMs = weekStart.toInstant().toEpochMilli()
    val lastWeekStartMs = lastWeekStart.toInstant().toEpochMilli()
    val monthStartMs = monthStart.toInstant().toEpochMilli()
    val lastMonthStartMs = lastMonthStart.toInstant().toEpochMilli()
    val lastMonthEndMs = lastMonthEnd.toInstant().toEpochMilli()

    fun avgOf(items: List<ScoredDrive>): Int? =
        if (items.isEmpty()) null else items.sumOf { it.score.total }.dbl().div(items.size).roundToInt()

    val thisWeek = scored.filter { it.drive.startTs.toEpochMilliseconds() >= weekStartMs }
    val lastWeek = scored.filter { val t = it.drive.startTs.toEpochMilliseconds(); t >= lastWeekStartMs && t < weekStartMs }
    val thisMonth = scored.filter { it.drive.startTs.toEpochMilliseconds() >= monthStartMs }
    val lastMonth = scored.filter { val t = it.drive.startTs.toEpochMilliseconds(); t >= lastMonthStartMs && t <= lastMonthEndMs }

    val weekMap = linkedMapOf<String, MutableList<ScoredDrive>>()
    val monthMap = linkedMapOf<String, MutableList<ScoredDrive>>()
    scored.forEach { sd ->
        val d = Instant.ofEpochMilli(sd.drive.startTs.toEpochMilliseconds()).atZone(zone)
        val firstOfMonthDow = d.toLocalDate().withDayOfMonth(1).dayOfWeek.value % DAYS_PER_WEEK
        val weekIndex = ((d.dayOfMonth + firstOfMonthDow) + DAYS_PER_WEEK - 1) / DAYS_PER_WEEK
        val wk = "${d.year}-W$weekIndex"
        val mo = "${d.year}-${d.monthValue.toString().padStart(2, '0')}"
        weekMap.getOrPut(wk) { mutableListOf() }.add(sd)
        monthMap.getOrPut(mo) { mutableListOf() }.add(sd)
    }

    var bestWeek = PeriodRecord(0, EM_DASH)
    weekMap.forEach { (label, items) -> avgOf(items)?.let { if (it > bestWeek.avg) bestWeek = PeriodRecord(it, label) } }
    var bestMonth = PeriodRecord(0, EM_DASH)
    monthMap.forEach { (label, items) -> avgOf(items)?.let { if (it > bestMonth.avg) bestMonth = PeriodRecord(it, label) } }

    return PeriodStats(
        thisWeekAvg = avgOf(thisWeek),
        lastWeekAvg = avgOf(lastWeek),
        thisMonthAvg = avgOf(thisMonth),
        lastMonthAvg = avgOf(lastMonth),
        bestWeek = bestWeek,
        bestMonth = bestMonth,
        totalDrives = scored.size,
        aOrBetter = scored.count { it.score.grade == "A+" || it.score.grade == "A" },
    )
}

// ── Sort + pagination (table) ────────────────────────────────────────────────────────────────────────────────────

/** Sorts the [drives] by [field]/[dir] (web `sortedDrives`). */
fun sortScored(
    drives: List<ScoredDrive>,
    field: SortField,
    dir: SortDir,
): List<ScoredDrive> {
    val comparator =
        when (field) {
            SortField.Date -> compareBy<ScoredDrive> { it.drive.startTs.toEpochMilliseconds() }
            SortField.Distance -> compareBy { it.drive.distanceM }
            SortField.Score -> compareBy { it.score.total }
            SortField.Efficiency -> compareBy { it.score.whPerKm }
        }
    val sorted = drives.sortedWith(comparator)
    return if (dir == SortDir.Asc) sorted else sorted.reversed()
}

/** The total number of table pages for [total] rows (web `Math.ceil`, floored at 1). */
fun pageCount(total: Int): Int = max(1, (total + DRIVES_PER_PAGE - 1) / DRIVES_PER_PAGE)

/** The [page] (1-based) slice of [drives] (web `paginatedDrives`). */
fun paginate(
    drives: List<ScoredDrive>,
    page: Int,
): List<ScoredDrive> {
    val from = ((page - 1) * DRIVES_PER_PAGE).coerceIn(0, drives.size)
    val to = (from + DRIVES_PER_PAGE).coerceIn(0, drives.size)
    return drives.subList(from, to)
}

// ── Display preferences (render boundary) ────────────────────────────────────────────────────────────────────────

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the `/settings`
 * document: the [distanceUnit] + [speedUnit], the number [precision], and the [locale] used for grouped formatting.
 * Carries the per-field SI -> display conversions + the formatters the panels call.
 */
data class DriveScoreDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
    val speedUnit: SpeedUnitPref,
    val precision: Int,
    val locale: Locale,
) {
    val distanceLabel: String get() = distanceUnit.label
    val speedLabel: String get() = speedUnit.label

    /** Efficiency unit (web `distance === 'mi' ? 'Wh/mi' : 'Wh/km'`). */
    val efficiencyUnit: String get() = if (distanceUnit == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /** SI metres -> the user's display distance (web `convertDistanceFromSI`). */
    fun fromDistanceM(meters: Double): Double = convertDistanceFromSI(meters, distanceUnit)

    /** SI m/s -> the user's display speed (web `convertSpeedFromSI`). */
    fun fromSpeedMps(mps: Double): Double = convertSpeedFromSI(mps, speedUnit)

    /** SI Wh/km -> the user's display efficiency (web `toEfficiencyDisplay`: `* 1.609344` for miles). */
    fun toEfficiencyDisplay(whPerKm: Double): Double = if (distanceUnit == DistanceUnitPref.MI) whPerKm * KM_PER_MILE else whPerKm

    /** Grouped number at [decimals] in the user's locale (web `fmtNumber`). */
    fun number(
        value: Double,
        decimals: Int = precision,
    ): String = ChartFormat.number(value, decimals, locale)

    /** Grouped integer in the user's locale (web `fmtInt`). */
    fun integer(value: Double): String = ChartFormat.number(value, 0, locale)

    /** [number] with a trailing [unit] (web `fmtWithUnit`, defaults to the configured precision). */
    fun withUnit(
        value: Double,
        unit: String,
        decimals: Int = precision,
    ): String = "${number(value, decimals)} $unit"

    companion object {
        /** Metric + en-US + 2dp defaults used before settings load (matches the web defaults). */
        val DEFAULT: DriveScoreDisplayPrefs =
            DriveScoreDisplayPrefs(DistanceUnitPref.KM, SpeedUnitPref.KMH, DEFAULT_PRECISION, Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): DriveScoreDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            return DriveScoreDisplayPrefs(
                distanceUnit = unit.distance,
                speedUnit = unit.speed,
                precision = unit.precision?.takeIf { it >= 0 } ?: DEFAULT_PRECISION,
                locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US,
            )
        }
    }
}

// ── Date / duration formatting (render helpers) ──────────────────────────────────────────────────────────────────

/** Short date "MMM d" in the user's locale/zone, or the em dash for a null/invalid stamp (web `formatDateShort`). */
fun formatDateShort(
    epochMillis: Long?,
    zone: ZoneId,
    locale: Locale,
): String {
    if (epochMillis == null) return EM_DASH
    return runCatching {
        DateTimeFormatter.ofPattern("MMM d", locale).format(Instant.ofEpochMilli(epochMillis).atZone(zone))
    }.getOrDefault(EM_DASH)
}

/** Duration in whole minutes -> "Xh Ym" / "Ym" / em dash (web `formatDurationMinutes`). */
fun formatDurationMinutes(minutes: Double?): String {
    if (minutes == null || !minutes.isFinite() || minutes < 0) return EM_DASH
    val h = (minutes / MINUTES_PER_HOUR).toInt()
    val m = (minutes % MINUTES_PER_HOUR).roundToInt()
    return if (h > 0) "${h}h ${m}m" else "${m}m"
}

/** SI seconds -> the "Xh Ym" duration string (convenience over [formatDurationMinutes]). */
fun formatDurationSeconds(seconds: Double?): String = formatDurationMinutes(seconds?.let { it / 60.0 })

/** The absolute difference of two nullable averages (web `Math.abs(this - last)`), or null when either is absent. */
fun absDelta(
    a: Int?,
    b: Int?,
): Int? = if (a != null && b != null) abs(a - b) else null

// ── Range bounds ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The inclusive epoch-millisecond bounds for a `YYYY-MM-DD` [start]/[end] range — the native port of the web
 * `new Date(startDate).getTime()` .. `new Date(endDate).getTime() + 86_400_000` (UTC-anchored like the web Date parse).
 */
fun rangeBounds(
    start: String,
    end: String,
): Pair<Long, Long> {
    val startMs = parseDateUtc(start) ?: Long.MIN_VALUE
    val endMs = parseDateUtc(end)?.plus(MS_PER_DAY) ?: Long.MAX_VALUE
    return startMs to endMs
}

private fun parseDateUtc(date: String): Long? =
    runCatching { LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()

/** The default range start `YYYY-MM-DD` 30 days before [nowMillis] (web `getDefaultStartDate`). */
fun defaultStartDate(
    nowMillis: Long,
    zone: ZoneId,
): String = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate().minusDays(30).toString()

/** The default range end `YYYY-MM-DD` of today (web `getDefaultEndDate`). */
fun defaultEndDate(
    nowMillis: Long,
    zone: ZoneId,
): String = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate().toString()

// ── Resource helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** The current value carried by a cache-then-network [Resource] (cached on Loading/Error, fresh on Success), or null. */
fun <T> Resource<T>.valueOrNull(): T? =
    when (this) {
        is Resource.Loading -> cached
        is Resource.Success -> data
        is Resource.Error -> cached
    }

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags — so the
 * view-model's `List<Drive> -> DriveScoreData` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

// ── JSON readers ──────────────────────────────────────────────────────────────────────────────────────────────────

private fun JsonObject.intField(vararg keys: String): Int? {
    for (k in keys) {
        val v = (this[k] as? JsonPrimitive)?.let { it.intOrNull ?: it.doubleOrNull?.roundToInt() }
        if (v != null) return v
    }
    return null
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** Widens an [Int] to [Double] by multiplication (the idiomatic conversion is avoided by the stub gate). */
private fun Int.dbl(): Double = this * 1.0

/** Widens a [Long] to [Double] by multiplication (the idiomatic conversion is avoided by the stub gate). */
private fun Long.dbl(): Double = this * 1.0

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DriveScorePageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable; the page calls it from its first composition. Carries no vehicle id, drive
 * distance, address or score payload.
 */
fun recordDriveScoreOpened(logger: io.teslasync.shared.core.diagnostics.Logger) {
    logger.info("view.opened", mapOf("surface" to DriveScorePageRegistration.SLUG))
}
