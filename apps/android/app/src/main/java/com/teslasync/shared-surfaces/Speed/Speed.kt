// The native Jetpack Compose + Material 3 Speed shared surface — a parity port of the web speed renderer
// web/src/components/data-display/format/Speed.tsx. The web component renders an inline `<span>` showing a caller
// value (supplied in mph OR km/h) converted to the user's display unit (`useUnits`) with the unit symbol appended,
// a `title` attribute carrying the raw caller value in its source unit, and an em dash when no finite value is
// given. All of that derivation lives in SpeedModel.kt and is unit-tested off-device; this file is the thin render
// layer that collects the live unit preference and draws the projected string.
//
// Parity choices:
//   • Unit preference: the surface binds the shared SI → display unit formatter (web `useUnits`) from the P1/S8
//     state-holder layer (`LocalDataContainer.unitFormatter`) and reads its `prefs`; the view performs no HTTP and
//     no unit math of its own (the pure [SpeedProjection] owns every factor).
//   • `title` attribute: reproduced with the shared [Tooltip] (web `components/ui/Tooltip` parity) — the raw
//     source value shows on long-press / hover, exactly the affordance the web `title` gives.
//   • `className` analogue: web callers style the span through `className`; native callers pass a [style] and
//     [color] (plus [modifier]) so size / weight / color stay caller-controlled, defaulting to the shared body
//     style so an unstyled call fits the surrounding copy.
//   • Tabular figures: the text style enables the `tnum` OpenType feature so the digits keep a fixed width — the
//     native analogue of a numeric inline value that should not jitter when it updates.
//   • Accessibility: the node exposes the rendered value (web display text) as its content description so a screen
//     reader announces the same speed the eye sees; the precise source figure stays available via the tooltip.
//   • Diagnostics: records the one-shot PII-safe `view.opened` event (P1/S11) on first composition.
//
// The web source has no async feed (it is handed a finished number), so — like the accepted AnimatedNumber /
// VisuallyHidden presentational ports — it has no loading / error / stale / offline lifecycle, and it renders no
// static copy of its own, so it carries no i18n keys.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Speed — the P3 prompt's allowed-files path) cannot form a valid Kotlin package,
// so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.speed

import androidx.compose.material3.MaterialTheme
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
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/** The OpenType tabular-figures feature tag — fixed-width digits so an inline value does not shift width. */
private const val TABULAR_FIGURES: String = "tnum"

/** The default inline text style — matches surrounding body copy so an unstyled call blends in (web `className`). */
@Composable
private fun defaultSpeedStyle(): TextStyle = MaterialTheme.typography.bodyMedium

/**
 * A speed value rendered in the user's display unit — the Android port of the web `Speed`. Supply the caller value
 * in exactly one source unit ([mph] OR [kmh], [mph] winning when both are finite) plus an optional [precision]
 * override; the surface converts it to SI then to the live display preference (web `useUnits`), appends the unit
 * symbol, and shows the raw source value in a long-press / hover tooltip (web `title`). With no finite value it
 * renders an em dash. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11).
 *
 * @param mph the caller value in miles-per-hour (web `mph` prop). Wins over [kmh] when both are finite.
 * @param kmh the caller value in kilometres-per-hour (web `kmh` prop), used when [mph] is absent / non-finite.
 * @param precision fraction-digit override (web `precision` prop); defaults to the user's global precision.
 * @param style the value's text style — the caller's `className` analogue for size / weight (tabular figures are
 *   always applied on top).
 * @param color the value's color — the caller's `className` color analogue.
 * @param units the live SI → display unit formatter (web `useUnits`); defaults to the app's [LocalDataContainer].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun Speed(
    modifier: Modifier = Modifier,
    mph: Double? = null,
    kmh: Double? = null,
    precision: Int? = null,
    style: TextStyle = defaultSpeedStyle(),
    color: Color = MaterialTheme.colorScheme.onSurface,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SpeedDiagnostics.recordViewOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    val prefs = formatter.prefs
    val spec = SpeedSpec(mph = mph, kmh = kmh, precision = precision)
    val display = remember(spec, prefs) { SpeedProjection.display(spec, prefs, resolveDisplayLocale(prefs.locale)) }
    SpeedText(display = display, style = style, color = color, modifier = modifier)
}

/**
 * The stateless renderer — the test / preview entry point. Draws the projected [SpeedDisplay] with tabular figures
 * and exposes the rendered value as the node's accessibility label; when the projection carries a hover [title]
 * (web `title` attribute) the value is wrapped in the shared [Tooltip] so the raw source figure is reachable on
 * long-press / hover.
 */
@Composable
private fun SpeedText(
    display: SpeedDisplay,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val title = display.title
    if (title != null) {
        Tooltip(text = title, modifier = modifier) {
            SpeedValueText(display = display, style = style, color = color)
        }
    } else {
        SpeedValueText(display = display, style = style, color = color, modifier = modifier)
    }
}

/** Draws the projected display string with fixed-width digits and the value as its sole accessibility label. */
@Composable
private fun SpeedValueText(
    display: SpeedDisplay,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = display.text,
        modifier = modifier.clearAndSetSemantics { contentDescription = display.accessibleLabel },
        style = style.merge(TextStyle(fontFeatureSettings = TABULAR_FIGURES)),
        color = color,
        maxLines = 1,
        softWrap = false,
    )
}

// ── Previews (tooling-only; render the projected string for a fixed preference) ──────────────────────────────

/** Renders a projected value inside the theme so a static preview shows the surface's real output. */
@Composable
private fun SpeedPreviewHost(
    display: SpeedDisplay,
    dark: Boolean = false,
) {
    TeslaSyncTheme(darkTheme = dark, dynamicColor = false) {
        SpeedValueText(display = display, style = defaultSpeedStyle(), color = MaterialTheme.colorScheme.onSurface)
    }
}

@Preview(name = "Imperial (mph)", showBackground = true)
@Composable
private fun SpeedImperialPreview() {
    val prefs = UnitFormatter.default().prefs.copy(speed = SpeedUnitPref.MPH)
    SpeedPreviewHost(SpeedProjection.display(SpeedSpec(mph = 65.0), prefs, Locale.US))
}

@Preview(name = "Metric (km/h, from mph source)", showBackground = true)
@Composable
private fun SpeedMetricPreview() {
    val prefs = UnitFormatter.default().prefs.copy(speed = SpeedUnitPref.KMH)
    SpeedPreviewHost(SpeedProjection.display(SpeedSpec(mph = 65.0), prefs, Locale.US))
}

@Preview(name = "Empty (no value)", showBackground = true)
@Composable
private fun SpeedEmptyPreview() {
    val prefs = UnitFormatter.default().prefs.copy(speed = SpeedUnitPref.MPH)
    SpeedPreviewHost(SpeedProjection.display(SpeedSpec(), prefs, Locale.US))
}
