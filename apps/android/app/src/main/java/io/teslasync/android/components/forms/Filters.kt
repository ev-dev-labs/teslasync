// File holds the filter-control family; co-located data classes are supporting types.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.forms

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.LocalDate

/** One selectable pill in a [PillFilterBar]: a stable [id], a [label], and an optional [count]. */
data class PillItem(
    val id: String,
    val label: String,
    val count: Int? = null,
)

/** One active filter chip in [ActiveFilterChips]: a stable [key], a [label], and its [value]. */
data class ActiveFilter(
    val key: String,
    val label: String,
    val value: String,
)

/**
 * Wrapping container for filter controls mirroring web `components/forms/FilterBar`. A [FlowRow]
 * that lays out child controls (search, selects, pills) with consistent spacing and wraps on
 * narrow widths.
 */
@Composable
fun FilterBar(
    modifier: Modifier = Modifier,
    content: @Composable FlowRowScope.() -> Unit,
) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        content = content,
    )
}

/**
 * Single-select pill row mirroring web `components/forms/PillFilterBar`. Each [PillItem] renders as
 * a toggle pill; the [selectedId] one is highlighted, and tapping any pill calls [onSelect].
 */
@Composable
fun PillFilterBar(
    items: List<PillItem>,
    selectedId: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        items.forEach { item ->
            val label = item.count?.let { "${item.label} ($it)" } ?: item.label
            Pill(label = label, selected = item.id == selectedId, onClick = { onSelect(item.id) })
        }
    }
}

/**
 * Active-filter summary mirroring web `components/forms/ActiveFilterChips`. Renders one removable
 * chip per active filter; when more than [maxVisible] are active the surplus collapses behind a
 * "+N more" pill (see [chipSplit]) that expands inline, plus an optional Clear-all action. Renders
 * nothing when there are no filters.
 */
@Composable
fun ActiveFilterChips(
    filters: List<ActiveFilter>,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
    onClearAll: (() -> Unit)? = null,
    maxVisible: Int = 8,
    clearAllLabel: String = "Clear all",
) {
    if (filters.isEmpty()) return
    var expanded by remember { mutableStateOf(false) }
    val split = chipSplit(filters.size, maxVisible)
    val shown = if (expanded) filters else filters.take(split.visible)

    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        shown.forEach { filter ->
            FilterChipView(filter = filter, onRemove = { onRemove(filter.key) })
        }
        if (!expanded && split.overflow > 0) {
            Pill(label = "+${split.overflow} more", selected = false, onClick = { expanded = true })
        }
        if (onClearAll != null) {
            Button(clearAllLabel, onClick = onClearAll, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        }
    }
}

/**
 * Quick date-range preset chips mirroring web `components/forms/DatePresetChips`. Tapping a chip
 * resolves its inclusive [DateRange] relative to [todayEpochDay] (see [resolveDatePreset]) and
 * forwards both the preset and the range to [onSelect]; the [activePreset] chip is highlighted.
 */
@Composable
fun DatePresetChips(
    onSelect: (DatePreset, DateRange) -> Unit,
    modifier: Modifier = Modifier,
    activePreset: DatePreset? = null,
    presets: List<DatePreset> = DatePreset.entries,
    todayEpochDay: Long = LocalDate.now().toEpochDay(),
) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        presets.forEach { preset ->
            Button(
                datePresetLabel(preset),
                onClick = { onSelect(preset, resolveDatePreset(preset, todayEpochDay)) },
                variant = if (preset == activePreset) ButtonVariant.Primary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * Information-density cycle control mirroring web `components/forms/DensityToggle`. Shows the
 * current density label and cycles Compact → Comfortable → Spacious on tap (see [nextDensity]).
 */
@Composable
fun DensityToggle(
    density: io.teslasync.android.components.ui.UiDensity,
    onDensityChange: (io.teslasync.android.components.ui.UiDensity) -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        densityLabel(density),
        onClick = { onDensityChange(nextDensity(density)) },
        modifier = modifier,
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
    )
}

@Composable
private fun Pill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(Radius.pill),
        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun FilterChipView(
    filter: ActiveFilter,
    onRemove: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Row(
            modifier = Modifier.padding(start = Spacing.md, end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${filter.label}: ${filter.value}", style = MaterialTheme.typography.labelMedium)
            IconButton(TeslaGlyphs.Close, contentDescription = "Remove ${filter.label}", onClick = onRemove, size = IconSize.Xs)
        }
    }
}
