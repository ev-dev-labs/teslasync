// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.generated.Spacing

/** One key/value row in a [KVList]; [value] is pre-formatted by the caller. */
data class KVItem(
    val label: String,
    val value: String,
)

/**
 * Definition-list of label/value rows with divider separators — the Android counterpart of the
 * web `KVList`. The label is muted; the value uses primary body text and is right-aligned.
 */
@Composable
fun KVList(
    items: List<KVItem>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        items.forEachIndexed { index, item ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Caption(item.label)
                Text(
                    item.value,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}
