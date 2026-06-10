// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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

/** Status-dot tone for [StatusPill]. */
enum class StatusTone { Success, Warning, Danger, Info, Neutral }

private const val PULSE_MIN_ALPHA = 0.35f
private const val PULSE_DURATION_MS = 900
private val PILL_DOT_SIZE = 7.dp

/**
 * Live-status pill mirroring web `components/ui/StatusPill`: a neutral surface with a leading
 * tone-colored dot and a [text] label. Set [pulse] to animate the dot (e.g. "streaming"); the
 * pulse respects the tone color and loops with a gentle alpha fade.
 */
@Composable
fun StatusPill(
    text: String,
    modifier: Modifier = Modifier,
    tone: StatusTone = StatusTone.Neutral,
    pulse: Boolean = false,
) {
    val dotColor = statusToneColor(tone)
    val alpha =
        if (pulse) {
            val transition = rememberInfiniteTransition(label = "status-pulse")
            transition
                .animateFloat(
                    initialValue = PULSE_MIN_ALPHA,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Reverse),
                    label = "status-pulse-alpha",
                ).value
        } else {
            1f
        }
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .padding(end = Spacing.xs)
                        .size(PILL_DOT_SIZE)
                        .clip(CircleShape)
                        .background(dotColor.copy(alpha = alpha)),
            )
            Text(text, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun statusToneColor(tone: StatusTone): Color =
    when (tone) {
        StatusTone.Success -> TeslaTokens.status.success
        StatusTone.Warning -> TeslaTokens.status.warning
        StatusTone.Danger -> TeslaTokens.status.danger
        StatusTone.Info -> TeslaTokens.status.info
        StatusTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }
