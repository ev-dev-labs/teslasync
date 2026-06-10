package io.teslasync.android.components.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Fullscreen toggle. The web version drives the browser Fullscreen API; on Android "fullscreen"
 * is host-defined (expand a chart/map card, enter immersive mode), so this is a controlled
 * toggle: the caller owns [isFullscreen] and reacts to [onToggle]. The icon and accessible name
 * flip together, matching the web's enter/exit signaling.
 */
@Composable
fun FullscreenButton(
    isFullscreen: Boolean,
    onToggle: () -> Unit,
    enterLabel: String,
    exitLabel: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    size: IconSize = IconSize.Md,
) {
    IconButton(
        imageVector = if (isFullscreen) TeslaGlyphs.FullscreenExit else TeslaGlyphs.Fullscreen,
        contentDescription = if (isFullscreen) exitLabel else enterLabel,
        onClick = onToggle,
        modifier = modifier,
        enabled = enabled,
        size = size,
    )
}
