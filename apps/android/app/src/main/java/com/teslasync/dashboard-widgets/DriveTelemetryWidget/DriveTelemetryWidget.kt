// The native Jetpack Compose + Material 3 Drive Telemetry dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise the title +
// activity icon + freshness header for the standard/wide footprint, or a freshness-overlaid frame for
// the compact footprint) wrapping either the standard/wide body (the Distance / Duration / Efficiency
// summary stats + an optional wide start-address badge, the speed/power/battery [+ wide elevation]
// replay chart, and the series legend), the compact summary-only layout (1×N), or — when there is no
// recent drive — the friendly "No recent drives" empty state, and the per-drive "No telemetry for this
// drive" chart empty branch. All data flows through the shared [DriveTelemetryWidgetViewModel] (P1/S8);
// SI values are converted to the user's unit at this render boundary via the live
// [io.teslasync.android.data.UnitFormatter]. The view never performs HTTP. Every string resolves
// through the i18n catalog (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveTelemetryWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivetelemetry

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import java.time.ZoneId

private val CHART_HEIGHT = 132.dp
private val BODY_MIN_HEIGHT = 150.dp
private val LEGEND_DOT = 8.dp
private val ADDRESS_BADGE_MAX_WIDTH = 180.dp
private val HEADER_SKELETON_HEIGHT = 14.dp
private const val HEADER_SKELETON_WIDTH_FRACTION = 0.5f
private const val ELEVATION_FILL_ALPHA = 0.18f

/**
 * Stateful entry point. Binds the shared drives + telemetry feeds via [source] into a
 * [DriveTelemetryWidgetViewModel], records the one-shot `view.opened` diagnostic, collects the live
 * [units] formatter, and renders the surface for the given [size]. A dashboard host supplies [source]
 * (the [driveTelemetrySource] adapter over the shared S8 Vehicles + Driving holders) and a unique
 * [instanceKey] per placement.
 *
 * @param source the cache-then-network drives + telemetry seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveTelemetryWidget(
    source: DriveTelemetrySource,
    modifier: Modifier = Modifier,
    size: DriveTelemetrySize = DriveTelemetryRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = DriveTelemetryRegistration.ID,
) {
    val viewModel: DriveTelemetryWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = DriveTelemetryWidgetViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    DriveTelemetryWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact
 * summary or the standard/wide title + freshness header over the stats + chart + legend body (or the
 * "No recent drives" empty state). [prefs] supplies the SI→display conversion; [zone] is injectable for
 * deterministic `HH:mm` rendering in tests. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract.
 */
@Composable
fun DriveTelemetryWidgetContent(
    state: UiState<DriveTelemetrySnapshot>,
    prefs: UnitPref,
    size: DriveTelemetrySize = DriveTelemetryRegistration.defaultSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
    zone: ZoneId = ZoneId.systemDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val labels = rememberDriveTelemetryLabels()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(state, onRetry, modifier)
        else -> {
            val display =
                remember(state.data, size, labels, prefs, zone) {
                    DriveTelemetryProjection.project(
                        snapshot = state.data ?: DriveTelemetrySnapshot(drive = null),
                        size = size,
                        labels = labels,
                        prefs = prefs,
                        zone = zone,
                    )
                }
            LoadedChrome(state = state, display = display, onRefresh = onRefresh, modifier = modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<DriveTelemetrySnapshot>,
    display: DriveTelemetryDisplay,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    if (display.isCompact) {
        CompactChrome(state = state, display = display, modifier = modifier)
        return
    }
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, onRefresh = onRefresh)
        Box(modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT)) {
            if (display.hasDrive) {
                StandardBody(display = display)
            } else {
                NoDrivesEmpty()
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<DriveTelemetrySnapshot>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.xs, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = ActivityIcon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.speed,
        )
        PanelTitle(
            text = stringResource(R.string.translation_widget_driveTelemetry_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
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
private fun StandardBody(display: DriveTelemetryDisplay) {
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StatsHeader(display = display)
        ChartArea(display = display)
        DriveLegend(display = display)
    }
}

@Composable
private fun StatsHeader(display: DriveTelemetryDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        display.stats.forEach { stat -> SummaryStat(stat = stat) }
        if (display.hasAddressBadge) {
            val address = display.startAddress.orEmpty()
            Badge(
                text = address,
                variant = BadgeVariant.Neutral,
                modifier = Modifier.widthIn(max = ADDRESS_BADGE_MAX_WIDTH).semantics { contentDescription = address },
            )
        }
    }
}

@Composable
private fun SummaryStat(stat: DriveTelemetryStat) {
    val description = stat.unit?.let { "${stat.label}: ${stat.value} $it" } ?: "${stat.label}: ${stat.value}"
    Column(modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description }) {
        Caption(stat.label)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(stat.value, maxLines = 1)
            stat.unit?.let { Caption(it) }
        }
    }
}

@Composable
private fun ChartArea(display: DriveTelemetryDisplay) {
    if (!display.hasTelemetry) {
        EmptyState(
            message = stringResource(R.string.translation_widget_driveTelemetry_noTelemetry),
            icon = ActivityIcon,
            modifier = Modifier.fillMaxWidth().heightIn(min = CHART_HEIGHT),
        )
        return
    }
    val chart = display.chart
    val speedColor = TeslaTokens.chart.speed
    val powerColor = TeslaTokens.chart.power
    val batteryColor = TeslaTokens.chart.battery
    val elevationColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = ELEVATION_FILL_ALPHA)
    val labels = rememberDriveTelemetryLabels()
    val series =
        remember(chart, speedColor, powerColor, batteryColor, elevationColor, labels) {
            buildList {
                if (chart.showElevation) {
                    add(ChartSeries("elevation", labels.elevation, chart.elevationValues, ChartSeriesKind.Area, elevationColor))
                }
                add(ChartSeries("power", labels.power, chart.powerValues, ChartSeriesKind.Area, powerColor))
                add(ChartSeries("speed", labels.speed, chart.speedValues, ChartSeriesKind.Line, speedColor))
                add(ChartSeries("battery", labels.battery, chart.batteryValues, ChartSeriesKind.Line, batteryColor))
            }
        }
    Box(modifier = Modifier.fillMaxWidth().semantics { contentDescription = display.chartContentDescription }) {
        ComboChart(
            series = series,
            xLabels = chart.timeLabels,
            height = CHART_HEIGHT,
            yValueFormatter = { ChartFormat.number(it, decimals = 0) },
        )
    }
}

@Composable
private fun DriveLegend(display: DriveTelemetryDisplay) {
    if (!display.hasTelemetry) return
    val labels = rememberDriveTelemetryLabels()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LegendItem(color = TeslaTokens.chart.speed, label = labels.speed)
        LegendItem(color = TeslaTokens.chart.power, label = labels.power)
        LegendItem(color = TeslaTokens.chart.battery, label = labels.battery)
        if (display.chart.showElevation) {
            LegendItem(color = MaterialTheme.colorScheme.onSurfaceVariant, label = labels.elevation)
        }
    }
}

@Composable
private fun LegendItem(
    color: Color,
    label: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(color))
        Caption(label)
    }
}

@Composable
private fun CompactChrome(
    state: UiState<DriveTelemetrySnapshot>,
    display: DriveTelemetryDisplay,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.sm)) {
        if (display.hasDrive) {
            Column(
                modifier =
                    Modifier
                        .align(Alignment.Center)
                        .clearAndSetSemantics { contentDescription = display.compactContentDescription },
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                display.stats.forEach { stat -> SummaryStat(stat = stat) }
            }
        } else {
            NoDrivesEmpty(modifier = Modifier.align(Alignment.Center))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
            modifier = Modifier.align(Alignment.TopEnd),
        )
    }
}

@Composable
private fun NoDrivesEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_widget_driveTelemetry_empty),
        icon = ActivityIcon,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_widget_driveTelemetry_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = HEADER_SKELETON_HEIGHT, rounded = true, widthFraction = HEADER_SKELETON_WIDTH_FRACTION)
        Skeleton(height = CHART_HEIGHT, rounded = true)
    }
}

@Composable
private fun ErrorChrome(
    state: UiState<DriveTelemetrySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.md), contentAlignment = Alignment.Center) {
        QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
    }
}

@Composable
private fun rememberDriveTelemetryLabels(): DriveTelemetryLabels =
    DriveTelemetryLabels(
        distance = stringResource(R.string.translation_widget_driveTelemetry_distance),
        duration = stringResource(R.string.translation_widget_driveTelemetry_duration),
        minute = stringResource(R.string.translation_widget_driveTelemetry_min),
        efficiency = stringResource(R.string.translation_widget_driveTelemetry_efficiency),
        speed = stringResource(R.string.translation_widget_driveTelemetry_speed),
        power = stringResource(R.string.translation_widget_driveTelemetry_power),
        battery = stringResource(R.string.translation_widget_driveTelemetry_battery),
        elevation = stringResource(R.string.translation_widget_driveTelemetry_elevation),
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

// ── Locally-authored stroked icon (the web `lucide-react` Activity glyph) ──────────────────────────
// Authored here because the app's shared icon set has no equivalent and the shared glyph objects are
// out of this surface's allowed files (the same approach as the sibling ChargingTelemetryWidget's Zap
// glyph). A 24×24 stroked vector recolored at render time by [Icon]/[EmptyState]'s tint.

private fun lucideIcon(
    name: String,
    block: PathBuilder.() -> Unit,
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
                pathBuilder = block,
            )
        }.build()

/** lucide `activity` — the pulse/heartbeat polyline `M22 12h-4l-3 9L9 3l-3 9H2`. */
private val ActivityIcon: ImageVector =
    lucideIcon("Activity") {
        moveTo(22f, 12f)
        horizontalLineToRelative(-4f)
        lineToRelative(-3f, 9f)
        lineTo(9f, 3f)
        lineToRelative(-3f, 9f)
        horizontalLineTo(2f)
    }
