// Pure, framework-free model + projection for the Temperature Trend chart feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx). No Compose, no
// Android, no HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate,
// so the composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (DrivetrainHealthPage) builds the per-drive
// `ChartDataPoint[]`, filters out the null outside-temperature rows, and passes the result down. From that
// prop the web render reads only `date` (the x label) and `outsideTemp` (the single plotted line), guards
// `if (data.length <= 1) return null`, and draws two horizontal `<ReferenceLine>` thresholds — Warm Zone
// at 35 °C and Freezing at 0 °C. This file owns those three derivations plus the `ChartContainer`
// `data`/`dataColumns` accessible-table projection.
//
// SI boundary (unit-conversion instructions, Phase-48 SI-canonical): `outsideTempC` is stored and carried
// in SI degrees Celsius. The display conversion is `convertTempFromSI(c, tempUnit)` — the same shared
// converter the web `useUnits` path uses. The web component has a latent inconsistency: it converts the
// Warm Zone / Freezing reference lines and the Y-axis unit to the display unit but plots the line itself
// in raw Celsius, so a Fahrenheit user sees a line that disagrees with its own axis and thresholds. This
// port converts the line too, so the line, thresholds, axis unit and table all read in one display unit —
// the same "do not reproduce a latent web inconsistency" stance the sibling SpeedTrendChart port documents.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TemperatureTrendChart — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.temperaturetrendchart

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import java.util.Locale

/** The Warm Zone reference threshold, in SI degrees Celsius — the web `<ReferenceLine y={toDisplay(35)}>`. */
internal const val WARM_ZONE_C: Double = 35.0

/** The Freezing reference threshold, in SI degrees Celsius — the web `<ReferenceLine y={toDisplay(0)}>`. */
internal const val FREEZING_C: Double = 0.0

/**
 * The minimum number of finite-temperature points required to draw a trend — the web `data.length <= 1`
 * guard. At or below this the surface renders the empty state rather than a single dot (a trend line needs
 * at least two points), reproducing the web "return nothing" intent without leaving a blank panel.
 */
internal const val MIN_TREND_POINTS: Int = 1

/** Value-axis tick precision — temperatures read as whole numbers on the axis (matches TemperatureSection). */
internal const val AXIS_DECIMALS: Int = 0

/** Display precision when the user's settings carry none — the shared temperature default (one decimal). */
internal const val DEFAULT_TEMP_PRECISION: Int = 1

/** Em dash shown for an absent/non-finite temperature cell — the shared display fallback. */
internal const val EM_DASH: String = "\u2014"

/** Largest fraction-digit count [TemperatureTrendChartProjection.formatNumber] will honor. */
private const val MAX_PRECISION: Int = 20

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TemperatureTrendChartRegistration {
    /** Stable surface id. */
    const val ID: String = "temperature-trend-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "TemperatureTrendChart"
}

/**
 * One per-drive point on the outside-temperature trend — the native mirror of the subset of the web
 * `ChartDataPoint` this chart reads (`date` + `outsideTemp`). The rest of the web type (power, distance)
 * belongs to the sibling PowerOutputChart and is intentionally omitted.
 *
 * @property date the x-axis category label, already formatted by the host (web `formatDateShort(startTs)`).
 * @property outsideTempC the drive's average outside temperature in SI degrees Celsius (web
 *   `outsideTempAvgC`), or `null` when the drive recorded none — a `null`/non-finite value is skipped (the
 *   line draws across the gap) and reads as an em dash in the accessible table.
 */
data class TempTrendPoint(
    val date: String,
    val outsideTempC: Double?,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `drivetrain.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings (empty / error
 * / retry / offline / freshness) are resolved inline at the Compose boundary, so this holder stays a thin
 * content carrier.
 *
 * @property title the panel title (web `drivetrain.tempHistory`).
 * @property subtitle the panel subtitle (web `drivetrain.tempHistorySub`).
 * @property ariaLabel the chart's screen-reader description (web `drivetrain.tempHistory.aria`; catalog
 *   absent ⇒ the web English fallback).
 * @property dateColumn / outsideColumn the accessible data-table headers (web `dataColumns`); the display
 *   unit is appended to [outsideColumn] at the Compose boundary, mirroring the web `Outside (${tempUnit})`.
 * @property outsideTempLabel the plotted line + legend name (web `<Line name={t('drivetrain.outsideTemp')}>`).
 * @property warmZoneLabel / freezingLabel the two reference-threshold labels (web `<ReferenceLine label>`).
 */
data class TemperatureTrendChartStrings(
    val title: String,
    val subtitle: String,
    val ariaLabel: String,
    val dateColumn: String,
    val outsideColumn: String,
    val outsideTempLabel: String,
    val warmZoneLabel: String,
    val freezingLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of what the web `<LineChart>` reads
 * from `data` plus the `ChartContainer` `data`/`dataColumns` table and the two reference thresholds. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host: the composable wraps
 * [tempValues] into a single line `ChartSeries`, feeds [dates] to the bottom axis, renders [tableRows] as
 * the accessible fallback table, and labels the threshold chips with [warmZoneDisplay] / [freezingDisplay].
 *
 * @property dates the x-axis labels (web `<XAxis dataKey="date" />`).
 * @property tempValues the converted display temperatures (one per point; `null` is a gap).
 * @property tableRows one `[date, formattedTemp]` row per point — the accessible table (web `dataColumns`).
 * @property warmZoneDisplay the Warm Zone threshold, converted + formatted with its unit (e.g. `35.0°C`).
 * @property freezingDisplay the Freezing threshold, converted + formatted with its unit (e.g. `0.0°C`).
 * @property isEmpty `true` when there are at most [MIN_TREND_POINTS] finite temperatures — the web
 *   `data.length <= 1` boundary, surfaced as the empty state.
 */
data class TemperatureTrendChartProjectionResult(
    val dates: List<String>,
    val tempValues: List<Double?>,
    val tableRows: List<List<String>>,
    val warmZoneDisplay: String,
    val freezingDisplay: String,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's data mapping, reference
 * thresholds and table bindings. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings, palette colors and freshness chrome.
 */
object TemperatureTrendChartProjection {
    /**
     * Projects [points] into render-ready chart inputs for the user's [tempUnit] / [precision] / [locale],
     * preserving the received order. Each point's SI Celsius temperature is converted to the display unit
     * for the line ([TemperatureTrendChartProjectionResult.tempValues]) and the accessible table; a `null`
     * or non-finite temperature becomes a line gap and an em-dash table cell. The two thresholds convert
     * the same way (web `toTemperatureDisplay(35)` / `toTemperatureDisplay(0)`). Sets
     * [TemperatureTrendChartProjectionResult.isEmpty] for the web `data.length <= 1` boundary, counting
     * only finite temperatures (a trend line needs at least two real points).
     */
    fun project(
        points: List<TempTrendPoint>,
        tempUnit: TemperatureUnitPref,
        precision: Int,
        locale: Locale,
    ): TemperatureTrendChartProjectionResult {
        val converted = points.map { it.outsideTempC?.takeIf(Double::isFinite)?.let { c -> convertTempFromSI(c, tempUnit) } }
        val finiteCount = converted.count { it != null }
        val tableRows =
            points.indices.map { i ->
                val value = converted[i]
                val cell = if (value != null) formatNumber(value, precision, locale) else EM_DASH
                listOf(points[i].date, cell)
            }
        val unitLabel = tempUnit.label
        return TemperatureTrendChartProjectionResult(
            dates = points.map { it.date },
            tempValues = converted,
            tableRows = tableRows,
            warmZoneDisplay = formatNumber(convertTempFromSI(WARM_ZONE_C, tempUnit), precision, locale) + unitLabel,
            freezingDisplay = formatNumber(convertTempFromSI(FREEZING_C, tempUnit), precision, locale) + unitLabel,
            isEmpty = finiteCount <= MIN_TREND_POINTS,
        )
    }

    /**
     * Locale-aware fixed-precision number formatting that reproduces the web `Intl.NumberFormat` display
     * contract the chart values use: a non-finite value is coerced to `0`, [decimals] is clamped to a sane
     * range, and the integer part is grouped in the given [locale]. Used for both the value-axis ticks
     * ([AXIS_DECIMALS]) and the accessible-table cells (the user's precision).
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale = Locale.US,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = decimals.coerceIn(0, MAX_PRECISION)
        return String.format(locale, "%,.${digits}f", safe)
    }
}

/** Resource name (by-name; absent ⇒ [TemperatureTrendChartDefaults.ARIA_LABEL]) for `drivetrain.tempHistory.aria`. */
const val KEY_ARIA: String = "translation_drivetrain_tempHistory_aria"

/**
 * Native fallback microcopy. Every visible title / subtitle / column / series / threshold key
 * (`drivetrain.tempHistory`, `drivetrain.tempHistorySub`, `drivetrain.col.date`, `drivetrain.col.outside`,
 * `drivetrain.outsideTemp`, `drivetrain.warmZone`, `drivetrain.freezing`) exists in the i18n catalog
 * (P1/S10) and resolves at compile time. This default backs the one string the catalog does not define:
 * the chart's accessible description (web `t('drivetrain.tempHistory.aria', …)`). It reproduces i18next's
 * "return the default when the key is absent" behaviour, so the surface still carries the web's exact
 * English fallback while routing through the i18n facade.
 */
object TemperatureTrendChartDefaults {
    /** Web `t('drivetrain.tempHistory.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String = "Outside temperature trend line chart per recent drive"
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
 * Resolves the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `Intl.NumberFormat` path applies when no locale
 * is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TemperatureTrendChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a date or temperature — so a diagnostics line can never leak the
 * fleet's drive history. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordTemperatureTrendChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TemperatureTrendChartRegistration.SLUG))
}
