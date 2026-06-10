package io.teslasync.android.components.forms

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.state.ToggleableState
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Grouped hierarchical multi-select mirroring web `components/forms/TreeSelect`. Each [TreeGroup]
 * has a collapsible header with a tri-state checkbox (off / mixed / on — see
 * [isGroupFullySelected]/[isGroupPartiallySelected]) that selects or clears all of its leaves at
 * once; leaves toggle individually. Selection is controlled via [selected] + [onSelectedChange];
 * expansion is local.
 */
@Composable
fun TreeSelect(
    groups: List<TreeGroup>,
    selected: Set<String>,
    onSelectedChange: (Set<String>) -> Unit,
    modifier: Modifier = Modifier,
    initiallyExpanded: Boolean = true,
) {
    var expanded by remember {
        mutableStateOf(if (initiallyExpanded) groups.map { it.id }.toSet() else emptySet())
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        groups.forEach { group ->
            val isExpanded = group.id in expanded
            Row(
                modifier = Modifier.fillMaxWidth().clickable { expanded = toggleExpanded(expanded, group.id) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (isExpanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
                    contentDescription = null,
                    size = IconSize.Sm,
                )
                TriStateCheckbox(
                    state = groupToggleState(group, selected),
                    onClick = { onSelectedChange(toggleGroupSelection(selected, group)) },
                )
                BodyText(group.label, modifier = Modifier.weight(1f))
            }
            if (isExpanded) {
                Column(modifier = Modifier.fillMaxWidth().padding(start = Spacing.xl)) {
                    group.leaves.forEach { leaf ->
                        Checkbox(
                            checked = leaf.value in selected,
                            onCheckedChange = { onSelectedChange(toggleSelection(selected, leaf.value)) },
                            label = leaf.label,
                        )
                    }
                }
            }
        }
    }
}

private fun groupToggleState(
    group: TreeGroup,
    selected: Set<String>,
): ToggleableState =
    when {
        isGroupFullySelected(group, selected) -> ToggleableState.On
        isGroupPartiallySelected(group, selected) -> ToggleableState.Indeterminate
        else -> ToggleableState.Off
    }
