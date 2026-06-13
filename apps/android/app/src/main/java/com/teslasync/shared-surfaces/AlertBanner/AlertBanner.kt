// The native Jetpack Compose + Material 3 AlertBanner shared surface — a parity port of
// web/src/components/feedback/AlertBanner.tsx. The web surface is a persistent, page-level inline notification
// (info / success / warning / danger): a severity-tinted, bordered, rounded panel with an optional leading icon,
// an optional title, the body `children`, and an optional dismiss affordance. It is a PURE, CONTROLLED component
// — the parent owns the content and the dismiss callback.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the four
// severity variants crossed with the title / body / icon / dismiss prop branches — without ever hiding a region.
// It performs NO HTTP and binds NO state holder (the web component fetches nothing; see AlertBannerModel.kt for
// the honesty rationale and why the generic loading/error/stale/offline states do not apply to a controlled
// notice). The chrome is composed from the shared feedback atoms (the Tone palette) + the ui atoms
// (Icon / IconButton / BodyText / Caption / Text), so the severity tint stays correct across light / dark /
// high-contrast themes; the only strings it renders beyond its props (the dismiss label and the empty-body
// fallback) resolve through the i18n catalog (P1/S10). A merged TalkBack announcement covers the title + body,
// the dismiss button carries its own label, and a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on
// first composition. All derivation flows through the pure [classify] in AlertBannerModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AlertBanner) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.alertbanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `border` on the alert — a 1 px hairline tinted to the severity. */
private val ALERT_BORDER_WIDTH: Dp = 1.dp

/**
 * Stateful entry point — the faithful port of the web `AlertBanner`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition and renders the alert. Performs no HTTP and binds no state holder
 * (the web component is controlled; its content is owned by the parent). [logger] defaults to the process
 * logger.
 *
 * The body is supplied as either a flat [message] (the common case) or an arbitrary [content] slot (the faithful
 * port of the web `children` ReactNode); when neither is present a localized empty caption is shown so the
 * surface never paints a blank box.
 *
 * @param variant the severity tint (web `variant`).
 * @param title the optional heading shown above the body (web `title`); blank ⇒ no title row.
 * @param message the flat body text (the common web `children`); blank and no [content] ⇒ the empty fallback.
 * @param icon the optional leading glyph (web `icon`); `null` ⇒ no icon, matching the web `{icon && …}`.
 * @param onClose invoked when the user dismisses the banner (web `onClose`); `null` ⇒ no dismiss affordance.
 * @param content an arbitrary body slot (the faithful port of the web `children`); overrides [message] when set.
 */
@Composable
fun AlertBanner(
    variant: AlertVariant,
    modifier: Modifier = Modifier,
    title: String? = null,
    message: String? = null,
    icon: ImageVector? = null,
    onClose: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    LaunchedEffect(Unit) { AlertBannerDiagnostics.recordViewOpened(logger) }
    AlertBannerContent(
        variant = variant,
        modifier = modifier,
        title = title,
        message = message,
        icon = icon,
        onClose = onClose,
        content = content,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies the props into
 * an [AlertBannerRender] and draws the severity-tinted alert: the optional leading icon, the optional title, the
 * body (the [message], the [content] slot, or the localized empty fallback), and the optional dismiss button.
 * The title + body are exposed to TalkBack as one merged announcement; the dismiss button keeps its own label.
 */
@Composable
fun AlertBannerContent(
    variant: AlertVariant,
    modifier: Modifier = Modifier,
    title: String? = null,
    message: String? = null,
    icon: ImageVector? = null,
    onClose: (() -> Unit)? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val render =
        classify(
            AlertBannerInput(
                variant = variant,
                title = title,
                message = message,
                hasSlotContent = content != null,
                hasIcon = icon != null,
                dismissible = onClose != null,
            ),
        )
    val colors = toneColors(toneFor(render.variant))
    val emptyFallback = stringResource(R.string.translation_common_noData)
    val closeLabel = stringResource(R.string.translation_a11y_dismissNotification)
    val spokenLabel = bannerAccessibilityLabel(title = title, body = message, emptyFallback = emptyFallback)

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ALERT_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            if (render.showIcon && icon != null) {
                Icon(icon, contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            }
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics(mergeDescendants = true) { contentDescription = spokenLabel },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                if (render.showTitle && title != null) {
                    Text(title, style = MaterialTheme.typography.titleSmall, color = colors.foreground)
                }
                AlertBannerBody(render = render, message = message, emptyFallback = emptyFallback, content = content)
            }
            if (render.dismissible && onClose != null) {
                IconButton(
                    TeslaGlyphs.Close,
                    contentDescription = closeLabel,
                    onClick = onClose,
                    size = IconSize.Sm,
                    tint = colors.foreground,
                )
            }
        }
    }
}

/**
 * The body region: the arbitrary [content] slot when supplied (web `children`), else the flat [message], else a
 * localized [emptyFallback] caption so an empty body never renders as a blank box.
 */
@Composable
private fun AlertBannerBody(
    render: AlertBannerRender,
    message: String?,
    emptyFallback: String,
    content: (@Composable ColumnScope.() -> Unit)?,
) {
    when {
        content != null ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs), content = content)
        render.showBody && message != null ->
            BodyText(message, color = MaterialTheme.colorScheme.onSurface)
        else ->
            Caption(emptyFallback)
    }
}

/** Map the model [AlertVariant] to the shared feedback [Tone] palette (web `variant` → AlertBanner tint). */
private fun toneFor(variant: AlertVariant): Tone =
    when (variant) {
        AlertVariant.Info -> Tone.Info
        AlertVariant.Success -> Tone.Success
        AlertVariant.Warning -> Tone.Warning
        AlertVariant.Danger -> Tone.Danger
    }

// ── Previews — one per severity variant plus the title / icon / dismiss / empty-body branches. ───────────────

private const val PREVIEW_TITLE = "Tesla connection expired"
private const val PREVIEW_BODY = "Reconnect your Tesla account to resume live telemetry."

@Preview(name = "AlertBanner · info (title + body + dismiss)", showBackground = true)
@Composable
private fun AlertBannerInfoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertBannerContent(
            variant = AlertVariant.Info,
            title = PREVIEW_TITLE,
            message = PREVIEW_BODY,
            icon = toneGlyph(Tone.Info),
            onClose = {},
        )
    }
}

@Preview(name = "AlertBanner · success (body only)", showBackground = true)
@Composable
private fun AlertBannerSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertBannerContent(
            variant = AlertVariant.Success,
            message = "Settings saved.",
            icon = toneGlyph(Tone.Success),
        )
    }
}

@Preview(name = "AlertBanner · warning (title + body, no icon)", showBackground = true)
@Composable
private fun AlertBannerWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertBannerContent(
            variant = AlertVariant.Warning,
            title = "Vehicle is offline",
            message = "Showing the last known state.",
        )
    }
}

@Preview(name = "AlertBanner · danger (dismissible)", showBackground = true)
@Composable
private fun AlertBannerDangerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertBannerContent(
            variant = AlertVariant.Danger,
            title = "Charging fault",
            message = "The session stopped unexpectedly.",
            icon = toneGlyph(Tone.Danger),
            onClose = {},
        )
    }
}

@Preview(name = "AlertBanner · empty body fallback", showBackground = true)
@Composable
private fun AlertBannerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AlertBannerContent(variant = AlertVariant.Info, title = "Notice")
    }
}
