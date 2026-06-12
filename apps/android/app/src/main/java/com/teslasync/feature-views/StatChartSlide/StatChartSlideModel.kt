// Pure, framework-free model + projection for the "stat chart" Year-in-Review slide feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/analytics/components/review/StatChartSlide.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// The web slide is purely presentational — its parent (the Year in Review carousel `SlideRenderer`) holds the
// loaded `YearReview` and passes it down. This file owns the parts the web render derives from that prop: the
// monthly drives bar series (web `data.monthly_stats.map(m => ({ name: MONTH_LABELS[m.month-1] ?? \`M${m.month}\`,
// drives: m.drives }))`), the headline total-drives figure fed to the count-up number (web
// `<AnimatedNumber value={data.total_drives} />`), and the "drives per week on average" count (web
// `fmtNumber(data.avg_drives_per_week, 1)`). The monthly order is preserved exactly as received, so the native
// categorical bar chart reads left-to-right in the same order as the web chart.
//
// Month-label parity note: the web `MONTH_LABELS` is a hard-coded `['Jan' … 'Dec']` const (not a `t()` call),
// so the abbreviations are fixed data labels — reproduced verbatim here exactly as the sibling
// `YearReviewWidget` `MONTH_NAMES` does — with the same `M{month}` fallback for an out-of-range month index
// (web `?? \`M${m.month}\``). They are not user-facing i18n strings, so they carry no catalog key.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/StatChartSlide — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statchartslide

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** Fraction digits for the count-up total (web `<AnimatedNumber />` renders an integer). */
internal const val TOTAL_DRIVES_DECIMALS: Int = 0

/** Fraction digits for the "drives per week" figure (web `fmtNumber(data.avg_drives_per_week, 1)`). */
internal const val AVG_PER_WEEK_DECIMALS: Int = 1

/**
 * Abbreviated month labels indexed 0=Jan … 11=Dec — the verbatim native mirror of the web `MONTH_LABELS`
 * const. Fixed data labels (not an i18n key), matching the sibling `YearReviewWidget`.
 */
private val MONTH_LABELS: List<String> =
    listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object StatChartSlideRegistration {
    /** Stable surface id. */
    const val ID: String = "stat-chart-slide"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StatChartSlide"
}

/**
 * One `monthly_stats` row the bar series reads — the native mirror of the web `YearReviewMonthStat` fields
 * this slide touches (`{ month, drives }`). [month] is the 1-based calendar month and [drives] the count of
 * drives that month (a non-negative tally rendered as the bar height).
 */
data class StatChartMonth(
    val month: Int,
    val drives: Double,
)

/**
 * The subset of the decoded `/analytics/year-review` payload this slide renders — the native analogue of the
 * `YearReview` fields the web `StatChartSlide` reads off its `data` prop: [totalDrives] (web
 * `data.total_drives`, the count-up headline), [avgDrivesPerWeek] (web `data.avg_drives_per_week`, the caption
 * figure), and [monthlyStats] (web `data.monthly_stats`, the bar series). All numerics are raw on the wire;
 * a missing/absent field collapses to zero / empty, exactly like the web optional-chaining (`?? 0` / `?? []`).
 */
data class StatChartData(
    val totalDrives: Double,
    val avgDrivesPerWeek: Double,
    val monthlyStats: List<StatChartMonth>,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the two
 * `yearReview.*` keys the web slide resolves via `t(...)`: the [drivesLabel] beside the count-up number (web
 * `t('yearReview.drives', 'drives')`) and the [avgPerWeekTemplate] sentence (web
 * `t('yearReview.avgPerWeek', …)`), a format string with a single `%1$s` slot for the count. The
 * lifecycle-chrome strings (empty / error / retry / offline / freshness) are resolved inline at the Compose
 * boundary, not here, so this holder stays a thin content carrier.
 */
data class StatChartSlideStrings(
    val drivesLabel: String,
    val avgPerWeekTemplate: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the props the web `<BarChart>`
 * reads from `chartData`. Pure data (no Compose types) so the projection is unit-tested without a UI host:
 * the composable wraps [driveValues] into a single `ChartSeries`, feeds [xLabels] to the bar chart's bottom
 * axis, and the chart layer shows its own empty message when [hasChartData] is false (no monthly rows).
 */
data class StatChartSlideProjectionResult(
    val xLabels: List<String>,
    val driveValues: List<Double>,
    val hasChartData: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `useMemo` chart-data
 * mapping plus its caption formatting. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate.
 */
object StatChartSlideProjection {
    /**
     * Projects the loaded [data] into render-ready chart inputs, preserving the received month order. Each
     * monthly row contributes one X-axis label ([monthLabel] of its `month`) and one bar value (its `drives`).
     * Mirrors the web `data.monthly_stats.map(...)`.
     */
    fun project(data: StatChartData): StatChartSlideProjectionResult =
        StatChartSlideProjectionResult(
            xLabels = data.monthlyStats.map { monthLabel(it.month) },
            driveValues = data.monthlyStats.map { it.drives },
            hasChartData = data.monthlyStats.isNotEmpty(),
        )

    /**
     * The abbreviated label for a 1-based [month] — `MONTH_LABELS[month - 1]`, falling back to `M{month}` for
     * an out-of-range index (web `?? \`M${m.month}\``).
     */
    fun monthLabel(month: Int): String = MONTH_LABELS.getOrNull(month - 1) ?: "M$month"

    /**
     * The locale-grouped "drives per week" count with one fraction digit — the web `fmtNumber(value, 1)`. The
     * composable substitutes this into the localized [StatChartSlideStrings.avgPerWeekTemplate] sentence.
     */
    fun formatAvgPerWeek(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value, AVG_PER_WEEK_DECIMALS, locale)
}

/**
 * Decodes the raw `/analytics/year-review` [json] (snake_case on the wire) into a [StatChartData], or `null`
 * when the payload is absent. A non-object input or an empty object resolves to `null`, reproducing the web
 * `data ?` truthiness gate (a missing recap renders the empty surface, while any populated payload — even one
 * with zero totals or no monthly rows — renders the slide). A missing field or a JSON-null field collapses to
 * zero / empty, reproducing the web optional-chaining (`data.total_drives` / `data.monthly_stats ?? []`).
 */
fun parseStatChartData(json: JsonElement?): StatChartData? {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return null
    val months =
        (obj["monthly_stats"] as? JsonArray)
            ?.mapNotNull { element ->
                (element as? JsonObject)?.let { StatChartMonth(month = it.int("month"), drives = it.double("drives")) }
            }.orEmpty()
    return StatChartData(
        totalDrives = obj.double("total_drives"),
        avgDrivesPerWeek = obj.double("avg_drives_per_week"),
        monthlyStats = months,
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 0

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [StatChartSlideRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect. Carries no drive / distance payload, so a diagnostics line can never leak the
 * owner's annual totals.
 */
fun recordStatChartSlideOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to StatChartSlideRegistration.SLUG))
}
