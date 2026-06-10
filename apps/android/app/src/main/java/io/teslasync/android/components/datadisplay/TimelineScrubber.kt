// File named after its primary @Composable; the co-located enum/data class are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaTokens

/** A notable moment along a [TimelineScrubber]. [at] is a normalized 0..1 position. */
enum class TimelineMarkerKind { Start, Stop, ChargeStart, ChargeStop, FastSegment, RegenPeak, LowSoc, Event }

/** A marker tick on the scrubber. */
data class TimelineMarker(
    val at: Float,
    val kind: TimelineMarkerKind,
    val label: String? = null,
)

/** "m:ss" label for the playhead position, or `null` when the duration is unknown. */
fun scrubberTimeLabel(
    durationSeconds: Int,
    progress: Float,
): String? {
    if (durationSeconds <= 0) return null
    val seconds = (durationSeconds * progress.coerceIn(0f, 1f)).toInt()
    val minutes = seconds / 60
    val rem = seconds % 60
    return "$minutes:${rem.toString().padStart(2, '0')}"
}

private val TRACK_HEIGHT = 6.dp
private val THUMB_SIZE = 12.dp
private val MARKER_WIDTH = 3.dp
private val SCRUBBER_HEIGHT = 32.dp

/**
 * Rich timeline scrubber for trip replay — the Android counterpart of the web `TimelineScrubber`.
 * Tap or drag to seek; keyframe [markers] render as colored ticks; an optional [background] (e.g.
 * a `Sparkline`) sits behind the track. Exposes slider semantics with the playhead time for
 * TalkBack.
 */
@Composable
fun TimelineScrubber(
    progress: Float,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
    durationSeconds: Int = 0,
    markers: List<TimelineMarker> = emptyList(),
    background: (@Composable () -> Unit)? = null,
    contentDescription: String = "Playback progress",
) {
    val clamped = progress.coerceIn(0f, 1f)
    val valueText = scrubberTimeLabel(durationSeconds, clamped)
    val semanticLabel = if (valueText != null) "$contentDescription $valueText" else contentDescription
    BoxWithConstraints(
        modifier = modifier.fillMaxWidth().height(SCRUBBER_HEIGHT),
        contentAlignment = Alignment.CenterStart,
    ) {
        val widthPx = constraints.maxWidth.toFloat()
        val fullWidth = maxWidth
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(SCRUBBER_HEIGHT)
                    .semantics {
                        this.contentDescription = semanticLabel
                        progressBarRangeInfo = ProgressBarRangeInfo(clamped, 0f..1f)
                    }.pointerInput(widthPx) {
                        detectTapGestures { offset ->
                            if (widthPx > 0f) onSeek((offset.x / widthPx).coerceIn(0f, 1f))
                        }
                    }.pointerInput(widthPx) {
                        detectHorizontalDragGestures { change, _ ->
                            if (widthPx > 0f) onSeek((change.position.x / widthPx).coerceIn(0f, 1f))
                        }
                    },
            contentAlignment = Alignment.CenterStart,
        ) {
            if (background != null) {
                Box(modifier = Modifier.fillMaxWidth().height(SCRUBBER_HEIGHT)) { background() }
            }
            // Track
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(TRACK_HEIGHT)
                        .clip(RoundedCornerShape(percent = 50))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
            )
            // Fill
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(clamped)
                        .height(TRACK_HEIGHT)
                        .clip(RoundedCornerShape(percent = 50))
                        .background(MaterialTheme.colorScheme.primary),
            )
            // Markers
            markers.forEach { marker ->
                Box(
                    modifier =
                        Modifier
                            .offset(x = fullWidth * marker.at.coerceIn(0f, 1f) - MARKER_WIDTH / 2)
                            .size(width = MARKER_WIDTH, height = TRACK_HEIGHT * 2)
                            .clip(RoundedCornerShape(percent = 50))
                            .background(markerColor(marker.kind)),
                )
            }
            // Playhead thumb
            Box(
                modifier =
                    Modifier
                        .offset(x = fullWidth * clamped - THUMB_SIZE / 2)
                        .size(THUMB_SIZE)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.onSurface),
            )
        }
    }
}

@Composable
private fun markerColor(kind: TimelineMarkerKind): Color =
    when (kind) {
        TimelineMarkerKind.Start, TimelineMarkerKind.ChargeStart -> TeslaTokens.status.success
        TimelineMarkerKind.Stop, TimelineMarkerKind.LowSoc -> TeslaTokens.status.danger
        TimelineMarkerKind.ChargeStop, TimelineMarkerKind.FastSegment -> TeslaTokens.status.warning
        TimelineMarkerKind.RegenPeak -> TeslaTokens.status.info
        TimelineMarkerKind.Event -> MaterialTheme.colorScheme.onSurfaceVariant
    }
