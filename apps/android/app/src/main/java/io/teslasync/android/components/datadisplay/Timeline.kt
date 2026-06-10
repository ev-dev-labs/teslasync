package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Vertical activity timeline — the Android counterpart of the web `Timeline`. Renders each
 * [TimelineEntry] via [TimelineItem], wiring the connector line between successive items.
 */
@Composable
fun Timeline(
    items: List<TimelineEntry>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        items.forEachIndexed { index, entry ->
            TimelineItem(entry = entry, isLast = index == items.lastIndex)
        }
    }
}
