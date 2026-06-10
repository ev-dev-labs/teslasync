// File named after its primary @Composable; the co-located enum is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
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
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/** Overall system health surfaced by [SystemHealthDot]. */
enum class SystemHealth { Healthy, Degraded, Down }

private const val BANNER_BG_ALPHA = 0.15f
private val HEALTH_DOT = 8.dp

/**
 * Offline notice banner — the Android counterpart of the web `ServiceStatusBanner`. Animates in
 * when [offline] and shows a danger-tinted row; renders nothing otherwise. The [message] is the
 * caller's localized "you are offline, data may be stale" copy.
 */
@Composable
fun ServiceStatusBanner(
    offline: Boolean,
    message: String,
    modifier: Modifier = Modifier,
) {
    AnimatedVisibility(
        visible = offline,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
        modifier = modifier,
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .background(TeslaTokens.status.danger.copy(alpha = BANNER_BG_ALPHA))
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(DataDisplayGlyphs.WifiOff, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.danger)
            Text(message, style = MaterialTheme.typography.labelMedium, color = TeslaTokens.status.danger)
        }
    }
}

/**
 * Compact system-health dot — the Android counterpart of the web `SystemHealthDot`. Green when
 * healthy, amber when degraded, red when down. Pass [contentDescription] for TalkBack.
 */
@Composable
fun SystemHealthDot(
    health: SystemHealth,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
) {
    val color =
        when (health) {
            SystemHealth.Healthy -> TeslaTokens.status.success
            SystemHealth.Degraded -> TeslaTokens.status.warning
            SystemHealth.Down -> TeslaTokens.status.danger
        }
    Box(
        modifier =
            modifier
                .size(HEALTH_DOT)
                .clip(CircleShape)
                .background(color)
                .clearAndSetSemantics { if (contentDescription != null) this.contentDescription = contentDescription },
    )
}
