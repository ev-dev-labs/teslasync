package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.StatSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The native API Usage dashboard surface — a parity port of
 * `web/src/features/dashboard/widgets/APIUsageWidget.tsx`. It mirrors the web `WidgetShell`
 * (skeleton while loading, a retry surface on error, otherwise a title + chart glyph + freshness
 * header) wrapping either the compact big-number call volume (1×N), or the stat grid of four metric
 * tiles (calls, average response, error rate, error count) laid out 2-up or — when wide (3×N+) —
 * 4-up; or a friendly empty state when the query has no payload. The error-rate value turns red with
 * a "High" chip above the warning threshold (web `valueColor` / `trendValue`). All data flows through
 * the [ApiUsageViewModel]; the view never performs HTTP. Every string resolves through the i18n
 * facade and every interactive element carries a screen-reader name.
 *
 * @param source the cache-then-network data port (production: [AdminApiUsageSource]).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param size the grid footprint; drives the compact / 2-up / 4-up layout (web `size`).
 */
@Composable
fun APIUsageWidget(
    source: ApiUsageSource,
    logger: Logger,
    modifier: Modifier = Modifier,
    size: ApiUsageSize = ApiUsageRegistration.defaultSize,
    diagnostics: ApiUsageDiagnostics = remember(logger) { ApiUsageDiagnostics(logger) },
) {
    val viewModel: ApiUsageViewModel =
        viewModel(
            key = ApiUsageRegistration.ID,
            factory = viewModelFactory { initializer { ApiUsageViewModel(source, logger) } },
        )
    val state by viewModel.stats.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { diagnostics.recordViewOpened() }
    FadeIn(modifier = modifier) {
        ApiUsageWidgetContent(
            state = state,
            size = size,
            onRetry = viewModel::refresh,
            onRefresh = viewModel::refresh,
        )
    }
}

/**
 * The stateless renderer for every [ApiUsageViewModel] surface state — loading / content / empty /
 * stale / offline / error. Hoisted so it is driven directly (no ViewModel host) by the Compose UI
 * tests across the full state matrix.
 */
@Composable
internal fun ApiUsageWidgetContent(
    state: UiState<ApiUsageStats>,
    size: ApiUsageSize,
    onRetry: () -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberApiUsageStrings()
    val display =
        remember(state.data, size, strings) {
            ApiUsageProjection.project(state.data ?: ApiUsageStats.EMPTY, size, strings)
        }
    GlassPanel(modifier = modifier) {
        ApiUsageHeader(state = state, title = strings.title, showTitle = !size.isCompact, onRefresh = onRefresh)
        when {
            state.isLoading -> ApiUsageLoading(size)
            state.isError -> ApiUsageError(state, strings.title, onRetry)
            !display.hasData ->
                EmptyState(
                    message = strings.noData,
                    icon = ApiUsageGlyphs.BarChart,
                    modifier = Modifier.padding(top = Spacing.sm),
                )
            display.isCompact -> ApiUsageCompact(display)
            else -> ApiUsageStatGrid(display)
        }
    }
}

@Composable
private fun ApiUsageHeader(
    state: UiState<ApiUsageStats>,
    title: String,
    showTitle: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showTitle) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    ApiUsageGlyphs.BarChart,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.primary,
                )
                PanelTitle(title)
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
            IconButton(
                imageVector = ApiUsageGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun ApiUsageLoading(size: ApiUsageSize) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = Spacing.sm)
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (size.isCompact) {
            StatSkeleton()
        } else {
            val rows = (STAT_COUNT + size.gridColumns - 1) / size.gridColumns
            repeat(rows) { StatGridSkeleton(count = size.gridColumns) }
        }
    }
}

@Composable
private fun ApiUsageError(
    state: UiState<ApiUsageStats>,
    resourceName: String,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = queryErrorKindFor(state),
        modifier = Modifier.fillMaxWidth(),
        resourceName = resourceName,
        onRetry = onRetry,
    )
}

@Composable
private fun ApiUsageCompact(display: ApiUsageDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = COMPACT_MIN_HEIGHT)
                .padding(top = Spacing.sm)
                .semantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Text(
            text = display.compactValue,
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
        )
        MetricLabel(display.compactLabel)
        if (display.showCompactError) {
            Text(
                text = display.compactErrorText,
                style = MaterialTheme.typography.labelMedium,
                color = TeslaTokens.status.danger,
            )
        }
    }
}

@Composable
private fun ApiUsageStatGrid(display: ApiUsageDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        display.stats.chunked(display.gridColumns).forEach { rowTiles ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                rowTiles.forEach { tile -> ApiUsageStatTileView(tile, Modifier.weight(1f)) }
                repeat(display.gridColumns - rowTiles.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun ApiUsageStatTileView(
    tile: ApiUsageStatTile,
    modifier: Modifier = Modifier,
) {
    val valueColor = if (tile.isAlert) TeslaTokens.status.danger else MaterialTheme.colorScheme.onSurface
    Card(modifier = modifier.semantics { contentDescription = tile.contentDescription }) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetricLabel(tile.label, modifier = Modifier.weight(1f, fill = false))
            Icon(
                statIcon(tile.icon),
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(
            modifier = Modifier.padding(top = Spacing.xs),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = tile.value,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
                color = valueColor,
            )
            if (tile.unit != null) {
                Caption(tile.unit, modifier = Modifier.padding(bottom = Spacing.xs))
            }
        }
        if (tile.trendLabel != null) {
            Row(
                modifier = Modifier.padding(top = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    TeslaGlyphs.ChevronDown,
                    contentDescription = null,
                    size = IconSize.Xs,
                    tint = TeslaTokens.status.danger,
                )
                Text(
                    text = tile.trendLabel,
                    style = MaterialTheme.typography.labelMedium,
                    color = TeslaTokens.status.danger,
                )
            }
        }
    }
}

/** Resolves the 9 `widget.apiUsage.*` source strings through the i18n facade (P1/S10). */
@Composable
private fun rememberApiUsageStrings(): ApiUsageStrings =
    ApiUsageStrings(
        title = stringResource(R.string.translation_widget_apiUsage_title),
        totalCalls = stringResource(R.string.translation_widget_apiUsage_totalCalls),
        avgResponse = stringResource(R.string.translation_widget_apiUsage_avgResponse),
        errorRate = stringResource(R.string.translation_widget_apiUsage_errorRate),
        totalErrors = stringResource(R.string.translation_widget_apiUsage_totalErrors),
        high = stringResource(R.string.translation_widget_apiUsage_highErrors),
        calls24h = stringResource(R.string.translation_widget_apiUsage_calls24h),
        errors = stringResource(R.string.translation_widget_apiUsage_errors),
        noData = stringResource(R.string.translation_widget_apiUsage_noData),
    )

/** Maps an [ApiUsageStatIcon] role to its rendered vector (web lucide parity). */
private fun statIcon(icon: ApiUsageStatIcon): ImageVector =
    when (icon) {
        ApiUsageStatIcon.TotalCalls -> ApiUsageGlyphs.Bolt
        ApiUsageStatIcon.AvgResponse -> ApiUsageGlyphs.Clock
        ApiUsageStatIcon.ErrorRate -> TeslaGlyphs.Warning
        ApiUsageStatIcon.Errors -> ApiUsageGlyphs.Activity
    }

/** Folds the [UiState] failure classification onto the [QueryError] recovery buckets. */
private fun queryErrorKindFor(state: UiState<ApiUsageStats>): QueryErrorKind {
    val online =
        when (state.errorKind) {
            ErrorKind.Network, ErrorKind.Timeout, ErrorKind.CircuitOpen -> false
            else -> true
        }
    return classifyQueryError(status = state.httpStatus, online = online, transientWaiting = false)
}

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library
 * leans on lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored
 * at render time by the [Icon] tint. The error-rate tile reuses the shared `TeslaGlyphs.Warning`.
 */
private object ApiUsageGlyphs {
    /** Bar chart — header + empty state (web `BarChart2`). */
    val BarChart: ImageVector =
        apiUsageVector("ApiUsageBarChart") {
            moveTo(6f, 21f)
            lineTo(6f, 11f)
            moveTo(12f, 21f)
            lineTo(12f, 4f)
            moveTo(18f, 21f)
            lineTo(18f, 14f)
        }

    /** Lightning bolt — total calls (web `Zap`). */
    val Bolt: ImageVector =
        apiUsageVector("ApiUsageBolt") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(11f, 14f)
            lineTo(10f, 22f)
            lineTo(20f, 9f)
            lineTo(13f, 9f)
            close()
        }

    /** Clock — average response (web `Clock`). */
    val Clock: ImageVector =
        apiUsageVector("ApiUsageClock") {
            moveTo(4f, 12f)
            arcTo(8f, 8f, 0f, true, true, 20f, 12f)
            arcTo(8f, 8f, 0f, true, true, 4f, 12f)
            close()
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** Activity pulse — error count (web `Activity`). */
    val Activity: ImageVector =
        apiUsageVector("ApiUsageActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        apiUsageVector("ApiUsageRefresh") {
            moveTo(20f, 9f)
            curveTo(18.5f, 6f, 15.5f, 4f, 12f, 4f)
            curveTo(8f, 4f, 4.7f, 6.8f, 4f, 11f)
            moveTo(4f, 15f)
            curveTo(5.5f, 18f, 8.5f, 20f, 12f, 20f)
            curveTo(16f, 20f, 19.3f, 17.2f, 20f, 13f)
            moveTo(20f, 5f)
            lineTo(20f, 9f)
            lineTo(16f, 9f)
            moveTo(4f, 19f)
            lineTo(4f, 15f)
            lineTo(8f, 15f)
        }
}

private fun apiUsageVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
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
                pathBuilder = build,
            )
        }.build()

private const val STAT_COUNT = 4
private val COMPACT_MIN_HEIGHT = 44.dp
