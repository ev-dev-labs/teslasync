// The native Jetpack Compose + Material 3 Monthly Mileage dashboard surface — a parity port of
// web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx. It mirrors the web `WidgetShell` (a
// skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a freshness header
// with the title + `BarChart3` icon + refresh) wrapping the web `WidgetChartSummary`: a This-Month /
// 12-Mo-Total stat row over a bar chart of the last twelve months' driving distance — the current month
// highlighted cyan, every other month faint — or a friendly "No mileage data" empty state. The compact
// (1-col) footprint shows only the stat row, exactly like the web compact branch. All data flows
// through the shared [MonthlyMileageWidgetViewModel]; the SI/kilometre distances are unit-converted at
// this render boundary via the live [MonthlyMileageDisplayPrefs]. The view never performs HTTP. Every
// string resolves through the i18n catalog (P1/S10) and every interactive element carries a TalkBack
// label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MonthlyMileageWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.monthlymileage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
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
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private val CHART_HEIGHT = 160.dp
private val STAT_UNIT_BOTTOM_PADDING = 2.dp
private const val STAT_COUNT = 2
private const val Y_AXIS_DECIMALS = 0
private const val KEY_CURRENT = "current"
private const val KEY_HISTORY = "history"

// Title icon accent — the web `text-neon-cyan` the WidgetShell `BarChart3` icon receives. A specific
// brand accent (the direct analogue of the web utility class), not themed body styling.
private val TITLE_ICON_COLOR = Color(0xFF22D3EE)

// The current-month bar fill — the exact web `#22d3ee` (cyan) highlight Cell.
private val CURRENT_BAR_COLOR = Color(0xFF22D3EE)

// Every other month's bar fill — the exact web `rgba(255,255,255,0.1)` faint Cell (white @ ~10%).
private val HISTORY_BAR_COLOR = Color(0x1AFFFFFF)

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [MonthlyMileageWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A
 * dashboard host supplies [source] (an adapter over the shared S7/S8 data layer), an optional
 * [vehicleId] (web `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + analytics + settings adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MonthlyMileageWidget(
    source: MonthlyMileageSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: MonthlyMileageSize = MonthlyMileageRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = MonthlyMileageRegistration.ID,
) {
    val viewModel: MonthlyMileageWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { MonthlyMileageWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    MonthlyMileageWidgetContent(
        state = state,
        prefs = prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness
 * header above the stat row + bar chart / empty surface. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [prefs] supplies the km→display distance conversion; [locale]
 * drives number grouping and [currentMonth] flags the highlighted bar (tests pin both).
 */
@Composable
fun MonthlyMileageWidgetContent(
    state: UiState<JsonElement>,
    prefs: MonthlyMileageDisplayPrefs,
    size: MonthlyMileageSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    currentMonth: String = currentMonthKey(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberMonthlyMileageStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> MonthlyMileageLoading(size)
            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val display =
                    remember(state.data, prefs, strings, currentMonth, locale) {
                        MonthlyMileageProjection.project(parseMonthlyMileage(state.data), prefs, strings, currentMonth, locale)
                    }
                MonthlyMileageReady(
                    state = state,
                    display = display,
                    strings = strings,
                    size = size,
                    locale = locale,
                    onRefresh = onRefresh,
                )
            }
        }
    }
}

@Composable
private fun MonthlyMileageReady(
    state: UiState<JsonElement>,
    display: MonthlyMileageDisplay,
    strings: MonthlyMileageStrings,
    size: MonthlyMileageSize,
    locale: Locale,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MonthlyMileageHeader(title = strings.title, state = state, showTitle = !size.isCompact, onRefresh = onRefresh)
        if (display.hasData) {
            MonthlyMileageStats(stats = display.stats)
            if (!size.isCompact) {
                MonthlyMileageChart(bars = display.bars, strings = strings, distanceUnit = display.distanceUnit, locale = locale)
            }
        } else {
            EmptyState(
                message = display.emptyMessage,
                icon = MonthlyMileageGlyphs.BarChart3,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun MonthlyMileageHeader(
    title: String,
    state: UiState<*>,
    showTitle: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
    ) {
        if (showTitle) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    imageVector = MonthlyMileageGlyphs.BarChart3,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TITLE_ICON_COLOR,
                )
                PanelTitle(title)
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
            IconButton(
                imageVector = MonthlyMileageGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun MonthlyMileageStats(stats: List<MileageStat>) {
    if (stats.isEmpty()) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        stats.forEach { stat ->
            MonthlyMileageStatItem(stat = stat, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun MonthlyMileageStatItem(
    stat: MileageStat,
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
            Caption(stat.unit, modifier = Modifier.padding(bottom = STAT_UNIT_BOTTOM_PADDING))
        }
        MetricLabel(stat.label)
    }
}

@Composable
private fun MonthlyMileageChart(
    bars: List<MileageBar>,
    strings: MonthlyMileageStrings,
    distanceUnit: String,
    locale: Locale,
) {
    val labels = remember(bars) { bars.map { it.month } }
    val series =
        remember(bars, strings, distanceUnit) {
            listOf(
                ChartSeries(
                    key = KEY_CURRENT,
                    label = strings.distance,
                    values = bars.map { if (it.isCurrent) it.distance else null },
                    kind = ChartSeriesKind.Bar,
                    color = CURRENT_BAR_COLOR,
                    unit = distanceUnit,
                ),
                ChartSeries(
                    key = KEY_HISTORY,
                    label = strings.distance,
                    values = bars.map { if (it.isCurrent) null else it.distance },
                    kind = ChartSeriesKind.Bar,
                    color = HISTORY_BAR_COLOR,
                    unit = distanceUnit,
                ),
            )
        }
    BarChartWrapper(
        series = series,
        xLabels = labels,
        height = CHART_HEIGHT,
        yValueFormatter = { ChartFormat.number(it, Y_AXIS_DECIMALS, locale) },
        emptyMessage = strings.noData,
    )
}

@Composable
private fun MonthlyMileageLoading(size: MonthlyMileageSize) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatGridSkeleton(count = STAT_COUNT)
        if (!size.isCompact) {
            Skeleton(height = CHART_HEIGHT, rounded = true)
        }
    }
}

/** Resolves the five source strings through the i18n facade (P1/S10) — the web `t('widget.monthlyMileage.…')` keys. */
@Composable
private fun rememberMonthlyMileageStrings(): MonthlyMileageStrings {
    val title = stringResource(R.string.translation_widget_monthlyMileage_title)
    val noData = stringResource(R.string.translation_widget_monthlyMileage_noData)
    val thisMonth = stringResource(R.string.translation_widget_monthlyMileage_thisMonth)
    val total12m = stringResource(R.string.translation_widget_monthlyMileage_total12m)
    val distance = stringResource(R.string.translation_widget_monthlyMileage_distance)
    return remember(title, noData, thisMonth, total12m, distance) {
        MonthlyMileageStrings(
            title = title,
            noData = noData,
            thisMonth = thisMonth,
            total12m = total12m,
            distance = distance,
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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans
 * on lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured at render
 * time by the [Icon] / [EmptyState] tint.
 */
private object MonthlyMileageGlyphs {
    /** Axis + three ascending bars — the header + empty-state icon (web lucide `BarChart3`). */
    val BarChart3: ImageVector =
        mileageVector("MonthlyMileageBarChart3") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(8f, 17f)
            lineTo(8f, 14f)
            moveTo(13f, 17f)
            lineTo(13f, 5f)
            moveTo(18f, 17f)
            lineTo(18f, 9f)
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        mileageVector("MonthlyMileageRefresh") {
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

private fun mileageVector(
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
