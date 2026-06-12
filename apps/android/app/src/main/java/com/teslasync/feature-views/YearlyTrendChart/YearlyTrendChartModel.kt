// Pure, framework-free model + projection for the Yearly-Charging-Speed-Trend chart feature view — the
// native analogue of everything the web component reads from its prop before returning JSX
// (web/src/features/charging/components/charging-curve/YearlyTrendChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent (the Charging Curve page) computes the
// `{ year, avg10to80, avg20to80, count }[]` trend and passes it down; the component only maps it onto the
// shared `<ChartContainer>` + Recharts `<ComposedChart>` (a `count` bar on the right "Sessions" axis and two
// time-to-charge lines — `avg10to80` / `avg20to80` — on the left "Minutes" axis) plus the `dataColumns`
// fallback table. This file owns exactly those reads: [project] turns the trend into the year x-axis, the
// three plotted series (the bar + two lines), and the four-column fallback table (Year / 10→80% avg min /
// 20→80% avg min / DC Sessions), preserving the received row order so the chart, table, and legend agree.
//
// Display formatting (minutes to one decimal, the session count as a grouped integer) is injected through
// [YearlyTrendChartFormatters] so the projection stays locale-deterministic under test; the composable
// supplies the localized implementations. No English literal is hard-coded in logic — every label is
// resolved at the render boundary from the P1/S10 catalog.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/YearlyTrendChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.yearlytrendchart

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object YearlyTrendChartRegistration {
    /** Stable surface id. */
    const val ID: String = "yearly-trend-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "YearlyTrendChart"
}

/**
 * One year's charging-speed trend row — the native mirror of the web prop element
 * `{ year, avg10to80, avg20to80, count }`. [year] is the x-axis category label, [avg10to80] / [avg20to80]
 * are the average minutes to charge from 10→80% / 20→80% (the two left-axis lines), and [count] is the
 * number of DC charging sessions that year (the right-axis bar).
 */
data class YearlyTrendPoint(
    val year: String,
    val avg10to80: Double,
    val avg20to80: Double,
    val count: Long,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — every
 * `charging.curve.*` and `common.*` key the web component resolves via `t(...)`. [title] / [subtitle] /
 * [ariaLabel] are the web `t('charging.curve.yearlyTrend' | 'yearlyTrendDesc' | 'yearlyTrend.aria')`; the
 * `col*` strings are the `dataColumns` headers; [minutesAxisLabel] / [sessionsAxisLabel] are the two web
 * `<YAxis label>` titles; and the three series labels are the web `<Line name>` / `<Bar name>` + the custom
 * legend. The lifecycle-chrome strings (empty / error / retry / offline / freshness) are resolved inline at
 * the Compose boundary, so this holder stays a thin content carrier.
 */
data class YearlyTrendChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val colYear: String,
    val colAvg10to80: String,
    val colAvg20to80: String,
    val colDcSessions: String,
    val minutesAxisLabel: String,
    val sessionsAxisLabel: String,
    val avg10to80Label: String,
    val avg20to80Label: String,
    val dcSessionsLabel: String,
)

/**
 * The locale-bound formatters the projection injects so it stays deterministic and UI-free under test (the
 * native analogue of the values the web `dataColumns` renders from each row). [avgMinutes] formats the two
 * time-to-charge columns (one fraction digit), [sessionCount] the DC-session count column (grouped integer).
 */
data class YearlyTrendChartFormatters(
    val avgMinutes: (Double) -> String,
    val sessionCount: (Long) -> String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the props the web
 * `<ComposedChart>` + `<ChartContainer>` read from the `yearlyTrend` array. Pure data (no Compose types) so
 * the projection is unit-tested without a UI host: the composable wraps [countValues] into a bar
 * `ChartSeries` and [avg10to80Values] / [avg20to80Values] into two line series, feeds [xLabels] to the
 * bottom axis, renders [tableRows] as the `dataColumns` fallback table, and shows the empty state when
 * [isEmpty]. Series values are nullable to carry gaps (the Android `connectNulls`); a non-finite input
 * becomes `null` so a malformed row never plots `NaN`.
 */
data class YearlyTrendChartProjectionResult(
    val xLabels: List<String>,
    val avg10to80Values: List<Double?>,
    val avg20to80Values: List<Double?>,
    val countValues: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's two reads of the
 * `yearlyTrend` prop (the `<ComposedChart>` series and the `<ChartContainer dataColumns>` table). Stateless
 * and side-effect-free so it is fully covered by the off-device unit gate.
 */
object YearlyTrendChartProjection {
    /**
     * Projects [points] into render-ready chart inputs via the injected [formatters], preserving the
     * received row order. Mirrors the web component's reads: the year x-axis, the bar + two line series,
     * and the four-column fallback table (Year / 10→80% avg min / 20→80% avg min / DC Sessions). Returns an
     * empty result for no rows so the composable shows the friendly empty state rather than a blank panel.
     */
    fun project(
        points: List<YearlyTrendPoint>,
        formatters: YearlyTrendChartFormatters,
    ): YearlyTrendChartProjectionResult =
        YearlyTrendChartProjectionResult(
            xLabels = points.map { it.year },
            avg10to80Values = points.map { finiteOrNull(it.avg10to80) },
            avg20to80Values = points.map { finiteOrNull(it.avg20to80) },
            // `+ 0.0` widens the Long session count to the bar series' nullable-Double sample type.
            countValues = points.map { it.count + 0.0 },
            tableRows =
                points.map { point ->
                    listOf(
                        point.year,
                        formatters.avgMinutes(point.avg10to80),
                        formatters.avgMinutes(point.avg20to80),
                        formatters.sessionCount(point.count),
                    )
                },
            isEmpty = points.isEmpty(),
        )

    /** Keeps a finite sample, mapping `NaN`/`Infinity` to `null` so the line bridges the gap. */
    private fun finiteOrNull(value: Double): Double? = if (value.isFinite()) value else null
}

/**
 * Resource name for the web `charging.curve.yearlyTrendDesc` subtitle key. It is absent from the
 * auto-generated, drift-checked catalog (web supplies it only as an inline `t(key, default)` default, ADR-014),
 * so the composable reads it by name and falls back to [YearlyTrendChartDefaults.SUBTITLE] when absent —
 * mirroring the `SessionComparisonChart` surface.
 */
const val KEY_SUBTITLE: String = "translation_charging_curve_yearlyTrendDesc"

/** Resource name for the web `charging.curve.yearlyTrend.aria` key (by-name; absent ⇒ default). */
const val KEY_ARIA_LABEL: String = "translation_charging_curve_yearlyTrend_aria"

/**
 * The web `t(key, default)` fallback strings for the two keys the web component supplies inline but that are
 * absent from the shared catalog. These reproduce the web inline defaults exactly; the composable reads the
 * key by name and falls back here when it is absent.
 */
object YearlyTrendChartDefaults {
    /** Web `t('charging.curve.yearlyTrendDesc', …)` default. */
    const val SUBTITLE: String = "Average time-to-charge and session count by year"

    /** Web `t('charging.curve.yearlyTrend.aria', …)` default. */
    const val ARIA_LABEL: String = "Yearly average charge-time and session-count composed chart"
}

/**
 * Optional by-name resolution — the seam that reproduces the web `t(key, default)` for keys the catalog may
 * not carry. Pure (a `(String) -> String?` lookup is injected) so it is unit-tested without Android; the
 * composable supplies the real `resources.getIdentifier`-backed lookup.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [YearlyTrendChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordYearlyTrendChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to YearlyTrendChartRegistration.SLUG))
}
