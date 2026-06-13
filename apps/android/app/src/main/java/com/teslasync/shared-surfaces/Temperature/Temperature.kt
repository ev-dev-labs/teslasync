// The native Jetpack Compose + Material 3 Temperature shared surface — a parity port of the web temperature
// renderer web/src/components/data-display/format/Temperature.tsx. The web surface is a compact, inline
// read-out of a temperature that respects the user's °C/°F preference: it takes a canonical °C value (`c`)
// or an alternative °F value (`f`, converted to °C first), converts to the preferred unit, formats it, and
// suffixes the unit symbol — with a hover `title` exposing the RAW caller value in its SOURCE unit. When
// neither input is finite it renders an em-dash. Its only hook is `useUnits` (the °C/°F display preference),
// so it is pure presentational — the parent owns the value(s).
//
// Every derivation flows through the pure [projectTemperature] in TemperatureModel.kt; this composable is a
// thin render layer that binds the live preference from the P1/S8 units state holder
// (`LocalDataContainer.unitFormatter`), maps the projected title onto the shared long-press/hover [Tooltip]
// (the native analogue of the web `title`), lays out the inline read-out, and fires the one-shot PII-safe
// `view.opened` diagnostic (P1/S11). It performs NO HTTP. The read-out's visible text is its accessibility
// label (a screen reader speaks the formatted temperature), mirroring the web `<span>` whose text content is
// what assistive tech announces.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Temperature) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.temperature

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref

/**
 * Stateful entry point — the faithful port of the web `Temperature`. Records the one-shot `view.opened`
 * diagnostic, reads the live °C/°F preference from the P1/S8 units state holder, and renders the read-out for
 * the [c] (°C) / [f] (°F) inputs. Always renders (the web component never returns `null`): a missing /
 * non-finite pair falls through to the em-dash branch. Performs no HTTP; [logger] defaults to the process
 * logger.
 *
 * @param c canonical input in °C (web `c`); `null` / non-finite falls back to [f].
 * @param f alternative input in °F (web `f`); converted to °C before display.
 * @param precision fraction-digit override (web `precision`); `null` resolves to the settings precision, then 2.
 * @param modifier the caller's `className` analogue, applied to the read-out text.
 * @param style the read-out text style; defaults to the inherited ambient style, like the web bare `<span>`.
 * @param color the read-out text color; defaults to the inherited ambient color (web inherits from the parent).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun Temperature(
    c: Double? = null,
    f: Double? = null,
    precision: Int? = null,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TemperatureDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    TemperatureContent(
        prefs = formatter.prefs,
        c = c,
        f = f,
        precision = precision,
        modifier = modifier,
        style = style,
        color = color,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reduces the inputs +
 * [prefs] into a [TemperatureProjection] and draws the unit-suffixed read-out, wrapping the value branch in a
 * long-press/hover [Tooltip] that mirrors the web `title` (the raw source value with its source unit). The
 * em-dash branch renders the bare read-out with no tooltip, exactly as the web omits the `title` there.
 */
@Composable
fun TemperatureContent(
    prefs: UnitPref,
    c: Double? = null,
    f: Double? = null,
    precision: Int? = null,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
) {
    val projection = remember(c, f, precision, prefs) { projectTemperature(c, f, precision, prefs) }
    val title = projection.title
    if (title != null) {
        Tooltip(text = title) {
            TemperatureReadout(text = projection.display, modifier = modifier, style = style, color = color)
        }
    } else {
        TemperatureReadout(text = projection.display, modifier = modifier, style = style, color = color)
    }
}

/**
 * The inline read-out text — the single visible node. Its [text] IS its accessibility label (a screen reader
 * speaks the formatted temperature), mirroring the web `<span>` whose text content is what assistive tech
 * announces; the value branch additionally exposes the raw source value through the wrapping [Tooltip].
 */
@Composable
private fun TemperatureReadout(
    text: String,
    modifier: Modifier,
    style: TextStyle,
    color: Color,
) {
    Text(
        text = text,
        modifier = modifier,
        style = style,
        color = color,
    )
}

// ── Previews (tooling-only; sample temperatures are never shipped UI) ─────────────────────────────────────

/** The metric (°C) default preference for previews — the same cold-start preference the app boots with. */
private fun previewCelsiusPrefs(): UnitPref = UnitFormatter.default().prefs

/** The °F preference for previews — the metric default with the temperature unit flipped to Fahrenheit. */
private fun previewFahrenheitPrefs(): UnitPref = UnitFormatter.default().prefs.copy(temperature = TemperatureUnitPref.FAHRENHEIT)

@Preview(name = "Celsius preference — °C source", showBackground = true)
@Composable
private fun TemperatureCelsiusPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureContent(prefs = previewCelsiusPrefs(), c = 23.456)
    }
}

@Preview(name = "Fahrenheit preference — °C source", showBackground = true)
@Composable
private fun TemperatureFahrenheitPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureContent(prefs = previewFahrenheitPrefs(), c = 23.456)
    }
}

@Preview(name = "°F source converted to the °C preference", showBackground = true)
@Composable
private fun TemperatureFahrenheitSourcePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TemperatureContent(prefs = previewCelsiusPrefs(), f = 212.0)
    }
}

@Preview(name = "Em-dash — no finite input (dark)", showBackground = true)
@Composable
private fun TemperatureEmptyPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        TemperatureContent(prefs = previewCelsiusPrefs())
    }
}
