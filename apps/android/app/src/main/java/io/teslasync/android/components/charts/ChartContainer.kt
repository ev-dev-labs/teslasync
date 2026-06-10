package io.teslasync.android.components.charts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The framing chrome for every chart — the Android counterpart of the web
 * `ChartContainer`. A [GlassPanel] with a title/subtitle header, an optional action
 * slot plus the export menu and a fullscreen toggle, a body that switches between
 * real loading / error / empty / content states by [status], and an expandable
 * accessible data table (the screen-reader fallback the web renders as a hidden
 * `<table>`).
 *
 * The chart itself is the [content] slot — pass a `LineChartWrapper`, `BarChartWrapper`,
 * etc. The container never hides a section: a chart with no data shows the empty
 * state, never a blank panel.
 */
@Composable
fun ChartContainer(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    status: ChartStatus = ChartStatus.Ready,
    height: Dp = ChartDefaults.Height,
    action: (@Composable () -> Unit)? = null,
    accessibleDescription: String? = null,
    dataTableHeader: List<String>? = null,
    dataTableRows: List<List<String>>? = null,
    dataTableLabel: String = "Data table",
    emptyMessage: String = "",
    errorMessage: String = "",
    retryLabel: String? = null,
    onRetry: (() -> Unit)? = null,
    onExportImage: (() -> Unit)? = null,
    onCopyImage: (() -> Unit)? = null,
    onExportCsv: (() -> Unit)? = null,
    fullscreen: Boolean = false,
    onToggleFullscreen: (() -> Unit)? = null,
    fullscreenLabel: String = "Toggle fullscreen",
    content: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                PanelTitle(title)
                if (subtitle != null) Caption(subtitle)
            }
            action?.invoke()
            if (onToggleFullscreen != null) {
                IconButton(
                    imageVector = if (fullscreen) TeslaGlyphs.FullscreenExit else TeslaGlyphs.Fullscreen,
                    contentDescription = fullscreenLabel,
                    onClick = onToggleFullscreen,
                    size = IconSize.Md,
                )
            }
            if (status == ChartStatus.Ready) {
                ChartExportMenu(
                    onExportImage = onExportImage,
                    onCopyImage = onCopyImage,
                    onExportCsv = onExportCsv,
                )
            }
        }
        Spacer(Modifier.height(Spacing.sm))
        when (status) {
            ChartStatus.Loading -> ChartLoadingState(height = height)
            ChartStatus.Error ->
                ChartErrorState(
                    message = errorMessage,
                    height = height,
                    retryLabel = retryLabel,
                    onRetry = onRetry,
                )
            ChartStatus.Empty -> ChartEmptyState(message = emptyMessage, height = height)
            ChartStatus.Ready -> {
                val bodyModifier =
                    if (accessibleDescription != null) {
                        Modifier.semantics { contentDescription = accessibleDescription }
                    } else {
                        Modifier
                    }
                Box(modifier = bodyModifier) { content() }
            }
        }
        if (status == ChartStatus.Ready && dataTableHeader != null && dataTableRows != null) {
            Spacer(Modifier.height(Spacing.sm))
            ChartDataTable(header = dataTableHeader, rows = dataTableRows, label = dataTableLabel)
        }
    }
}

/**
 * Expandable data table that mirrors the chart's series — both a user-facing data
 * view and the screen-reader fallback for the opaque chart canvas. Built from the
 * JVM-tested [tableHeader]/[tableRows] output.
 */
@Composable
private fun ChartDataTable(
    header: List<String>,
    rows: List<List<String>>,
    label: String,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Radius.sm))
                    .clickable { expanded = !expanded }
                    .padding(vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(label, modifier = Modifier.weight(1f))
            Icon(
                imageVector = if (expanded) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
            )
        }
        if (expanded) {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = TABLE_MAX_HEIGHT)
                        .verticalScroll(rememberScrollState()),
            ) {
                ChartTableRow(cells = header, header = true)
                HorizontalDivider()
                rows.forEach { row -> ChartTableRow(cells = row, header = false) }
            }
        }
    }
}

@Composable
private fun ChartTableRow(
    cells: List<String>,
    header: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        cells.forEach { cell ->
            if (header) {
                Caption(cell, modifier = Modifier.weight(1f))
            } else {
                BodyText(cell, modifier = Modifier.weight(1f))
            }
        }
    }
}

private val TABLE_MAX_HEIGHT = 220.dp
