// The native Jetpack Compose + Material 3 Distance shared surface — a parity port of the web inline
// distance renderer web/src/components/data-display/format/Distance.tsx. The web component reads the
// user's metric/imperial preference (`useUnits`), takes a value in miles (preferred) or kilometres,
// normalises it to SI metres, converts to the display unit, formats it with the user's decimal precision,
// and renders `{value} {unit}` in a `<span>` whose `title` attribute carries the raw caller value in its
// original unit; when neither input is finite it renders a bare em dash. All of that pure work lives in
// DistanceModel.kt (DistanceProjection) and is unit-tested off-device; this file is the thin render layer
// that binds the live unit preference and applies the text style.
//
// Parity choices:
//   • Data binding: the unit preference comes from the shared, app-scoped `unitFormatter` state holder
//     (the native `useUnits` port, P1/S8) via `LocalDataContainer` — a units change re-renders the value
//     without this surface knowing how the preference is stored. The view performs NO HTTP.
//   • `className` analogue: web callers style the span through `className`; native callers pass a [style]
//     and [color] (plus [modifier]) so size / weight / color stay caller-controlled, defaulting to the
//     ambient text style so an unstyled call reads like the surrounding copy (the inline-`<span>` look).
//   • Accessibility: the node exposes the rendered string (the value, or the em dash) as its sole content
//     description, so a screen reader reads exactly what is shown — the same information the web `<span>`
//     conveys to assistive tech.
//   • Diagnostics: a one-shot PII-safe `view.opened` is recorded on first composition (P1/S11); it
//     carries only the surface slug, never the distance, raw value, or unit.
//
// The surface has no async feed (its one dependency, the unit preference, is synchronous and always
// resolved), so — like the accepted AnimatedNumber / VisuallyHidden presentational ports — it has no
// loading / empty / error / stale / offline lifecycle beyond the source's own value vs. em-dash branches,
// and it renders no static copy of its own, so it carries no i18n keys.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Distance — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.distance

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref

/**
 * Renders a distance in the user's preferred unit — the Android port of the web `Distance`. Supply the
 * value in [miles] (preferred) or [km]; it is normalised to SI metres, converted to the user's display
 * unit (bound live from the shared unit formatter), formatted with [precision] fraction digits
 * (defaulting to the user's `decimal_precision`, or 2), and drawn as `{value} {unit}`. When neither input
 * is a finite number a bare em dash is shown. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11).
 *
 * @param modifier layout modifier for the text node.
 * @param miles the distance in miles; preferred over [km] when both are supplied (web order).
 * @param km the distance in kilometres; used only when [miles] is null / non-finite.
 * @param precision fraction-digit override; defaults to the user's `decimal_precision` (else 2).
 * @param style the text style — the caller's `className` analogue; defaults to the ambient text style.
 * @param color the text color — the caller's `className` color analogue; unspecified inherits [style].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun Distance(
    modifier: Modifier = Modifier,
    miles: Double? = null,
    km: Double? = null,
    precision: Int? = null,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DistanceDiagnostics.recordViewOpened(logger) }

    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val locale = remember(prefs.locale) { DistanceProjection.resolveLocale(prefs.locale) }
    val display =
        remember(miles, km, precision, prefs, locale) {
            DistanceProjection.project(DistanceInput(miles = miles, km = km, precision = precision), prefs, locale)
        }

    DistanceText(display = display, style = style, color = color, modifier = modifier)
}

/**
 * The stateless renderer — the test/preview entry point. Draws [DistanceDisplay.text] and exposes that
 * same string as the node's sole accessibility label via [clearAndSetSemantics], so a screen reader reads
 * exactly what is shown (the formatted value, or the em dash).
 */
@Composable
private fun DistanceText(
    display: DistanceDisplay,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = display.text,
        modifier = modifier.clearAndSetSemantics { contentDescription = display.text },
        style = style,
        color = color,
        maxLines = 1,
        softWrap = false,
    )
}

// ── Previews (tooling-only; render a projected display under the theme) ───────────────────────────────

/** Renders a projected distance inside the theme — previews resolve the projection with explicit prefs
 *  so they do not depend on the app-scoped unit formatter. */
@Composable
private fun DistancePreview(
    input: DistanceInput,
    prefs: UnitPref,
    dark: Boolean = false,
) {
    TeslaSyncTheme(darkTheme = dark, dynamicColor = false) {
        DistanceText(
            display = DistanceProjection.project(input, prefs),
            style = LocalTextStyle.current,
            color = Color.Unspecified,
        )
    }
}

@Preview(name = "Metric (km)", showBackground = true)
@Composable
private fun DistanceMetricPreview() {
    DistancePreview(
        input = DistanceInput(km = 100.0, precision = 1),
        prefs = UnitFormatter.default().prefs,
    )
}

@Preview(name = "Imperial (mi)", showBackground = true)
@Composable
private fun DistanceImperialPreview() {
    DistancePreview(
        input = DistanceInput(miles = 62.1371, precision = 1),
        prefs = UnitFormatter.default().prefs.copy(distance = DistanceUnitPref.MI),
    )
}

@Preview(name = "No value (dark)", showBackground = true)
@Composable
private fun DistanceEmptyPreview() {
    DistancePreview(
        input = DistanceInput(),
        prefs = UnitFormatter.default().prefs,
        dark = true,
    )
}
