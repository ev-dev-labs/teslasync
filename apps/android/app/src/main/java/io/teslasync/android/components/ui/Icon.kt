// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Icon as M3Icon

/** Tailwind-parity icon sizes (xs..xl) mapped to dp. */
enum class IconSize(
    val dimension: Dp,
) {
    Xs(12.dp),
    Sm(14.dp),
    Md(16.dp),
    Lg(20.dp),
    Xl(24.dp),
}

/**
 * Standardized icon renderer mirroring web `components/ui/Icon`. Pass an [ImageVector] (e.g.
 * from [TeslaGlyphs]) and a [contentDescription]; supply `null` for purely decorative icons so
 * they are skipped by accessibility services. [tint] defaults to the ambient content color so
 * icons inherit their container's foreground in every theme/state.
 */
@Composable
fun Icon(
    imageVector: ImageVector,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    size: IconSize = IconSize.Md,
    tint: Color = LocalContentColor.current,
) {
    M3Icon(
        imageVector = imageVector,
        contentDescription = contentDescription,
        modifier = modifier.size(size.dimension),
        tint = tint,
    )
}
