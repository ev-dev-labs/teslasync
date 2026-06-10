package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

private const val ACCENT_BG_ALPHA = 0.16f
private const val ACCENT_RING_ALPHA = 0.32f

/**
 * Compact metric card with an [icon] accent box, [value], [label], optional [subtitle], and an
 * optional [delta] slot — the Android counterpart of the web `MetricCard`. Pages drop a `Delta`
 * (or any node) into [delta] for the direction-aware change indicator.
 */
@Composable
fun MetricCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    accent: Color = MaterialTheme.colorScheme.primary,
    subtitle: String? = null,
    iconContentDescription: String? = null,
    delta: (@Composable () -> Unit)? = null,
) {
    Card(modifier = modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Column(modifier = Modifier.weight(1f)) {
                MetricLabel(label)
                MetricValue(value, modifier = Modifier.padding(top = Spacing.xs))
                if (subtitle != null) HelperText(subtitle, modifier = Modifier.padding(top = Spacing.xs))
                if (delta != null) {
                    Box(modifier = Modifier.padding(top = Spacing.xs)) { delta() }
                }
            }
            if (icon != null) {
                Box(
                    modifier =
                        Modifier
                            .background(accent.copy(alpha = ACCENT_BG_ALPHA), RoundedCornerShape(Radius.md))
                            .border(1.dp, accent.copy(alpha = ACCENT_RING_ALPHA), RoundedCornerShape(Radius.md))
                            .padding(Spacing.sm),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(icon, contentDescription = iconContentDescription, size = IconSize.Md, tint = accent)
                }
            }
        }
    }
}
