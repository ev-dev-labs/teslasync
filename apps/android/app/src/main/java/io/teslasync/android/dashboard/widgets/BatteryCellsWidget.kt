package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

private const val SURFACE_TINT_ALPHA = 0.10f
private const val BORDER_TINT_ALPHA = 0.25f
private val STATUS_DOT_SIZE = 8.dp
private val TILE_MIN_HEIGHT = 44.dp
private val HEATMAP_SKELETON_HEIGHT = 96.dp
private const val VOLTAGE_STAT_COLUMNS = 2
private const val TEMPERATURE_STAT_COLUMNS = 3

/**
 * The native Battery Cells dashboard surface — a Jetpack Compose / Material 3 parity port of
 * web/src/features/dashboard/widgets/BatteryCellsWidget.tsx. It mirrors the web `WidgetShell` (a
 * skeleton while loading, a `QueryError` on hard failure, otherwise a freshness header) wrapping the
 * cell-voltage heatmap (the shared `WidgetStatusGrid`, which shows its own "No cell data" message
 * when there are no bricks) over the four min/max/avg/spread voltage stat cards and — when wide
 * (≥3 columns) — a row of per-module temperature stat cards; or a friendly "No battery cell data"
 * empty state when no vehicle/response resolved. All data flows through the shared
 * [BatteryCellsWidgetViewModel] (P1/S8); the view never performs HTTP. Every string resolves through
 * the i18n catalog and every heatmap tile carries a TalkBack content description.
 */
@Composable
fun BatteryCellsWidget(
    viewModel: BatteryCellsWidgetViewModel,
    modifier: Modifier = Modifier,
    size: BatteryCellsSize = BatteryCellsRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    BatteryCellsWidgetContent(
        state = state,
        size = size,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for the Battery Cells surface — every state from the web source is reproduced
 * and none is ever hidden. Split out from [BatteryCellsWidget] so each state can be rendered in a
 * snapshot/accessibility test without a view-model or network.
 */
@Composable
fun BatteryCellsWidgetContent(
    state: UiState<BatteryCellSummary?>,
    size: BatteryCellsSize,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val labels = rememberBatteryCellsLabels()
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> BatteryCellsLoading()
            state.isError -> QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
            state.data == null -> {
                BatteryCellsHeader(state = state, compact = size.isCompact)
                EmptyState(
                    message = stringResource(R.string.translation_widget_batteryCells_noData),
                    icon = CpuIcon,
                )
            }

            else -> {
                BatteryCellsHeader(state = state, compact = size.isCompact)
                BatteryCellsBody(
                    display = BatteryCellsProjection.project(state.data, size, labels),
                )
            }
        }
    }
}

@Composable
private fun BatteryCellsHeader(
    state: UiState<BatteryCellSummary?>,
    compact: Boolean,
    modifier: Modifier = Modifier,
) {
    if (compact) return
    Row(
        modifier = modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = CpuIcon,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            MetricLabel(stringResource(R.string.translation_widget_batteryCells_title))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
        )
    }
}

@Composable
private fun BatteryCellsBody(
    display: BatteryCellsDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (display.hasCells) {
            BatteryCellsHeatmap(display)
        } else {
            EmptyState(
                message = stringResource(R.string.translation_widget_batteryCells_noCells),
                icon = CpuIcon,
            )
        }
        BatteryCellsStatGrid(stats = display.voltageStats, columns = VOLTAGE_STAT_COLUMNS)
        if (display.showTemperature && display.temperatureStats.isNotEmpty()) {
            BatteryCellsStatGrid(stats = display.temperatureStats, columns = TEMPERATURE_STAT_COLUMNS)
        }
    }
}

@Composable
private fun BatteryCellsHeatmap(
    display: BatteryCellsDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        display.cells.chunked(display.gridColumns).forEach { rowCells ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowCells.forEach { tile ->
                    BatteryCellTileView(tile = tile, compact = display.isCompact, modifier = Modifier.weight(1f))
                }
                repeat(display.gridColumns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun BatteryCellTileView(
    tile: BatteryCellTile,
    compact: Boolean,
    modifier: Modifier = Modifier,
) {
    val color = severityColor(tile.severity)
    val shape = RoundedCornerShape(Radius.sm)
    Box(
        modifier =
            modifier
                .heightIn(min = TILE_MIN_HEIGHT)
                .clip(shape)
                .background(color.copy(alpha = SURFACE_TINT_ALPHA))
                .border(1.dp, color.copy(alpha = BORDER_TINT_ALPHA), shape)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .clearAndSetSemantics { contentDescription = tile.contentDescription },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(tile.label)
            if (!compact) BodyText(tile.value)
        }
        Box(
            modifier =
                Modifier
                    .align(Alignment.TopEnd)
                    .size(STATUS_DOT_SIZE)
                    .clip(CircleShape)
                    .background(color),
        )
    }
}

@Composable
private fun BatteryCellsStatGrid(
    stats: List<BatteryCellsStat>,
    columns: Int,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.chunked(columns).forEach { rowStats ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowStats.forEach { stat ->
                    StatCard(label = stat.label, value = stat.value, modifier = Modifier.weight(1f))
                }
                repeat(columns - rowStats.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun BatteryCellsLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_widget_batteryCells_title)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = HEATMAP_SKELETON_HEIGHT, rounded = true)
        StatGridSkeleton(count = VOLTAGE_STAT_COLUMNS * VOLTAGE_STAT_COLUMNS)
    }
}

@Composable
private fun severityColor(severity: BatteryCellSeverity): Color =
    when (severity) {
        BatteryCellSeverity.Ok -> TeslaTokens.status.success
        BatteryCellSeverity.Warning -> TeslaTokens.status.warning
        BatteryCellSeverity.Error -> TeslaTokens.status.danger
        BatteryCellSeverity.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun rememberBatteryCellsLabels(): BatteryCellsLabels =
    BatteryCellsLabels(
        cell = stringResource(R.string.translation_widget_batteryCells_cell),
        minV = stringResource(R.string.translation_widget_batteryCells_minV),
        maxV = stringResource(R.string.translation_widget_batteryCells_maxV),
        avgV = stringResource(R.string.translation_widget_batteryCells_avgV),
        spread = stringResource(R.string.translation_widget_batteryCells_spread),
        minTemp = stringResource(R.string.translation_widget_batteryCells_minTemp),
        avgTemp = stringResource(R.string.translation_widget_batteryCells_avgTemp),
        maxTemp = stringResource(R.string.translation_widget_batteryCells_maxTemp),
    )

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Self-contained "Cpu" chip glyph (the web widget's `lucide-react` `Cpu` icon) — a body square with
 * an inner die and eight edge pins, drawn as a 24×24 stroked [ImageVector] and recolored at render
 * time by [Icon]'s `tint`. Authored locally because the app's icon set has no equivalent and the
 * shared `TeslaGlyphs` set is out of this surface's allowed files.
 */
private val CpuIcon: ImageVector =
    ImageVector
        .Builder(
            name = "Cpu",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                // Chip body + inner die.
                moveTo(6f, 6f)
                lineTo(18f, 6f)
                lineTo(18f, 18f)
                lineTo(6f, 18f)
                close()
                moveTo(9f, 9f)
                lineTo(15f, 9f)
                lineTo(15f, 15f)
                lineTo(9f, 15f)
                close()
                // Top pins.
                moveTo(9f, 3f)
                lineTo(9f, 6f)
                moveTo(15f, 3f)
                lineTo(15f, 6f)
                // Bottom pins.
                moveTo(9f, 18f)
                lineTo(9f, 21f)
                moveTo(15f, 18f)
                lineTo(15f, 21f)
                // Left pins.
                moveTo(3f, 9f)
                lineTo(6f, 9f)
                moveTo(3f, 15f)
                lineTo(6f, 15f)
                // Right pins.
                moveTo(18f, 9f)
                lineTo(21f, 9f)
                moveTo(18f, 15f)
                lineTo(21f, 15f)
            }
        }.build()
