// Pure, framework-free model + projection for the OptimizerSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/charging/components/charging-list/OptimizerSection.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// OptimizerSection is a presentational section — the web component takes its `optimizer`
// (a `ChargingOptimizerData`) as a prop from the charging page that owns the TanStack query, so this surface
// binds no data hook of its own (its only web hook is `useTranslation`). As in the sibling
// ChargingBreakdownSlide port, the cache-then-network lifecycle (loading / error / stale / offline) is
// supplied by the owning page through the shared P1/S8 state-holder layer as a [UiState]; the composable
// renders every state that layer can carry without ever fetching. This pure file owns the parts the web
// render derives from `optimizer`: the savings-banner gate (web `potential_monthly_savings > 5`), the
// battery-score band (web `>= 75 / >= 50` ternary), the formatted habit + cost rows, the "sessions during
// peak" emphasis flag (web `> 30`), the joined peak/off-peak hour lists, the per-recommendation level +
// savings badge, and the weekly cost-heatmap grid with its intensity color math.
//
// The cost-heatmap grid (web child `CostHeatmap.tsx`) is rendered INLINE by this surface — the heatmap is a
// section of OptimizerSection's own parity, projected here as a 7×24 [HeatCell] grid so the surface never
// drops a visible section. The reusable standalone heatmap is a separate surface; this projection is private
// to OptimizerSection.
//
// All wire models default every field and carry snake_case @SerialName names, so a partial or still-loading
// payload decodes without error (a decoder must ignore unknown keys — the optimizer endpoint carries more).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/OptimizerSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ChargingBreakdownSlide surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.optimizersection

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.util.Locale
import kotlin.math.min
import kotlin.math.roundToInt

// ── Wire models (the subset of the web `ChargingOptimizerData` this section reads) ───────────────────

/**
 * The optimizer payload this section renders — the native mirror of the web `ChargingOptimizerData`
 * (web/src/types/charging.ts). snake_case wire names are kept via @SerialName and every field defaults so a
 * partial payload decodes without error.
 */
@Serializable
data class ChargingOptimizerData(
    @SerialName("current_schedule") val currentSchedule: OptimizerSchedule = OptimizerSchedule(),
    @SerialName("cost_analysis") val costAnalysis: OptimizerCostAnalysis = OptimizerCostAnalysis(),
    @SerialName("battery_health_score") val batteryHealthScore: Double = 0.0,
    val recommendations: List<OptimizerRecommendation> = emptyList(),
    @SerialName("weekly_heatmap") val weeklyHeatmap: List<OptimizerHeatmapEntry> = emptyList(),
)

/** The "Charging Habits" panel inputs (web `optimizer.current_schedule`). */
@Serializable
data class OptimizerSchedule(
    @SerialName("most_common_start_hour") val mostCommonStartHour: Int = 0,
    @SerialName("most_common_day") val mostCommonDay: String = "",
    @SerialName("avg_sessions_per_week") val avgSessionsPerWeek: Double = 0.0,
    @SerialName("home_charging_pct") val homeChargingPct: Double = 0.0,
    @SerialName("avg_charge_to_pct") val avgChargeToPct: Double = 0.0,
)

/** The "Cost Analysis" panel inputs (web `optimizer.cost_analysis`). */
@Serializable
data class OptimizerCostAnalysis(
    @SerialName("peak_hours") val peakHours: List<Int> = emptyList(),
    @SerialName("offpeak_hours") val offpeakHours: List<Int> = emptyList(),
    @SerialName("peak_cost_per_kwh") val peakCostPerKwh: Double = 0.0,
    @SerialName("offpeak_cost_per_kwh") val offpeakCostPerKwh: Double = 0.0,
    @SerialName("sessions_during_peak_pct") val sessionsDuringPeakPct: Double = 0.0,
    @SerialName("potential_monthly_savings") val potentialMonthlySavings: Double = 0.0,
)

/** One optimization recommendation (web `optimizer.recommendations[]`). */
@Serializable
data class OptimizerRecommendation(
    val type: String = "",
    val priority: String = "",
    val title: String = "",
    val detail: String = "",
    @SerialName("estimated_savings") val estimatedSavings: Double? = null,
)

/** One weekly cost-heatmap reading (web `optimizer.weekly_heatmap[]`). */
@Serializable
data class OptimizerHeatmapEntry(
    val day: Int = 0,
    val hour: Int = 0,
    val sessions: Int = 0,
    @SerialName("avg_cost_per_kwh") val avgCostPerKwh: Double = 0.0,
)

// ── Render-ready projection types (pure data, no Compose) ────────────────────────────────────────────

/** The battery-friendly score band — selects the gauge color and the message (web `>= 75 / >= 50` ternary). */
enum class ScoreBand { Good, Fair, Poor }

/** A recommendation's priority band — selects its accent color + chip style (web `high / medium / low`). */
enum class RecommendationLevel { High, Medium, Low }

/** The five formatted "Charging Habits" rows (values pre-formatted; labels resolved at the Compose boundary). */
data class HabitValues(
    val sessionsPerWeek: String,
    val homePct: String,
    val avgTargetPct: String,
    val commonHour: String,
    val commonDay: String,
)

/**
 * The formatted "Cost Analysis" rows. [sessionsDuringPeakHigh] mirrors the web `> 30` red/emerald emphasis;
 * the composable maps it to a status color. Hour lists are pre-joined ("16:00, 17:00" or an em dash).
 */
data class CostAnalysisDisplay(
    val peakRate: String,
    val offpeakRate: String,
    val sessionsDuringPeakPct: String,
    val sessionsDuringPeakHigh: Boolean,
    val peakHours: String,
    val offpeakHours: String,
)

/**
 * One render-ready recommendation. [priorityLabel] is the uppercased raw priority for the chip (web renders
 * `{rec.priority}` with a CSS uppercase); [savingsBadge] is the "~$N/mo" pill or `null` (web shows it only
 * when `estimated_savings > 0`).
 */
data class RecommendationDisplay(
    val title: String,
    val detail: String,
    val level: RecommendationLevel,
    val priorityLabel: String,
    val savingsBadge: String?,
)

/** One heatmap cell — its [day]/[hour] coordinate, [sessions] count, and normalized [intensity] (0–1). */
data class HeatCell(
    val day: Int,
    val hour: Int,
    val sessions: Int,
    val intensity: Double,
)

/** The weekly cost heatmap. [visible] mirrors the web `weekly_heatmap.length > 0` gate; [rows] is 7×24 when shown. */
data class HeatmapDisplay(
    val visible: Boolean,
    val rows: List<List<HeatCell>>,
)

/** A theme-invariant data-viz color (0–255 channels, 0–1 alpha) for the heatmap gradient + legend swatches. */
data class HeatRgba(
    val red: Int,
    val green: Int,
    val blue: Int,
    val alpha: Double,
)

/**
 * The fully projected, render-ready section — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class OptimizerDisplay(
    val showSavingsBanner: Boolean,
    val savingsAmount: String,
    val habits: HabitValues,
    val batteryScore: Double,
    val scoreBand: ScoreBand,
    val cost: CostAnalysisDisplay,
    val recommendations: List<RecommendationDisplay>,
    val heatmap: HeatmapDisplay,
)

// ── Projection ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Pure projection from a [ChargingOptimizerData] to its render-ready [OptimizerDisplay] — a 1:1 port of the
 * derivations the web component performs before returning JSX. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate. [locale] governs number formatting (parity with the web `fmtNumber`
 * grouping); it defaults to the device locale and is injected explicitly by the unit tests.
 */
object OptimizerProjection {
    /** Wire priority value for the highest band (web `rec.priority === 'high'`). */
    private const val HIGH = "high"

    /** Wire priority value for the middle band (web `rec.priority === 'medium'`). */
    private const val MEDIUM = "medium"

    /** Web savings-banner gate: only shown when the projected monthly saving exceeds this (web `> 5`). */
    private const val SAVINGS_BANNER_THRESHOLD = 5.0

    /** Score at/above which habits are "battery-friendly" (web `battery_health_score >= 75`). */
    private const val SCORE_GOOD = 75.0

    /** Score at/above which there is "room for improvement" (web `battery_health_score >= 50`). */
    private const val SCORE_FAIR = 50.0

    /** Peak-session share above which the value is shown in the danger color (web `> 30`). */
    private const val SESSIONS_PEAK_HIGH_THRESHOLD = 30.0

    /** Days per heatmap column group (Sun–Sat), matching the web grid rows. */
    const val DAYS_PER_WEEK: Int = 7

    /** Hours per heatmap row, matching the web grid columns (0–23). */
    const val HOURS_PER_DAY: Int = 24

    /** Web `maxCost = peakCostPerKwh || 0.30` fallback when the peak rate is unknown/zero. */
    private const val DEFAULT_MAX_COST = 0.30

    // Heatmap gradient coefficients — the exact web rgba() channel math (red rises, green/blue fall with cost).
    private const val RED_COEFFICIENT = 239.0
    private const val GREEN_COEFFICIENT = 187.0
    private const val BLUE_COEFFICIENT = 100.0
    private const val ALPHA_BASE = 0.15
    private const val ALPHA_PER_SESSION = 0.12
    private const val ALPHA_MAX = 0.9

    /** Fixed alpha of the Cheap→Expensive legend swatches (web `0.6`). */
    private const val LEGEND_ALPHA = 0.6

    /** Decimal places for the per-kWh rates (web `fmtNumber(_, 3)`). */
    private const val RATE_DECIMALS = 3

    /** Decimal places for the sessions-per-week figure (web `fmtNumber(_, 1)`). */
    private const val SESSIONS_DECIMALS = 1

    /** The opacity stops the web legend draws, low→high cost. */
    val LEGEND_STOPS: List<Double> = listOf(0.15, 0.3, 0.5, 0.7, 0.9)

    /** Select the render-ready view for [data]. */
    fun project(
        data: ChargingOptimizerData,
        locale: Locale = Locale.getDefault(),
    ): OptimizerDisplay {
        val analysis = data.costAnalysis
        return OptimizerDisplay(
            showSavingsBanner = safe(analysis.potentialMonthlySavings) > SAVINGS_BANNER_THRESHOLD,
            savingsAmount = formatNumber(analysis.potentialMonthlySavings, 0, locale),
            habits = projectHabits(data.currentSchedule, locale),
            batteryScore = safe(data.batteryHealthScore),
            scoreBand = scoreBand(data.batteryHealthScore),
            cost = projectCost(analysis, locale),
            recommendations = data.recommendations.map { projectRecommendation(it, locale) },
            heatmap = projectHeatmap(data.weeklyHeatmap, analysis.peakCostPerKwh),
        )
    }

    /** The battery-score band — the web `>= 75` / `>= 50` ternary; non-finite folds to [ScoreBand.Poor]. */
    fun scoreBand(score: Double): ScoreBand =
        when {
            score >= SCORE_GOOD -> ScoreBand.Good
            score >= SCORE_FAIR -> ScoreBand.Fair
            else -> ScoreBand.Poor
        }

    /** Map a wire priority string to its [RecommendationLevel]; unknown/blank folds to [RecommendationLevel.Low]. */
    fun level(priority: String): RecommendationLevel =
        when (priority.trim().lowercase(Locale.ROOT)) {
            HIGH -> RecommendationLevel.High
            MEDIUM -> RecommendationLevel.Medium
            else -> RecommendationLevel.Low
        }

    /**
     * The joined hour list the web renders, e.g. "16:00, 17:00" (web `hours.map(h => h + ':00').join(', ')`).
     * An empty list folds to the em dash, matching the web `|| '—'` fallback.
     */
    fun hourList(hours: List<Int>): String =
        if (hours.isEmpty()) ChartFormat.EMPTY else hours.joinToString(separator = ", ") { hourLabel(it) }

    /** The "~$N/mo" savings pill, or `null` when there is no positive estimate (web `estimated_savings > 0`). */
    fun savingsBadge(
        value: Double?,
        locale: Locale = Locale.getDefault(),
    ): String? {
        if (value == null || !value.isFinite() || value <= 0.0) return null
        return "~\$${formatNumber(value, 0, locale)}/mo"
    }

    /**
     * Project the weekly cost heatmap into a 7×24 [HeatCell] grid (web rows Sun–Sat × columns 0–23). The web
     * `maxCost = peakCostPerKwh || 0.30` normalizes the per-cell intensity (web `min(1, cost / maxCost)`).
     * Returns an invisible, empty grid when there are no readings (web `weekly_heatmap.length > 0` gate).
     */
    fun projectHeatmap(
        entries: List<OptimizerHeatmapEntry>,
        peakCostPerKwh: Double,
    ): HeatmapDisplay {
        if (entries.isEmpty()) return HeatmapDisplay(visible = false, rows = emptyList())
        val maxCost = peakCostPerKwh.takeIf { it.isFinite() && it > 0.0 } ?: DEFAULT_MAX_COST
        // Web `heatmap.find(...)` keeps the FIRST match per (day, hour); reverse so associateBy's last-wins keeps it.
        val byKey = entries.reversed().associateBy { it.day * HOURS_PER_DAY + it.hour }
        val rows =
            (0 until DAYS_PER_WEEK).map { day ->
                (0 until HOURS_PER_DAY).map { hour ->
                    val entry = byKey[day * HOURS_PER_DAY + hour]
                    val sessions = entry?.sessions ?: 0
                    val cost = safe(entry?.avgCostPerKwh ?: 0.0)
                    val intensity = if (maxCost > 0.0) min(1.0, cost / maxCost) else 0.0
                    HeatCell(day = day, hour = hour, sessions = sessions, intensity = intensity.coerceIn(0.0, 1.0))
                }
            }
        return HeatmapDisplay(visible = true, rows = rows)
    }

    /**
     * The cost-gradient color for a populated cell — the exact web rgba() math: red rises and green/blue fall
     * with [intensity], and the alpha grows with the [sessions] count up to a cap. Callers render empty cells
     * (sessions ≤ 0) with a theme-neutral fill instead of calling this.
     */
    fun heatColor(
        intensity: Double,
        sessions: Int,
    ): HeatRgba {
        val normalized = intensity.coerceIn(0.0, 1.0)
        val alpha = min(ALPHA_MAX, ALPHA_BASE + sessions.coerceAtLeast(0) * ALPHA_PER_SESSION)
        return HeatRgba(
            red = (normalized * RED_COEFFICIENT).roundToInt(),
            green = ((1.0 - normalized) * GREEN_COEFFICIENT).roundToInt(),
            blue = ((1.0 - normalized) * BLUE_COEFFICIENT).roundToInt(),
            alpha = alpha,
        )
    }

    /** A Cheap→Expensive legend swatch color for an opacity stop (web fixed-alpha rgba over the same gradient). */
    fun legendColor(opacity: Double): HeatRgba {
        val stop = opacity.coerceIn(0.0, 1.0)
        return HeatRgba(
            red = (stop * RED_COEFFICIENT).roundToInt(),
            green = ((1.0 - stop) * GREEN_COEFFICIENT).roundToInt(),
            blue = ((1.0 - stop) * BLUE_COEFFICIENT).roundToInt(),
            alpha = LEGEND_ALPHA,
        )
    }

    private fun projectHabits(
        schedule: OptimizerSchedule,
        locale: Locale,
    ): HabitValues =
        HabitValues(
            sessionsPerWeek = formatNumber(schedule.avgSessionsPerWeek, SESSIONS_DECIMALS, locale),
            homePct = percent(schedule.homeChargingPct, locale),
            avgTargetPct = percent(schedule.avgChargeToPct, locale),
            commonHour = hourLabel(schedule.mostCommonStartHour),
            commonDay = schedule.mostCommonDay,
        )

    private fun projectCost(
        analysis: OptimizerCostAnalysis,
        locale: Locale,
    ): CostAnalysisDisplay =
        CostAnalysisDisplay(
            peakRate = rate(analysis.peakCostPerKwh, locale),
            offpeakRate = rate(analysis.offpeakCostPerKwh, locale),
            sessionsDuringPeakPct = percent(analysis.sessionsDuringPeakPct, locale),
            sessionsDuringPeakHigh = safe(analysis.sessionsDuringPeakPct) > SESSIONS_PEAK_HIGH_THRESHOLD,
            peakHours = hourList(analysis.peakHours),
            offpeakHours = hourList(analysis.offpeakHours),
        )

    private fun projectRecommendation(
        recommendation: OptimizerRecommendation,
        locale: Locale,
    ): RecommendationDisplay =
        RecommendationDisplay(
            title = recommendation.title,
            detail = recommendation.detail,
            level = level(recommendation.priority),
            priorityLabel = recommendation.priority.trim().uppercase(Locale.ROOT),
            savingsBadge = savingsBadge(recommendation.estimatedSavings, locale),
        )

    private fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String = ChartFormat.number(safe(value), decimals, locale)

    private fun percent(
        value: Double,
        locale: Locale,
    ): String = "${formatNumber(value, 0, locale)}%"

    private fun rate(
        value: Double,
        locale: Locale,
    ): String = "\$${formatNumber(value, RATE_DECIMALS, locale)}/kWh"

    private fun hourLabel(hour: Int): String = "$hour:00"

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}

// ── Diagnostics (P1/S11 view.opened contract) ──────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * user's charging schedule, costs, or recommendation contents — so a diagnostics line can never leak a
 * user's charging habits.
 */
object OptimizerSectionDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "optimizer-section"

    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "OptimizerSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
