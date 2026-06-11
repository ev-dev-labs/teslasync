// File hosts the LiveSignalSparklines Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.livesignalsparklines

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The native Android (Jetpack Compose / Material 3) Live Signal Sparklines dashboard surface — a parity
 * port of `web/src/features/dashboard/widgets/LiveSignalSparklinesWidget.tsx`. It mirrors the web
 * `WidgetShell` (full skeleton while loading, a retry surface on hard error, otherwise a title + activity
 * glyph + freshness header) wrapping the configurable list of signal rows: a color bar, the spaced signal
 * name, the latest live value, a trailing-hour sparkline (or a "no data" label), and an up/down/flat
 * trend glyph — laid out single-column or, on a wide footprint with more than three rows, in two columns.
 * A friendly empty state shows when no signals are configured/available. All data flows through the
 * [LiveSignalSparklinesWidgetViewModel] (P1/S8); the view performs no HTTP. Every string resolves from
 * `strings.xml` (P1/S10), and the surface emits the P1/S11 `view.opened` event on appear.
 *
 * @param viewModel the state holder bound to the shared vehicles + signals feeds.
 * @param size the grid footprint; controls sparkline width (web `isWide`) and the two-column layout
 *   (web `useTwoColumns`).
 */
@Composable
fun LiveSignalSparklinesWidget(
    viewModel: LiveSignalSparklinesWidgetViewModel,
    modifier: Modifier = Modifier,
    size: LiveSignalSparklinesSize = LiveSignalSparklinesRegistration.DEFAULT_SIZE,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    LiveSignalSparklinesWidgetContent(
        state = state,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Live Signal Sparklines panel — renders every state the web widget does (loading / content /
 * empty / error, plus stale + offline via the header freshness chip over cached rows). Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state. Stale (non-error) data auto-refreshes
 * exactly once, mirroring the web realtime refetch.
 */
@Composable
fun LiveSignalSparklinesWidgetContent(
    state: UiState<LiveSignalSparklinesData>,
    size: LiveSignalSparklinesSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> LiveSignalSparklinesLoading()
            state.isError -> LiveSignalSparklinesErrorState(state = state, onRetry = onRetry)
            else -> LiveSignalSparklinesLoaded(state = state, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun LiveSignalSparklinesLoaded(
    state: UiState<LiveSignalSparklinesData>,
    size: LiveSignalSparklinesSize,
    onRefresh: () -> Unit,
) {
    val rows = state.data?.rows ?: emptyList()
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        LiveSignalSparklinesHeader(
            title = stringResource(R.string.translation_widget_liveSparklines),
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        if (rows.isEmpty()) {
            LiveSignalSparklinesEmpty()
        } else {
            SignalRows(rows = rows, size = size)
        }
    }
}

@Composable
private fun LiveSignalSparklinesHeader(
    title: String,
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Gauge,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        Caption(text = title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = updatedAtMillis,
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !isFetching,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun SignalRows(
    rows: List<LiveSignalSparklineRow>,
    size: LiveSignalSparklinesSize,
) {
    val twoColumns = size.useTwoColumns(rows.size)
    val groups = if (twoColumns) rows.withIndex().chunked(TWO_PER_ROW) else rows.withIndex().map { listOf(it) }
    Column(modifier = Modifier.fillMaxWidth()) {
        groups.forEachIndexed { groupIndex, group ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                group.forEach { (index, row) ->
                    SignalSparklineRow(
                        row = row,
                        color = paletteColor(index),
                        isWide = size.isWide,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (twoColumns && group.size < TWO_PER_ROW) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
            if (groupIndex < groups.lastIndex) RowDivider()
        }
    }
}

@Composable
private fun SignalSparklineRow(
    row: LiveSignalSparklineRow,
    color: Color,
    isWide: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .width(COLOR_BAR_WIDTH)
                    .height(COLOR_BAR_HEIGHT)
                    .clip(CircleShape)
                    .background(color),
        )
        Column(modifier = Modifier.weight(1f)) {
            Caption(text = row.displayName)
            BodyText(text = ChartFormat.number(row.currentValue, VALUE_DECIMALS), maxLines = 1)
        }
        Box(
            modifier = Modifier.width(if (isWide) SPARKLINE_WIDTH_WIDE else SPARKLINE_WIDTH_NARROW),
            contentAlignment = Alignment.Center,
        ) {
            if (row.hasSparkline) {
                Sparkline(
                    data = row.points,
                    color = color,
                    width = if (isWide) SPARKLINE_WIDTH_WIDE else SPARKLINE_WIDTH_NARROW,
                    height = SPARKLINE_HEIGHT,
                )
            } else {
                Caption(text = stringResource(R.string.translation_widget_noHistory))
            }
        }
        Icon(
            imageVector = trendGlyph(row.trend),
            contentDescription = null,
            size = IconSize.Xs,
            tint = trendColor(row.trend),
        )
    }
}

@Composable
private fun RowDivider() {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(DIVIDER_THICKNESS)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = DIVIDER_ALPHA)),
    )
}

@Composable
private fun trendGlyph(trend: SignalTrend): ImageVector =
    when (trend) {
        SignalTrend.Up -> DataDisplayGlyphs.ArrowUp
        SignalTrend.Down -> DataDisplayGlyphs.ArrowDown
        SignalTrend.Flat -> TeslaGlyphs.Minus
    }

@Composable
private fun trendColor(trend: SignalTrend): Color =
    when (trend) {
        SignalTrend.Up -> TeslaTokens.status.success
        SignalTrend.Down -> TeslaTokens.status.danger
        SignalTrend.Flat -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun LiveSignalSparklinesEmpty() {
    Box(
        modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(vertical = Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(
            message = stringResource(R.string.translation_widget_noSignalsAvailable),
            icon = DataDisplayGlyphs.Gauge,
        )
    }
}

@Composable
private fun LiveSignalSparklinesLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.sm)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROW_COUNT) {
            Skeleton(height = LOADING_ROW_HEIGHT, widthFraction = 1f, rounded = true)
        }
    }
}

@Composable
private fun LiveSignalSparklinesErrorState(
    state: UiState<LiveSignalSparklinesData>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = stringResource(R.string.translation_widget_liveSparklines),
            onRetry = onRetry,
        )
    }
}

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind]: an [ErrorKind.Network]/[ErrorKind.Timeout] is
 * treated as offline, [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the
 * not-found / unauthorized / server bucket.
 */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

private val COLOR_BAR_WIDTH = 3.dp
private val COLOR_BAR_HEIGHT = 24.dp
private val SPARKLINE_WIDTH_WIDE = 80.dp
private val SPARKLINE_WIDTH_NARROW = 56.dp
private val SPARKLINE_HEIGHT = 20.dp
private val BODY_MIN_HEIGHT = 96.dp
private val DIVIDER_THICKNESS = 1.dp
private val LOADING_ROW_HEIGHT = 28.dp
private const val DIVIDER_ALPHA = 0.06f
private const val VALUE_DECIMALS = 1
private const val TWO_PER_ROW = 2
private const val LOADING_ROW_COUNT = 4

// ── Previews — one per rendered state (content / wide two-column / empty / loading / error) ──────────

private fun previewRow(
    name: String,
    value: Double?,
    points: List<Double>,
    trend: SignalTrend,
): LiveSignalSparklineRow =
    LiveSignalSparklineRow(
        signal = name,
        displayName = formatSignalName(name),
        currentValue = value,
        points = points,
        hasSparkline = points.size >= 2,
        trend = trend,
    )

private fun previewData(): LiveSignalSparklinesData =
    LiveSignalSparklinesData(
        rows =
            listOf(
                previewRow("BatteryLevel", 72.4, listOf(70.0, 71.0, 71.5, 72.0, 72.4, 72.4), SignalTrend.Up),
                previewRow("VehicleSpeed", 0.0, listOf(30.0, 22.0, 14.0, 6.0, 0.0, 0.0), SignalTrend.Down),
                previewRow("OutsideTemp", 15.2, emptyList(), SignalTrend.Flat),
                previewRow("InsideTemp", 21.0, listOf(21.0, 21.0, 21.0, 21.0), SignalTrend.Flat),
            ),
    )

@Preview(name = "LiveSignalSparklines · content", showBackground = true)
@Composable
private fun LiveSignalSparklinesContentPreview() {
    TeslaSyncTheme {
        LiveSignalSparklinesWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = System.currentTimeMillis()),
            size = LiveSignalSparklinesRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "LiveSignalSparklines · wide two-column", showBackground = true)
@Composable
private fun LiveSignalSparklinesWidePreview() {
    TeslaSyncTheme {
        LiveSignalSparklinesWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = System.currentTimeMillis()),
            size = LiveSignalSparklinesSize(cols = 4, rows = 6),
        )
    }
}

@Preview(name = "LiveSignalSparklines · empty", showBackground = true)
@Composable
private fun LiveSignalSparklinesEmptyPreview() {
    TeslaSyncTheme {
        LiveSignalSparklinesWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = LiveSignalSparklinesData.EMPTY, fetchedAt = 1L),
            size = LiveSignalSparklinesRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "LiveSignalSparklines · loading", showBackground = true)
@Composable
private fun LiveSignalSparklinesLoadingPreview() {
    TeslaSyncTheme {
        LiveSignalSparklinesWidgetContent(
            state = UiState.loading(),
            size = LiveSignalSparklinesRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "LiveSignalSparklines · error", showBackground = true)
@Composable
private fun LiveSignalSparklinesErrorPreview() {
    TeslaSyncTheme {
        LiveSignalSparklinesWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = LiveSignalSparklinesRegistration.DEFAULT_SIZE,
        )
    }
}
