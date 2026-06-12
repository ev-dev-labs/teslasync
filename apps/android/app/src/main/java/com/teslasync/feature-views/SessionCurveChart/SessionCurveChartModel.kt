// Pure, framework-free model + projection for the Session Curve chart feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/charging/components/charging-curve/SessionCurveChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent (the charging-curve page) generates the
// `CurvePoint[]` for the selected session and passes it down. This file owns the parts the web render
// derives from that prop: the single power-vs-soc area series (web `<Area dataKey="power" />`), the X-axis
// soc labels (web `<XAxis dataKey="soc" />`), and the accessible fallback table rows (web `ChartContainer`
// `data`/`dataColumns`: the raw soc in the "SOC %" column and the power rounded to one decimal in the
// "Power (kW)" column — `curveData.map((p) => ({ soc: p.soc, power: Math.round(p.power * 10) / 10 }))`). The
// point order is preserved exactly as received (the web generator already emits ascending soc and the chart
// maps in array order), so the native plot and its table read left-to-right in the same order.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SessionCurveChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.sessioncurvechart

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** Em dash shown when a value is missing or non-finite — the chart layer's empty marker. */
internal const val EM_DASH: String = "\u2014"

/** Fraction digits the data table + axis show for the power series — the web `Math.round(p.power * 10) / 10`. */
internal const val POWER_DECIMALS: Int = 1

/** Tolerance for treating a soc value as a whole number, so an integer soc renders without a decimal. */
private const val SOC_EPSILON: Double = 1e-9

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SessionCurveChartRegistration {
    /** Stable surface id. */
    const val ID: String = "session-curve-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / session data. */
    const val SLUG: String = "SessionCurveChart"
}

/**
 * One sample on the power-vs-soc curve — the native mirror of the web `CurvePoint`
 * (`{ soc: number; power: number }`). [soc] is the state-of-charge percentage (the X axis) and [power] is
 * the instantaneous charging power in kilowatts (the Y axis). Both are `Double` to mirror the web `number`s.
 */
data class CurvePoint(
    val soc: Double,
    val power: Double,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the keys the
 * web component resolves via `t(...)`: the panel [title] (`charging.curve.powerVsSoc`), the [subtitle]
 * (`charging.curve.powerVsSocDesc`), the [ariaLabel] (`charging.curve.powerVsSoc.aria`), the two data-table
 * column headers ([socColumn] = `charging.curve.col.soc`, [powerColumn] = `charging.curve.col.power`), the
 * two axis titles ([xAxisLabel] = `charging.curve.socPercent`, [yAxisLabel] = `charging.curve.powerKw`), and
 * the area [seriesLabel] (`charging.curve.power`). The lifecycle-chrome strings (empty / error / retry /
 * offline / freshness) are resolved inline at the Compose boundary, not here, so this holder stays a thin
 * content carrier.
 */
data class SessionCurveChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val socColumn: String,
    val powerColumn: String,
    val xAxisLabel: String,
    val yAxisLabel: String,
    val seriesLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<AreaChart>` reads
 * from `curveData` plus the `ChartContainer` `data`/`dataColumns` props. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host: the composable wraps [powerValues] into a `ChartSeries`, feeds
 * [xLabels] to the bottom axis, and renders [tableRows] as the accessible fallback table.
 */
data class SessionCurveChartProjectionResult(
    val xLabels: List<String>,
    val powerValues: List<Double>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's chart-data mapping.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SessionCurveChartProjection {
    /**
     * Projects the loaded [points] into render-ready chart inputs, preserving the received order. Each point
     * contributes one X-axis label ([formatSoc] of its `soc`), one raw power value for the area series (the
     * web plots the unrounded `curveData`), and one accessible-table row (`[formatSoc(soc), formatPower(power)]`,
     * mirroring the web `dataColumns` where the SOC column is the raw soc and the Power column is rounded to one
     * decimal). Injecting the two formatters keeps this function locale-deterministic for tests.
     */
    fun project(
        points: List<CurvePoint>,
        formatSoc: (soc: Double) -> String,
        formatPower: (power: Double) -> String,
    ): SessionCurveChartProjectionResult =
        SessionCurveChartProjectionResult(
            xLabels = points.map { formatSoc(it.soc) },
            powerValues = points.map { it.power },
            tableRows = points.map { listOf(formatSoc(it.soc), formatPower(it.power)) },
            isEmpty = points.isEmpty(),
        )

    /**
     * Formats a soc percentage for the X axis + the table's SOC column — the web `<XAxis dataKey="soc" />`
     * tick, which renders the raw number. A whole value shows with locale grouping and no decimal (e.g. `20`,
     * `1,000`); a fractional value keeps a single decimal (e.g. `22.5`). A non-finite value yields [EM_DASH].
     */
    fun formatSoc(
        soc: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (!soc.isFinite()) return EM_DASH
        val whole = soc.roundToLong()
        return if (abs(soc - whole) < SOC_EPSILON) {
            String.format(locale, "%,d", whole)
        } else {
            String.format(locale, "%,.${POWER_DECIMALS}f", soc)
        }
    }

    /**
     * Formats a power value in kW to one decimal with locale grouping — the web data column's
     * `Math.round(p.power * 10) / 10`. A non-finite value yields [EM_DASH] so a sparse series never shows
     * `NaN`.
     */
    fun formatPower(
        power: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (!power.isFinite()) return EM_DASH
        return String.format(locale, "%,.${POWER_DECIMALS}f", power)
    }
}

/** Resource name for the web `charging.curve.powerVsSoc` panel title (present in the catalog). */
const val KEY_TITLE: String = "translation_charging_curve_powerVsSoc"

/** Resource name (by-name; absent ⇒ [SessionCurveChartDefaults.SUBTITLE]) for web `charging.curve.powerVsSocDesc`. */
const val KEY_SUBTITLE: String = "translation_charging_curve_powerVsSocDesc"

/** Resource name (by-name; absent ⇒ [SessionCurveChartDefaults.ARIA_LABEL]) for web `charging.curve.powerVsSoc.aria`. */
const val KEY_ARIA: String = "translation_charging_curve_powerVsSoc_aria"

/**
 * Native fallback microcopy. The visible keys (`charging.curve.powerVsSoc`, `…col.soc`, `…col.power`,
 * `…socPercent`, `…powerKw`, `…power`) exist in the i18n catalog (P1/S10) and resolve at compile time; these
 * defaults back the two strings the web renders via `t(key, default)` whose keys the catalog does not define
 * (the subtitle description and the chart aria sentence). They reproduce i18next's "return the default when
 * the key is absent" behaviour exactly, so the surface still carries the web's English fallback verbatim.
 */
object SessionCurveChartDefaults {
    /** Web `t('charging.curve.powerVsSocDesc', 'Charging power curve for selected session')` default. */
    const val SUBTITLE: String = "Charging power curve for selected session"

    /** Web `t('charging.curve.powerVsSoc.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String =
        "Charging power versus state-of-charge area chart for the selected session"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SessionCurveChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordSessionCurveChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SessionCurveChartRegistration.SLUG))
}
