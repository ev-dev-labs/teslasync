// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.generated.Spacing

/** One day-cluster of items in a [DateGroupedList]. Labels are pre-formatted by the caller. */
data class DateGroup<T>(
    val dateKey: String,
    val dateLabel: String,
    val items: List<T>,
    val relativeLabel: String? = null,
    val summary: String? = null,
)

/**
 * Generic list with date-divider headers and an optional per-group summary — the Android
 * counterpart of the web `DateGroupedList`. Domain aggregation (the "2 drives · 6.2 mi" summary)
 * lives on the caller, so this stays free of unit/format logic. [renderItem] draws each item.
 */
@Composable
fun <T> DateGroupedList(
    groups: List<DateGroup<T>>,
    modifier: Modifier = Modifier,
    renderItem: @Composable (T) -> Unit,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        groups.forEach { group ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    Text(
                        group.dateLabel,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (group.relativeLabel != null) Caption(group.relativeLabel)
                    HorizontalDivider(modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.outlineVariant)
                    if (group.summary != null) Caption(group.summary)
                }
                group.items.forEach { item -> renderItem(item) }
            }
        }
    }
}
