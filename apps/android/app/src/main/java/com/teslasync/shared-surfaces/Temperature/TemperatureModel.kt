// Pure, framework-free model + projection + diagnostics for the Temperature shared surface — the native
// analogue of every decision the web component makes (web/src/components/data-display/format/Temperature.tsx)
// before it paints. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device
// in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE presentational temperature renderer. Its only hook is `useUnits()` — the user's °C/°F display
//     preference (the P1/S8 units state holder). There is NO data port to fetch (no Source / ViewModel),
//     exactly like the accepted sibling presentational ports BatteryDelta / AnimatedNumber. Modelling a
//     loading / error / stale / offline lifecycle would invent a fetch the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift), so the surface's real, fully reproduced states are the
//     value branch (with its °C / °F preference + °C / °F source variants) and the em-dash branch.
//   • Source resolution (web `sourceC`): a finite `c` wins (already °C); otherwise a finite `f` is converted
//     from °F via `((f - 32) * 5) / 9`; otherwise `null` -> the em-dash read-out. NaN / Infinity is treated
//     as missing, exactly as the web `Number.isFinite` guard does.
//   • Display (web `fmtNumber(convertTempFromSI(sourceC, tempUnit), precision)` + `tempUnit`): the SI Celsius
//     source is converted to the user's preferred unit and formatted with the resolved digits, then suffixed
//     with the °C / °F symbol — reproduced here by the shared, golden-pinned `formatTemperature`.
//   • Hover title (web `${c.toFixed(1)} °C` / `${f.toFixed(1)} °F`): the RAW caller value to one decimal with
//     its SOURCE unit (never the display preference). Carried on the projection for the render layer's tooltip.
//
// The one parity subtlety: the web component formats through `fmtNumber`, whose default precision is the
// global 2, NOT the shared `formatTemperature` per-quantity fallback of 1. So the digit count is resolved
// here (prop precision -> settings precision -> 2) and passed to `formatTemperature` as an explicit override,
// keeping the displayed decimals identical to the web read-out.
//
// Why there are no i18n keys: the web source renders no English copy — only the numeric value, the °C / °F
// unit symbols (sourced from the shared unit enum, not literals), and the em-dash. There is no `t()` call to
// mirror, so this surface adds no P1/S10 catalog keys; that acceptance criterion is vacuously satisfied.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Temperature — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling BatteryDelta / AnimatedNumber surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.temperature

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatTemperature
import java.math.BigDecimal
import java.math.RoundingMode

/** The em dash shown when neither input is a finite temperature (web `'—'`). */
const val TEMPERATURE_DASH: String = "\u2014"

/**
 * Default fraction digits used when neither the `precision` prop nor the settings precision is set — the
 * web `fmtNumber` global default (2), deliberately NOT the shared `formatTemperature` per-quantity fallback
 * of 1, so the native read-out keeps the same decimals as the web component.
 */
const val TEMPERATURE_DEFAULT_PRECISION: Int = 2

/** Fraction digits the hover title always uses (web `toFixed(1)`). */
private const val TITLE_FRACTION_DIGITS: Int = 1

/** °F -> °C constants for `((f - 32) * 5) / 9` (web inline conversion of an `f`-supplied value). */
private const val FAHRENHEIT_FREEZING_OFFSET: Double = 32.0
private const val CELSIUS_PER_FAHRENHEIT_NUMERATOR: Double = 5.0
private const val CELSIUS_PER_FAHRENHEIT_DENOMINATOR: Double = 9.0

/** True when [value] is a usable temperature input — the native mirror of `value != null && isFinite(value)`. */
private fun isUsableTemperature(value: Double?): Boolean = value != null && value.isFinite()

/** Convert a Fahrenheit reading to Celsius (web `((f - 32) * 5) / 9`). */
private fun fahrenheitToCelsius(fahrenheit: Double): Double =
    (fahrenheit - FAHRENHEIT_FREEZING_OFFSET) * CELSIUS_PER_FAHRENHEIT_NUMERATOR / CELSIUS_PER_FAHRENHEIT_DENOMINATOR

/**
 * The canonical SI Celsius source for the read-out — the native mirror of the web `sourceC` resolution: a
 * finite [c] wins (already °C); otherwise a finite [f] is converted from °F; otherwise `null` (the em-dash
 * branch). A NaN / infinite input is treated as missing, exactly as the web `Number.isFinite` guard does.
 */
fun temperatureSourceCelsius(
    c: Double?,
    f: Double?,
): Double? =
    when {
        isUsableTemperature(c) -> c
        isUsableTemperature(f) -> fahrenheitToCelsius(f!!)
        else -> null
    }

/**
 * The hover title — the RAW caller value rendered to one decimal with its SOURCE unit (web
 * `${c.toFixed(1)} °C` / `${f.toFixed(1)} °F`), or `null` when neither input is finite. The source unit is
 * the unit the caller supplied, never the user's display preference.
 */
fun temperatureTitle(
    c: Double?,
    f: Double?,
): String? =
    when {
        isUsableTemperature(c) -> "${toFixedOneDecimal(c!!)} ${TemperatureUnitPref.CELSIUS.label}"
        isUsableTemperature(f) -> "${toFixedOneDecimal(f!!)} ${TemperatureUnitPref.FAHRENHEIT.label}"
        else -> null
    }

/**
 * The fraction digits the display uses — the native mirror of the web `fmtNumber(value, precision)` digit
 * resolution: the explicit [precision] prop wins; otherwise the settings precision carried on [prefs]; and
 * when neither is set, the web `fmtNumber` global default of [TEMPERATURE_DEFAULT_PRECISION].
 */
fun temperatureDisplayPrecision(
    precision: Int?,
    prefs: UnitPref,
): Int = precision ?: prefs.precision ?: TEMPERATURE_DEFAULT_PRECISION

/**
 * The fully reduced, render-ready projection of the surface — every web decision made before paint, so the
 * composable stays a thin render layer and every branch is covered off-device.
 *
 * @property hasValue whether a finite source temperature was resolved (web `sourceC != null`).
 * @property display the formatted, unit-suffixed read-out (web `{display}{tempUnit}`), or the em-dash.
 * @property title the hover title (raw source value + source unit), or `null` in the em-dash branch.
 */
data class TemperatureProjection(
    val hasValue: Boolean,
    val display: String,
    val title: String?,
)

/** Reduce the caller inputs + [prefs] into the render-ready [TemperatureProjection]. Pure (no Compose). */
fun projectTemperature(
    c: Double?,
    f: Double?,
    precision: Int?,
    prefs: UnitPref,
): TemperatureProjection {
    val sourceCelsius = temperatureSourceCelsius(c, f)
    if (sourceCelsius == null) {
        return TemperatureProjection(hasValue = false, display = TEMPERATURE_DASH, title = null)
    }
    val digits = temperatureDisplayPrecision(precision, prefs)
    return TemperatureProjection(
        hasValue = true,
        display = formatTemperature(sourceCelsius, prefs, digits),
        title = temperatureTitle(c, f),
    )
}

/**
 * Renders [value] like JavaScript `Number.toFixed(1)`: a fixed single decimal, '.'-separated, never grouped,
 * rounding half away from zero — the faithful native form of the web title's raw-value formatting. Only ever
 * called for a finite value (the title branches guard with [isUsableTemperature]).
 */
private fun toFixedOneDecimal(value: Double): String =
    BigDecimal.valueOf(value).setScale(TITLE_FRACTION_DIGITS, RoundingMode.HALF_UP).toPlainString()

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * temperature value — so a diagnostics line can never leak a cabin, battery, or ambient reading.
 */
object TemperatureDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "Temperature"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
