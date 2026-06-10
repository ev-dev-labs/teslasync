// File named after its primary @Composable; the co-located enum/function are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Visual variants for [LiveIndicator]. */
enum class LiveIndicatorVariant { Pill, Dot, Compact }

/** Default English label for a [LiveConnectionStatus]. */
fun defaultLiveLabel(status: LiveConnectionStatus): String =
    when (status) {
        LiveConnectionStatus.Connected -> "Live"
        LiveConnectionStatus.Reconnecting -> "Reconnecting\u2026"
        LiveConnectionStatus.Disconnected -> "Offline"
        LiveConnectionStatus.Unknown -> "Unknown"
    }

private const val PILL_BG_ALPHA = 0.12f
private val DOT_SIZE = 8.dp

/**
 * At-a-glance health of the live-data pipeline — the Android counterpart of the web
 * `LiveIndicator`. Distinct from [FreshnessIndicator]: this reflects the health of the wire
 * (SSE/MQTT) rather than the age of a single datum. Use [LiveIndicatorVariant.Dot] in dense
 * headers; the pill appends [lastMessageRelative] when connected.
 */
@Composable
fun LiveIndicator(
    status: LiveConnectionStatus,
    modifier: Modifier = Modifier,
    variant: LiveIndicatorVariant = LiveIndicatorVariant.Pill,
    lastMessageRelative: String? = null,
    label: (LiveConnectionStatus) -> String = ::defaultLiveLabel,
) {
    val color = liveConnectionColor(status)
    val text = label(status)
    if (variant == LiveIndicatorVariant.Dot) {
        Box(
            modifier =
                modifier
                    .size(DOT_SIZE)
                    .clip(CircleShape)
                    .background(color)
                    .clearAndSetSemantics { contentDescription = text },
        )
        return
    }
    val showFreshness = variant == LiveIndicatorVariant.Pill && status == LiveConnectionStatus.Connected && lastMessageRelative != null
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = color.copy(alpha = PILL_BG_ALPHA),
        contentColor = color,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(liveIcon(status), contentDescription = null, size = IconSize.Xs, tint = color)
            Text(text, style = MaterialTheme.typography.labelSmall, color = color)
            if (showFreshness) {
                Text(
                    "\u00b7 $lastMessageRelative",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun liveIcon(status: LiveConnectionStatus) =
    when (status) {
        LiveConnectionStatus.Connected -> DataDisplayGlyphs.Wifi
        LiveConnectionStatus.Reconnecting -> DataDisplayGlyphs.Wifi
        else -> DataDisplayGlyphs.WifiOff
    }
