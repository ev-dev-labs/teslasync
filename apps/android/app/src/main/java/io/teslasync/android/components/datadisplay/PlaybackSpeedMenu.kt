// File named after its primary @Composable; the co-located constants/functions are supporting.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant

/** Replay speed multipliers, slowest → fastest (matches the web `REPLAY_SPEEDS`). */
val REPLAY_SPEEDS: List<Int> = listOf(1, 10, 25, 50, 100)

/** Steps the speed up by [delta] slots (signed), clamped to the available range. */
fun shiftSpeed(
    current: Int,
    delta: Int,
): Int {
    val index = REPLAY_SPEEDS.indexOf(current).let { if (it == -1) 0 else it }
    val next = (index + delta).coerceIn(0, REPLAY_SPEEDS.lastIndex)
    return REPLAY_SPEEDS[next]
}

/** Cycles to the next-fastest speed, wrapping around to the slowest. */
fun nextSpeed(current: Int): Int {
    val index = REPLAY_SPEEDS.indexOf(current)
    return REPLAY_SPEEDS[(index + 1) % REPLAY_SPEEDS.size]
}

/**
 * Compact playback-speed control — the Android counterpart of the web `PlaybackSpeedMenu`. Tapping
 * cycles to the next speed (wrapping). Used by [PlaybackControls] and any scrub-speed surface.
 */
@Composable
fun PlaybackSpeedMenu(
    speed: Int,
    onChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    description: String = "Playback speed",
) {
    Button(
        label = "${speed}x",
        onClick = { onChange(nextSpeed(speed)) },
        modifier = modifier.semantics { contentDescription = description },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    )
}
