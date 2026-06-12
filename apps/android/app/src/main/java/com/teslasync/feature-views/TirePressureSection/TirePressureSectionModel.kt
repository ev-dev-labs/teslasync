// Pure, framework-free model + projection for the Tire Pressure feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/drive-detail/TirePressureSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational — its parent (the drive-detail page via useDriveDetailData)
// builds the per-sample `ChartDataPoint[]` whose four tire fields are ALREADY converted into the user's
// display pressure unit (web `convertPressureFromSI(tp.tirePressureFl / 1000, unitPrefs.pressure)`), and the
// `DriveStats`, and passes them down. This file owns the parts the web render derives from those props:
//   * the four per-wheel min/max tiles, reproducing the web `tpVals` filter (`v != null && v > 0`; here also
//     dropping non-finite so a sparse column never yields `NaN`) and its `'—'` empty-tile fallback,
//   * which of the four `<Line>`s are present (the web `chartData.some((d) => d.tireFl !== null)` guards,
//     one per wheel) and their ordered value columns,
//   * the content/empty boundary, reproducing the web `stats.hasTirePressure`
//     (`some(d => d.tireFl !== null || d.tireFr !== null || d.tireRl !== null || d.tireRr !== null)`) exactly
//     — so the surface is empty iff no wheel has any non-null sample.
// Sample order is preserved exactly as received (the web generator emits ascending time and the chart maps in
// array order), so the native plot reads in the same order.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TirePressureSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressuresection

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TirePressureSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "tire-pressure-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / drive data. */
    const val SLUG: String = "TirePressureSection"
}

/**
 * One per-sample tire-pressure point — the native mirror of the four tire fields of the web `ChartDataPoint`
 * this surface reads. The parent supplies each value already converted into the user's display pressure unit;
 * this surface only labels + plots it. A `null` field is an absent reading (web `tireFl: number | null`).
 *
 * @property time the x-axis category label (web `<XAxis dataKey="time" />`).
 * @property frontLeft front-left pressure in the user's display unit, or `null` (web `tireFl`).
 * @property frontRight front-right pressure in the user's display unit, or `null` (web `tireFr`).
 * @property rearLeft rear-left pressure in the user's display unit, or `null` (web `tireRl`).
 * @property rearRight rear-right pressure in the user's display unit, or `null` (web `tireRr`).
 */
data class TirePressurePoint(
    val time: String,
    val frontLeft: Double? = null,
    val frontRight: Double? = null,
    val rearLeft: Double? = null,
    val rearRight: Double? = null,
)

/** The four wheels, in the web tile + line render order. Each maps to a localized label + palette color. */
enum class TireWheelId { FrontLeft, FrontRight, RearLeft, RearRight }

/**
 * Min/max of a single wheel's samples — the native mirror of the web `tpVals` result (`{ min, max }`).
 * [TireWheelRange.of] reproduces the web filter (`v != null && v > 0`; here also dropping non-finite so a
 * sparse column never yields `NaN`) and the empty guard (no positive finite sample ⇒ `null`, so the tile
 * shows the web `'—'` fallback).
 */
data class TireWheelRange(
    val min: Double,
    val max: Double,
) {
    companion object {
        /** Builds a range from [values], or `null` when no positive finite sample remains (web `vals.length === 0`). */
        fun of(values: List<Double?>): TireWheelRange? {
            val positive = values.filterNotNull().filter { it.isFinite() && it > 0.0 }
            if (positive.isEmpty()) return null
            return TireWheelRange(min = positive.min(), max = positive.max())
        }
    }
}

/**
 * One already-formatted per-wheel tile — the native mirror of a web grid tile. [id] resolves the localized
 * label + palette color at the Compose boundary; [value] is the fully formatted, unit-suffixed min–max string
 * (web `${fmtNumber(min)}–${fmtNumber(max)} ${pressureUnit}`) or the `'—'` fallback when no positive sample.
 */
data class TireWheelTile(
    val id: TireWheelId,
    val value: String,
)

/**
 * The injected display formatter + unit label the tile projection needs — the native analogue of the web
 * `fmtNumber` bound to the global precision/locale, plus `useUnits().unitPrefs.pressure`. Injecting them keeps
 * the projection locale/precision deterministic for the off-device tests.
 *
 * @property number web `fmtNumber(v)` — locale grouping at the user's precision.
 * @property pressureUnit web `unitPrefs.pressure` label (e.g. `psi` / `kPa` / `bar`).
 */
data class TirePressureFormatters(
    val number: (Double) -> String,
    val pressureUnit: String,
)

/**
 * The fully projected, render-ready inputs — the native analogue of what the web tile grid + `<LineChart>`
 * read from `chartData`. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * A `null` value column means that wheel's `<Line>` is absent (web omitted it); a present column is plotted
 * with `null` gaps bridged. [tiles] is always the four wheels in order (the web always renders all four
 * tiles), and [isEmpty] is the web `stats.hasTirePressure` content/empty boundary, negated.
 */
data class TirePressureSectionProjectionResult(
    val xLabels: List<String>,
    val tiles: List<TireWheelTile>,
    val frontLeftValues: List<Double?>?,
    val frontRightValues: List<Double?>?,
    val rearLeftValues: List<Double?>?,
    val rearRightValues: List<Double?>?,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's tile derivation and
 * line-presence guards. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object TirePressureSectionProjection {
    /**
     * Projects the loaded [points] into render-ready inputs, preserving the received order. Builds the four
     * per-wheel tiles (web `tpStats`), decides which wheel lines are present with the same guard as the web
     * (`some(d => d.tireFl !== null)`, one per wheel), builds each present value column, and sets
     * [TirePressureSectionProjectionResult.isEmpty] for the web `stats.hasTirePressure` boundary (no wheel has
     * any non-null sample ⇒ the empty surface).
     */
    fun project(
        points: List<TirePressurePoint>,
        formatters: TirePressureFormatters,
    ): TirePressureSectionProjectionResult {
        val frontLeft = points.map { it.frontLeft }
        val frontRight = points.map { it.frontRight }
        val rearLeft = points.map { it.rearLeft }
        val rearRight = points.map { it.rearRight }

        val hasTirePressure =
            points.any {
                it.frontLeft != null || it.frontRight != null || it.rearLeft != null || it.rearRight != null
            }

        return TirePressureSectionProjectionResult(
            xLabels = points.map { it.time },
            tiles =
                listOf(
                    tile(TireWheelId.FrontLeft, frontLeft, formatters),
                    tile(TireWheelId.FrontRight, frontRight, formatters),
                    tile(TireWheelId.RearLeft, rearLeft, formatters),
                    tile(TireWheelId.RearRight, rearRight, formatters),
                ),
            frontLeftValues = presentColumn(frontLeft),
            frontRightValues = presentColumn(frontRight),
            rearLeftValues = presentColumn(rearLeft),
            rearRightValues = presentColumn(rearRight),
            isEmpty = !hasTirePressure,
        )
    }

    /**
     * Builds one per-wheel tile — the native mirror of a web grid tile. The min/max use the web `tpVals`
     * `v != null && v > 0` filter; a present range is formatted `${fmtNumber(min)}–${fmtNumber(max)} ${unit}`
     * (en dash, the web separator), and an absent one falls back to `'—'` (em dash, the web literal).
     */
    private fun tile(
        id: TireWheelId,
        values: List<Double?>,
        formatters: TirePressureFormatters,
    ): TireWheelTile {
        val range = TireWheelRange.of(values)
        val value =
            if (range != null) {
                "${formatters.number(range.min)}$RANGE_SEPARATOR${formatters.number(range.max)} ${formatters.pressureUnit}"
            } else {
                EM_DASH
            }
        return TireWheelTile(id = id, value = value)
    }

    /**
     * The present value column for a wheel, or `null` when every sample is absent — the native mirror of the
     * web `chartData.some((d) => d[key] !== null)` per-line guard (note: `!== null`, so a non-positive sample
     * still makes the line present, unlike the tile's `> 0` range filter). A present column keeps every sample
     * (including `null` gaps, which the chart bridges).
     */
    private fun presentColumn(values: List<Double?>): List<Double?>? = values.takeIf { col -> col.any { it != null } }

    /** The web min–max separator (en dash U+2013). */
    private const val RANGE_SEPARATOR: String = "\u2013"

    /** The web `'—'` empty-tile fallback (em dash U+2014). */
    private const val EM_DASH: String = "\u2014"
}

/**
 * Locale-aware number formatting that reproduces the web `numberFormat` helper (`fmtNumber`,
 * web/src/lib/numberFormat.ts) the tiles use. Pure (JVM-tested): a non-finite value is coerced to `0` exactly
 * as the web `safeNumber`, and grouping/precision follow `Intl.NumberFormat` with equal min/max fraction
 * digits (`String.format`'s `HALF_UP` matches ECMAScript `halfExpand`). The composable binds this into a
 * [TirePressureFormatters] from the live unit prefs.
 */
object TirePressureFormat {
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
}

/** Resource name (by-name; absent ⇒ [TirePressureSectionDefaults.ARIA_LABEL]) for web `driveDetail.tirePressure.aria`. */
const val KEY_ARIA: String = "translation_driveDetail_tirePressure_aria"

/**
 * Native fallback microcopy. The visible title / wheel / empty keys (`driveDetail.tirePressure`,
 * `driveDetail.frontLeft`, `driveDetail.frontRight`, `driveDetail.rearLeft`, `driveDetail.rearRight`,
 * `driveDetail.noChartData`) exist in the i18n catalog (P1/S10) and resolve at compile time. This default
 * backs the one string the catalog does not define: the chart's accessible description (web
 * `t('driveDetail.tirePressure.aria', …)`). It reproduces i18next's "return the default when the key is
 * absent" behaviour, so the surface still carries the web's English fallback verbatim while routing through
 * the i18n facade.
 */
object TirePressureSectionDefaults {
    /** Web `t('driveDetail.tirePressure.aria', '…')` default — the accessible chart description. */
    const val ARIA_LABEL: String = "Front and rear tire pressure lines over the drive timeline"
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TirePressureSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordTirePressureSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TirePressureSectionRegistration.SLUG))
}
