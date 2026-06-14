// The native Jetpack Compose + Material 3 Slider shared surface — a parity port of
// web/src/components/ui/Slider.tsx. The web surface is a single-thumb slider primitive: a native
// `<input type="range">` carries the WAI-ARIA APG slider keyboard semantics (Arrow steps by `step`,
// Page steps by ~10%, Home/End jump to min/max) plus touch + drag, with an optional label row whose
// right edge shows the live, caller-formatted value, and the same formatted string announced through
// `aria-valuetext`. It snaps to a `step` increment (default 1), dims when `disabled`, hides the visible
// label (keeping an accessible name) when `showLabel` is false, and reports each new value via `onChange`.
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws —
// the value position along the track, the discrete-step vs continuous track, the label-shown row with its
// live value vs the label-hidden control, and the disabled dim — over the pure [SliderProjection] in
// SliderModel.kt. The control is the platform-idiomatic Material 3 [M3Slider] so its accessibility, font
// scaling, touch target, and theming come from the framework: the value is announced through
// `stateDescription` (the native mirror of `aria-valuetext`) carrying the already-localized, caller-formatted
// text, and the slider is named through `contentDescription` (the native mirror of the label / spread
// `aria-label`). The visible label + live value reuse the shared design-system typography (FieldLabelText /
// Caption) over the generated tokens (P1/S9), matching the sibling component-library slider.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; its only React
// dependency is `useId`). See SliderModel.kt for the honesty rationale and why the generic
// loading/empty/error/stale/offline states do not apply to a controlled presentational control. A one-shot
// PII-safe `view.opened` diagnostic (P1/S11) fires on first composition, carrying only the surface slug —
// never the value, the bounds, or the label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Slider) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.slider

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import androidx.compose.material3.Slider as M3Slider

/**
 * Controlled single-thumb slider — the faithful port of the web `Slider`. Renders the optional [label] row with
 * a right-aligned live value (formatted by [formatValue], else the raw number), then a Material 3 track snapped
 * to [step] over `[min, max]`, reports each new value through [onValueChange], and records the one-shot
 * `view.opened` diagnostic on first composition. When [showLabel] is false the visible label row is hidden and
 * the control keeps its accessible name (web `aria-label`); [enabled] false dims and disables it (web `disabled`).
 *
 * @param value the controlled current value (web `value`); coerced into `[min, max]` for the thumb.
 * @param min the inclusive lower bound (web `min`).
 * @param max the inclusive upper bound (web `max`).
 * @param onValueChange reports the new value as the thumb moves (web `onChange`).
 * @param label the visible label and the accessible name for the slider (web `label`, required).
 * @param step the increment Arrow keys + drag snap to (web `step`, default 1); ≤ 0 ⇒ a continuous track.
 * @param formatValue formats the live value and the announced `stateDescription` (web `formatValue`).
 * @param showLabel whether the visible label row is shown (web `showLabel`, default true).
 * @param enabled whether the control is interactive (web `disabled` inverted).
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 */
@Composable
fun Slider(
    value: Float,
    min: Float,
    max: Float,
    onValueChange: (Float) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    step: Float = SliderRegistration.DEFAULT_STEP,
    formatValue: ((Float) -> String)? = null,
    showLabel: Boolean = true,
    enabled: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SliderDiagnostics.recordViewOpened(logger) }
    SliderField(
        value = value,
        min = min,
        max = max,
        onValueChange = onValueChange,
        label = label,
        modifier = modifier,
        step = step,
        formatValue = formatValue,
        showLabel = showLabel,
        enabled = enabled,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Lays out the
 * optional [label] row (label + live value) over the Material 3 track. The track is named via `contentDescription`
 * (the web label / `aria-label`) and announces its value via `stateDescription` (the web `aria-valuetext`), both
 * derived once through the pure [SliderProjection] so the value coercion, discrete-step count, and display text
 * stay testable off-device. Hidden label ([showLabel] false) keeps the accessible name; [enabled] false disables.
 */
@Composable
fun SliderField(
    value: Float,
    min: Float,
    max: Float,
    onValueChange: (Float) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    step: Float = SliderRegistration.DEFAULT_STEP,
    formatValue: ((Float) -> String)? = null,
    showLabel: Boolean = true,
    enabled: Boolean = true,
) {
    val display =
        remember(value, min, max, step, formatValue) {
            SliderProjection.project(value, min, max, step, formatValue)
        }

    val trackModifier =
        Modifier
            .fillMaxWidth()
            .testTag(SLIDER_TEST_TAG)
            .semantics {
                contentDescription = label
                stateDescription = display.valueText
            }

    Column(modifier = modifier.fillMaxWidth()) {
        if (showLabel) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FieldLabelText(label, modifier = Modifier.weight(1f))
                Caption(display.valueText)
            }
            Spacer(Modifier.height(Spacing.xs))
        }
        M3Slider(
            value = display.thumbValue,
            onValueChange = onValueChange,
            modifier = trackModifier,
            enabled = enabled,
            valueRange = display.valueRange,
            steps = display.steps,
        )
    }
}

// ── Previews — one per rendered state (labelled / formatted value / hidden label / continuous / disabled). The
// sample labels are tooling-only and never shipped UI. ───────────────────────────────────────────────────────

private const val PREVIEW_LABEL = "Charge limit"
private const val PREVIEW_MIN = 0f
private const val PREVIEW_MAX = 100f
private const val PREVIEW_VALUE = 80f
private const val PREVIEW_STEP = 5f

@Preview(name = "Slider · labelled (discrete)", showBackground = true)
@Composable
private fun SliderLabelledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SliderField(
            value = PREVIEW_VALUE,
            min = PREVIEW_MIN,
            max = PREVIEW_MAX,
            onValueChange = {},
            label = PREVIEW_LABEL,
            step = PREVIEW_STEP,
        )
    }
}

@Preview(name = "Slider · formatted value", showBackground = true)
@Composable
private fun SliderFormattedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SliderField(
            value = PREVIEW_VALUE,
            min = PREVIEW_MIN,
            max = PREVIEW_MAX,
            onValueChange = {},
            label = PREVIEW_LABEL,
            step = PREVIEW_STEP,
            formatValue = { "${it.toInt()}%" },
        )
    }
}

@Preview(name = "Slider · hidden label", showBackground = true)
@Composable
private fun SliderHiddenLabelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SliderField(
            value = PREVIEW_VALUE,
            min = PREVIEW_MIN,
            max = PREVIEW_MAX,
            onValueChange = {},
            label = PREVIEW_LABEL,
            step = PREVIEW_STEP,
            showLabel = false,
        )
    }
}

@Preview(name = "Slider · continuous", showBackground = true)
@Composable
private fun SliderContinuousPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SliderField(
            value = PREVIEW_VALUE,
            min = PREVIEW_MIN,
            max = PREVIEW_MAX,
            onValueChange = {},
            label = PREVIEW_LABEL,
            step = 0f,
        )
    }
}

@Preview(name = "Slider · disabled", showBackground = true)
@Composable
private fun SliderDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SliderField(
            value = PREVIEW_VALUE,
            min = PREVIEW_MIN,
            max = PREVIEW_MAX,
            onValueChange = {},
            label = PREVIEW_LABEL,
            step = PREVIEW_STEP,
            enabled = false,
        )
    }
}
