// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/** A toggleable column entry for [DataTableColumnMenu]. */
data class TableColumnToggle(
    val key: String,
    val label: String,
    val visible: Boolean,
)

/**
 * Column-visibility menu mirroring web `components/ui/DataTableColumnsMenu`. A [DropdownMenu]
 * with a checkbox per column; tapping a row fires [onToggle] with that column's key. Drive the
 * resulting visible-set with [Set.togglePresence] in the caller.
 */
@Composable
fun DataTableColumnMenu(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    columns: List<TableColumnToggle>,
    onToggle: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismissRequest, modifier = modifier) {
        columns.forEach { column ->
            DropdownMenuItem(
                text = { Text(column.label) },
                onClick = { onToggle(column.key) },
                leadingIcon = { Checkbox(checked = column.visible, onCheckedChange = null) },
            )
        }
    }
}
