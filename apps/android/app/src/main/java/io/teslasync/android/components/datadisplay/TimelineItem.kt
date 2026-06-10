// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** One entry in a [Timeline] / standalone [TimelineItem]. [time] is pre-formatted by the caller. */
data class TimelineEntry(
    val title: String,
    val time: String,
    val subtitle: String? = null,
    val icon: ImageVector? = null,
    val accent: Color? = null,
    val onClick: (() -> Unit)? = null,
)

private const val MARKER_BG_ALPHA = 0.16f
private val MARKER_SIZE = 32.dp
private val MARKER_DOT = 8.dp

/**
 * Single activity-feed row with a marker (icon or dot) and a connector line — the Android
 * counterpart of the web `TimelineItem`. Set [isLast] to omit the trailing connector; an
 * [TimelineEntry.onClick] makes the whole row tappable for drill-through.
 */
@Composable
fun TimelineItem(
    entry: TimelineEntry,
    isLast: Boolean,
    modifier: Modifier = Modifier,
) {
    val accent = entry.accent ?: MaterialTheme.colorScheme.onSurfaceVariant
    val rowModifier =
        if (entry.onClick != null) modifier.clickable(onClick = entry.onClick) else modifier
    Row(
        modifier = rowModifier.height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier =
                    Modifier
                        .size(MARKER_SIZE)
                        .clip(RoundedCornerShape(Radius.md))
                        .background(accent.copy(alpha = MARKER_BG_ALPHA)),
                contentAlignment = Alignment.Center,
            ) {
                if (entry.icon != null) {
                    Icon(entry.icon, contentDescription = null, size = IconSize.Sm, tint = accent)
                } else {
                    Box(modifier = Modifier.size(MARKER_DOT).clip(CircleShape).background(accent))
                }
            }
            if (!isLast) {
                Box(
                    modifier =
                        Modifier
                            .width(1.dp)
                            .weight(1f)
                            .background(MaterialTheme.colorScheme.outlineVariant),
                )
            }
        }
        Column(modifier = Modifier.padding(bottom = if (isLast) Spacing.none else Spacing.md)) {
            Text(entry.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface)
            if (entry.subtitle != null) Caption(entry.subtitle)
            Spacer(Modifier.height(Spacing.xs))
            HelperText(entry.time)
        }
    }
}
