package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Compact icon + value (+ optional label) pair used in stat rows within cards — the Android
 * counterpart of the web `InlineMetric`. Rendered in muted text so it reads as supporting detail.
 */
@Composable
fun InlineMetric(
    icon: ImageVector,
    value: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    iconContentDescription: String? = null,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(icon, contentDescription = iconContentDescription, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Caption(value)
        if (label != null) Caption(label)
    }
}
