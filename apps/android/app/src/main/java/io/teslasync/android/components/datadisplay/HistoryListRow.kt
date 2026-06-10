package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Spacing

private val LEADING_WIDTH = 40.dp

/**
 * Generic slot-based row for history-style pages (Drives, Charging, Trips) — the Android
 * counterpart of the web `HistoryListRow`. The page composes the [leading] badge, [primary] line,
 * optional [route] / [metrics] / [insight] rows; the row handles the panel, selection accent,
 * tap target, and trailing chevron.
 */
@Composable
fun HistoryListRow(
    primary: @Composable RowScope.() -> Unit,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    route: (@Composable () -> Unit)? = null,
    metrics: (@Composable RowScope.() -> Unit)? = null,
    insight: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    selected: Boolean = false,
    showChevron: Boolean = true,
) {
    val panelModifier = if (onClick != null) modifier.clickable(onClick = onClick) else modifier
    GlassPanel(
        modifier = panelModifier,
        padding = PanelPadding.Md,
        accent = if (selected) PanelAccent.Primary else PanelAccent.None,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            if (leading != null) {
                Box(modifier = Modifier.width(LEADING_WIDTH), contentAlignment = Alignment.Center) { leading() }
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    content = primary,
                )
                if (route != null) route()
                if (metrics != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                        content = metrics,
                    )
                }
                if (insight != null) insight()
            }
            if (showChevron) {
                Icon(
                    TeslaGlyphs.ChevronRight,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
