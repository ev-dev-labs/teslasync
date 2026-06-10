package io.teslasync.android.components.datadisplay

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

private const val TICK_INTERVAL_MS = 10_000L
private const val PULSE_MIN_ALPHA = 0.4f
private const val PULSE_DURATION_MS = 1_200
private val DOT_SIZE = 7.dp

/**
 * Per-datum freshness indicator — the Android counterpart of the web `FreshnessIndicator`. Shows a
 * colored dot (pulsing while fresh) and a relative-age label that re-renders every 10s. Resolves
 * status with the shared [freshnessStatus]; values older than the stale window are surfaced amber,
 * offline ones red (ADR-013). Provide a localized [formatAge] to override the English default.
 */
@Composable
fun FreshnessIndicator(
    timestampMillis: Long?,
    modifier: Modifier = Modifier,
    staleThreshold: Long = DEFAULT_STALE_SECONDS,
    offlineThreshold: Long = DEFAULT_OFFLINE_SECONDS,
    showLabel: Boolean = true,
    formatAge: (FreshnessAge) -> String = ::formatFreshnessAge,
) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(timestampMillis) {
        while (true) {
            delay(TICK_INTERVAL_MS)
            now = System.currentTimeMillis()
        }
    }
    val age = computeAgeSeconds(timestampMillis, now)
    val status = freshnessStatus(age, staleThreshold, offlineThreshold)
    val label = formatAge(freshnessAge(age))
    val color = freshnessColor(status)

    val pulseAlpha =
        if (status == FreshnessStatus.Fresh) {
            val transition = rememberInfiniteTransition(label = "freshness-pulse")
            transition
                .animateFloat(
                    initialValue = PULSE_MIN_ALPHA,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Reverse),
                    label = "freshness-pulse-alpha",
                ).value
        } else {
            1f
        }

    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Box(
            modifier =
                Modifier
                    .size(DOT_SIZE)
                    .alpha(pulseAlpha)
                    .clip(CircleShape)
                    .background(color),
        )
        if (showLabel) HelperText(label)
    }
}
