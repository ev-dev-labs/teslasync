package io.teslasync.android.components.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val HANDLE_WIDTH = 16.dp
private val HANDLE_LINE = 2.dp

/**
 * Draggable column-width handle mirroring web `components/ui/DataTableResizer`. Horizontal drags
 * adjust [width] via [onWidthChange], clamped to `[minWidth, maxWidth]`. The Android-native
 * counterpart to the web pointer-resize affordance; pixel deltas are converted with the screen
 * density so a drag tracks the finger 1:1.
 */
@Composable
fun DataTableResizer(
    width: Dp,
    onWidthChange: (Dp) -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    minWidth: Dp = 64.dp,
    maxWidth: Dp = 480.dp,
) {
    val density = LocalDensity.current
    val currentWidth by rememberUpdatedState(width)
    Box(
        modifier =
            modifier
                .fillMaxHeight()
                .width(HANDLE_WIDTH)
                .pointerInput(Unit) {
                    detectHorizontalDragGestures { change, dragAmount ->
                        change.consume()
                        val deltaDp = with(density) { dragAmount.toDp() }
                        onWidthChange((currentWidth + deltaDp).coerceIn(minWidth, maxWidth))
                    }
                }.semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier =
                Modifier
                    .width(HANDLE_LINE)
                    .fillMaxHeight()
                    .background(MaterialTheme.colorScheme.outlineVariant),
        )
    }
}
