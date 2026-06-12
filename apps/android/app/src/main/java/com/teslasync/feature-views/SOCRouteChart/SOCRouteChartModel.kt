// Pure, framework-free model + projection for the SOC-Route ("Battery Along Route") chart feature view —
// the native analogue of everything the web component derives from its props before returning JSX
// (web/src/features/driving/components/SOCRouteChart.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational. Its parent (the Trip Planner page) computes a `TripPlan`
// and passes this surface three props: the planned-route state-of-charge curve (`socCurve: TripSOCPoint[]`,
// each `{ distance_m, soc }`), the charge stops (`chargeStops: TripChargeStop[]`), and the `minArrivalSOC`
// threshold. The component then renders, inside the shared `<ChartContainer>` (title / aria fallback table /
// empty state), a Recharts `<AreaChart>` of `soc` over `distance` with: a green→amber→red gradient area, a
// horizontal `<ReferenceLine y={minArrivalSOC}>` ("Min N%"), and one vertical `<ReferenceLine x>` per matched
// charge stop ("⚡ Stop N"). An empty `socCurve` renders the friendly empty state instead.
//
// This file owns the pure half of that contract:
//   • The render-ready projection — the rounded x-distance labels + soc area values (web `chartData =
//     socCurve.map(p => ({ distance: round(p.distance_m,1), soc: round(p.soc,1) }))`), the constant
//     min-arrival threshold series (the horizontal reference line, reproduced as a flat line in the combo
//     chart since the shared Vico renderer exposes no horizontal-line decoration — see the composable), the
//     accessible fallback-table rows (web `dataColumns` Distance / SOC %), and the empty guard
//     (`chartData.length === 0`).
//   • The charge-stop matching algorithm exactly as the web computes `stopDistances`: walking the stops in
//     order, finding the FIRST curve sample past the running cumulative distance whose soc is within 5 % of
//     the stop's `charge_from_soc`, advancing the cursor, and numbering only the matched stops (the web
//     `stopDistances.map((_, i) => 'Stop ' + (i + 1))`). The matched sample's index positions the native
//     marker-rail pin (the Vico analogue of the web vertical reference line).
//   • The i18n `t(key, default)` resolve-or-fallback and the PII-safe `view.opened` diagnostic.
//
// SI boundary (unit-conversion instructions, ADR / Phase-48): `distance_m` is SI metres and `soc` /
// `minArrivalSOC` are dimensionless 0-100 percentages, exactly as the API serves them. The web SOCRouteChart
// binds no `useUnits`/`useSettings` — it plots `distance_m` directly under a literal `km` axis caption and
// `soc` directly — so this port performs NO unit conversion either; it only rounds + labels (faithful parity
// with the web spec, which is the single source of truth for this surface).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SOCRouteChart — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.socroutechart

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** Em dash shown when a value is missing or non-finite — the chart layer's empty marker. */
internal const val EM_DASH: String = "\u2014"

/** Fraction digits the area values, axis, and table show — the web `Math.round(x * 10) / 10`. */
internal const val VALUE_DECIMALS: Int = 1

/**
 * SOC proximity (in percent) within which a curve sample is treated as the leg boundary for a charge stop —
 * the web `Math.abs(pt.soc - stop.charge_from_soc) < 5`. Strictly-less, exactly as the web comparison.
 */
internal const val SOC_MATCH_TOLERANCE: Double = 5.0

/** Tolerance for treating a value as a whole number, so an integer renders without a trailing decimal. */
private const val WHOLE_EPSILON: Double = 1e-9

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SOCRouteChartRegistration {
    /** Stable surface id. */
    const val ID: String = "soc-route-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / route data. */
    const val SLUG: String = "SOCRouteChart"
}

/**
 * One sample on the planned-route SOC curve — the native mirror of the web `TripSOCPoint`
 * (`{ distance_m: number; soc: number }`). [distanceM] is the cumulative route distance in SI metres (the X
 * axis, plotted raw under a `km` caption exactly as the web does) and [soc] is the projected state-of-charge
 * percentage (0-100, the Y value).
 */
data class TripSOCPoint(
    val distanceM: Double,
    val soc: Double,
)

/**
 * The single charge-stop field this surface consumes — the native mirror of the only `TripChargeStop`
 * property the web component reads, `charge_from_soc` (the SOC at which the car reaches the stop). The web
 * `TripChargeStop` interface carries more fields (name, location, energy, cost, …) but SOCRouteChart
 * references none of them, so the port models exactly the consumed slice — no behaviour is dropped.
 */
data class RouteChargeStop(
    val chargeFromSoc: Double,
)

/**
 * The three web props bundled as the surface's data payload, carried by the host's
 * [io.teslasync.android.data.UiState] (P1/S8). Mirrors the web `SOCRouteChartProps`: the [socCurve], the
 * [chargeStops], and the [minArrivalSoc] threshold (web `minArrivalSOC`). An empty [socCurve] is the
 * surface's empty state (web `chartData.length === 0`).
 */
data class SOCRouteData(
    val socCurve: List<TripSOCPoint>,
    val chargeStops: List<RouteChargeStop>,
    val minArrivalSoc: Double,
)

/**
 * A matched charge stop positioned for the native marker rail — the analogue of one web vertical
 * `<ReferenceLine x={dist} label={'⚡ Stop ' + (i + 1)} />`. [index] is the matched curve sample's position
 * (the rail pin's x location, the Vico replacement for the web reference line on the distance axis) and
 * [ordinal] is its 1-based number among the matched stops (web `i + 1`).
 */
data class StopMarker(
    val index: Int,
    val ordinal: Int,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the keys the
 * web component resolves via `t(...)`: the panel [title] (`tripPlanner.socChart.title`), the chart's
 * accessible description [ariaLabel] (`tripPlanner.socChart.aria`), the two data-table column headers
 * ([distanceColumn] = `tripPlanner.socChart.col.distance`, [socColumn] = `tripPlanner.socChart.col.soc`), and
 * the [distanceAxisLabel] (`units.km`, the web `<XAxis label="km">`). The SOC column text doubles as the
 * Y-axis caption and SOC legend label (web `<YAxis label="SOC %">`). [minLineTemplate] and
 * [chargeStopTemplate] are the localized single-argument format strings for the two reference-line labels the
 * web builds inline (`` `Min ${minArrivalSOC}%` `` / `` `⚡ Stop ${i + 1}` ``); the composable formats them
 * per value with [SOCRouteChartProjection.formatMinLineLabel] / [SOCRouteChartProjection.formatStopLabel].
 * Lifecycle-chrome strings (empty / error / retry / offline / freshness) are resolved inline at the Compose
 * boundary, not here, so this holder stays a thin content carrier.
 */
data class SOCRouteChartStrings(
    val title: String,
    val ariaLabel: String,
    val distanceColumn: String,
    val socColumn: String,
    val distanceAxisLabel: String,
    val minLineTemplate: String,
    val chargeStopTemplate: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<AreaChart>` reads
 * from `chartData` plus the `ChartContainer` `data`/`dataColumns` props and the `stopDistances` overlay.
 * Pure data (no Compose types) so the projection is unit-tested without a UI host: the composable wraps
 * [socValues] into the SOC area series, [thresholdValues] into the flat min-arrival line, [xLabels] feeds the
 * bottom axis, [stops] become marker-rail pins, and [tableRows] render the accessible fallback table.
 */
data class SOCRouteChartProjectionResult(
    val xLabels: List<String>,
    val socValues: List<Double?>,
    val thresholdValues: List<Double?>,
    val stops: List<StopMarker>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `useMemo`
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SOCRouteChartProjection {
    /** The empty projection — the web `chartData.length === 0` branch, with no series, stops, or rows. */
    private val EMPTY =
        SOCRouteChartProjectionResult(
            xLabels = emptyList(),
            socValues = emptyList(),
            thresholdValues = emptyList(),
            stops = emptyList(),
            tableRows = emptyList(),
            isEmpty = true,
        )

    /**
     * Projects the loaded [data] into render-ready chart inputs, preserving curve order. Each sample
     * contributes one X-axis distance label ([formatDistance] of its metres), one rounded SOC area value
     * (web `Math.round(p.soc * 10) / 10`), one constant min-arrival threshold value (the horizontal
     * reference line, reproduced as a flat line), and one accessible-table row
     * (`[formatDistance(distance_m), formatSoc(soc)]`, mirroring the web `dataColumns`). Charge stops are
     * matched via [computeStopMarkers] against the RAW curve (the web `stopDistances` walk). An empty curve
     * yields the empty result (web empty branch). Injecting the two formatters keeps this locale-deterministic
     * for tests.
     */
    fun project(
        data: SOCRouteData,
        formatDistance: (distanceM: Double) -> String,
        formatSoc: (soc: Double) -> String,
    ): SOCRouteChartProjectionResult {
        val points = data.socCurve
        if (points.isEmpty()) return EMPTY
        return SOCRouteChartProjectionResult(
            xLabels = points.map { formatDistance(it.distanceM) },
            socValues = points.map { roundToTenth(it.soc) },
            thresholdValues = points.map { data.minArrivalSoc },
            stops = computeStopMarkers(points, data.chargeStops),
            tableRows = points.map { listOf(formatDistance(it.distanceM), formatSoc(it.soc)) },
            isEmpty = false,
        )
    }

    /**
     * Matches each charge stop to a curve sample exactly as the web computes `stopDistances`: walking the
     * stops in order, finding the FIRST sample whose distance is past the running cumulative cursor and whose
     * soc is within [SOC_MATCH_TOLERANCE] of the stop's `charge_from_soc`, then advancing the cursor to that
     * sample. Only matched stops are numbered (1-based, web `i + 1` over the matched list), so an unmatched
     * stop neither emits a pin nor consumes an ordinal. The matched sample's index positions the marker pin.
     */
    fun computeStopMarkers(
        points: List<TripSOCPoint>,
        chargeStops: List<RouteChargeStop>,
    ): List<StopMarker> {
        if (points.isEmpty() || chargeStops.isEmpty()) return emptyList()
        val matched = mutableListOf<StopMarker>()
        var cumDistanceM = 0.0
        for (stop in chargeStops) {
            val index =
                points.indexOfFirst { pt ->
                    pt.distanceM > cumDistanceM && abs(pt.soc - stop.chargeFromSoc) < SOC_MATCH_TOLERANCE
                }
            if (index >= 0) {
                matched += StopMarker(index = index, ordinal = matched.size + 1)
                cumDistanceM = points[index].distanceM
            }
        }
        return matched
    }

    /**
     * Formats a value to one decimal with locale grouping — the web `Math.round(x * 10) / 10` precision used
     * for both the distance axis labels and the SOC values. A whole value shows with grouping and no decimal
     * (e.g. `50,000`, `20`); a fractional value keeps a single decimal (e.g. `22.5`). A non-finite value
     * yields [EM_DASH] so a sparse curve never shows `NaN`. Used for the X-axis distance labels, the table's
     * distance + SOC columns, and the min-line label value.
     */
    fun formatValue(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (!value.isFinite()) return EM_DASH
        val whole = value.roundToLong()
        return if (abs(value - whole) < WHOLE_EPSILON) {
            String.format(locale, "%,d", whole)
        } else {
            String.format(locale, "%,.${VALUE_DECIMALS}f", value)
        }
    }

    /**
     * Builds the horizontal min-arrival threshold label from the resolved [template] — the web
     * `` `Min ${minArrivalSOC}%` ``. [template] is a single-arg format string (catalog key absent ⇒
     * [SOCRouteChartDefaults.MIN_LINE] = `"Min %1$s%%"`); the soc is rendered with [formatValue] so an
     * integer threshold reads `Min 10%`. Pure (locale-deterministic) for the unit gate.
     */
    fun formatMinLineLabel(
        template: String,
        minArrivalSoc: Double,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, template, formatValue(minArrivalSoc, locale))

    /**
     * Builds a charge-stop marker label from the resolved [template] — the web `` `⚡ Stop ${i + 1}` ``.
     * [template] is a single-arg format string (catalog key absent ⇒ [SOCRouteChartDefaults.CHARGE_STOP] =
     * `"\u26A1 Stop %1$d"`) and [ordinal] is the stop's 1-based number. Pure for the unit gate.
     */
    fun formatStopLabel(
        template: String,
        ordinal: Int,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, template, ordinal)

    /** Rounds [value] to one decimal — the web `Math.round(x * 10) / 10`; a non-finite value passes through. */
    private fun roundToTenth(value: Double): Double {
        if (!value.isFinite()) return value
        return (value * TENTH_SCALE).roundToLong() / TENTH_SCALE
    }

    private const val TENTH_SCALE: Double = 10.0
}

/** Resource name for the web `tripPlanner.socChart.title` panel title (present in the catalog). */
const val KEY_TITLE: String = "translation_tripPlanner_socChart_title"

/** Resource name for the web `tripPlanner.socChart.aria` accessible chart description (present in the catalog). */
const val KEY_ARIA: String = "translation_tripPlanner_socChart_aria"

/** Resource name for the web `tripPlanner.socChart.empty` empty-state message (present in the catalog). */
const val KEY_EMPTY: String = "translation_tripPlanner_socChart_empty"

/** Resource name for the web `tripPlanner.socChart.col.distance` table header (present in the catalog). */
const val KEY_COL_DISTANCE: String = "translation_tripPlanner_socChart_col_distance"

/** Resource name for the web `tripPlanner.socChart.col.soc` table header / Y-axis / SOC legend (present). */
const val KEY_COL_SOC: String = "translation_tripPlanner_socChart_col_soc"

/** Resource name for the `km` distance-axis caption — the web `<XAxis label="km">` (present in the catalog). */
const val KEY_AXIS_KM: String = "translation_units_km"

/**
 * Resource name (by-name; absent ⇒ [SOCRouteChartDefaults.MIN_LINE]) for the horizontal min-arrival
 * reference-line label. The web renders it as the inline literal `` `Min ${minArrivalSOC}%` `` (no `t()`
 * call), so there is no catalog key; this routes it through the i18n facade with the web text as the
 * fallback, reproducing i18next's `t(key, default)` behaviour.
 */
const val KEY_MIN_LINE: String = "translation_tripPlanner_socChart_minLine"

/**
 * Resource name (by-name; absent ⇒ [SOCRouteChartDefaults.CHARGE_STOP]) for the vertical charge-stop
 * reference-line label. The web renders it as the inline literal `` `⚡ Stop ${i + 1}` `` (no `t()` call),
 * so there is no catalog key; this routes it through the facade with the web text as the fallback.
 */
const val KEY_CHARGE_STOP: String = "translation_tripPlanner_socChart_chargeStop"

/**
 * Native fallback microcopy. The visible keys (`tripPlanner.socChart.title`, `.aria`, `.empty`,
 * `.col.distance`, `.col.soc`) and the `units.km` axis caption all exist in the i18n catalog (P1/S10) and
 * resolve at compile time; these defaults back the two labels the web renders as inline template literals
 * (the min-arrival reference line and the per-stop reference line) whose keys the catalog does not define.
 * They reproduce i18next's "return the default when the key is absent" behaviour, so the surface still
 * carries the web's text verbatim while routing through the facade. Each is a single-argument format string.
 */
object SOCRouteChartDefaults {
    /** Web `` `Min ${minArrivalSOC}%` `` — single `%1$s` slot for the formatted SOC threshold. */
    const val MIN_LINE: String = "Min %1\$s%%"

    /** Web `` `⚡ Stop ${i + 1}` `` — single `%1$d` slot for the 1-based stop ordinal. */
    const val CHARGE_STOP: String = "\u26A1 Stop %1\$d"
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SOCRouteChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a distance, SOC value, charge stop, or VIN — so a diagnostics line
 * can never leak the planned route. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordSOCRouteChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SOCRouteChartRegistration.SLUG))
}
