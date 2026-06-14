// The native Jetpack Compose + Material 3 Toggle shared surface — a parity port of
// web/src/components/ui/Toggle.tsx. The web surface is an accessible switch primitive: a real
// `<button role="switch" aria-checked>` carries the keyboard / screen-reader semantics, layered with a styled
// pill track and a sliding round thumb that tints the track to the accent (web cyan) and slides the thumb right
// when checked, or shows a neutral (web gray) track with the thumb resting left otherwise. It scales with a
// `size` prop (sm / md), takes an optional `label` to its right, and reports the toggled boolean through
// `onChange`. Clicking the label OR the switch toggles (the web wrapper delegates the label click to the button).
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// off / on track (selected by the pure [thumbOffsetFor] + the accent/neutral tint in ToggleModel.kt), the two
// sizes ([metricsFor]), the optional label, and the slide that reports the flipped boolean. The accessible idiom
// is the platform-native one shared with the component-library Toggle atom: the whole row is one `Role.Switch`
// target via `toggleable`, so the framework announces on / off — already localized — without any hand-rolled
// string, and the label (or a caller-supplied `contentDescription`, the web spread `aria-label`) names it. The
// track + thumb are composed from Compose primitives over the generated design tokens (P1/S9): the accent track
// maps the web cyan onto `colorScheme.primary` and the neutral track onto `colorScheme.outline` so the tint stays
// correct across light / dark / high-contrast, and the colour + slide animate with the generated motion tokens
// (web `transition-colors` / `transition-transform duration-normal`).
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook at all).
// See ToggleModel.kt for the honesty rationale and why the generic loading/empty/stale/offline states do not
// apply to a presentational control. A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition, carrying only the surface slug — never the checked value or the label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Toggle) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.toggle

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.MotionEasing
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the switch row — used by the instrumented per-state + a11y UI tests. */
const val TOGGLE_TEST_TAG: String = "toggle"

// Subtle drop shadow under the thumb (web `shadow-sm`), so the knob stays distinct on either track.
private val THUMB_ELEVATION: Dp = 1.dp

/**
 * Controlled switch — the faithful port of the web `Toggle`. Renders the off / on track at the chosen [size]
 * with an optional [label] to its right, reports the toggled boolean through [onCheckedChange], and records the
 * one-shot `view.opened` diagnostic on first composition. [onCheckedChange] is required, mirroring the web
 * component whose `onChange` prop is mandatory (there is no read-only path in the web source).
 *
 * @param checked the controlled checked value (web `checked`).
 * @param onCheckedChange reports the new boolean when toggled (web `onChange`, required).
 * @param label optional inline label to the right of the switch (web `label`).
 * @param size visual size of the switch (web `size`, default md).
 * @param contentDescription accessible name when there is no visible [label] (web spread `aria-label`).
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 */
@Composable
fun Toggle(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    size: ToggleSize = ToggleSize.Md,
    contentDescription: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ToggleDiagnostics.recordViewOpened(logger) }
    ToggleSwitch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        label = label,
        size = size,
        contentDescription = contentDescription,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Lays out the
 * track + thumb and the optional [label] as one `Role.Switch` target: the whole row is `toggleable` (≥48 dp touch
 * target, framework-localized on/off announcement, clicking the track OR the label reports the flipped boolean,
 * mirroring the web wrapper that delegates the label click to the button). When there is no [label] a
 * [contentDescription] names the control (the web spread `aria-label`).
 */
@Composable
fun ToggleSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    size: ToggleSize = ToggleSize.Md,
    contentDescription: String? = null,
) {
    val metrics = metricsFor(size)

    val interactionModifier =
        Modifier
            .minimumInteractiveComponentSize()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange)

    val description = contentDescription
    val nameModifier =
        if (label == null && description != null) {
            Modifier.semantics { this.contentDescription = description }
        } else {
            Modifier
        }

    Row(
        modifier =
            modifier
                .then(interactionModifier)
                .then(nameModifier)
                .testTag(TOGGLE_TEST_TAG),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ToggleTrack(checked = checked, metrics = metrics)
        if (label != null) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * The token-driven pill track + sliding thumb — the native mirror of the web styled `<button>` + `<span>`. The
 * track tints to `colorScheme.primary` (the web cyan) when [checked] and `colorScheme.outline` (the web gray)
 * otherwise; the thumb takes the contrasting on-colour (`onPrimary` / `onSurface`) so it stays visible on either
 * track in every theme. The track colour, the thumb colour, and the thumb's horizontal slide all animate with the
 * generated motion tokens (web `transition-* duration-normal`); the slide distance is the pure [thumbOffsetFor].
 */
@Composable
private fun ToggleTrack(
    checked: Boolean,
    metrics: ToggleMetrics,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme

    val trackColor by animateColorAsState(
        targetValue = if (checked) colors.primary else colors.outline,
        animationSpec = tween(durationMillis = MotionDurations.normal, easing = MotionEasing.standard),
        label = "toggle-track-color",
    )
    val thumbColor by animateColorAsState(
        targetValue = if (checked) colors.onPrimary else colors.onSurface,
        animationSpec = tween(durationMillis = MotionDurations.normal, easing = MotionEasing.standard),
        label = "toggle-thumb-color",
    )
    val thumbOffset by animateDpAsState(
        targetValue = thumbOffsetFor(metrics, checked).dp,
        animationSpec = tween(durationMillis = MotionDurations.normal, easing = MotionEasing.standard),
        label = "toggle-thumb-offset",
    )

    Box(
        modifier =
            modifier
                .size(width = metrics.trackWidthDp.dp, height = metrics.trackHeightDp.dp)
                .clip(CircleShape)
                .background(trackColor),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            modifier =
                Modifier
                    .offset(x = thumbOffset)
                    .size(metrics.thumbDiameterDp.dp)
                    .shadow(THUMB_ELEVATION, CircleShape)
                    .background(thumbColor, CircleShape),
        )
    }
}

// ── Previews (tooling-only; the sample label is never shipped UI) ─────────────────────────────────────────

private const val PREVIEW_LABEL = "Enable notifications"

@Preview(name = "Toggle · off / on (md)", showBackground = true)
@Composable
private fun ToggleStatesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            ToggleSwitch(checked = false, onCheckedChange = {})
            ToggleSwitch(checked = true, onCheckedChange = {})
        }
    }
}

@Preview(name = "Toggle · sizes sm / md (on)", showBackground = true)
@Composable
private fun ToggleSizesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ToggleSwitch(checked = true, size = ToggleSize.Sm, onCheckedChange = {})
            ToggleSwitch(checked = true, size = ToggleSize.Md, onCheckedChange = {})
        }
    }
}

@Preview(name = "Toggle · with label", showBackground = true)
@Composable
private fun ToggleLabelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ToggleSwitch(checked = true, label = PREVIEW_LABEL, onCheckedChange = {})
    }
}
