// The native Jetpack Compose + Material 3 Pressure shared surface — a parity port of the web pressure
// renderer web/src/components/data-display/format/Pressure.tsx. It renders a caller-supplied pressure value
// (given in `bar` OR `psi`) converted to the user's preferred unit and formatted as `{value} {unit}`, with a
// hover title carrying the RAW caller value in its source unit; when neither input is finite it renders an em
// dash. All resolution + formatting logic lives in the pure [PressureProjection] (PressureModel.kt) so this
// file is a thin renderer.
//
// [Pressure] is the stateless primitive: a faithful 1:1 port of the web component's props (`bar`, `psi`,
// `precision`, `className` → `modifier`/`style`/`color`), the reusable atom and the per-state preview/test
// entry; it accepts the resolved [UnitFormatter] so it is pure and previewable. [PressureSurface] is the
// holder-backed entry the prompt mandates: it binds the [PressureSource] units seam (P1/S8 — the web
// `useUnits` boundary) through [PressureViewModel], records the one-shot `view.opened` diagnostic (P1/S11),
// collects the live [UnitFormatter] (so a settings unit change re-renders the value in place) and renders it
// — the same primitive/consumer split as the accepted Avatar / AnimatedNumber siblings.
//
// The web `title` attribute (a raw-value hover hint) maps to the platform tooltip — the app's shared
// [Tooltip] over Material 3 `TooltipBox`, the idiomatic native equivalent of an HTML title hover — applied
// only when a finite input exists. The visible value is the node's accessibility label, so a screen reader
// reads the meaningful reading (e.g. "35 psi"); the surface exposes no static copy of its own and so carries
// no i18n keys (the unit symbol + source-unit title are data / unit identifiers, never translatable prose).
// It performs NO HTTP.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Pressure) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pressure

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The stateless Pressure primitive — the faithful port of the web `Pressure` component. Resolves [bar] / [psi]
 * to SI kPa, formats it in [formatter]'s pressure unit at the resolved precision, and renders `{value} {unit}`
 * (or an em dash when no finite input is supplied); a finite input also gets a raw-value hover title. The
 * reusable atom and the per-state preview/test entry — it performs no work beyond rendering its inputs.
 *
 * @param bar source value in bar (web `bar`); takes priority over [psi] when both are finite.
 * @param psi source value in psi (web `psi`); used when [bar] is absent/non-finite.
 * @param precision fraction-digit override (web `precision`); falls back to the user's `decimal_precision`
 *   then the web global default of 2.
 * @param formatter the resolved SI → display formatter (web `useUnits()`); defaults to the metric formatter so
 *   an unbound preview/test call still renders.
 * @param style the value's text style — the caller's `className` analogue for size / weight; inherits the
 *   ambient style by default so the value reads like the inline span the web renders.
 * @param color the value's color — the caller's `className` color analogue; inherits by default.
 */
@Composable
fun Pressure(
    modifier: Modifier = Modifier,
    bar: Double? = null,
    psi: Double? = null,
    precision: Int? = null,
    formatter: UnitFormatter = UnitFormatter.default(),
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
) {
    val spec = PressureSpec(bar = bar, psi = psi, precision = precision)
    PressureValue(
        text = PressureProjection.display(spec, formatter),
        title = PressureProjection.sourceTitle(spec),
        style = style,
        color = color,
        modifier = modifier,
    )
}

/**
 * The holder-backed Pressure surface — binds the [source] units seam (P1/S8) through a [PressureViewModel],
 * records the one-shot `view.opened` diagnostic (P1/S11), collects the live [UnitFormatter] (so a unit-
 * preference change re-renders the value) and renders it. Mount this where the value should follow the user's
 * live unit preference; use [Pressure] directly when the formatter is already in hand. [logger] defaults to
 * the process logger and [instanceKey] scopes the ViewModel per placement.
 */
@Composable
fun PressureSurface(
    modifier: Modifier = Modifier,
    bar: Double? = null,
    psi: Double? = null,
    precision: Int? = null,
    style: TextStyle = LocalTextStyle.current,
    color: Color = Color.Unspecified,
    source: PressureSource = dataContainerUnitsSource(LocalDataContainer.current),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = PressureRegistration.SLUG,
) {
    val viewModel: PressureViewModel =
        viewModel(key = instanceKey, factory = PressureViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val formatter by viewModel.state.collectAsStateWithLifecycle()
    Pressure(
        modifier = modifier,
        bar = bar,
        psi = psi,
        precision = precision,
        formatter = formatter,
        style = style,
        color = color,
    )
}

/**
 * Renders the formatted [text] as an inline value, exposing it as the node's accessibility label so a screen
 * reader reads the meaningful reading. When a [title] exists (a finite input), wraps the value in the platform
 * [Tooltip] so a long-press / hover reveals the raw caller value — the native analogue of the web `title`
 * attribute. The empty (em-dash) branch renders the bare value, exactly as the web `<span>—</span>` carries no
 * title.
 */
@Composable
private fun PressureValue(
    text: String,
    title: String?,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val value: @Composable () -> Unit = {
        Text(
            text = text,
            modifier = modifier.semantics { contentDescription = text },
            style = style,
            color = color,
            maxLines = 1,
            softWrap = false,
        )
    }
    if (title != null) {
        Tooltip(text = title) { value() }
    } else {
        value()
    }
}

// ── Previews (tooling-only; sample readings are never shipped UI) ─────────────────────────────────────────

/** A psi-preference formatter for previews; the default [UnitFormatter] already covers the metric (bar) case. */
private fun psiPreviewFormatter(): UnitFormatter =
    UnitFormatter(UnitPreferences.fromSettings(buildJsonObject { put("unit_of_pressure", "psi") }))

@Preview(name = "Bar — metric default", showBackground = true)
@Composable
private fun PressureBarPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Pressure(bar = 2.55, precision = 2)
    }
}

@Preview(name = "Psi — imperial preference", showBackground = true)
@Composable
private fun PressurePsiPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Pressure(bar = 2.55, precision = 1, formatter = psiPreviewFormatter())
    }
}

@Preview(name = "Empty — no input (dark)", showBackground = true)
@Composable
private fun PressureEmptyPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Pressure()
    }
}
