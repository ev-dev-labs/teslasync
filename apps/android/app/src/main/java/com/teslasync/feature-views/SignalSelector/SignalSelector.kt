// The native Jetpack Compose + Material 3 SignalSelector feature view — a parity port of
// web/src/features/telemetry/components/SignalSelector.tsx. The web component is the `ComboboxMulti` wrapper
// specialised for signal names: a small label that reads "Signals (N / max)" (or "Signals (N)" when
// uncapped, or an explicit override), an optional live-state-layer help affordance beside it, and a
// multi-select of signal names hard-capped (default 5) so the resulting chart stays legible. This port keeps
// that contract: the label form, the layer-help gate, the cap (which both disables further additions and
// slices the emitted selection), and a friendly empty note when no signals are available.
//
// SignalSelector is a controlled control — the web component takes its `options` / `value` and the
// `onChange` callback as props from the owning page (e.g. the Signal Explorer filter), which owns the
// per-vehicle signal-catalog query and the selected-signals client state and mounts this control only in its
// resolved branch. So, as the sibling presentational ports (WeekSelector, StatusHeader) document, the
// loading / error / stale / offline states live on the owning page, not here; the branches the web source
// defines are the complete state set this surface renders. The one data source the web component binds is
// `useTranslation`, mapped natively to the generated i18n catalog (P1/S10) — every visible string resolves
// through a catalog key, with no English literal in shipped code. Every derivation flows through the pure
// [SignalSelectorProjection]; the composable is a thin render layer that records the one-shot `view.opened`
// diagnostic (P1/S11) on first composition.
//
// Shared-counterpart mapping (web → native): web `ComboboxMulti` (@/components/forms) → the shared
// io.teslasync.android.components.forms.ComboboxMulti; web `HelpTooltip` used here as a bare help trigger
// (i18nKey + ariaLabel, no title) (@/components/ui) → the shared HelpIcon; web's small uppercase label span
// → the Caption typography role; the web lucide `Search` field icon is an internal detail of the atomic
// combobox (out of scope for this surface, covered by the P3 component-library bundle). The help trigger's
// accessible name resolves through the catalog's shared `help.tooltip.iconLabel` ("More info") — the same
// generic fallback the web HelpTooltip applies — because the surface-specific `help.signal.layers.aria` key
// is not in the P1/S10 Android catalog and this artifact may not edit the catalog.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalSelector) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalselector

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.forms.ComboboxMulti
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful 1:1 port of the web `SignalSelector({ options, value, onChange, max,
 * showLayerHelp, labelOverride })` props. Records the one-shot `view.opened` diagnostic on first composition
 * (P1/S11), projects the props onto a [SignalSelectorDisplay] via the pure [SignalSelectorProjection], and
 * renders the stateless content. Toggling a signal recomputes the next selection through
 * [SignalSelectorProjection.applyToggle] (which enforces the cap) and emits it through [onChange].
 *
 * @param options every selectable signal name (web `options`).
 * @param value the ordered current selection (web `value`).
 * @param onChange fired with the next selection whenever a signal is toggled (web `onChange`).
 * @param max hard selection cap; defaults to [SignalSelectorProjection.DEFAULT_MAX] (5). Pass `null` for no
 *   cap — web `max?: number | null`.
 * @param showLayerHelp whether the live-state-layer help affordance renders beside the label (web default
 *   `true`).
 * @param labelOverride overrides the computed "Signals (N / max)" label verbatim when non-null (web
 *   `labelOverride`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalSelector(
    options: List<String>,
    value: List<String>,
    onChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    max: Int? = SignalSelectorProjection.DEFAULT_MAX,
    showLayerHelp: Boolean = true,
    labelOverride: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SignalSelectorDiagnostics.recordViewOpened(logger) }
    val signalsWord = stringResource(R.string.translation_Signals)
    val display =
        remember(signalsWord, options, value, max, showLayerHelp, labelOverride) {
            val label = SignalSelectorProjection.resolveLabel(signalsWord, value.size, max, labelOverride)
            SignalSelectorProjection.project(
                label = label,
                options = options,
                value = value,
                max = max,
                showLayerHelp = showLayerHelp,
            )
        }
    SignalSelectorContent(
        display = display,
        onToggle = { signal -> onChange(SignalSelectorProjection.applyToggle(value, signal, max)) },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test entry point. Reproduces the web layout: a [Caption] label
 * ("Signals (N / max)") with an optional layer-help [HelpIcon] beside it, the shared [ComboboxMulti] of
 * signal names (every option carrying its enabled flag so additions stop at the cap), and a friendly note
 * below — the "no results" hint when the catalog resolved empty, or the "maximum reached" hint once the cap
 * is hit. The combobox carries the label as its accessible name (the native analogue of the web `hideLabel`
 * intent: present for screen readers, not duplicated visually).
 */
@Composable
fun SignalSelectorContent(
    display: SignalSelectorDisplay,
    onToggle: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val helpText = stringResource(R.string.translation_help_signal_layers)
    val helpAria = stringResource(R.string.translation_help_tooltip_iconLabel)
    val emptySelectionPrompt = stringResource(R.string.translation_Signals)
    val capReached = stringResource(R.string.translation_combobox_maxReached)
    val noOptions = stringResource(R.string.translation_combobox_noResults)

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(display.label)
            if (display.showLayerHelp) {
                HelpIcon(text = helpText, contentDescription = helpAria, size = IconSize.Sm)
            }
        }
        ComboboxMulti(
            options = display.options,
            selectedValues = display.selectedValues,
            onToggle = onToggle,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics { contentDescription = display.label },
            emptyLabel = emptySelectionPrompt,
        )
        when {
            !display.hasOptions -> HelperText(noOptions)
            display.atCap -> HelperText(capReached)
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val SAMPLE_OPTIONS =
    listOf(
        "VehicleSpeed",
        "BatteryLevel",
        "ChargeState",
        "OutsideTemp",
        "TpmsPressureFl",
        "PackVoltage",
    )

@Preview(name = "Capped — partial selection", showBackground = true)
@Composable
private fun SignalSelectorCappedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSelectorContent(
            display =
                previewDisplay(
                    options = SAMPLE_OPTIONS,
                    value = listOf("VehicleSpeed", "BatteryLevel"),
                    max = SignalSelectorProjection.DEFAULT_MAX,
                    showLayerHelp = true,
                ),
            onToggle = {},
        )
    }
}

@Preview(name = "At cap", showBackground = true)
@Composable
private fun SignalSelectorAtCapPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSelectorContent(
            display =
                previewDisplay(
                    options = SAMPLE_OPTIONS,
                    value = SAMPLE_OPTIONS.take(SignalSelectorProjection.DEFAULT_MAX),
                    max = SignalSelectorProjection.DEFAULT_MAX,
                    showLayerHelp = true,
                ),
            onToggle = {},
        )
    }
}

@Preview(name = "Uncapped, no help", showBackground = true)
@Composable
private fun SignalSelectorUncappedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSelectorContent(
            display =
                previewDisplay(
                    options = SAMPLE_OPTIONS,
                    value = listOf("VehicleSpeed"),
                    max = null,
                    showLayerHelp = false,
                ),
            onToggle = {},
        )
    }
}

@Preview(name = "Empty catalog", showBackground = true)
@Composable
private fun SignalSelectorEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSelectorContent(
            display =
                previewDisplay(
                    options = emptyList(),
                    value = emptyList(),
                    max = SignalSelectorProjection.DEFAULT_MAX,
                    showLayerHelp = true,
                ),
            onToggle = {},
        )
    }
}

@Preview(name = "Label override", showBackground = true)
@Composable
private fun SignalSelectorLabelOverridePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalSelectorContent(
            display =
                previewDisplay(
                    options = SAMPLE_OPTIONS,
                    value = listOf("PackVoltage"),
                    max = SignalSelectorProjection.DEFAULT_MAX,
                    showLayerHelp = true,
                    labelOverride = "Compare signals",
                ),
            onToggle = {},
        )
    }
}

/**
 * Compose the two pure projection steps for tooling previews: resolve the label with the literal sample word
 * (previews are tooling-only, never shipped UI, so a literal is fine here) and assemble the display.
 */
private fun previewDisplay(
    options: List<String>,
    value: List<String>,
    max: Int?,
    showLayerHelp: Boolean,
    labelOverride: String? = null,
): SignalSelectorDisplay =
    SignalSelectorProjection.project(
        label = SignalSelectorProjection.resolveLabel("Signals", value.size, max, labelOverride),
        options = options,
        value = value,
        max = max,
        showLayerHelp = showLayerHelp,
    )
