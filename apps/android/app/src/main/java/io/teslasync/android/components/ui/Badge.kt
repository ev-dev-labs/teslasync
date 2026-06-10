// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Semantic badge color, mapped to the status palette / neutral surface. */
enum class BadgeVariant { Info, Success, Warning, Danger, Neutral }

/**
 * Small status chip mirroring web `components/ui/Badge`. A pill with a low-alpha wash of the
 * variant color behind variant-colored text; set [dot] for a leading status dot.
 */
@Composable
fun Badge(
    text: String,
    modifier: Modifier = Modifier,
    variant: BadgeVariant = BadgeVariant.Neutral,
    dot: Boolean = false,
) {
    val foreground = badgeColor(variant)
    val background =
        if (variant == BadgeVariant.Neutral) {
            MaterialTheme.colorScheme.surfaceVariant
        } else {
            foreground.copy(alpha = BADGE_WASH_ALPHA)
        }
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = background,
        contentColor = foreground,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (dot) {
                Box(
                    modifier =
                        Modifier
                            .padding(end = Spacing.xs)
                            .size(DOT_SIZE)
                            .clip(CircleShape)
                            .background(foreground),
                )
            }
            Text(text, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun badgeColor(variant: BadgeVariant): Color =
    when (variant) {
        BadgeVariant.Info -> TeslaTokens.status.info
        BadgeVariant.Success -> TeslaTokens.status.success
        BadgeVariant.Warning -> TeslaTokens.status.warning
        BadgeVariant.Danger -> TeslaTokens.status.danger
        BadgeVariant.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private const val BADGE_WASH_ALPHA = 0.16f
private val DOT_SIZE = 6.dp
