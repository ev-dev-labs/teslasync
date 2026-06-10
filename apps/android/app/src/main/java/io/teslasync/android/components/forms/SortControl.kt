// File holds SortControl; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.forms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.ui.theme.generated.Spacing

/** One sort field option: a stable [value] and a localised [label]. */
data class SortOption(
    val value: String,
    val label: String,
)

/**
 * Sort field + direction control mirroring web `components/forms/SortControl`. A field [Select]
 * sits beside a direction toggle whose arrow reflects the current [direction] (see
 * [flipSortDirection]); changing either calls the matching callback so URL/list state stays owned
 * by the caller.
 */
@Composable
fun SortControl(
    field: String,
    direction: SortDirection,
    options: List<SortOption>,
    onFieldChange: (String) -> Unit,
    onDirectionChange: (SortDirection) -> Unit,
    modifier: Modifier = Modifier,
    directionLabel: String = "Toggle sort direction",
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Select(
            options = options.map { SelectOption(it.value, it.label) },
            selectedValue = field,
            onSelect = onFieldChange,
            modifier = Modifier.weight(1f),
        )
        IconButton(
            imageVector = if (direction == SortDirection.Asc) FormsGlyphs.ArrowUp else FormsGlyphs.ArrowDown,
            contentDescription = directionLabel,
            onClick = { onDirectionChange(flipSortDirection(direction)) },
            variant = IconButtonVariant.Outline,
            size = IconSize.Sm,
        )
    }
}
