package io.teslasync.android.components.datadisplay

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Chronological per-user activity feed — the Android counterpart of the web `RecentActivityFeed`.
 * Maps each [TimelineEntry] onto the shared [Timeline]; shows an [emptyMessage] empty-state when
 * there is nothing to display so the surface never renders blank.
 */
@Composable
fun RecentActivityFeed(
    entries: List<TimelineEntry>,
    modifier: Modifier = Modifier,
    emptyMessage: String = "No recent activity in this window.",
) {
    if (entries.isEmpty()) {
        DataEmpty(emptyMessage, modifier = modifier, icon = DataDisplayGlyphs.History)
        return
    }
    Timeline(items = entries, modifier = modifier)
}
