package io.teslasync.android.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Adaptive list/detail scaffold for tablet and foldable layouts. From [WindowWidth.Medium] up it
 * shows the list and detail side by side; on compact width it shows one pane at a time, switching
 * to the detail pane once an item is [selected]. A7 list+detail pages compose their content into
 * the [listPane] / [detailPane] slots so the two-pane behavior is shared, not re-implemented.
 */
@Composable
fun <T> ListDetailScaffold(
    width: WindowWidth,
    selected: T?,
    listPane: @Composable () -> Unit,
    detailPane: @Composable (T?) -> Unit,
    modifier: Modifier = Modifier,
    listPaneWidth: Dp = DEFAULT_LIST_PANE_WIDTH,
) {
    if (AdaptiveNav.useTwoPane(width)) {
        Row(modifier = modifier.fillMaxSize()) {
            Box(modifier = Modifier.width(listPaneWidth).fillMaxHeight()) { listPane() }
            VerticalDivider()
            Box(modifier = Modifier.weight(1f).fillMaxHeight()) { detailPane(selected) }
        }
    } else {
        Box(modifier = modifier.fillMaxSize()) {
            if (selected == null) listPane() else detailPane(selected)
        }
    }
}

private val DEFAULT_LIST_PANE_WIDTH = 360.dp
