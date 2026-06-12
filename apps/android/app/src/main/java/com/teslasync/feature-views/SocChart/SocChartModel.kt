// Pure, framework-free model + projection for the SOC-over-time chart feature view — the native analogue
// of everything the web component reads from its prop before returning JSX
// (web/src/features/driving/components/drive-detail/SocChart.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (DriveDetailPage) builds the per-sample
// `ChartDataPoint[]` (already in display units) and passes it down; the component then draws a single green
// area of the `battery` series (state of charge, in percent) over the `time` axis, with a `<YAxis
// domain={[0, 100]}>`, a synced reference line, and a `chartData.length > 1` content/empty boundary. This
// file owns the parts the web render derives from that prop: the ordered x-axis labels, the raw SOC value
// column (the web plots `dataKey="battery"` unfiltered), and that length boundary (1 or 0 samples ⇒ the web
// "No telemetry data available" branch). Sample order is preserved exactly as received (the web generator
// emits ascending time and the chart maps in array order), so the native plot reads in the same order.
//
// SI on the wire, display at the boundary: `battery` is a state-of-charge percentage (0-100, dimensionless)
// exactly as the API serves it — there is no unit conversion to do (the web SocChart binds no `useUnits`),
// only labelling and the ordered projection done here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SocChart — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.socchart

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SocChartRegistration {
    /** Stable surface id. */
    const val ID: String = "soc-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "SocChart"
}

/**
 * One per-sample point on the SOC trace — the native mirror of the two web `ChartDataPoint` fields this
 * chart reads. The parent supplies [battery] as a 0-100 state-of-charge percentage (dimensionless, no unit
 * conversion), exactly as the web `chartData` arrives; this surface only labels and orders it.
 *
 * @property time the x-axis category label (web `<XAxis dataKey="time" />`).
 * @property battery the SOC percentage (web `<Area dataKey="battery" />`); the area plots this raw.
 */
data class SocChartPoint(
    val time: String,
    val battery: Double,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the keys the
 * web component resolves via `t(...)`: the panel [title] (`driveDetail.socOverTime`), the [seriesLabel]
 * (`driveDetail.soc`, the base of the web `name={t('driveDetail.soc') + ' %'}`), and the chart's accessible
 * description [ariaLabel] (web `ariaLabel`; catalog-absent ⇒ the web English fallback). Lifecycle-chrome
 * strings (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, not
 * here, so this holder stays a thin content carrier.
 */
data class SocChartStrings(
    val title: String,
    val seriesLabel: String,
    val ariaLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<AreaChart>` reads
 * from `chartData`. Pure data (no Compose types) so the projection is unit-tested without a UI host: the
 * composable wraps [socValues] into a single area `ChartSeries`, feeds [xLabels] to the bottom axis, and
 * shows the friendly empty state when [isEmpty] (the web `chartData.length > 1` boundary).
 */
data class SocChartProjectionResult(
    val xLabels: List<String>,
    val socValues: List<Double?>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's chart-data read.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SocChartProjection {
    /**
     * Projects the loaded [points] into render-ready chart inputs, preserving the received order. [socValues]
     * carry the raw `battery` per sample (the web `<Area dataKey="battery">` plots it unfiltered), and
     * [SocChartProjectionResult.isEmpty] reproduces the web `chartData.length > 1` boundary: 0 or 1 samples
     * is the empty surface (a one-point area would read as a flat dot, never a trace), 2+ is the chart.
     */
    fun project(points: List<SocChartPoint>): SocChartProjectionResult =
        SocChartProjectionResult(
            xLabels = points.map { it.time },
            socValues = points.map { it.battery },
            isEmpty = points.size <= 1,
        )

    /**
     * Locale-grouped whole-percent formatting for the value axis ticks — the native analogue of the web
     * `<YAxis domain={[0, 100]}>` numeric ticks (the web renders the bare 0-100 number; the percent semantics
     * live in the series name `SOC %`). Pure (JVM-tested): a non-finite value is coerced to `0` exactly as
     * the web `safeNumber`, and grouping follows the locale at zero fraction digits.
     */
    fun formatAxisValue(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return String.format(locale, "%,.0f", safe)
    }
}

/**
 * Resource name (by-name; absent ⇒ [SocChartDefaults.ARIA_LABEL]) for the web `driveDetail.socOverTime.aria`
 * accessible description. The title (`driveDetail.socOverTime`), series base (`driveDetail.soc`), and empty
 * (`driveDetail.noChartData`) keys exist in the i18n catalog (P1/S10) and resolve at compile time; this aria
 * key is the one the catalog does not define, so it is resolved by-name with the web fallback below.
 */
const val KEY_ARIA: String = "translation_driveDetail_socOverTime_aria"

/**
 * Native fallback microcopy reproducing i18next's "return the default when the key is absent" behaviour for
 * the one string the catalog does not define — the chart's accessible description (web
 * `t('driveDetail.socOverTime.aria', 'State of charge percent over time area chart')`). Carries the web
 * English default verbatim while still routing through the i18n facade.
 */
object SocChartDefaults {
    /** Web `t('driveDetail.socOverTime.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String = "State of charge percent over time area chart"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SocChartRegistration.SLUG] (P1/S11).
 * Carries only the slug — never a time, SOC value, or VIN — so a diagnostics line can never leak the
 * fleet's state of charge. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordSocChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SocChartRegistration.SLUG))
}
