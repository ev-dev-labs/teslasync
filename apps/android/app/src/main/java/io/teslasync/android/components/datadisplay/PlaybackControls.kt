package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Playback control bar for trip replay — the Android counterpart of the web `PlaybackControls`.
 * Composes reset / play-pause / stop buttons, the [PlaybackSpeedMenu], a [TimelineScrubber] with
 * marker ticks, and an elapsed/total readout. All control labels are caller-provided for i18n.
 */
@Composable
fun PlaybackControls(
    isPlaying: Boolean,
    speed: Int,
    progress: Float,
    elapsed: String,
    total: String,
    onPlay: () -> Unit,
    onPause: () -> Unit,
    onStop: () -> Unit,
    onSpeedChange: (Int) -> Unit,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
    markers: List<TimelineMarker> = emptyList(),
    durationSeconds: Int = 0,
    resetLabel: String = "Reset",
    playLabel: String = "Play",
    pauseLabel: String = "Pause",
    stopLabel: String = "Stop",
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            IconButton(DataDisplayGlyphs.SkipBack, contentDescription = resetLabel, onClick = onStop, size = IconSize.Sm)
            IconButton(
                if (isPlaying) DataDisplayGlyphs.Pause else DataDisplayGlyphs.Play,
                contentDescription = if (isPlaying) pauseLabel else playLabel,
                onClick = if (isPlaying) onPause else onPlay,
                size = IconSize.Sm,
            )
            IconButton(DataDisplayGlyphs.Stop, contentDescription = stopLabel, onClick = onStop, size = IconSize.Sm)
            PlaybackSpeedMenu(speed = speed, onChange = onSpeedChange)
            Box(modifier = Modifier.weight(1f).padding(horizontal = Spacing.sm)) {
                TimelineScrubber(
                    progress = progress,
                    onSeek = onSeek,
                    durationSeconds = durationSeconds,
                    markers = markers,
                )
            }
            Text(
                "$elapsed / $total",
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
