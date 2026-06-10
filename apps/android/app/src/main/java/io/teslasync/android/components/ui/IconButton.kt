// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material3.IconButton as M3IconButton

/** Icon-button emphasis, mapped to the Material 3 icon-button containers. */
enum class IconButtonVariant { Standard, Tonal, Outline }

/**
 * Icon-only button wrapper mirroring the web icon affordances (close, fullscreen, copy …).
 * Always renders a 48 dp Material touch target and requires a [contentDescription] so the
 * action is announced to screen readers.
 */
@Composable
fun IconButton(
    imageVector: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    variant: IconButtonVariant = IconButtonVariant.Standard,
    size: IconSize = IconSize.Lg,
    tint: Color = LocalContentColor.current,
) {
    val glyph: @Composable () -> Unit = {
        Icon(imageVector, contentDescription = contentDescription, size = size, tint = tint)
    }
    when (variant) {
        IconButtonVariant.Standard -> M3IconButton(onClick, modifier, enabled, content = glyph)
        IconButtonVariant.Tonal -> FilledTonalIconButton(onClick, modifier, enabled, content = glyph)
        IconButtonVariant.Outline -> OutlinedIconButton(onClick, modifier, enabled, content = glyph)
    }
}
