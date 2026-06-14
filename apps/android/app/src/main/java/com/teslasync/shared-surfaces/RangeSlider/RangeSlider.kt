// The native Jetpack Compose + Material 3 RangeSlider shared surface — a parity port of
// web/src/components/ui/RangeSlider.tsx. The web surface is a PURE, CONTROLLED dual-thumb range slider: two
// stacked native `<input type="range">` elements over a shared track, with an optional label/value row (the
// `label` on the left, the formatted `low – high` summary on the right, hidden when `showLabel` is false), a
// `step` increment, a `disabled` flag, and — per WAI-ARIA APG — each thumb exposed individually with its own
// accessible name (`slider.thumbMin` / `slider.thumbMax`, overridable via `minThumbLabel`/`maxThumbLabel`) and
// value text (`formatValue` or `String(n)`). Dragging one thumb past the other "swaps" them so `onChange`
// always receives a SORTED `[low, high]` tuple.
//
// This native surface keeps that contract end to end using the platform-idiomatic primitive — the Material 3
// [M3RangeSlider] (spec rule 3: native primitives, not ported web Tailwind). Material 3 keeps the
// `[low, high]` range sorted (the thumb-swap) and exposes each thumb to accessibility individually; this
// surface layers the web's per-thumb semantics on top by rendering custom start/end thumbs whose
// `contentDescription` is the resolved i18n thumb label (P1/S10) and whose `stateDescription` is the formatted
// value — the native mirror of the web `aria-label` + `aria-valuetext`. The label/value row reuses the shared
// typography atoms ([FieldLabelText] + [Caption]) on platform tokens (P1/S9 Spacing); the web `step` increment
// is folded to the Material 3 `steps` count by the pure [rangeSliderSteps], and the value/summary text by the
// pure [formatRangeSummary] / [formatBound] in RangeSliderModel.kt, so this file stays a thin render layer.
//
// It performs NO HTTP and binds NO data state holder: the web component fetches nothing (its only hooks are
// `useTranslation` + `useId`). See RangeSliderModel.kt for the honesty rationale and why the generic
// loading/empty/error/stale/offline states do not apply to a controlled primitive, plus the enumeration of the
// surface's REAL states (enabled/disabled, label shown/hidden, the value summary, default-vs-custom thumb
// labels, default-vs-custom value formatting, the thumb-swap normalization) — every one of which is reproduced
// here and previewed/tested. A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition,
// carrying only the surface slug — never the value, the bounds, or the label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RangeSlider) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer + previews.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.rangeslider

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import androidx.compose.material3.RangeSlider as M3RangeSlider

/** Test tag identifying the slider — used by the instrumented per-state + a11y UI tests. */
const val RANGE_SLIDER_TEST_TAG: String = "range-slider"

/** The web `min = 0` / `max = 1` defaults when a caller supplies no explicit bounds. */
private val DEFAULT_VALUE_RANGE: ClosedFloatingPointRange<Float> = 0f..1f

/**
 * Controlled dual-thumb range slider — the faithful port of the web `RangeSlider`. Renders the optional
 * label/value row and the two thumbs, reports the SORTED, clamped `[low, high]` through [onValueChange] on
 * every change (the web thumb-swap contract), and records the one-shot `view.opened` diagnostic on first
 * composition.
 *
 * @param value the controlled `[low, high]` selection (web `value`); always shown sorted + clamped to [valueRange].
 * @param onValueChange reports the new sorted, clamped `[low, high]` on every change (web `onChange`).
 * @param label the visible label AND accessible base name for the range (web `label`, required); already localized.
 * @param valueRange the inclusive `min..max` bounds (web `min` + `max`); defaults to `0f..1f`.
 * @param step the increment used by drag/keyboard (web `step`, default 1); folded to Material 3 `steps`.
 * @param formatValue formats both the displayed values and each thumb's spoken value text (web `formatValue`).
 * @param minThumbLabel overrides the low thumb's accessible name (web `minThumbLabel`); else the i18n default.
 * @param maxThumbLabel overrides the high thumb's accessible name (web `maxThumbLabel`); else the i18n default.
 * @param showLabel whether the label/value row is shown (web `showLabel`, default true).
 * @param enabled whether both thumbs are interactive (web `disabled` inverted).
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 */
@Composable
fun RangeSlider(
    value: ClosedFloatingPointRange<Float>,
    onValueChange: (ClosedFloatingPointRange<Float>) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = DEFAULT_VALUE_RANGE,
    step: Float = RangeSliderRegistration.DEFAULT_STEP,
    formatValue: ((Float) -> String)? = null,
    minThumbLabel: String? = null,
    maxThumbLabel: String? = null,
    showLabel: Boolean = true,
    enabled: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RangeSliderDiagnostics.recordViewOpened(logger) }

    val steps = rangeSliderSteps(valueRange.start, valueRange.endInclusive, step)
    val lowText = formatBound(value.start, formatValue)
    val highText = formatBound(value.endInclusive, formatValue)
    val summary = formatRangeSummary(value.start, value.endInclusive, formatValue)
    val lowThumbLabel = resolveThumbLabel(minThumbLabel, stringResource(R.string.translation_slider_thumbMin, label))
    val highThumbLabel = resolveThumbLabel(maxThumbLabel, stringResource(R.string.translation_slider_thumbMax, label))

    RangeSliderContent(
        value = value,
        onValueChange = onValueChange,
        label = label,
        summary = summary,
        lowThumbLabel = lowThumbLabel,
        highThumbLabel = highThumbLabel,
        lowValueText = lowText,
        highValueText = highText,
        modifier = modifier,
        valueRange = valueRange,
        steps = steps,
        showLabel = showLabel,
        enabled = enabled,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Draws the
 * optional label/value row and the Material 3 range slider, attaching each thumb's accessible name
 * ([lowThumbLabel] / [highThumbLabel]) and spoken value ([lowValueText] / [highValueText]) as its
 * `contentDescription` / `stateDescription` so TalkBack announces each thumb individually (the web per-thumb
 * `aria-label` + `aria-valuetext`). The incoming [value] and every emitted change are sorted + clamped into
 * [valueRange] by [coerceRangeIntoBounds] so the callback honours the web "always normalised so low ≤ high"
 * contract and Material 3 never receives an out-of-range value.
 */
@Composable
fun RangeSliderContent(
    value: ClosedFloatingPointRange<Float>,
    onValueChange: (ClosedFloatingPointRange<Float>) -> Unit,
    label: String,
    summary: String,
    lowThumbLabel: String,
    highThumbLabel: String,
    lowValueText: String,
    highValueText: String,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = DEFAULT_VALUE_RANGE,
    steps: Int = 0,
    showLabel: Boolean = true,
    enabled: Boolean = true,
) {
    val startInteraction = remember { MutableInteractionSource() }
    val endInteraction = remember { MutableInteractionSource() }
    val safeValue = coerceRangeIntoBounds(value, valueRange)

    Column(modifier = modifier.fillMaxWidth()) {
        if (showLabel) {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                FieldLabelText(label, modifier = Modifier.weight(1f))
                Caption(summary)
            }
            Spacer(Modifier.height(Spacing.xs))
        }
        M3RangeSlider(
            value = safeValue,
            onValueChange = { next -> onValueChange(coerceRangeIntoBounds(next, valueRange)) },
            modifier = Modifier.fillMaxWidth().testTag(RANGE_SLIDER_TEST_TAG),
            enabled = enabled,
            valueRange = valueRange,
            steps = steps,
            startInteractionSource = startInteraction,
            endInteractionSource = endInteraction,
            startThumb = {
                SliderDefaults.Thumb(
                    interactionSource = startInteraction,
                    enabled = enabled,
                    modifier =
                        Modifier.semantics {
                            contentDescription = lowThumbLabel
                            stateDescription = lowValueText
                        },
                )
            },
            endThumb = {
                SliderDefaults.Thumb(
                    interactionSource = endInteraction,
                    enabled = enabled,
                    modifier =
                        Modifier.semantics {
                            contentDescription = highThumbLabel
                            stateDescription = highValueText
                        },
                )
            },
        )
    }
}

// ── Previews — one per rendered state (labelled / no-label / disabled / custom format / stepped). ───────────

@Preview(name = "RangeSlider · with label", showBackground = true)
@Composable
private fun RangeSliderLabeledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeSliderContent(
            value = 20f..80f,
            onValueChange = {},
            label = "Battery range",
            summary = "20 \u2013 80",
            lowThumbLabel = "Battery range minimum",
            highThumbLabel = "Battery range maximum",
            lowValueText = "20",
            highValueText = "80",
            valueRange = 0f..100f,
        )
    }
}

@Preview(name = "RangeSlider · no label", showBackground = true)
@Composable
private fun RangeSliderNoLabelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeSliderContent(
            value = 30f..70f,
            onValueChange = {},
            label = "Battery range",
            summary = "30 \u2013 70",
            lowThumbLabel = "Battery range minimum",
            highThumbLabel = "Battery range maximum",
            lowValueText = "30",
            highValueText = "70",
            valueRange = 0f..100f,
            showLabel = false,
        )
    }
}

@Preview(name = "RangeSlider · disabled", showBackground = true)
@Composable
private fun RangeSliderDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeSliderContent(
            value = 10f..40f,
            onValueChange = {},
            label = "Speed",
            summary = "10 \u2013 40",
            lowThumbLabel = "Speed minimum",
            highThumbLabel = "Speed maximum",
            lowValueText = "10",
            highValueText = "40",
            valueRange = 0f..100f,
            enabled = false,
        )
    }
}

@Preview(name = "RangeSlider · custom format (percent)", showBackground = true)
@Composable
private fun RangeSliderFormattedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeSliderContent(
            value = 20f..80f,
            onValueChange = {},
            label = "Charge limit",
            summary = "20% \u2013 80%",
            lowThumbLabel = "Charge limit minimum",
            highThumbLabel = "Charge limit maximum",
            lowValueText = "20%",
            highValueText = "80%",
            valueRange = 0f..100f,
        )
    }
}

@Preview(name = "RangeSlider · stepped", showBackground = true)
@Composable
private fun RangeSliderSteppedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangeSliderContent(
            value = 2f..8f,
            onValueChange = {},
            label = "Seats",
            summary = "2 \u2013 8",
            lowThumbLabel = "Seats minimum",
            highThumbLabel = "Seats maximum",
            lowValueText = "2",
            highValueText = "8",
            valueRange = 0f..10f,
            steps = rangeSliderSteps(0f, 10f, 1f),
        )
    }
}
