// Pure, framework-free model + projection for the Weather at Car dashboard widget — the native analogue
// of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render
// layer. The SI Celsius outside temperature is converted to the user's display unit here, at the single
// render-boundary seam (Phase-48 SI-canonical rule; web `convertTempFromSI` + `useUnits` + `fmtInt`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/WeatherAtCarWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling RangeEstimateWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.weatheratcar

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.formatTemperature
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Em dash shown for a missing reading — the shared formatter's empty value and the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The degree mark suffixed to each rounded coordinate, mirroring the web `{lat.toFixed(2)}°`. */
private const val DEGREE_SIGN: String = "\u00B0"

/** Outside temperature renders as whole display degrees — the web `fmtInt(convertTempFromSI(…))`. */
private const val TEMPERATURE_DECIMALS: Int = 0

/** Coordinates render with two fraction digits — the web `latitude.toFixed(2)` / `longitude.toFixed(2)`. */
private const val COORDINATE_DECIMALS: Int = 2

/** At or below this SI Celsius reading the surface shows the snow condition (web `tempC <= 0`). */
internal const val FREEZING_THRESHOLD_C: Double = 0.0

/** At or above this SI Celsius reading the surface shows the clear/sunny condition (web `tempC >= 25`). */
internal const val HOT_THRESHOLD_C: Double = 25.0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. Unlike the
 * sibling climate surfaces, the web `WeatherAtCarWidget` DOES read `size`: a 1×1 footprint renders the
 * compact (icon over temperature) layout, every larger footprint renders the full (icon beside temperature
 * + label + coordinates) layout. [isCompact] reproduces the web `size.cols === 1 && size.rows === 1`.
 */
data class WeatherAtCarSize(
    val cols: Int,
    val rows: Int,
) {
    /** True for the single-cell footprint that renders the compact layout (web `isCompact`). */
    val isCompact: Boolean get() = cols == 1 && rows == 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/climate.ts (`weather-at-car`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object WeatherAtCarRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "weather-at-car"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "climate"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "WeatherAtCarWidget"

    /** Default footprint: 1 column × 2 rows (web `defaultSize`). */
    val DEFAULT_SIZE: WeatherAtCarSize = WeatherAtCarSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: WeatherAtCarSize = WeatherAtCarSize(cols = 1, rows = 2)

    /** Maximum footprint: 3 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: WeatherAtCarSize = WeatherAtCarSize(cols = 3, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: WeatherAtCarSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: WeatherAtCarSize): WeatherAtCarSize =
        WeatherAtCarSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The weather condition the surface depicts, chosen from the outside temperature — the native analogue of
 * the web `WeatherIcon` branch (`tempC <= 0 → CloudSnow`, `tempC >= 25 → Sun`, else `CloudSun`). The render
 * layer resolves each condition to its glyph; the threshold logic stays pure and unit-tested here.
 */
enum class WeatherCondition {
    /** At/below freezing (web `CloudSnow`). */
    Freezing,

    /** At/above the warm threshold (web `Sun`). */
    Hot,

    /** Between the two thresholds (web `CloudSun`). */
    Mild,
}

/**
 * Localized labels the surface folds into its output (web `t('widget.…')` calls). The pure
 * [WeatherAtCarProjection] reads these to assemble the empty-state message and the TalkBack content
 * description; the composable additionally renders [outsideTemperature] as the visible field label. The
 * composable builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets it stay a pure, locale-stable function.
 */
data class WeatherAtCarStrings(
    val weatherAtCar: String,
    val outsideTemperature: String,
    val noWeather: String,
)

/**
 * The fully projected, render-ready view of the weather at the vehicle — the native analogue of everything
 * the web component computes before returning JSX. Pure data (no Compose types) so every branch is
 * unit-tested directly. When [hasData] is false the surface renders its empty state instead of the reading.
 *
 * @property hasData whether a decodable vehicle state with an outside temperature was present (web
 *   `outsideTemp != null`); when false the surface shows its "No weather data" empty state.
 * @property condition which weather glyph to depict, derived from the SI outside temperature.
 * @property temperatureText the localized outside temperature, already SI→display converted, rounded to a
 *   whole degree, and unit-suffixed (web `fmtInt(toTemperatureDisplay(outsideTemp))}{tempUnit}`), or the em
 *   dash when absent.
 * @property coordinatesText the `"{lat}°, {lng}°"` string (web `latitude.toFixed(2)°, longitude.toFixed(2)°`)
 *   shown beneath the label in the full layout, or `null` when no reading is present.
 * @property contentDescription a TalkBack phrase folding the reading into one announcement.
 */
data class WeatherAtCarDisplay(
    val hasData: Boolean,
    val condition: WeatherCondition,
    val temperatureText: String,
    val coordinatesText: String?,
    val contentDescription: String,
) {
    companion object {
        /** The no-reading projection (web `outsideTemp == null`): the surface shows its empty state. */
        fun noData(message: String): WeatherAtCarDisplay =
            WeatherAtCarDisplay(
                hasData = false,
                condition = WeatherCondition.Mild,
                temperatureText = EM_DASH,
                coordinatesText = null,
                contentDescription = message,
            )
    }
}

/**
 * Pure projection from a decoded [VehicleState] (or `null`) to the [WeatherAtCarDisplay] — the native port
 * of the field reads + inline formatting `WeatherAtCarWidget.tsx` performs in JSX. The SI Celsius
 * `outside_temp` is converted to the user's display unit via the shared [formatTemperature] (web
 * `useUnits()` + `convertTempFromSI` + `fmtInt`), keeping the SI source unconverted (Phase-48; ADR-013);
 * the weather glyph is chosen from the RAW SI Celsius reading exactly as the web `WeatherIcon tempC` does.
 */
object WeatherAtCarProjection {
    /**
     * Project [state] using the user's [prefs] (temperature unit) and the localized [strings]. A `null`
     * state — or a non-finite outside temperature — yields the no-data projection (web `outsideTemp == null`
     * empty branch); otherwise the temperature is converted + formatted and the coordinates are rendered,
     * exactly as the web component does.
     */
    fun project(
        state: VehicleState?,
        prefs: UnitPref,
        strings: WeatherAtCarStrings,
    ): WeatherAtCarDisplay {
        if (state == null || !state.outsideTemp.isFinite()) {
            return WeatherAtCarDisplay.noData(strings.noWeather)
        }
        val temperatureText = formatTemperature(state.outsideTemp, prefs, TEMPERATURE_DECIMALS)
        val coordinatesText = formatCoordinates(state.latitude, state.longitude)
        return WeatherAtCarDisplay(
            hasData = true,
            condition = conditionFor(state.outsideTemp),
            temperatureText = temperatureText,
            coordinatesText = coordinatesText,
            contentDescription = "${strings.outsideTemperature} $temperatureText, $coordinatesText",
        )
    }

    /** True when [state] carries no decodable reading (web `outsideTemp == null`) → render the empty state. */
    fun isEmptyReading(state: VehicleState?): Boolean = state == null || !state.outsideTemp.isFinite()

    /**
     * Choose the weather condition from the SI Celsius outside temperature — the web `WeatherIcon` branch:
     * at/below 0 °C the snow glyph, at/above 25 °C the clear glyph, otherwise the partly-cloudy glyph. The
     * thresholds read the RAW SI reading (not the display-converted value), matching the web `tempC` prop.
     */
    fun conditionFor(outsideTempC: Double): WeatherCondition =
        when {
            outsideTempC <= FREEZING_THRESHOLD_C -> WeatherCondition.Freezing
            outsideTempC >= HOT_THRESHOLD_C -> WeatherCondition.Hot
            else -> WeatherCondition.Mild
        }

    /**
     * Render the `"{lat}°, {lng}°"` coordinate string — the web `{latitude.toFixed(2)}°, {longitude.toFixed(2)}°`.
     * Both values are fixed to two fraction digits with a dot decimal separator and half-up rounding, matching
     * ECMAScript `toFixed`, so the native output equals the web truth.
     */
    fun formatCoordinates(
        latitude: Double,
        longitude: Double,
    ): String = "${fixed(latitude)}$DEGREE_SIGN, ${fixed(longitude)}$DEGREE_SIGN"

    private fun fixed(value: Double): String {
        val safe = if (value.isFinite()) value else 0.0
        val pattern = "0." + "0".repeat(COORDINATE_DECIMALS)
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(safe)
    }
}
