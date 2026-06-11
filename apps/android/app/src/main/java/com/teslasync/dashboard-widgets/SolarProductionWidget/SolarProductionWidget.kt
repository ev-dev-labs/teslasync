// The native Jetpack Compose + Material 3 Solar Production dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SolarProductionWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a freshness header) wrapping the web
// `WidgetChartSummary`: a Today / 30-Day Total / Daily Avg stat row over a single gradient area chart of
// the last 30 days of daily solar generation (kWh); the compact (single-column) footprint shows only
// Today + Daily Avg with no chart, exactly like the web compact branch; a linked site with no solar rows
// shows the "No solar data" empty state; and no linked Tesla Energy site shows the title-less "No Tesla
// Energy site linked" surface. All data flows through the shared [SolarProductionWidgetViewModel]; the
// view never performs HTTP. Every string resolves through the i18n catalog and the refresh control
// carries a screen-reader name.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SolarProductionWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.solarproduction

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
import io.teslasync.android.components.charts.AreaChartWrapper
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
private const val KEY_SOLAR = "solar"

/**
 * Stateful entry point. Binds the solar-production feeds via [source] into a
 * [SolarProductionWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8
 * Energy data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (energy-sites + energy-history adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SolarProductionWidget(
    source: SolarProductionSource,
    modifier: Modifier = Modifier,
    size: SolarProductionSize = SolarProductionRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SolarProductionRegistration.ID,
) {
    val viewModel: SolarProductionWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SolarProductionWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    SolarProductionWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header over the stat row + area chart, the "No solar data" empty state, or the title-less "No Tesla
 * Energy site linked" surface. Split out so each state renders in a snapshot/accessibility test without a
 * view-model or network.
 */
@Composable
fun SolarProductionWidgetContent(
    state: UiState<SolarProductionSnapshot>,
    size: SolarProductionSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberSolarProductionStrings()
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> SolarProductionLoading(size)
            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val snapshot = state.data ?: SolarProductionSnapshot.EMPTY
                val display =
                    remember(snapshot, size, strings) {
                        SolarProductionProjection.project(snapshot, size, strings)
                    }
                SolarProductionLoaded(state = state, display = display, onRefresh = onRefresh)
            }
        }
    }
}

@Composable
private fun SolarProductionLoaded(
    state: UiState<SolarProductionSnapshot>,
    display: SolarProductionDisplay,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SolarProductionHeader(state = state, display = display, onRefresh = onRefresh)
        when {
            !display.hasSites ->
                EmptyState(
                    message = display.noSiteMessage,
                    icon = SolarProductionGlyphs.Sun,
                    modifier = Modifier.fillMaxWidth(),
                )

            !display.hasData ->
                EmptyState(
                    message = display.noDataMessage,
                    icon = SolarProductionGlyphs.Sun,
                    modifier = Modifier.fillMaxWidth(),
                )

            else -> SolarProductionBody(display = display)
        }
    }
}

@Composable
private fun SolarProductionHeader(
    state: UiState<SolarProductionSnapshot>,
    display: SolarProductionDisplay,
    onRefresh: () -> Unit,
) {
    // Web shows the shell title (+ sun icon) only in the standard (linked-site, non-compact) branch.
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
                    SolarProductionGlyphs.Sun,
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
private fun SolarProductionBody(display: SolarProductionDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SolarProductionStats(stats = display.stats)
        if (!display.isCompact) {
            SolarProductionChart(display = display)
        }
    }
}

@Composable
private fun SolarProductionStats(stats: List<SolarProductionStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            SolarProductionStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun SolarProductionStatItem(
    stat: SolarProductionStat,
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
private fun SolarProductionChart(display: SolarProductionDisplay) {
    val solarColor = TeslaTokens.chart.energy
    val locale = Locale.getDefault()
    val labels = remember(display.days) { display.days.map { it.label } }
    val series =
        remember(display, solarColor) {
            listOf(
                ChartSeries(
                    key = KEY_SOLAR,
                    label = display.solarLabel,
                    values = display.days.map { it.solarKwh },
                    color = solarColor,
                    unit = SolarProductionProjection.KWH_UNIT,
                ),
            )
        }
    AreaChartWrapper(
        series = series,
        xLabels = labels,
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = "",
    )
}

@Composable
private fun SolarProductionLoading(size: SolarProductionSize) {
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

/** Resolves the source strings through the i18n facade (P1/S10). */
@Composable
private fun rememberSolarProductionStrings(): SolarProductionStrings {
    val title = stringResource(R.string.translation_widget_solarProduction_title)
    val noSite = stringResource(R.string.translation_widget_solarProduction_noSite)
    val noData = stringResource(R.string.translation_widget_solarProduction_noData)
    val today = stringResource(R.string.translation_widget_solarProduction_today)
    val avg = stringResource(R.string.translation_widget_solarProduction_avg)
    val total30d = stringResource(R.string.translation_widget_solarProduction_total30d)
    val solar = stringResource(R.string.translation_widget_solarProduction_solar)
    return remember(title, noSite, noData, today, avg, total30d, solar) {
        SolarProductionStrings(
            title = title,
            noSite = noSite,
            noData = noData,
            today = today,
            avg = avg,
            total30d = total30d,
            solar = solar,
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
 * on lucide-react's `Sun`, which has no bundled Android equivalent). Monochrome, recoloured at render
 * time by the [Icon] tint.
 */
private object SolarProductionGlyphs {
    /** A sun disc with eight rays — header + empty state (web `Sun`). */
    val Sun: ImageVector =
        solarGlyph("SolarProductionSun") {
            moveTo(16f, 12f)
            arcToRelative(4f, 4f, 0f, false, true, -8f, 0f)
            arcToRelative(4f, 4f, 0f, false, true, 8f, 0f)
            moveTo(12f, 2f)
            lineTo(12f, 4f)
            moveTo(12f, 20f)
            lineTo(12f, 22f)
            moveTo(4.93f, 4.93f)
            lineTo(6.34f, 6.34f)
            moveTo(17.66f, 17.66f)
            lineTo(19.07f, 19.07f)
            moveTo(2f, 12f)
            lineTo(4f, 12f)
            moveTo(20f, 12f)
            lineTo(22f, 12f)
            moveTo(6.34f, 17.66f)
            lineTo(4.93f, 19.07f)
            moveTo(19.07f, 4.93f)
            lineTo(17.66f, 6.34f)
        }
}

private fun solarGlyph(
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
