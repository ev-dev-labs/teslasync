// Pure, framework-free model + projection for the Drive Overview chart feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent (DriveDetailPage) builds the per-sample
// `ChartDataPoint[]` (already converted into the user's display units) and passes it down. This file owns
// the parts the web render derives from that prop:
//   * which series are present (the web `chartData.some((d) => d.idealRange !== null)` /
//     `… d.estRange !== null || d.ratedRange !== null` / `… d.usableSoc !== null` guards, plus the
//     est-vs-rated dataKey choice), and their ordered value columns (web `<Area>`/`<Line dataKey>`),
//   * the rich Mean/Max/Min legend the web renders below the chart, including its exact per-series
//     formatter choices (speed mean/max via `fmtNumber`, speed min via `fmtInt`, ranges via `fmtInt`,
//     SOC/usable-SOC via `fmtPercent`, power via `fmtWithUnit(_, 'kW')`) and its `socS` battery>0 filter
//     and `estRangeS` `estRange ?? ratedRange` fallback,
//   * the `chartData.length > 1` content/empty boundary (1 or 0 samples ⇒ the web "No telemetry data
//     available" branch).
// Sample order is preserved exactly as received (the web generator emits ascending time and the chart maps
// in array order), so the native plot and legend read in the same order.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DriveOverviewChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.driveoverviewchart

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object DriveOverviewChartRegistration {
    /** Stable surface id. */
    const val ID: String = "drive-overview-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "DriveOverviewChart"
}

/**
 * One per-sample point on the drive trace — the native mirror of the subset of the web `ChartDataPoint`
 * this chart reads. The parent supplies values already converted into the user's display units (speed in
 * the user's speed unit, the three range fields in the user's distance unit, [power] in kW, SOC fields in
 * percent), exactly as the web `chartData` arrives pre-converted; this surface only labels them.
 *
 * @property time the x-axis category label (web `<XAxis dataKey="time" />`).
 * @property speed display-unit speed (web `dataKey="speed"`).
 * @property battery SOC percentage (web `dataKey="battery"`); the SOC line plots this raw.
 * @property power instantaneous power in kW (web `dataKey="power"`); may be negative under regen.
 * @property idealRange ideal range in the user's distance unit, or `null` when unknown.
 * @property ratedRange rated range in the user's distance unit, or `null`; the est-range line falls back to it.
 * @property estRange estimated range in the user's distance unit, or `null`.
 * @property usableSoc usable SOC percentage, or `null` when unknown.
 */
data class DriveChartPoint(
    val time: String,
    val speed: Double,
    val battery: Double,
    val power: Double,
    val idealRange: Double? = null,
    val ratedRange: Double? = null,
    val estRange: Double? = null,
    val usableSoc: Double? = null,
)

/** The six trace series, in the web render + legend order. Each maps to a localized label + palette color. */
enum class DriveSeriesId { Speed, IdealRange, EstRange, Soc, UsableSoc, Power }

/**
 * Mean/Max/Min of a single series — the native mirror of the web `statFn` result
 * (`{ mean, max, min }`). [DriveSeriesStat.of] reproduces the web filter (drop `null`; here also drop
 * non-finite so a sparse column never yields `NaN`) and the empty guard (no finite samples ⇒ `null`,
 * so the series is omitted from the legend exactly as the web `if (speedS) …` checks do).
 */
data class DriveSeriesStat(
    val mean: Double,
    val max: Double,
    val min: Double,
) {
    companion object {
        /** Builds a stat from [values], or `null` when no finite sample remains (web `v.length === 0`). */
        fun of(values: List<Double?>): DriveSeriesStat? {
            val finite = values.filterNotNull().filter { it.isFinite() }
            if (finite.isEmpty()) return null
            return DriveSeriesStat(
                mean = finite.sum() / finite.size,
                max = finite.max(),
                min = finite.min(),
            )
        }
    }
}

/**
 * One already-formatted rich-legend row — the native mirror of the web legend `items` entry
 * (`{ color, dash?, label, mean, max, min }`). The [id] resolves the localized label + palette color at
 * the Compose boundary; [dashed] marks the two range rows (web `dash: true`); [mean]/[max]/[min] are the
 * fully formatted, unit-suffixed stat strings.
 */
data class DriveLegendEntryData(
    val id: DriveSeriesId,
    val dashed: Boolean,
    val mean: String,
    val max: String,
    val min: String,
)

/**
 * The injected display formatters + unit labels the legend projection needs — the native analogue of the
 * web `fmtNumber`/`fmtInt`/`fmtPercent`/`fmtWithUnit` bound to the global precision/locale, plus
 * `useUnits().unitPrefs.speed`/`.distance`. Injecting them keeps the projection locale/precision
 * deterministic for the off-device tests.
 *
 * @property number web `fmtNumber(v)` — locale grouping at the user's precision.
 * @property integer web `fmtInt(v)` — locale grouping, zero decimals.
 * @property percent web `fmtPercent(v)` — [number] with a trailing `%`.
 * @property powerKw web `fmtWithUnit(v, 'kW')` — [number] with a trailing ` kW`.
 * @property speedUnit web `unitPrefs.speed` label (e.g. `mph` / `km/h`).
 * @property distanceUnit web `unitPrefs.distance` label (e.g. `mi` / `km`).
 */
data class DriveChartFormatters(
    val number: (Double) -> String,
    val integer: (Double) -> String,
    val percent: (Double) -> String,
    val powerKw: (Double) -> String,
    val speedUnit: String,
    val distanceUnit: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<ComposedChart>`
 * reads from `chartData` plus the rich legend it renders below. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host: the composable wraps the present value columns into
 * `ChartSeries`, feeds [xLabels] to the bottom axis, and renders [legend] as the Mean/Max/Min summary.
 *
 * A `null` value column means that series is absent (web omitted the `<Line>`); a present column is plotted
 * with `null` gaps bridged. [socValues] is always present (web SOC line is unconditional) and carries the
 * raw battery (not the legend's `battery > 0` filtered view).
 */
data class DriveOverviewChartProjectionResult(
    val xLabels: List<String>,
    val speedValues: List<Double?>,
    val idealRangeValues: List<Double?>?,
    val estRangeValues: List<Double?>?,
    val socValues: List<Double?>,
    val usableSocValues: List<Double?>?,
    val powerValues: List<Double?>,
    val legend: List<DriveLegendEntryData>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's chart-data mapping
 * and rich-legend derivation. Stateless and side-effect-free so it is fully covered by the off-device unit
 * gate.
 */
object DriveOverviewChartProjection {
    /**
     * Projects the loaded [points] into render-ready chart inputs, preserving the received order. Decides
     * which optional series are present with the same guards as the web (`some(d => d.idealRange !== null)`,
     * `some(d => d.estRange !== null || d.ratedRange !== null)` choosing `estRange` when any is non-null
     * else `ratedRange`, `some(d => d.usableSoc !== null)`), builds each present value column, derives the
     * rich legend via [buildLegend], and sets [DriveOverviewChartProjectionResult.isEmpty] for the web
     * `chartData.length > 1` boundary (≤ 1 sample ⇒ the empty surface).
     */
    fun project(
        points: List<DriveChartPoint>,
        formatters: DriveChartFormatters,
    ): DriveOverviewChartProjectionResult {
        val hasIdealRange = points.any { it.idealRange != null }
        val hasEstOrRated = points.any { it.estRange != null || it.ratedRange != null }
        val useEstRange = points.any { it.estRange != null }
        val hasUsableSoc = points.any { it.usableSoc != null }

        return DriveOverviewChartProjectionResult(
            xLabels = points.map { it.time },
            speedValues = points.map { it.speed },
            idealRangeValues = if (hasIdealRange) points.map { it.idealRange } else null,
            estRangeValues =
                if (hasEstOrRated) {
                    points.map { if (useEstRange) it.estRange else it.ratedRange }
                } else {
                    null
                },
            socValues = points.map { it.battery },
            usableSocValues = if (hasUsableSoc) points.map { it.usableSoc } else null,
            powerValues = points.map { it.power },
            legend = buildLegend(points, formatters),
            isEmpty = points.size <= 1,
        )
    }

    /**
     * Builds the ordered Mean/Max/Min legend — the native mirror of the web `ChartLegend` `items` array.
     * Each series is included only when it has a finite sample (web `if (speedS) …`). Speed reproduces the
     * web's deliberate mixed formatting (mean/max via `fmtNumber`, min via `fmtInt`); the ranges use
     * `fmtInt` + the distance unit and are dashed; SOC (from the `battery > 0` filtered column) and
     * usable-SOC use `fmtPercent`; power uses `fmtWithUnit(_, 'kW')`. `estRangeS` reads `estRange`, falling
     * back per-sample to `ratedRange`, exactly as the web `d.estRange ?? d.ratedRange`.
     */
    private fun buildLegend(
        points: List<DriveChartPoint>,
        formatters: DriveChartFormatters,
    ): List<DriveLegendEntryData> {
        val speedStat = DriveSeriesStat.of(points.map { it.speed })
        val idealStat = DriveSeriesStat.of(points.map { it.idealRange })
        val estStat = DriveSeriesStat.of(points.map { it.estRange ?: it.ratedRange })
        val socStat = DriveSeriesStat.of(points.map { point -> point.battery.takeIf { it > 0 } })
        val usableStat = DriveSeriesStat.of(points.map { it.usableSoc })
        val powerStat = DriveSeriesStat.of(points.map { it.power })

        return buildList {
            speedStat?.let { add(speedRow(it, formatters)) }
            idealStat?.let { add(distanceRow(DriveSeriesId.IdealRange, it, formatters)) }
            estStat?.let { add(distanceRow(DriveSeriesId.EstRange, it, formatters)) }
            socStat?.let { add(uniformRow(DriveSeriesId.Soc, dashed = false, it, formatters.percent)) }
            usableStat?.let { add(uniformRow(DriveSeriesId.UsableSoc, dashed = false, it, formatters.percent)) }
            powerStat?.let { add(uniformRow(DriveSeriesId.Power, dashed = false, it, formatters.powerKw)) }
        }
    }

    /**
     * The speed legend row — the web `{ mean: fmtNumber(mean) sp, max: fmtNumber(max) sp, min: fmtInt(min) sp }`.
     * Note the intentional asymmetry: mean and max keep the user's decimal precision while min is shown as a
     * whole number, mirroring the web source's mixed `fmtNumber`/`fmtInt` choice verbatim.
     */
    private fun speedRow(
        stat: DriveSeriesStat,
        formatters: DriveChartFormatters,
    ): DriveLegendEntryData =
        DriveLegendEntryData(
            id = DriveSeriesId.Speed,
            dashed = false,
            mean = withUnit(formatters.number(stat.mean), formatters.speedUnit),
            max = withUnit(formatters.number(stat.max), formatters.speedUnit),
            min = withUnit(formatters.integer(stat.min), formatters.speedUnit),
        )

    /** A range legend row (ideal / est) — web `fmtInt(value) distanceUnit` for all three stats, dashed swatch. */
    private fun distanceRow(
        id: DriveSeriesId,
        stat: DriveSeriesStat,
        formatters: DriveChartFormatters,
    ): DriveLegendEntryData =
        DriveLegendEntryData(
            id = id,
            dashed = true,
            mean = withUnit(formatters.integer(stat.mean), formatters.distanceUnit),
            max = withUnit(formatters.integer(stat.max), formatters.distanceUnit),
            min = withUnit(formatters.integer(stat.min), formatters.distanceUnit),
        )

    /** A legend row whose three stats share one formatter (SOC/usable-SOC via percent, power via kW). */
    private fun uniformRow(
        id: DriveSeriesId,
        dashed: Boolean,
        stat: DriveSeriesStat,
        format: (Double) -> String,
    ): DriveLegendEntryData =
        DriveLegendEntryData(
            id = id,
            dashed = dashed,
            mean = format(stat.mean),
            max = format(stat.max),
            min = format(stat.min),
        )

    /** Joins a formatted number with a unit label (`"60 km"`); the web template-literal `${v} ${unit}`. */
    private fun withUnit(
        value: String,
        unit: String,
    ): String = "$value $unit"
}

/**
 * Locale-aware number formatting that reproduces the web `numberFormat` helpers
 * (web/src/lib/numberFormat.ts) the legend uses. Pure (JVM-tested): a non-finite value is coerced to `0`
 * exactly as the web `safeNumber`, and grouping/precision follow `Intl.NumberFormat` with equal min/max
 * fraction digits. The composable binds these into a [DriveChartFormatters] from the live unit prefs.
 */
object DriveChartFormat {
    /** Web `numberFormat` default precision (`_globalPrecision`), used when settings carry none. */
    const val DEFAULT_PRECISION: Int = 2

    private const val MAX_PRECISION: Int = 20

    /** Web `fmtNumber(v, decimals)` — `safeNumber` then locale grouping at [precision] fraction digits. */
    fun number(
        value: Double,
        precision: Int,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = precision.coerceIn(0, MAX_PRECISION)
        return String.format(locale, "%,.${digits}f", safe)
    }

    /** Web `fmtInt(v)` — [number] with zero fraction digits. */
    fun integer(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String = number(value, 0, locale)

    /** Web `fmtPercent(v)` — [number] with a trailing `%`. */
    fun percent(
        value: Double,
        precision: Int,
        locale: Locale = Locale.getDefault(),
    ): String = "${number(value, precision, locale)}%"

    /** Web `fmtWithUnit(v, unit)` — [number] with a trailing space + [unit]. */
    fun withUnit(
        value: Double,
        unit: String,
        precision: Int,
        locale: Locale = Locale.getDefault(),
    ): String = "${number(value, precision, locale)} $unit"
}

/** Resource name (by-name; absent ⇒ [DriveOverviewChartDefaults.ARIA_LABEL]) for web `driveDetail.driveChart.aria`. */
const val KEY_ARIA: String = "translation_driveDetail_driveChart_aria"

/** Resource name (by-name; absent ⇒ [DriveOverviewChartDefaults.STAT_MEAN]) for the legend "Mean" label. */
const val KEY_STAT_MEAN: String = "translation_driveDetail_chart_mean"

/**
 * Native fallback microcopy. The visible series/title/empty keys (`driveDetail.driveChart`,
 * `driveDetail.speed`, `driveDetail.rangeIdeal`, `driveDetail.rangeEst`, `driveDetail.soc`,
 * `driveDetail.usableSoc`, `driveDetail.power`, `driveDetail.noChartData`) exist in the i18n catalog
 * (P1/S10) and resolve at compile time. These defaults back the two strings the catalog does not define:
 * the chart's accessible description (web `t('driveDetail.driveChart.aria', …)`) and the legend "Mean"
 * label (the web legend hard-codes the literal `Mean:` with no `t()` call). They reproduce i18next's
 * "return the default when the key is absent" behaviour, so the surface still carries the web's English
 * fallback verbatim while routing through the i18n facade.
 */
object DriveOverviewChartDefaults {
    /** Web `t('driveDetail.driveChart.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String =
        "Drive overview composed chart of speed, range, SOC and power over time"

    /** Web legend literal `Mean:` (no `t()` in the web source) — the per-series average label. */
    const val STAT_MEAN: String = "Mean"
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DriveOverviewChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordDriveOverviewChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DriveOverviewChartRegistration.SLUG))
}
