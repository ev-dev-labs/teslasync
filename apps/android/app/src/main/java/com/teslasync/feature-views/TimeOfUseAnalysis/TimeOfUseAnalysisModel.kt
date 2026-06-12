// Pure, framework-free model + projection for the Time-of-Use rate-analysis feature view — the native
// analogue of everything the web component renders before returning JSX
// (web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent (useCostAnalysisData) hands it an already-derived
// `hourlyData: HourBucket[]` and `touInsights: TouInsights | null`, and it renders two independent regions:
// (1) an hourly sessions bar chart whose bars are tinted by time-of-use band (peak 14–19 → red, off-peak
// ≥22 or <6 → green, otherwise mid-peak), plus a static peak/mid/off-peak legend; and (2) four insight
// cards (Cheapest / Priciest / Busiest hour + Off-Peak charging ratio). This file owns those derivations:
// [TimeOfUseAnalysisProjection.ratePeriod] mirrors the web per-bar `isPeak` / `isOffPeak` classification,
// and [TimeOfUseAnalysisProjection.project] mirrors the chart inputs + the four insight cards, both of the
// component's independent empty branches included.
//
// Per-bar `<Cell>` tinting is the shared chart renderer's concern — feature views must not import Vico nor
// alter the shared chart layer (allowed-files) — so the native chart carries one color per series and the
// per-band palette is reproduced faithfully in the legend (the same compromise the sibling ChargerTypeChart
// surface documents). The [RatePeriod] classification is still ported + tested because it is the web
// component's own logic, and it drives the legend's band labels at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TimeOfUseAnalysis — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.timeofuseanalysis

import io.teslasync.shared.core.diagnostics.Logger

/** First peak hour, inclusive — the web `entry.hour >= 14`. */
internal const val PEAK_START_HOUR: Int = 14

/** Last peak hour, inclusive — the web `entry.hour <= 19`. */
internal const val PEAK_END_HOUR: Int = 19

/** First off-peak evening hour, inclusive — the web `entry.hour >= 22`. */
internal const val OFF_PEAK_START_HOUR: Int = 22

/** First non-off-peak morning hour, exclusive bound — the web `entry.hour < 6`. */
internal const val OFF_PEAK_END_HOUR_EXCLUSIVE: Int = 6

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TimeOfUseAnalysisRegistration {
    /** Stable surface id. */
    const val ID: String = "time-of-use-analysis"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TimeOfUseAnalysis"
}

/**
 * The time-of-use rate band an hour falls into — the stable, locale-independent key the web derives inline
 * per bar (`isPeak` / `isOffPeak`). Kept as an enum so the classification stays correct across locales and
 * the display label / swatch color are resolved at the render boundary (P1/S9 + S10), never hard-coded
 * English in logic.
 */
enum class RatePeriod {
    /** On-peak hours 14:00–19:00 (web `hour >= 14 && hour <= 19`). */
    Peak,

    /** Mid-peak — any hour that is neither peak nor off-peak (web fallback). */
    MidPeak,

    /** Off-peak hours 22:00–05:59 (web `hour >= 22 || hour < 6`). */
    OffPeak,
}

/**
 * One hourly bucket — the native mirror of the web `HourBucket` the parent precomputes. [hour] is the
 * 0–23 hour, [label] its already-formatted `"HH:00"` axis label, [sessions] the session count, [avgCost]
 * the mean session cost in the user's currency, and [totalEnergy] the bucket energy in display kWh. The
 * component reads [label] / [sessions] for the chart and [avgCost] / [sessions] for the insights.
 */
data class TouHourBucket(
    val hour: Int,
    val label: String,
    val sessions: Long,
    val avgCost: Double,
    val totalEnergy: Double,
)

/**
 * The four time-of-use insights — the native mirror of the web `TouInsights`. [cheapest] / [priciest] /
 * [busiest] are the extreme hourly buckets and [offPeakPct] the share of sessions started between 22:00 and
 * 06:00, as a 0–100 percentage.
 */
data class TouInsights(
    val cheapest: TouHourBucket,
    val priciest: TouHourBucket,
    val busiest: TouHourBucket,
    val offPeakPct: Double,
)

/**
 * The component's two props as one immutable value (web `hourlyData` + `touInsights`). [hourlyData] is the
 * ascending-by-hour bucket list (empty when there are no sessions) and [insights] is `null` when no hour has
 * any sessions, mirroring the web's two independent empty branches.
 */
data class TimeOfUseData(
    val hourlyData: List<TouHourBucket>,
    val insights: TouInsights?,
)

/** Which insight an [TouInsightCard] represents — resolves to its accent color at the render boundary. */
enum class TouTone { Cheapest, Priciest, Busiest, OffPeak }

/**
 * One render-ready insight card — the native mirror of a web insight `GlassPanel`: a [label] header, a
 * colored [value] (an hour label or a percentage), and a muted [caption]. [tone] selects the value color at
 * the render boundary (P1/S9), keeping this holder free of Compose color types.
 */
data class TouInsightCard(
    val tone: TouTone,
    val label: String,
    val value: String,
    val caption: String,
)

/**
 * The render-ready chart inputs — the native analogue of the props the web `<BarChart>` reads. [xLabels]
 * are the per-hour `"HH:00"` axis labels and [sessionValues] the matching session counts; [isEmpty] is the
 * web `hourlyData.length === 0` guard that swaps the chart for the "Not enough data" empty state.
 */
data class TimeOfUseChartData(
    val xLabels: List<String>,
    val sessionValues: List<Double>,
    val isEmpty: Boolean,
)

/**
 * The fully projected, render-ready surface inputs. The composable feeds [chart] to the shared bar wrapper,
 * renders [insightCards] (empty when [hasInsights] is false — the web `touInsights ? … : noInsights`
 * branch), and never hides either region.
 */
data class TimeOfUseProjectionResult(
    val chart: TimeOfUseChartData,
    val insightCards: List<TouInsightCard>,
    val hasInsights: Boolean,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — every
 * `costAnalysis.tou.*` insight key the web component resolves via `t(...)`. The chart "Not enough data"
 * message and lifecycle chrome (loading / error / retry / offline / freshness) are resolved inline at the
 * Compose boundary, so this holder stays a thin content carrier.
 */
data class TimeOfUseStrings(
    val title: String,
    val insights: String,
    val cheapestHour: String,
    val priciestHour: String,
    val busiestHour: String,
    val offPeakRatio: String,
    val offPeakDesc: String,
    val noInsights: String,
    val avgCost: String,
    val perSession: String,
    val sessions: String,
    val peak: String,
    val midPeak: String,
    val offPeak: String,
)

/**
 * The locale-bound formatters the projection injects so it stays deterministic and UI-free under test
 * (the native analogue of the web `fmtNumber` / `fmtInt` calls + the `$` / `%` literals). [avgCostSummary]
 * builds the cheapest/priciest caption (web `avg ${fmtNumber(cost, 3)} / session`); [sessionsSummary] the
 * busiest caption (web `{fmtInt(sessions)} sessions`); [percent] the off-peak value (web
 * `{fmtNumber(pct, 1)}%`).
 */
data class TimeOfUseFormatters(
    val avgCostSummary: (Double) -> String,
    val sessionsSummary: (Long) -> String,
    val percent: (Double) -> String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-bar band
 * classification, its chart inputs, and its four insight cards. Stateless and side-effect-free so it is
 * fully covered by the off-device unit gate.
 */
object TimeOfUseAnalysisProjection {
    /**
     * Classifies an [hour] (0–23) into its [RatePeriod] — the native mirror of the web per-bar logic:
     * 14:00–19:00 is [RatePeriod.Peak]; 22:00–05:59 is [RatePeriod.OffPeak]; everything else is
     * [RatePeriod.MidPeak]. A single `when` keeps this within the return-count budget.
     */
    fun ratePeriod(hour: Int): RatePeriod =
        when {
            hour in PEAK_START_HOUR..PEAK_END_HOUR -> RatePeriod.Peak
            hour >= OFF_PEAK_START_HOUR || hour < OFF_PEAK_END_HOUR_EXCLUSIVE -> RatePeriod.OffPeak
            else -> RatePeriod.MidPeak
        }

    /**
     * Projects [data] into render-ready chart inputs + insight cards via the injected [strings] and
     * [formatters]. The chart mirrors the web `hourlyData` map (labels + session counts + the empty guard)
     * and the cards mirror the `touInsights ? … : null` branch — an absent [TimeOfUseData.insights] yields
     * no cards and [TimeOfUseProjectionResult.hasInsights] `false`, so the composable shows the
     * "No insights available" empty state instead of hiding the region.
     */
    fun project(
        data: TimeOfUseData,
        strings: TimeOfUseStrings,
        formatters: TimeOfUseFormatters,
    ): TimeOfUseProjectionResult {
        val chart =
            TimeOfUseChartData(
                xLabels = data.hourlyData.map { it.label },
                // `+ 0.0` widens each Long session count to the chart series' Double input type.
                sessionValues = data.hourlyData.map { it.sessions + 0.0 },
                isEmpty = data.hourlyData.isEmpty(),
            )
        val cards = data.insights?.let { insightCards(it, strings, formatters) } ?: emptyList()
        return TimeOfUseProjectionResult(chart = chart, insightCards = cards, hasInsights = data.insights != null)
    }

    /**
     * Builds the four insight cards in the web's order (cheapest, priciest, busiest, off-peak ratio). The
     * cheapest / priciest cards show the hour label with an `avg $cost / session` caption; the busiest card
     * shows the hour label with a `{count} sessions` caption; the off-peak card shows the percentage with
     * its descriptive caption.
     */
    fun insightCards(
        insights: TouInsights,
        strings: TimeOfUseStrings,
        formatters: TimeOfUseFormatters,
    ): List<TouInsightCard> =
        listOf(
            TouInsightCard(
                tone = TouTone.Cheapest,
                label = strings.cheapestHour,
                value = insights.cheapest.label,
                caption = formatters.avgCostSummary(insights.cheapest.avgCost),
            ),
            TouInsightCard(
                tone = TouTone.Priciest,
                label = strings.priciestHour,
                value = insights.priciest.label,
                caption = formatters.avgCostSummary(insights.priciest.avgCost),
            ),
            TouInsightCard(
                tone = TouTone.Busiest,
                label = strings.busiestHour,
                value = insights.busiest.label,
                caption = formatters.sessionsSummary(insights.busiest.sessions),
            ),
            TouInsightCard(
                tone = TouTone.OffPeak,
                label = strings.offPeakRatio,
                value = formatters.percent(insights.offPeakPct),
                caption = strings.offPeakDesc,
            ),
        )
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TimeOfUseAnalysisRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordTimeOfUseAnalysisOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TimeOfUseAnalysisRegistration.SLUG))
}
