// The native Jetpack Compose + Material 3 InlineCallout shared surface — a parity port of
// web/src/components/feedback/InlineCallout.tsx. The web surface is a single-line, low-chrome callout for
// surfacing one actionable insight inside a larger card (e.g. "1 anomaly in this range — Apr 24 →"): a
// severity-tinted, ring-bordered, rounded row with an optional leading icon, the body `children`, and an
// optional `action` that — when present — turns the whole callout into one tap target and appends a trailing
// label + chevron. It is a PURE presentational component — the parent owns the content and the action.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the four
// severity variants crossed with the icon / body / action prop branches and the three container modes the action
// selects (link / button / status) — without ever hiding a region. It performs NO HTTP and binds NO state holder
// (the web component fetches nothing; see InlineCalloutModel.kt for the honesty rationale and why the generic
// loading/error/stale/offline states do not apply to a controlled callout). The chrome is composed from the
// shared feedback Tone palette + the ui atoms (Icon / Caption / typography), so the severity tint stays correct
// across light / dark / high-contrast themes; the only string it renders beyond its props (the empty-body
// fallback) resolves through the i18n catalog (P1/S10). A merged TalkBack announcement covers the body + action,
// the interactive modes carry the action label as their click affordance and the static mode is a polite live
// region (the web `role="status"`), and a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition. All branch selection flows through the pure [classify] / [resolveInteraction] in
// InlineCalloutModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/InlineCallout) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.inlinecallout

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.ToneColors
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `ring-1` on the callout — a 1 px hairline tinted to the severity. */
private val CALLOUT_BORDER_WIDTH: Dp = 1.dp

/** Body text is clamped so an over-long insight degrades gracefully instead of pushing out the action. */
private const val BODY_MAX_LINES = 2

/**
 * Stateful entry point — the faithful port of the web `InlineCallout`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition and renders the callout. Performs no HTTP and binds no state holder
 * (the web component is controlled; its content is owned by the parent). [logger] defaults to the process logger.
 *
 * The body is supplied as either a flat [message] (the common case) or an arbitrary [content] slot (the faithful
 * port of the web `children` ReactNode); when neither is present a localized empty caption is shown so the
 * surface never paints a blank box.
 *
 * @param variant the severity tint (web `variant`).
 * @param message the flat body text (the common web `children`); blank and no [content] ⇒ the empty fallback.
 * @param icon the optional leading glyph (web `icon`); `null` ⇒ no icon, matching the web `{icon && …}`.
 * @param action the optional trailing affordance (web `action`); `null` ⇒ a non-interactive status callout.
 * @param content an arbitrary body slot (the faithful port of the web `children`); overrides [message] when set.
 */
@Composable
fun InlineCallout(
    variant: CalloutVariant,
    modifier: Modifier = Modifier,
    message: String? = null,
    icon: ImageVector? = null,
    action: InlineCalloutAction? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: (@Composable () -> Unit)? = null,
) {
    LaunchedEffect(Unit) { InlineCalloutDiagnostics.recordViewOpened(logger) }
    InlineCalloutContent(
        variant = variant,
        modifier = modifier,
        message = message,
        icon = icon,
        action = action,
        content = content,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies the props into
 * an [InlineCalloutRender] and draws the severity-tinted callout: the optional leading icon, the body (the
 * [message], the [content] slot, or the localized empty fallback), and the optional trailing action label +
 * chevron, wrapped in the container mode the action selects (an interactive link/button or a static status row).
 * The body + action are exposed to TalkBack as one merged announcement.
 */
@Composable
fun InlineCalloutContent(
    variant: CalloutVariant,
    modifier: Modifier = Modifier,
    message: String? = null,
    icon: ImageVector? = null,
    action: InlineCalloutAction? = null,
    content: (@Composable () -> Unit)? = null,
) {
    val render =
        classify(
            InlineCalloutInput(
                variant = variant,
                message = message,
                hasSlotContent = content != null,
                hasIcon = icon != null,
                actionLabel = action?.label,
                hasActivation = action?.onActivate != null,
                isLink = action?.isLink == true,
            ),
        )
    val colors = toneColors(toneFor(render.variant))
    val emptyFallback = stringResource(R.string.translation_common_noData)
    val bodyColor = bodyColorFor(render.variant, colors)
    val spokenLabel =
        calloutAccessibilityLabel(body = message, actionLabel = action?.label, emptyFallback = emptyFallback)

    Surface(
        modifier = modifier.fillMaxWidth().then(interactionModifier(render.interaction, action, spokenLabel)),
        shape = RoundedCornerShape(Radius.sm),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(CALLOUT_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (render.showIcon && icon != null) {
                Icon(icon, contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            }
            Box(modifier = Modifier.weight(1f)) {
                InlineCalloutBody(
                    render = render,
                    message = message,
                    emptyFallback = emptyFallback,
                    bodyColor = bodyColor,
                    content = content,
                )
            }
            if (render.showAction && action != null) {
                InlineCalloutActionLabel(label = action.label, tint = colors.foreground)
            }
        }
    }
}

/**
 * The container-mode modifier — the native mirror of the web element switch. [CalloutInteraction.Link] and
 * [CalloutInteraction.Button] make the whole callout one focusable tap target carrying the action label as its
 * click affordance (Compose has no distinct link role, so both use [Role.Button]); [CalloutInteraction.Status] is
 * a non-interactive polite live region — the web `<div role="status">`. Either way the body + action are merged
 * into one [spokenLabel] so TalkBack announces the insight and its affordance together.
 */
private fun interactionModifier(
    interaction: CalloutInteraction,
    action: InlineCalloutAction?,
    spokenLabel: String,
): Modifier =
    when (interaction) {
        CalloutInteraction.Link, CalloutInteraction.Button ->
            Modifier
                .clickable(role = Role.Button, onClickLabel = action?.label) { action?.onActivate?.invoke() }
                .semantics(mergeDescendants = true) { contentDescription = spokenLabel }
        CalloutInteraction.Status ->
            Modifier.semantics(mergeDescendants = true) {
                liveRegion = LiveRegionMode.Polite
                contentDescription = spokenLabel
            }
    }

/**
 * The body region: the arbitrary [content] slot when supplied (web `children`), else the flat [message], else a
 * localized [emptyFallback] caption so an empty body never renders as a blank box. The flat body is tinted to the
 * variant ([bodyColor]) and clamped to [BODY_MAX_LINES] so a long insight never crowds out the action.
 */
@Composable
private fun InlineCalloutBody(
    render: InlineCalloutRender,
    message: String?,
    emptyFallback: String,
    bodyColor: Color,
    content: (@Composable () -> Unit)?,
) {
    when {
        content != null -> content()
        render.showBody && message != null ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = bodyColor,
                maxLines = BODY_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
        else -> Caption(emptyFallback)
    }
}

/**
 * The trailing affordance — the action [label] in the severity [tint] (web `text-xs font-medium`) followed by a
 * chevron (web `<ChevronRight>`). Decorative: the chevron has no content description and the label is already
 * folded into the callout's merged announcement, so a screen reader hears it once, not twice.
 */
@Composable
private fun InlineCalloutActionLabel(
    label: String,
    tint: Color,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            color = tint,
            maxLines = 1,
        )
        Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Xs, tint = tint)
    }
}

/** Map the model [CalloutVariant] to the shared feedback [Tone] palette (web `variant` → callout tint). */
private fun toneFor(variant: CalloutVariant): Tone =
    when (variant) {
        CalloutVariant.Info -> Tone.Info
        CalloutVariant.Success -> Tone.Success
        CalloutVariant.Warning -> Tone.Warning
        CalloutVariant.Danger -> Tone.Danger
    }

/**
 * Per-variant body text color — the native mirror of the web `VARIANT_STYLES[variant].text`. Info/success bodies
 * are neutral secondary text (web `var(--text-secondary)` → `onSurfaceVariant`); warning/danger bodies are tinted
 * toward their severity (web `text-amber-200/85` / `text-rose-200/85` → the tone foreground), all token-based so
 * every theme stays correct.
 */
@Composable
private fun bodyColorFor(
    variant: CalloutVariant,
    colors: ToneColors,
): Color =
    when (variant) {
        CalloutVariant.Info, CalloutVariant.Success -> MaterialTheme.colorScheme.onSurfaceVariant
        CalloutVariant.Warning, CalloutVariant.Danger -> colors.foreground
    }

// ── Previews — one per severity variant plus the icon / action-link / action-button / status / empty branches. ──

private const val PREVIEW_BODY = "1 anomaly detected in this range"
private const val PREVIEW_ACTION = "Apr 24"

@Preview(name = "InlineCallout · info (icon + link action)", showBackground = true)
@Composable
private fun InlineCalloutInfoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InlineCalloutContent(
            variant = CalloutVariant.Info,
            message = PREVIEW_BODY,
            icon = toneGlyph(Tone.Info),
            action = InlineCalloutAction(label = PREVIEW_ACTION, onActivate = {}, isLink = true),
        )
    }
}

@Preview(name = "InlineCallout · success (body + button action)", showBackground = true)
@Composable
private fun InlineCalloutSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InlineCalloutContent(
            variant = CalloutVariant.Success,
            message = "Charging optimization saved \$1.20 today",
            icon = toneGlyph(Tone.Success),
            action = InlineCalloutAction(label = "View", onActivate = {}),
        )
    }
}

@Preview(name = "InlineCallout · warning (no icon, status)", showBackground = true)
@Composable
private fun InlineCalloutWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InlineCalloutContent(
            variant = CalloutVariant.Warning,
            message = "Tire pressure trending low on the front-left",
        )
    }
}

@Preview(name = "InlineCallout · danger (icon + link)", showBackground = true)
@Composable
private fun InlineCalloutDangerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InlineCalloutContent(
            variant = CalloutVariant.Danger,
            message = "Battery degradation exceeds the fleet baseline",
            icon = toneGlyph(Tone.Danger),
            action = InlineCalloutAction(label = "Details", onActivate = {}, isLink = true),
        )
    }
}

@Preview(name = "InlineCallout · empty body fallback", showBackground = true)
@Composable
private fun InlineCalloutEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InlineCalloutContent(variant = CalloutVariant.Info, icon = toneGlyph(Tone.Info))
    }
}
