// Pure, framework-free model + projection for the Power Output History chart feature view — the native
// analogue of everything the web component reads before returning JSX
// (web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (DrivetrainHealthPage) builds the per-drive
// `ChartDataPoint[]` (`date = formatDateShort(startTs)`, `powerMax = (avgPowerW ?? 0) / 1000`,
// `powerMin = 0`, last 30 drives) and passes it down. From that prop the web render reads exactly three
// fields — `date`, `powerMax`, `powerMin` — to plot the two stacked areas (Peak / Regen power per drive)
// and to build the `ChartContainer` accessible table (`{ date, power_max_kw, power_min_kw }` over the
// `Date` / `Peak (kW)` / `Regen (kW)` columns). This file owns that mapping plus the `data.length <= 1`
// content/empty boundary the web encodes as `if (data.length <= 1) return null`.
//
// SI boundary (ADR / unit-conversion instructions): `powerMax`/`powerMin` arrive already in kW — the page
// derives `power = avgPowerW / 1000` per drive (web DrivetrainHealthPage), so the only scale is that fixed
// W→kW divide the host applies; no `useUnits()` preference is involved (kW is the fixed axis unit the web
// hardcodes via its `<YAxis label="kW" />`). The accessible-table cells render at the feature's standard
// one-decimal kW precision (web `fmtNumber(v, 1)` as the sibling DetailCards / ThermalLoadPanel use).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/PowerOutputChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.poweroutputchart

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/**
 * Minimum sample count the chart renders for — the web `if (data.length <= 1) return null` boundary. Fewer
 * than this projects to the empty surface (a single point can not draw a meaningful trend line).
 */
internal const val MIN_RENDERABLE_POINTS: Int = 2

/** kW display precision for the accessible-table cells — the feature's `fmtNumber(v, 1)` one-decimal kW. */
internal const val KW_DECIMALS: Int = 1

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object PowerOutputChartRegistration {
    /** Stable surface id (also the web `useHiddenSeries('drivetrain-power-output')` persistence key root). */
    const val ID: String = "drivetrain-power-output"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "PowerOutputChart"
}

/**
 * One per-drive point on the power-output history — the native mirror of the subset of the web
 * `ChartDataPoint` this chart reads (`date` + `powerMax` + `powerMin`). The rest of the web type
 * (`outsideTemp`, `distance`) belongs to the sibling drivetrain-health charts and is intentionally omitted.
 *
 * @property date the x-axis category label, already display-formatted by the host (web
 *   `formatDateShort(startTs)`); used verbatim as the X label and the table's first column.
 * @property powerMax the drive's peak power in kW (web `dataKey="powerMax"`); already W→kW scaled by the host.
 * @property powerMin the drive's regen (minimum) power in kW (web `dataKey="powerMin"`); negative under regen.
 */
data class PowerOutputPoint(
    val date: String,
    val powerMax: Double,
    val powerMin: Double,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `drivetrain.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) and the fixed `kW` axis unit are resolved inline at the
 * Compose boundary, not here, so this holder stays a thin content carrier.
 *
 * @property title the panel title (web `drivetrain.powerOutput`).
 * @property subtitle the panel subtitle (web `drivetrain.powerOutputSub`).
 * @property ariaLabel the chart's screen-reader description (web `drivetrain.powerOutput.aria`; catalog-absent
 *   ⇒ the web English fallback resolved via [resolveOptional]).
 * @property dateColumn / peakColumn / regenColumn the accessible data-table headers (web `dataColumns`).
 * @property peakSeriesLabel / regenSeriesLabel the legend + tooltip series names (web `<Area name=… />`).
 */
data class PowerOutputChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val dateColumn: String,
    val peakColumn: String,
    val regenColumn: String,
    val peakSeriesLabel: String,
    val regenSeriesLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's `data` map
 * plus the `ChartContainer` `data`/`dataColumns` props. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host: the composable wraps [peakValues]/[regenValues] into two area `ChartSeries`,
 * feeds [dates] to the bottom axis, and renders [tableRows] as the accessible fallback table
 * (`Date` / `Peak (kW)` / `Regen (kW)`).
 *
 * [isEmpty] is the web `data.length <= 1` boundary — true projects the empty surface and omits the chart.
 */
data class PowerOutputChartProjectionResult(
    val dates: List<String>,
    val peakValues: List<Double?>,
    val regenValues: List<Double?>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's `data` mapping and its
 * chart/table bindings. Stateless and side-effect-free so it is fully covered by the off-device unit gate;
 * the composable only resolves localized strings, palette colors, the hidden-series state, and freshness
 * chrome.
 */
object PowerOutputChartProjection {
    /**
     * Projects [points] into render-ready chart inputs, preserving the received order (the web maps `data`
     * in array order and the host emits ascending-by-date drives). [dates] feed the X axis (web
     * `<XAxis dataKey="date" />`), [peakValues]/[regenValues] become the two area series (web
     * `dataKey="powerMax"` / `dataKey="powerMin"`), and each point contributes one accessible-table row
     * (`[date, formatValue(powerMax), formatValue(powerMin)]`, mirroring the web `dataColumns`). Sets
     * [PowerOutputChartProjectionResult.isEmpty] for the web `data.length <= 1` boundary. Injecting
     * [formatValue] keeps the projection locale-deterministic for tests; the composable supplies the real
     * localized one-decimal kW formatter.
     */
    fun project(
        points: List<PowerOutputPoint>,
        formatValue: (kw: Double) -> String,
    ): PowerOutputChartProjectionResult {
        val isEmpty = points.size < MIN_RENDERABLE_POINTS
        return PowerOutputChartProjectionResult(
            dates = points.map { it.date },
            peakValues = points.map { it.powerMax },
            regenValues = points.map { it.powerMin },
            tableRows = points.map { listOf(it.date, formatValue(it.powerMax), formatValue(it.powerMin)) },
            isEmpty = isEmpty,
        )
    }

    /**
     * Locale-aware one-decimal kW formatting (e.g. `45.3`) for the accessible-table cells — the feature's
     * `fmtNumber(v, 1)` convention. A non-finite value is coerced to `0` exactly as the web `safeNumber`,
     * then the locale's grouping/decimal separators are applied with half-up rounding.
     */
    fun formatKw(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val pattern = "#,##0." + "0".repeat(KW_DECIMALS)
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(safe)
    }
}

/** Resource name (by-name; absent ⇒ [PowerOutputChartDefaults.ARIA_LABEL]) for web `drivetrain.powerOutput.aria`. */
const val KEY_ARIA: String = "translation_drivetrain_powerOutput_aria"

/**
 * Native fallback microcopy. The visible title/subtitle/column/series keys (`drivetrain.powerOutput`,
 * `drivetrain.powerOutputSub`, `drivetrain.col.date`, `drivetrain.col.powerMax`, `drivetrain.col.powerMin`,
 * `drivetrain.powerMax`, `drivetrain.powerMin`) exist in the i18n catalog (P1/S10) and resolve at compile
 * time. This default backs the one string the catalog does not define: the chart's accessible description
 * (web `t('drivetrain.powerOutput.aria', …)`). It reproduces i18next's "return the default when the key is
 * absent" behaviour, so the surface still carries the web's English fallback verbatim while routing through
 * the i18n facade. (strings.xml is not in this surface's allowed files, so the key cannot be added here.)
 */
object PowerOutputChartDefaults {
    /** Web `t('drivetrain.powerOutput.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String = "Per-drive peak and regen motor power output history area chart"
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PowerOutputChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a date or power figure — so a diagnostics line can never leak the
 * fleet's drive history. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable
 * calls it from its first-composition effect.
 */
fun recordPowerOutputChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PowerOutputChartRegistration.SLUG))
}
