package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Selection toolbar mirroring web `components/ui/DataTableBulkBar`. Shown above a table when
 * [count] > 0: a live "{n} selected" label, caller-supplied bulk [actions], and a clear button.
 * Renders nothing when [count] is 0.
 */
@Composable
fun DataTableBulkBar(
    count: Int,
    onClear: () -> Unit,
    selectedText: (Int) -> String,
    clearLabel: String,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    if (count <= 0) return
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(selectedText(count), style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.weight(1f))
            actions()
            Spacer(Modifier.width(Spacing.xs))
            IconButton(TeslaGlyphs.Close, contentDescription = clearLabel, onClick = onClear, size = IconSize.Sm)
        }
    }
}
