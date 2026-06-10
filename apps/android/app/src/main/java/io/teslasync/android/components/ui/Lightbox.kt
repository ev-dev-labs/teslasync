package io.teslasync.android.components.ui

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.teslasync.android.ui.theme.generated.Spacing

const val LIGHTBOX_MIN_ZOOM = 1f
const val LIGHTBOX_MAX_ZOOM = 5f
const val LIGHTBOX_ZOOM_STEP = 0.5f

/** Metadata for one [Lightbox] slide: its accessible [contentDescription] and optional [caption]. */
data class LightboxImage(
    val contentDescription: String,
    val caption: String? = null,
)

/**
 * Immersive image viewer mirroring web `components/ui/Lightbox`. A full-screen [Dialog] with
 * prev/next navigation, +/- zoom (1×–5× in 0.5× steps, see [clampZoom]/[stepZoom]), one-finger
 * pan while zoomed, a reset action, a counter, and a caption. The image itself is supplied by
 * [imageContent] so the viewer stays decoupled from any image-loading library; [Lightbox] owns
 * the zoom/pan transform and chrome.
 */
@Composable
fun Lightbox(
    images: List<LightboxImage>,
    index: Int,
    onIndexChange: (Int) -> Unit,
    onClose: () -> Unit,
    closeLabel: String,
    previousLabel: String,
    nextLabel: String,
    zoomInLabel: String,
    zoomOutLabel: String,
    resetLabel: String,
    modifier: Modifier = Modifier,
    imageContent: @Composable BoxScope.(index: Int) -> Unit,
) {
    if (images.isEmpty()) return
    val current = index.coerceIn(0, images.lastIndex)
    var scale by remember(current) { mutableStateOf(LIGHTBOX_MIN_ZOOM) }
    var offset by remember(current) { mutableStateOf(Offset.Zero) }

    val applyScale: (Float) -> Unit = { next ->
        scale = next
        if (next <= LIGHTBOX_MIN_ZOOM) offset = Offset.Zero
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = true),
    ) {
        Surface(
            modifier =
                modifier
                    .fillMaxSize()
                    .semantics { paneTitle = images[current].contentDescription },
            color = Color.Black,
            contentColor = Color.White,
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .graphicsLayer {
                                scaleX = scale
                                scaleY = scale
                                translationX = offset.x
                                translationY = offset.y
                            }.pointerInput(current, scale) {
                                detectDragGestures { change, dragAmount ->
                                    if (scale > LIGHTBOX_MIN_ZOOM) {
                                        change.consume()
                                        offset += dragAmount
                                    }
                                }
                            },
                    contentAlignment = Alignment.Center,
                ) {
                    imageContent(current)
                }

                IconButton(
                    imageVector = TeslaGlyphs.Close,
                    contentDescription = closeLabel,
                    onClick = onClose,
                    modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.md),
                    tint = Color.White,
                )

                if (current > 0) {
                    IconButton(
                        imageVector = TeslaGlyphs.ChevronLeft,
                        contentDescription = previousLabel,
                        onClick = { onIndexChange(current - 1) },
                        modifier = Modifier.align(Alignment.CenterStart).padding(Spacing.md),
                        tint = Color.White,
                    )
                }
                if (current < images.lastIndex) {
                    IconButton(
                        imageVector = TeslaGlyphs.ChevronRight,
                        contentDescription = nextLabel,
                        onClick = { onIndexChange(current + 1) },
                        modifier = Modifier.align(Alignment.CenterEnd).padding(Spacing.md),
                        tint = Color.White,
                    )
                }

                LightboxFooter(
                    counter = "${current + 1} / ${images.size}",
                    caption = images[current].caption,
                    zoomInLabel = zoomInLabel,
                    zoomOutLabel = zoomOutLabel,
                    resetLabel = resetLabel,
                    onZoomIn = { applyScale(stepZoom(scale, LIGHTBOX_ZOOM_STEP, LIGHTBOX_MIN_ZOOM, LIGHTBOX_MAX_ZOOM)) },
                    onZoomOut = { applyScale(stepZoom(scale, -LIGHTBOX_ZOOM_STEP, LIGHTBOX_MIN_ZOOM, LIGHTBOX_MAX_ZOOM)) },
                    onReset = { applyScale(LIGHTBOX_MIN_ZOOM) },
                    modifier = Modifier.align(Alignment.BottomCenter).padding(Spacing.lg),
                )
            }
        }
    }
}

@Composable
private fun LightboxFooter(
    counter: String,
    caption: String?,
    zoomInLabel: String,
    zoomOutLabel: String,
    resetLabel: String,
    onZoomIn: () -> Unit,
    onZoomOut: () -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            IconButton(TeslaGlyphs.Minus, contentDescription = zoomOutLabel, onClick = onZoomOut, tint = Color.White)
            Button(resetLabel, onReset, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
            IconButton(TeslaGlyphs.Plus, contentDescription = zoomInLabel, onClick = onZoomIn, tint = Color.White)
        }
        Spacer(Modifier.height(Spacing.sm))
        Text(counter, color = Color.White)
        if (caption != null) {
            Spacer(Modifier.height(Spacing.xs))
            Text(caption, color = Color.White)
        }
    }
}
