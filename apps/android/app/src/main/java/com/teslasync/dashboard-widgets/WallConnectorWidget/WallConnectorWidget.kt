// The native Jetpack Compose + Material 3 Wall Connector dashboard surface — a parity port of
// web/src/features/dashboard/widgets/WallConnectorWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a freshness header) wrapping the web
// `WidgetChartSummary`: a This Month / Sessions / Avg-per-Session stat row over a single bar chart of the
// last 14 days of daily home-charging energy (kWh); the compact (single-column) footprint shows only
// This Month + Sessions with no chart, exactly like the web compact branch; a linked site with no
// charging sessions shows the "No Wall Connector data" empty state; and no linked Tesla Energy site shows
// the title-less "No Tesla Energy site linked" surface. All data flows through the shared
// [WallConnectorWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n
// catalog and the refresh control carries a screen-reader name.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WallConnectorWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.wallconnector

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val STANDARD_STAT_COUNT = 3
private const val COMPACT_STAT_COUNT = 2
private const val Y_AXIS_DECIMALS = 0
private const val KEY_ENERGY = "energy"

/**
 * Stateful entry point. Binds the Wall Connector feeds via [source] into a [WallConnectorWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (an adapter over the shared S7/S8 Energy data layer) and a unique [instanceKey]
 * per placement.
 *
 * @param source the cache-then-network seam (energy-sites + charging-history adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WallConnectorWidget(
    source: WallConnectorSource,
    modifier: Modifier = Modifier,
    size: WallConnectorSize = WallConnectorRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = WallConnectorRegistration.ID,
) {
    val viewModel: WallConnectorWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { WallConnectorWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    WallConnectorWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header over the stat row + bar chart, the "No Wall Connector data" empty state, or the title-less "No
 * Tesla Energy site linked" surface. Split out so each state renders in a snapshot/accessibility test
 * without a view-model or network.
 */
@Composable
fun WallConnectorWidgetContent(
    state: UiState<WallConnectorSnapshot>,
    size: WallConnectorSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberWallConnectorStrings()
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> WallConnectorLoading(size)
            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val snapshot = state.data ?: WallConnectorSnapshot.EMPTY
                val display =
                    remember(snapshot, size, strings) {
                        WallConnectorProjection.project(snapshot, size, strings)
                    }
                WallConnectorLoaded(state = state, display = display, onRefresh = onRefresh)
            }
        }
    }
}

@Composable
private fun WallConnectorLoaded(
    state: UiState<WallConnectorSnapshot>,
    display: WallConnectorDisplay,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        WallConnectorHeader(state = state, display = display, onRefresh = onRefresh)
        when {
            !display.hasSites ->
                EmptyState(
                    message = display.noSiteMessage,
                    icon = WallConnectorGlyphs.Plug,
                    modifier = Modifier.fillMaxWidth(),
                )

            !display.hasData ->
                EmptyState(
                    message = display.noDataMessage,
                    icon = WallConnectorGlyphs.Plug,
                    modifier = Modifier.fillMaxWidth(),
                )

            else -> WallConnectorBody(display = display)
        }
    }
}

@Composable
private fun WallConnectorHeader(
    state: UiState<WallConnectorSnapshot>,
    display: WallConnectorDisplay,
    onRefresh: () -> Unit,
) {
    // Web shows the shell title (+ plug icon) only in the standard (linked-site, non-compact) branch.
    val showTitle = display.hasSites && !display.isCompact
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showTitle) {
            Row(
                modifier = Modifier.semantics { heading() },
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    WallConnectorGlyphs.Plug,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.chart.energy,
                )
                PanelTitle(display.title)
            }
        } else {
            Spacer(modifier = Modifier.fillMaxWidth().weight(1f))
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
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
}

@Composable
private fun WallConnectorBody(display: WallConnectorDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        WallConnectorStats(stats = display.stats)
        if (!display.isCompact) {
            WallConnectorChart(display = display)
        }
    }
}

@Composable
private fun WallConnectorStats(stats: List<WallConnectorStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            WallConnectorStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun WallConnectorStatItem(
    stat: WallConnectorStat,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = stat.value,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (stat.unit != null) {
                Caption(stat.unit, modifier = Modifier.padding(bottom = STAT_UNIT_BOTTOM_PADDING))
            }
        }
        MetricLabel(stat.label)
    }
}

@Composable
private fun WallConnectorChart(display: WallConnectorDisplay) {
    val energyColor = TeslaTokens.chart.energy
    val locale = Locale.getDefault()
    val labels = remember(display.days) { display.days.map { it.label } }
    val series =
        remember(display, energyColor) {
            listOf(
                ChartSeries(
                    key = KEY_ENERGY,
                    label = display.energyLabel,
                    values = display.days.map { it.energyKwh },
                    color = energyColor,
                    unit = WallConnectorProjection.KWH_UNIT,
                ),
            )
        }
    BarChartWrapper(
        series = series,
        xLabels = labels,
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = "",
    )
}

@Composable
private fun WallConnectorLoading(size: WallConnectorSize) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatGridSkeleton(count = if (size.isCompact) COMPACT_STAT_COUNT else STANDARD_STAT_COUNT)
        if (!size.isCompact) {
            Skeleton(height = CHART_HEIGHT, rounded = true)
        }
    }
}

/** Resolves the seven source strings through the i18n facade (P1/S10) — the web `t('widget.wallConnector.…')` keys. */
@Composable
private fun rememberWallConnectorStrings(): WallConnectorStrings {
    val title = stringResource(R.string.translation_widget_wallConnector_title)
    val noSite = stringResource(R.string.translation_widget_wallConnector_noSite)
    val noData = stringResource(R.string.translation_widget_wallConnector_noData)
    val monthTotal = stringResource(R.string.translation_widget_wallConnector_monthTotal)
    val sessions = stringResource(R.string.translation_widget_wallConnector_sessions)
    val avgPerSession = stringResource(R.string.translation_widget_wallConnector_avgPerSession)
    val energy = stringResource(R.string.translation_widget_wallConnector_energy)
    return remember(title, noSite, noData, monthTotal, sessions, avgPerSession, energy) {
        WallConnectorStrings(
            title = title,
            noSite = noSite,
            noData = noData,
            monthTotal = monthTotal,
            sessions = sessions,
            avgPerSession = avgPerSession,
            energy = energy,
        )
    }
}

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
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans
 * on lucide-react's `Plug`, which has no bundled Android equivalent). Monochrome, recoloured at render
 * time by the [Icon] tint.
 */
private object WallConnectorGlyphs {
    /** A wall-connector plug with two prongs — header + empty state (web `Plug`). */
    val Plug: ImageVector =
        plugGlyph("WallConnectorPlug") {
            moveTo(12f, 22f)
            lineTo(12f, 17f)
            moveTo(9f, 8f)
            lineTo(9f, 2f)
            moveTo(15f, 8f)
            lineTo(15f, 2f)
            moveTo(18f, 8f)
            lineTo(18f, 13f)
            arcToRelative(4f, 4f, 0f, false, true, -4f, 4f)
            lineToRelative(-4f, 0f)
            arcToRelative(4f, 4f, 0f, false, true, -4f, -4f)
            lineTo(6f, 8f)
            close()
        }
}

private fun plugGlyph(
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
