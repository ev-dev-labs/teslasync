// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** A labelled action button rendered inside a banner (reconnect, retry, view, …). */
data class BannerAction(
    val label: String,
    val onClick: () -> Unit,
)

/**
 * Persistent, page-level inline notification mirroring web `components/feedback/AlertBanner`
 * (info / success / warning / danger). A tinted, bordered [Surface] with a leading [tone] icon,
 * an optional [title], the [message] body, an optional [action] CTA, and an optional dismiss
 * affordance. For transient post-mutation feedback use [Toast]; for the >2-minute live-data
 * outage use [LiveStaleDataBanner].
 */
@Composable
fun AlertBanner(
    message: String,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Info,
    title: String? = null,
    icon: ImageVector? = toneGlyph(tone),
    action: BannerAction? = null,
    secondaryAction: BannerAction? = null,
    onClose: (() -> Unit)? = null,
    closeLabel: String = "Dismiss",
) {
    val colors = toneColors(tone)
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                if (title != null) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.foreground,
                    )
                }
                BodyText(message, color = MaterialTheme.colorScheme.onSurface)
                if (action != null || secondaryAction != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                        if (action != null) {
                            Button(action.label, onClick = action.onClick, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
                        }
                        if (secondaryAction != null) {
                            Button(
                                secondaryAction.label,
                                onClick = secondaryAction.onClick,
                                variant = ButtonVariant.Ghost,
                                size = ButtonSize.Sm,
                            )
                        }
                    }
                }
            }
            if (onClose != null) {
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
 * Low-chrome, single-line callout mirroring web `components/feedback/InlineCallout`. Surfaces one
 * actionable insight inside a larger card. When [onClick]/[actionLabel] are supplied the whole
 * row becomes tappable with a trailing chevron; otherwise it is a passive status line.
 */
@Composable
fun InlineCallout(
    message: String,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Info,
    icon: ImageVector? = null,
    actionLabel: String? = null,
    onClick: (() -> Unit)? = null,
) {
    val colors = toneColors(tone)
    val clickModifier = if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier
    Surface(
        modifier = modifier.fillMaxWidth().then(clickModifier),
        shape = RoundedCornerShape(Radius.sm),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, size = IconSize.Sm, tint = colors.foreground)
            }
            BodyText(message, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurface)
            if (actionLabel != null) {
                Text(actionLabel, style = MaterialTheme.typography.labelMedium, color = colors.foreground)
                Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Sm, tint = colors.foreground)
            }
        }
    }
}
