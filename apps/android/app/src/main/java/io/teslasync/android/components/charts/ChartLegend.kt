package io.teslasync.android.components.charts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Interactive chart legend — the Android counterpart of the web `ChartLegend`. Each
 * entry is a tappable swatch + label; tapping toggles that series' visibility via the
 * supplied [ChartLegendState] (or [onToggle]). Hidden entries dim to signal they can
 * be re-enabled. With neither a state nor a callback the legend renders passively.
 *
 * Like the web component, the legend does not hide the series itself — the caller
 * passes `hiddenKeys = state.hidden` to the chart wrapper.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChartLegend(
    entries: List<LegendEntry>,
    modifier: Modifier = Modifier,
    state: ChartLegendState? = null,
    onToggle: ((String) -> Unit)? = null,
    hiddenLabel: String = "hidden",
) {
    if (entries.isEmpty()) return
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        entries.forEach { entry ->
            val hidden = state?.isHidden(entry.key) ?: false
            val onClick: (() -> Unit)? =
                when {
                    onToggle != null -> {
                        { onToggle(entry.key) }
                    }
                    state != null -> {
                        { state.toggle(entry.key) }
                    }
                    else -> null
                }
            LegendChip(entry = entry, hidden = hidden, hiddenLabel = hiddenLabel, onClick = onClick)
        }
    }
}

@Composable
private fun LegendChip(
    entry: LegendEntry,
    hidden: Boolean,
    hiddenLabel: String,
    onClick: (() -> Unit)?,
) {
    val description = if (hidden) "${entry.label}, $hiddenLabel" else entry.label
    val base =
        Modifier
            .clip(CircleShape)
            .semantics {
                contentDescription = description
                if (onClick != null) role = Role.Button
            }
    val interactive = if (onClick != null) base.clickable { onClick() } else base
    Row(
        modifier = interactive.padding(horizontal = Spacing.xs, vertical = Spacing.xs).alpha(if (hidden) DIM_ALPHA else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .padding(end = Spacing.xs)
                    .size(SWATCH_SIZE)
                    .clip(CircleShape)
                    .background(entry.color),
        )
        Caption(entry.label)
    }
}

private val SWATCH_SIZE = 10.dp
private const val DIM_ALPHA = 0.4f
