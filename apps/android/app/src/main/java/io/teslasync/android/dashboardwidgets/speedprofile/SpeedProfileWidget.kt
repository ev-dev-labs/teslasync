// File hosts the SpeedProfile Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.speedprofile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) Speed Profile dashboard surface — a parity port of
 * `web/src/features/dashboard/widgets/SpeedProfileWidget.tsx`. It mirrors the web `WidgetShell`
 * (skeleton while loading, a retry surface on error, otherwise an Activity icon + "Speed Profile" title
 * + freshness header) wrapping either the standard Most Common / Peak Freq / Sweet Spot stat row plus the
 * frequency-histogram + efficiency-overlay combo chart, the compact (1-col) Most Common / Sweet Spot
 * summary, or a friendly empty state. All data flows through the [SpeedProfileWidgetViewModel] (P1/S8);
 * the view performs no HTTP. Every string resolves from `strings.xml` (P1/S10) and the refresh control
 * carries a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared driving / vehicles / settings holders.
 * @param size the grid footprint; controls the compact vs standard layout (web `isCompact`/`isWide`).
 */
@Composable
fun SpeedProfileWidget(
    viewModel: SpeedProfileWidgetViewModel,
    modifier: Modifier = Modifier,
    size: SpeedProfileSize = SpeedProfileRegistration.DEFAULT_SIZE,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.prefs.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    SpeedProfileWidget(
        state = state,
        prefs = prefs,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Speed Profile panel — renders every state the web widget does (loading / content / empty /
 * error, plus stale + offline via the header freshness chip over cached figures, and the compact 1×1
 * summary layout). Hoisted out of the ViewModel so it is preview- and screenshot-testable for each state.
 * Stale (non-error) data auto-refreshes (web `refetchOn..` cadence analogue).
 */
@Composable
fun SpeedProfileWidget(
    state: UiState<SpeedProfileSnapshot>,
    prefs: SpeedProfilePrefs,
    size: SpeedProfileSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val snapshot = state.data ?: SpeedProfileSnapshot.EMPTY
    val display = remember(snapshot, size, prefs) { SpeedProfileProjection.project(snapshot, size, prefs) }
    GlassPanel(modifier = modifier.fillMaxSize(), padding = PanelPadding.Md) {
        when (speedProfileSurface(state)) {
            SpeedProfileSurface.Loading -> SpeedProfileLoading(compact = size.isCompact)
            SpeedProfileSurface.Error -> SpeedProfileError(state = state, onRetry = onRetry)
            SpeedProfileSurface.Empty -> {
                if (!size.isCompact) SpeedProfileHeader(state = state, onRefresh = onRefresh)
                SpeedProfileEmpty()
            }
            SpeedProfileSurface.Content ->
                if (size.isCompact) {
                    SpeedProfileCompact(display = display, state = state)
                } else {
                    SpeedProfileHeader(state = state, onRefresh = onRefresh)
                    SpeedProfileBody(display = display)
                }
        }
    }
}

@Composable
private fun SpeedProfileHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = SpeedProfileActivityGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.speed,
        )
        PanelTitle(
            stringResource(R.string.translation_widget_speedProfile_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun SpeedProfileBody(display: SpeedProfileDisplay) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        SpeedProfileStatRow(stats = rememberSpeedProfileStats(display))
        SpeedProfileChart(display = display)
    }
}

@Composable
private fun SpeedProfileCompact(
    display: SpeedProfileDisplay,
    state: UiState<*>,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
        }
        SpeedProfileStatRow(stats = rememberSpeedProfileStats(display))
    }
}

@Composable
private fun rememberSpeedProfileStats(display: SpeedProfileDisplay): List<SpeedProfileStat> {
    val labels =
        SpeedProfileStatLabels(
            mostCommon = stringResource(R.string.translation_widget_speedProfile_mostCommon),
            peakFreq = stringResource(R.string.translation_widget_speedProfile_peakFreq),
            sweetSpot = stringResource(R.string.translation_widget_speedProfile_sweetSpot),
        )
    return remember(display, labels) { SpeedProfileProjection.stats(display, labels, Locale.getDefault()) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SpeedProfileStatRow(stats: List<SpeedProfileStat>) {
    // FlowRow reproduces the web stat row's responsive behaviour: all chips on one line on a wide widget
    // (web `@sm:flex`), wrapping onto further lines when the widget is narrow (web `grid-cols-2`).
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.forEach { stat -> SpeedProfileStatCell(stat = stat) }
    }
}

@Composable
private fun SpeedProfileStatCell(stat: SpeedProfileStat) {
    val description = stat.unit?.let { "${stat.label}: ${stat.value} $it" } ?: "${stat.label}: ${stat.value}"
    Column(modifier = Modifier.clearAndSetSemantics { contentDescription = description }) {
        MetricLabel(text = stat.label)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricValue(text = stat.value)
            if (stat.unit != null) MetricLabel(text = stat.unit)
        }
    }
}

@Composable
private fun SpeedProfileChart(display: SpeedProfileDisplay) {
    val frequencyLabel = stringResource(R.string.translation_widget_speedProfile_frequency)
    val efficiencyLabel = stringResource(R.string.translation_widget_speedProfile_efficiency)
    // Web bar (#6366f1) + line (#f59e0b) map to the theme chart palette so light/dark stay correct.
    val frequencyColor = TeslaTokens.chart.speed
    val efficiencyColor = TeslaTokens.chart.energy
    val series =
        remember(display, frequencyLabel, efficiencyLabel, frequencyColor, efficiencyColor) {
            listOf(
                ChartSeries(
                    key = FREQUENCY_SERIES_KEY,
                    label = frequencyLabel,
                    values = display.frequencyValues,
                    kind = ChartSeriesKind.Bar,
                    color = frequencyColor,
                    unit = SPEED_PROFILE_PERCENT,
                ),
                ChartSeries(
                    key = EFFICIENCY_SERIES_KEY,
                    label = efficiencyLabel,
                    values = display.efficiencyValues,
                    kind = ChartSeriesKind.Line,
                    color = efficiencyColor,
                ),
            )
        }
    // Vico's combo chart shares one start axis across the column + line layers (charts SURVEY / the
    // single-axis ColumnCartesianLayer + LineCartesianLayer composition), so the web's dual freq-%/
    // efficiency axes collapse to a single percent-labelled axis here. This is faithful in practice: the
    // backend emits avg_power_w (not the web's avg_power_kw key), so the efficiency overlay is flat at 0
    // and the visible scale is the frequency histogram — the precise Sweet Spot / Peak Freq values are
    // carried by the stat row above regardless.
    val chartDescription = "$frequencyLabel, $efficiencyLabel"
    Box(modifier = Modifier.semantics { contentDescription = chartDescription }) {
        ComboChart(
            series = series,
            xLabels = display.bucketLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { "${ChartFormat.number(it, 0)}$SPEED_PROFILE_PERCENT" },
            emptyMessage = stringResource(R.string.translation_widget_speedProfile_noData),
        )
    }
}

@Composable
private fun SpeedProfileLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            StatGridSkeleton(count = 2)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            StatGridSkeleton(count = 3)
            Skeleton(height = CHART_HEIGHT, rounded = true)
        }
    }
}

@Composable
private fun SpeedProfileError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = speedProfileErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_speedProfile_title),
        onRetry = onRetry,
    )
}

@Composable
private fun SpeedProfileEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_speedProfile_noData),
        icon = SpeedProfileActivityGlyph,
    )
}

// ── Local glyph — the web lucide `Activity` pulse line, authored as a 24×24 stroked vector (the
// data-display layer has no activity glyph; mirrors the hand-authored approach in ChargeCostTrackerWidget). ──

private fun speedProfileStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val SpeedProfileActivityGlyph: ImageVector =
    speedProfileStroked("SpeedProfileActivity") {
        moveTo(22f, 12f)
        lineTo(18f, 12f)
        lineTo(15f, 21f)
        lineTo(9f, 3f)
        lineTo(6f, 12f)
        lineTo(2f, 12f)
    }

private const val FREQUENCY_SERIES_KEY = "frequency"
private const val EFFICIENCY_SERIES_KEY = "efficiency"
private const val LOADING_TITLE_FRACTION = 0.5f
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private val LOADING_TITLE_HEIGHT = 12.dp
private val CHART_HEIGHT = 140.dp

// ── Previews — one per rendered state (content / empty / loading / error / compact). ──────────────

private val previewSnapshot =
    SpeedProfileSnapshot(
        distribution =
            listOf(
                SpeedProfileBucket("0-15", 40, 0.0),
                SpeedProfileBucket("15-30", 120, 0.0),
                SpeedProfileBucket("30-45", 200, 0.0),
                SpeedProfileBucket("45-60", 150, 0.0),
                SpeedProfileBucket("60-75", 60, 0.0),
            ),
        optimalSpeedMps = 13.4,
    )

@Preview(name = "SpeedProfile · content", showBackground = true)
@Composable
private fun SpeedProfileContentPreview() {
    TeslaSyncTheme {
        SpeedProfileWidget(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot, fetchedAt = 1L),
            prefs = SpeedProfilePrefs.DEFAULT,
            size = SpeedProfileRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SpeedProfile · empty", showBackground = true)
@Composable
private fun SpeedProfileEmptyPreview() {
    TeslaSyncTheme {
        SpeedProfileWidget(
            state = UiState(phase = UiPhase.Empty, data = SpeedProfileSnapshot.EMPTY, fetchedAt = 1L),
            prefs = SpeedProfilePrefs.DEFAULT,
            size = SpeedProfileRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SpeedProfile · loading", showBackground = true)
@Composable
private fun SpeedProfileLoadingPreview() {
    TeslaSyncTheme {
        SpeedProfileWidget(
            state = UiState.loading(),
            prefs = SpeedProfilePrefs.DEFAULT,
            size = SpeedProfileRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SpeedProfile · error", showBackground = true)
@Composable
private fun SpeedProfileErrorPreview() {
    TeslaSyncTheme {
        SpeedProfileWidget(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = SpeedProfilePrefs.DEFAULT,
            size = SpeedProfileRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SpeedProfile · compact", showBackground = true)
@Composable
private fun SpeedProfileCompactPreview() {
    TeslaSyncTheme {
        SpeedProfileWidget(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot, fetchedAt = 1L),
            prefs = SpeedProfilePrefs.DEFAULT,
            size = SpeedProfileSize(cols = 1, rows = 4),
        )
    }
}
