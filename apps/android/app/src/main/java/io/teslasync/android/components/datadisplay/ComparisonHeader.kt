package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Section header with current/prior period labels and an optional headline [delta] — the Android
 * counterpart of the web `ComparisonHeader`. Stays free of date/i18n logic: the page passes the
 * already-formatted [currentLabel] and [comparisonLabel].
 */
@Composable
fun ComparisonHeader(
    title: String,
    currentLabel: String,
    modifier: Modifier = Modifier,
    comparisonLabel: String? = null,
    delta: (@Composable () -> Unit)? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Subhead(title)
            val period = if (comparisonLabel != null) "$currentLabel \u00b7 $comparisonLabel" else currentLabel
            Caption(period)
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (delta != null) delta()
            if (actions != null) actions()
        }
    }
}
