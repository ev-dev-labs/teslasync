// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Column definition for [DataTable]: a stable [key], visible [header], horizontal [weight], an
 * optional [sortable] header and end-[alignEnd] alignment, and a [cell] renderer.
 */
data class TableColumn<T>(
    val key: String,
    val header: String,
    val weight: Float = 1f,
    val sortable: Boolean = false,
    val alignEnd: Boolean = false,
    val cell: @Composable (T) -> Unit,
)

private const val SELECTED_ROW_ALPHA = 0.08f
private const val ROW_DIVIDER_ALPHA = 0.5f

/**
 * Tabular list mirroring web `components/ui/DataTable`. Renders a header with sortable columns
 * and an optional select-all tri-state checkbox, then one row per item with weighted cells,
 * loading/empty states, and per-row selection. Sort and selection state are hoisted (use
 * [SortState.toggledBy] and [Set.togglePresence]); compose [Pagination] into the [footer] slot.
 *
 * A non-lazy [Column] body is used deliberately so the table composes inside a scrolling page
 * without nested-scroll conflicts; page large datasets via the footer.
 */
@Composable
fun <T> DataTable(
    columns: List<TableColumn<T>>,
    rows: List<T>,
    keyOf: (T) -> Any,
    modifier: Modifier = Modifier,
    sortState: SortState = SortState(),
    onSortChange: (String) -> Unit = {},
    selectable: Boolean = false,
    selectedKeys: Set<Any> = emptySet(),
    onSelectedChange: (Set<Any>) -> Unit = {},
    loading: Boolean = false,
    emptyText: String = "No data",
    selectAllLabel: String = "Select all",
    footer: (@Composable () -> Unit)? = null,
) {
    val allKeys = rows.map(keyOf).toSet()
    val selectedInView = allKeys.intersect(selectedKeys)
    val headerState =
        when {
            selectedInView.isEmpty() -> ToggleableState.Off
            allKeys.isNotEmpty() && selectedInView.size == allKeys.size -> ToggleableState.On
            else -> ToggleableState.Indeterminate
        }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (selectable) {
                    TriStateCheckbox(
                        state = headerState,
                        onClick = {
                            val next = if (headerState == ToggleableState.On) selectedKeys - allKeys else selectedKeys + allKeys
                            onSelectedChange(next)
                        },
                        label = null,
                        modifier = Modifier.semantics { contentDescription = selectAllLabel },
                    )
                    Spacer(Modifier.width(Spacing.sm))
                }
                columns.forEach { column ->
                    HeaderCell(column, sortState, onSortChange)
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            when {
                loading ->
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(Spacing.xl3),
                        contentAlignment = Alignment.Center,
                    ) { CircularProgressIndicator() }

                rows.isEmpty() ->
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(Spacing.xl3),
                        contentAlignment = Alignment.Center,
                    ) { Caption(emptyText) }

                else ->
                    rows.forEach { row ->
                        DataRow(columns, row, selectable, keyOf(row) in selectedKeys) {
                            onSelectedChange(selectedKeys.togglePresence(keyOf(row)))
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = ROW_DIVIDER_ALPHA))
                    }
            }

            if (footer != null) {
                Box(modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm)) { footer() }
            }
        }
    }
}

@Composable
private fun <T> RowScope.HeaderCell(
    column: TableColumn<T>,
    sortState: SortState,
    onSortChange: (String) -> Unit,
) {
    val base = Modifier.weight(column.weight)
    val cellModifier = if (column.sortable) base.clickable { onSortChange(column.key) } else base
    Row(
        modifier = cellModifier,
        horizontalArrangement = if (column.alignEnd) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FieldLabelText(column.header)
        if (sortState.key == column.key) {
            Spacer(Modifier.width(Spacing.xs))
            Icon(
                imageVector = if (sortState.direction == SortDirection.Asc) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Xs,
            )
        }
    }
}

@Composable
private fun <T> DataRow(
    columns: List<TableColumn<T>>,
    row: T,
    selectable: Boolean,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    val rowModifier =
        Modifier
            .fillMaxWidth()
            .then(if (selectable) Modifier.clickable(role = Role.Checkbox, onClick = onToggle) else Modifier)
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = SELECTED_ROW_ALPHA) else Color.Transparent)
            .padding(horizontal = Spacing.md, vertical = Spacing.sm)
    Row(modifier = rowModifier, verticalAlignment = Alignment.CenterVertically) {
        if (selectable) {
            Checkbox(checked = selected, onCheckedChange = null)
            Spacer(Modifier.width(Spacing.sm))
        }
        columns.forEach { column ->
            Box(
                modifier = Modifier.weight(column.weight),
                contentAlignment = if (column.alignEnd) Alignment.CenterEnd else Alignment.CenterStart,
            ) { column.cell(row) }
        }
    }
}
