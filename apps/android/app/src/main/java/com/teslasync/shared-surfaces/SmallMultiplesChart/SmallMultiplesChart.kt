// The native Jetpack Compose + Material 3 SmallMultiplesChart shared surface — a parity port of
// web/src/components/charts/SmallMultiplesChart.tsx. The web surface is a "small multiples" / "trellis" grid: one
// mini line chart per series, each with its OWN y-scale (so series of very different magnitudes don't flatten
// each other), all sharing a single cursor `syncId` so a cursor on one cell lands at the same timestamp on every
// other cell — "that's the whole point of small multiples". A cell whose series has no finite value shows a
// localized "No data" empty state instead of an empty plot. It is purely presentational: the parent hands in the
// already-loaded rows + the series keys to project; there is no fetch (so no P1/S8 state holder), exactly like
// the sibling ChartExportMenu surface.
//
// This port keeps that contract end to end. All data decisions (per-cell projection, finite filtering, stride
// downsampling, color index, the diagnostic) live in the pure, off-device-tested ChartExportMenuModel-style
// SmallMultiplesChartModel.kt; this composable owns only the one-shot `view.opened` diagnostic (P1/S11), the i18n
// resolution of the empty-cell label (P1/S10), and the Compose render. It reuses the shared chart primitives
// (`VicoCartesianChart`, the cursor-sync store, the brand palette, `ChartEmptyState`) rather than re-importing a
// chart library — those atomic components are owned by the P3 component-library bundle, out of scope here.
//
// Rendering note (documented native adaptation, not a parity shortcut): each cell hides its per-cell axes and
// draws the synced cursor as a precise full-width Canvas overlay — the established treatment of this exact
// visualization in the chart layer (components/charts/SmallMultiplesChart) — because an axis-less plot fills the
// cell so the cross-cell cursor aligns exactly. Each cell's own y-scale (the headline web feature) is preserved
// by Vico's independent per-cell autoscaling. The web's IntersectionObserver lazy mount has no Compose analogue
// (Compose composes lazily by construction) and no user-visible state, so it is intentionally not ported.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SmallMultiplesChart) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.smallmultipleschart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartDefaults
import io.teslasync.android.components.charts.ChartEmptyState
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.MarkerSeverity
import io.teslasync.android.components.charts.VicoCartesianChart
import io.teslasync.android.components.charts.cursorSyncPosition
import io.teslasync.android.components.charts.fractionForIndex
import io.teslasync.android.components.charts.markerColor
import io.teslasync.android.components.charts.seriesColor
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Default column count for the responsive cell grid (web auto-fills by min cell width; mobile packs two-up). */
private const val DEFAULT_COLUMNS = 2

private val SWATCH_SIZE = 8.dp
private val CURSOR_STROKE = 1.5.dp

/**
 * Stateful entry point — the faithful port of the web `SmallMultiplesChart`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), resolves the empty-cell label through the i18n catalog (P1/S10), projects the [rows] into
 * one cell per [series] key via the pure model, and renders the grid. Performs no HTTP; the parent owns the data.
 *
 * @param rows the already-loaded, time-ordered input rows (web `data`); each carries a formatted x label + the
 *   per-series samples.
 * @param series the series keys to render — one cell each, in order (web `series`).
 * @param seriesLabel optional friendly label per series key; defaults to the key (web `seriesLabel`).
 * @param columns cells per row in the responsive grid (web `columns`); defaults to a mobile-friendly two-up.
 * @param cellHeight pixel height of each cell's plot (web `cellHeight`).
 * @param syncId cross-cell cursor-sync id; cells sharing it mirror the hovered/selected timestamp (web `syncId`).
 * @param colorIndex optional series-key → palette-index override (web `colorIndex`).
 * @param onCellClick optional drill-in handler invoked with the series key when a cell is activated (web
 *   `onCellClick`); when supplied the cell becomes a focusable, TalkBack-actionable button.
 * @param emptyCellLabel overrides the per-cell "No data" empty-state text; `null` resolves the i18n default
 *   (web `emptyCellLabel ?? t('smallMultiples.noData', 'No data')`).
 * @param maxPointsPerCell per-cell stride-downsample cap (web `maxPointsPerCell`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SmallMultiplesChart(
    rows: List<SmallMultiplesRow>,
    series: List<String>,
    modifier: Modifier = Modifier,
    seriesLabel: (String) -> String = { it },
    columns: Int = DEFAULT_COLUMNS,
    cellHeight: Dp = ChartDefaults.CompactHeight,
    syncId: String? = null,
    colorIndex: Map<String, Int>? = null,
    onCellClick: ((String) -> Unit)? = null,
    emptyCellLabel: String? = null,
    maxPointsPerCell: Int = ChartDefaults.MAX_POINTS_PER_CELL,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SmallMultiplesChartDiagnostics.recordViewOpened(logger) }

    val noData = emptyCellLabel ?: stringResource(R.string.translation_smallMultiples_noData)
    val cells = remember(rows, series, maxPointsPerCell) { projectCells(rows, series, maxPointsPerCell) }
    val keptIndices = remember(rows.size, maxPointsPerCell) { strideIndices(rows.size, maxPointsPerCell) }

    SmallMultiplesGrid(
        cells = cells,
        noData = noData,
        modifier = modifier,
        keptIndices = keptIndices,
        seriesLabel = seriesLabel,
        columns = columns,
        cellHeight = cellHeight,
        syncId = syncId,
        colorIndex = colorIndex,
        onCellClick = onCellClick,
    )
}

/**
 * The stateless grid renderer — shared by the live surface and the tooling previews. Lays the projected [cells]
 * out in a [columns]-wide [FlowRow]; an empty list (no series) renders the friendly [noData] empty state rather
 * than a blank region. Subscribes to the cross-cell cursor for [syncId] and threads it into every cell.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SmallMultiplesGrid(
    cells: List<SmallMultiplesCell>,
    noData: String,
    modifier: Modifier = Modifier,
    keptIndices: List<Int> = emptyList(),
    seriesLabel: (String) -> String = { it },
    columns: Int = DEFAULT_COLUMNS,
    cellHeight: Dp = ChartDefaults.CompactHeight,
    syncId: String? = null,
    colorIndex: Map<String, Int>? = null,
    onCellClick: ((String) -> Unit)? = null,
) {
    if (cells.isEmpty()) {
        ChartEmptyState(message = noData, modifier = modifier, height = cellHeight)
        return
    }
    val cols = columns.coerceAtLeast(1)
    val cursorIndex = cursorSyncPosition(syncId)
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        maxItemsInEachRow = cols,
    ) {
        cells.forEachIndexed { index, cell ->
            SmallMultiplesChartCell(
                cell = cell,
                label = seriesLabel(cell.key),
                color = seriesColor(null, cellColorIndex(index, cell.key, colorIndex)),
                cellHeight = cellHeight,
                keptIndices = keptIndices,
                cursorIndex = cursorIndex,
                noData = noData,
                onClick = onCellClick,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/**
 * A single cell — its color swatch + label header, then either the localized [noData] empty state (web `!hasData`
 * branch) or the series line via the shared [VicoCartesianChart] with a precise synced-cursor overlay. The whole
 * cell carries [label] as its accessibility name; when [onClick] is supplied it becomes a TalkBack-actionable
 * button keyed by the series key (web `role="button"` + `aria-label`).
 */
@Composable
private fun SmallMultiplesChartCell(
    cell: SmallMultiplesCell,
    label: String,
    color: Color,
    cellHeight: Dp,
    keptIndices: List<Int>,
    cursorIndex: Int?,
    noData: String,
    onClick: ((String) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val onActivate: (() -> Unit)? = onClick?.let { handler -> { handler(cell.key) } }
    val cursorPos =
        remember(cursorIndex, keptIndices) {
            cursorIndex?.let { ci -> keptIndices.indexOf(ci).takeIf { it >= 0 } }
        }
    val cursorColor = markerColor(MarkerSeverity.Info)

    val cellModifier =
        modifier
            .semantics(mergeDescendants = true) {
                contentDescription = label
                if (onActivate != null) role = Role.Button
            }.then(
                if (onActivate != null) Modifier.clickable(onClick = onActivate) else Modifier,
            )

    Card(modifier = cellModifier, padding = CardPadding.Sm) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier =
                    Modifier
                        .padding(end = Spacing.xs)
                        .size(SWATCH_SIZE)
                        .clip(CircleShape)
                        .background(color),
            )
            Caption(label)
        }
        Box(modifier = Modifier.fillMaxWidth()) {
            if (!cell.hasData) {
                ChartEmptyState(message = noData, height = cellHeight)
            } else {
                val seriesList =
                    remember(cell, color, label) {
                        listOf(
                            ChartSeries(
                                key = cell.key,
                                label = label,
                                values = cell.values,
                                kind = ChartSeriesKind.Line,
                                color = color,
                            ),
                        )
                    }
                VicoCartesianChart(
                    series = seriesList,
                    xLabels = cell.xLabels,
                    height = cellHeight,
                    showStartAxis = false,
                    showBottomAxis = false,
                    showMarker = false,
                    emptyMessage = noData,
                )
                if (cursorPos != null) {
                    val fraction = fractionForIndex(cursorPos, cell.xLabels.size)
                    Canvas(modifier = Modifier.matchParentSize()) {
                        val x = size.width * fraction
                        drawLine(
                            color = cursorColor,
                            start = Offset(x, 0f),
                            end = Offset(x, size.height),
                            strokeWidth = CURSOR_STROKE.toPx(),
                        )
                    }
                }
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────
// The surface's real states: the populated grid (per-cell own y-scale), the per-cell "No data" empty state (a
// series with no finite value), and the overall empty grid (no series). The previews render the stateless
// [SmallMultiplesGrid] directly since the stateful entry resolves a logger from `LocalDataContainer`.

private fun previewRows(): List<SmallMultiplesRow> =
    (0 until 12).map { i ->
        SmallMultiplesRow(
            x = "10:%02d".format(i),
            values =
                mapOf(
                    "speed" to (20.0 + i * 3),
                    "power" to (4.0 + (i % 4)),
                    "soc" to null,
                ),
        )
    }

@Preview(name = "Grid — populated", showBackground = true)
@Composable
private fun SmallMultiplesGridPopulatedPreview() {
    val keys = listOf("speed", "power", "soc")
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            SmallMultiplesGrid(
                cells = projectCells(previewRows(), keys, ChartDefaults.MAX_POINTS_PER_CELL),
                noData = "No data",
                seriesLabel = { it.replaceFirstChar(Char::uppercase) },
            )
        }
    }
}

@Preview(name = "Cell — no data", showBackground = true)
@Composable
private fun SmallMultiplesGridNoDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            SmallMultiplesGrid(
                cells = projectCells(previewRows(), listOf("soc"), ChartDefaults.MAX_POINTS_PER_CELL),
                noData = "No data",
            )
        }
    }
}

@Preview(name = "Grid — empty (no series)", showBackground = true)
@Composable
private fun SmallMultiplesGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            SmallMultiplesGrid(cells = emptyList(), noData = "No data")
        }
    }
}
