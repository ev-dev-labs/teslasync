// File hosts the ChargeHistory Compose surface (stateful + stateless + per-state previews); named after
// the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.units.EnergyUnitPref
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) Charge History dashboard surface — a parity port of
 * `web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx`. It mirrors the web `WidgetShell`
 * (skeleton while loading, a retry surface on error, otherwise a title + chart glyph + freshness header)
 * wrapping `WidgetChartSummary` (a `Total`/`Avg` kWh stat pair plus — in the non-compact footprint — a
 * recent-sessions energy area chart, or a friendly empty state). All data flows through the
 * [ChargeHistoryWidgetViewModel] (P1/S8); the view performs no HTTP. Every string resolves from
 * `strings.xml` (P1/S10) and the refresh control carries a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared vehicles + charging feeds.
 * @param size the grid footprint; `cols <= 1` selects the compact (stats-only) layout (web `isCompact`).
 */
@Composable
fun ChargeHistoryWidget(
    viewModel: ChargeHistoryWidgetViewModel,
    modifier: Modifier = Modifier,
    size: ChargeHistorySize = ChargeHistoryWidgetDescriptor.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onAppear() }
    ChargeHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless Charge History panel — renders every state the web widget does (loading / content / empty /
 * error, plus stale + offline via the header freshness chip over the cached chart). Stale (non-error)
 * data auto-refreshes (web TanStack stale refetch). Hoisted out of the ViewModel so it is preview- and
 * screenshot-testable for each state with hand-built [UiState] inputs.
 */
@Composable
fun ChargeHistoryWidgetContent(
    state: UiState<ChargeHistorySnapshot>,
    size: ChargeHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    GlassPanel(modifier = modifier.fillMaxSize(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> ChargeHistoryLoading(compact = size.isCompact)
            state.isError -> ChargeHistoryError(state = state, onRetry = onRefresh)
            else -> ChargeHistoryLoaded(state = state, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun ChargeHistoryLoaded(
    state: UiState<ChargeHistorySnapshot>,
    size: ChargeHistorySize,
    onRefresh: () -> Unit,
) {
    val snapshot = state.data ?: ChargeHistorySnapshot.EMPTY
    val totalLabel = stringResource(R.string.translation_widget_chargeHistory_total)
    val avgLabel = stringResource(R.string.translation_widget_chargeHistory_avg)
    val title = stringResource(R.string.translation_widget_chargeHistory_title)
    val unit = EnergyUnitPref.KWH.label
    val display =
        remember(snapshot, size, totalLabel, avgLabel, unit) {
            ChargeHistoryProjection.project(snapshot, size, totalLabel, avgLabel, unit)
        }
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ChargeHistoryHeader(
            title = if (size.isCompact) null else title,
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        if (!display.hasData) {
            ChargeHistoryEmpty()
        } else {
            ChargeHistorySummary(display = display, unit = unit)
        }
    }
}

@Composable
private fun ChargeHistoryHeader(
    title: String?,
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (title != null) {
            Icon(
                imageVector = NavGlyphs.Chart,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.chart.battery,
            )
            Caption(
                text = title.uppercase(Locale.getDefault()),
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = updatedAtMillis,
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = title == null,
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

/**
 * The `WidgetChartSummary` body: the `Total`/`Avg` stat pair, plus — only in the non-compact footprint
 * (web `!compact && chart`) — the recent-sessions energy area chart beneath it.
 */
@Composable
private fun ChargeHistorySummary(
    display: ChargeHistoryDisplay,
    unit: String,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            display.stats.forEach { stat ->
                StatCard(
                    label = stat.label,
                    value = stat.value,
                    unit = stat.unit,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (!display.isCompact) {
            ChargeHistoryChart(display = display, unit = unit)
        }
    }
}

@Composable
private fun ChargeHistoryChart(
    display: ChargeHistoryDisplay,
    unit: String,
) {
    val color = TeslaTokens.chart.battery
    AreaChartWrapper(
        series =
            listOf(
                ChartSeries(
                    key = "energy",
                    label = unit,
                    values = display.chartValues,
                    color = color,
                    unit = unit,
                ),
            ),
        xLabels = display.xLabels,
        modifier = Modifier.fillMaxWidth(),
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.withUnit(it, unit, ENERGY_AXIS_DECIMALS) },
        emptyMessage = stringResource(R.string.translation_widget_noChargeHistory),
    )
}

@Composable
private fun ChargeHistoryEmpty() {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(
            message = stringResource(R.string.translation_widget_noChargeHistory),
            icon = NavGlyphs.Chart,
        )
    }
}

@Composable
private fun ChargeHistoryLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!compact) Skeleton(widthFraction = SKELETON_TITLE_WIDTH, height = SKELETON_TITLE_HEIGHT)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Skeleton(modifier = Modifier.weight(1f), height = SKELETON_STAT_HEIGHT, rounded = true)
            Skeleton(modifier = Modifier.weight(1f), height = SKELETON_STAT_HEIGHT, rounded = true)
        }
        if (!compact) Skeleton(height = CHART_HEIGHT, rounded = true)
    }
}

@Composable
private fun ChargeHistoryError(
    state: UiState<ChargeHistorySnapshot>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = chargeHistoryErrorKind(state.errorKind, state.httpStatus),
            resourceName = stringResource(R.string.translation_widget_chargeHistory_title),
            onRetry = onRetry,
        )
    }
}

/** Maps the Android [ErrorKind] + HTTP status onto the feedback layer's recovery-oriented bucket. */
internal fun chargeHistoryErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

private val CHART_HEIGHT = 200.dp
private val BODY_MIN_HEIGHT = 140.dp
private val SKELETON_TITLE_HEIGHT = 12.dp
private val SKELETON_STAT_HEIGHT = 48.dp
private const val SKELETON_TITLE_WIDTH = 0.5f
private const val ENERGY_AXIS_DECIMALS = 1

// ── Previews — one per rendered state (loading / content / compact / empty / error) ───────────

private fun sampleSnapshot(): ChargeHistorySnapshot = ChargeHistorySnapshot(listOf(12_000.0, 8_500.0, 15_200.0, 9_300.0, 11_100.0))

@Preview(name = "ChargeHistory · content", showBackground = true)
@Composable
private fun ChargeHistoryContentPreview() {
    TeslaSyncTheme {
        ChargeHistoryWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = ChargeHistoryWidgetDescriptor.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "ChargeHistory · compact", showBackground = true)
@Composable
private fun ChargeHistoryCompactPreview() {
    TeslaSyncTheme {
        ChargeHistoryWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = ChargeHistorySize(cols = 1, rows = 2),
            onRefresh = {},
        )
    }
}

@Preview(name = "ChargeHistory · empty", showBackground = true)
@Composable
private fun ChargeHistoryEmptyPreview() {
    TeslaSyncTheme {
        ChargeHistoryWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = ChargeHistorySnapshot.EMPTY, fetchedAt = System.currentTimeMillis()),
            size = ChargeHistoryWidgetDescriptor.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "ChargeHistory · loading", showBackground = true)
@Composable
private fun ChargeHistoryLoadingPreview() {
    TeslaSyncTheme {
        ChargeHistoryWidgetContent(
            state = UiState.loading(),
            size = ChargeHistoryWidgetDescriptor.defaultSize,
            onRefresh = {},
        )
    }
}

@Preview(name = "ChargeHistory · error", showBackground = true)
@Composable
private fun ChargeHistoryErrorPreview() {
    TeslaSyncTheme {
        ChargeHistoryWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = ChargeHistoryWidgetDescriptor.defaultSize,
            onRefresh = {},
        )
    }
}
