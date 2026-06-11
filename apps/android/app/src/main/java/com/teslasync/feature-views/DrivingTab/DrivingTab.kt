// The native Jetpack Compose + Material 3 Driving analytics tab feature view — a parity port of
// web/src/features/analytics/components/analytics/DrivingTab.tsx. The web component wraps a vertical stack
// (`<FadeIn className="space-y-4 mt-4">`) of seven always-visible `<GlassPanel>` chart sections, each with a
// `SectionTitle` over either a Recharts plot or a friendly `<EmptyState>` when that series is missing:
//   1. Speed Distribution        — bar (count by speed range)
//   2. Trip Distance Distribution— bar (count by distance range)
//   3. Hourly Driving Pattern    — composed: drives columns + a distance line
//   4. Temperature vs Efficiency — scatter (x = temp, y = efficiency, bubble = distance)
//   5. Daily Driving Trend       — composed: distance area + a drives line
//   6. Drive Duration Distribution—bar (count by duration range)
//   7. Efficiency Trend          — area (daily efficiency, filtered to > 0)
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation` -> the i18n catalog, and `useUnits` -> the resolved [UnitPref]). The host owns
// the `FleetAnalytics["drive_analytics"]` feed (P1/S8) and supplies it as a [UiState], so this view renders
// every lifecycle state that layer can carry — loading skeleton chrome, hard error with retry, empty,
// content, and stale/offline ("last known") — plus the per-section empty states the web draws. The two web
// sibling sub-components (`DrivingPerformanceCards`, `DrivingTemperatureStats`) are separate surfaces with
// their own prompts and are intentionally out of scope here (see the prompt's extracted i18n key list).
//
// Charts map to the shared chart layer ([BarChartWrapper], [ComboChart], [AreaChartWrapper], [ChartLegend]) —
// feature views must not import Vico directly. The shared layer has no scatter primitive, so the
// temperature-vs-efficiency plot is a small bespoke Compose [Canvas] (allowed: no Vico, no edit to the shared
// layer) driven entirely by the unit-tested [DrivingScatter] geometry. The dual-axis nuance of the two
// composed charts (web left/right `<YAxis>`) is a shared-renderer concern; the data parity (series, kinds,
// colors, labels, legend) is exact. Series colors map to the generated [paletteColor] by the same index the
// web `CHART_COLORS` uses.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingTab — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingtab

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import java.util.Locale

// ── Layout + parity constants ───────────────────────────────────────────────────────────────────────

/** The web `height={260}` bar/area plots. */
private val BAR_HEIGHT: Dp = 260.dp

/** The web `height={280}` composed/scatter plots. */
private val COMPOSED_HEIGHT: Dp = 280.dp

/** The web `height={260}` efficiency-trend area plot. */
private val AREA_HEIGHT: Dp = 260.dp

/** Smallest / largest scatter bubble radius (the web `<ZAxis range={[30, 300]} />` area scale). */
private val MIN_BUBBLE_RADIUS: Dp = 3.dp
private val MAX_BUBBLE_RADIUS: Dp = 13.dp

/** Scatter axis rule stroke width. */
private val AXIS_STROKE: Dp = 1.dp

/** Scatter bubble fill opacity. */
private const val BUBBLE_ALPHA: Float = 0.65f

/** Bar counts are integers (web `<YAxis />` integer ticks); the composed/scatter axes keep one decimal. */
private const val COUNT_DECIMALS: Int = 0
private const val COMBO_DECIMALS: Int = 1
private const val SCATTER_AXIS_DECIMALS: Int = 1

/** Number of always-visible chart sections — also the loading skeleton count. */
private const val SECTION_COUNT: Int = 7

// Web CHART_COLORS palette indices, preserved for visual parity.
private const val COLOR_SPEED: Int = 0
private const val COLOR_EFFICIENCY: Int = 1
private const val COLOR_DISTANCE_BAR: Int = 2
private const val COLOR_TREND_LINE: Int = 3
private const val COLOR_DURATION: Int = 4

/** Em dash shown for an unknown freshness age. */
private const val EM_DASH: String = "\u2014"

// ── Public entry points ─────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry point for the Driving analytics tab. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), resolves the live display [UnitPref] from the shared data container (the native
 * `useUnits`), and renders every lifecycle [state] the drive-analytics feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [DrivingAnalytics] (web `data.drive_analytics`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingTab(
    state: UiState<DrivingAnalytics>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { recordDrivingTabOpened(logger) }
    DrivingTabContent(state = state, onRetry = onRetry, units = unitFormatter.prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `data: FleetAnalytics | undefined` prop, for hosts that
 * already hold the loaded analytics. A `null` or all-empty value renders the empty surface (the web's
 * per-section empty states); a populated value renders the charts. Records `view.opened` and resolves units
 * like the stateful entry, and offers no retry (there is no fetch behind it).
 */
@Composable
fun DrivingTab(
    analytics: DrivingAnalytics?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(analytics) {
            val resolved = analytics ?: DrivingAnalytics.EMPTY
            val phase = if (resolved.isEmpty) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = resolved)
        }
    DrivingTab(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-visible seven-section stack and adds the lifecycle chrome the host's feed implies: a loading
 * skeleton, a hard-error retry surface, and a freshness chip that reflects refreshing/stale/offline. Stale
 * (non-error) data auto-refreshes, mirroring the web freshness contract. [units] applies the display
 * preference at the render boundary (the only conversions are in the scatter); [locale] formats axis values.
 */
@Composable
fun DrivingTabContent(
    state: UiState<DrivingAnalytics>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: UnitPref = UnitFormatter.default().prefs,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    FadeIn(modifier = modifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when {
                state.isLoading -> DrivingTabLoading()
                state.isError -> DrivingTabError(onRetry = onRetry)
                else -> {
                    if (state.stale || state.refreshing || state.hasError) {
                        DrivingFreshnessRow(state)
                    }
                    DrivingCharts(
                        analytics = state.data ?: DrivingAnalytics.EMPTY,
                        units = units,
                        locale = locale,
                    )
                }
            }
        }
    }
}

// ── Chart sections ──────────────────────────────────────────────────────────────────────────────────

/** The seven always-visible chart sections, in web order (minus the two out-of-scope sibling surfaces). */
@Composable
private fun DrivingCharts(
    analytics: DrivingAnalytics,
    units: UnitPref,
    locale: Locale,
) {
    DistributionBarPanel(
        title = stringResource(R.string.translation_analytics_driving_speedDist),
        seriesLabel = stringResource(R.string.translation_analytics_driving_trips),
        emptyMessage = stringResource(R.string.translation_analytics_driving_noSpeed),
        seriesKey = "speed",
        buckets = analytics.speedDistribution,
        colorIndex = COLOR_SPEED,
        locale = locale,
    )
    DistributionBarPanel(
        title = stringResource(R.string.translation_analytics_driving_distDist),
        seriesLabel = stringResource(R.string.translation_analytics_driving_trips),
        emptyMessage = stringResource(R.string.translation_analytics_driving_noDistDist),
        seriesKey = "tripDistance",
        buckets = analytics.distanceDistribution,
        colorIndex = COLOR_DISTANCE_BAR,
        locale = locale,
    )
    HourlyPatternPanel(points = analytics.hourlyPattern, locale = locale)
    TempVsEfficiencyPanel(samples = analytics.tempVsEfficiency, units = units, locale = locale)
    DailyTrendPanel(points = analytics.dailyTrend, units = units, locale = locale)
    DistributionBarPanel(
        title = stringResource(R.string.translation_analytics_driving_durationDist),
        seriesLabel = stringResource(R.string.translation_analytics_driving_drives),
        emptyMessage = stringResource(R.string.translation_analytics_driving_noDurationData),
        seriesKey = "duration",
        buckets = analytics.durationDistribution,
        colorIndex = COLOR_DURATION,
        locale = locale,
    )
    EfficiencyTrendPanel(points = analytics.dailyTrend, units = units, locale = locale)
}

/** A single-series distribution bar chart panel (speed / trip-distance / duration) — web `<BarChart>`. */
@Composable
private fun DistributionBarPanel(
    title: String,
    seriesLabel: String,
    emptyMessage: String,
    seriesKey: String,
    buckets: List<DistributionBucket>,
    colorIndex: Int,
    locale: Locale,
) {
    ChartPanel(title = title) {
        if (buckets.isEmpty()) {
            EmptyState(message = emptyMessage, modifier = Modifier.fillMaxWidth())
        } else {
            val color = paletteColor(colorIndex)
            val series =
                remember(buckets, seriesKey, seriesLabel, color) {
                    listOf(
                        ChartSeries(
                            key = seriesKey,
                            label = seriesLabel,
                            values = DrivingProjection.counts(buckets),
                            kind = ChartSeriesKind.Bar,
                            color = color,
                        ),
                    )
                }
            BarChartWrapper(
                series = series,
                xLabels = DrivingProjection.ranges(buckets),
                height = BAR_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, COUNT_DECIMALS, locale) },
                emptyMessage = emptyMessage,
            )
        }
    }
}

/** Hourly driving pattern — drives columns + a distance line (web composed chart with dual axes). */
@Composable
private fun HourlyPatternPanel(
    points: List<HourlyDrivePoint>,
    locale: Locale,
) {
    ChartPanel(title = stringResource(R.string.translation_analytics_driving_hourlyPattern)) {
        if (points.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_analytics_driving_noHourly),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            val drivesColor = paletteColor(COLOR_SPEED)
            val distanceColor = paletteColor(COLOR_TREND_LINE)
            val drivesLabel = stringResource(R.string.translation_analytics_driving_drives)
            val distanceLabel = stringResource(R.string.translation_analytics_driving_distance)
            val series =
                remember(points, drivesLabel, distanceLabel, drivesColor, distanceColor) {
                    listOf(
                        ChartSeries(
                            key = "drives",
                            label = drivesLabel,
                            values = DrivingProjection.drivesValues(points),
                            kind = ChartSeriesKind.Bar,
                            color = drivesColor,
                        ),
                        ChartSeries(
                            key = "distance",
                            label = distanceLabel,
                            values = DrivingProjection.hourlyDistanceValues(points),
                            kind = ChartSeriesKind.Line,
                            color = distanceColor,
                        ),
                    )
                }
            val legend =
                remember(drivesLabel, distanceLabel, drivesColor, distanceColor) {
                    listOf(
                        LegendEntry(key = "drives", label = drivesLabel, color = drivesColor),
                        LegendEntry(key = "distance", label = distanceLabel, color = distanceColor),
                    )
                }
            ComboWithLegend(
                series = series,
                xLabels = DrivingProjection.hourLabels(points),
                legend = legend,
                height = COMPOSED_HEIGHT,
                locale = locale,
            )
        }
    }
}

/** Daily driving trend — distance area + a drives line (web composed chart with dual axes). */
@Composable
private fun DailyTrendPanel(
    points: List<DailyDrivePoint>,
    units: UnitPref,
    locale: Locale,
) {
    ChartPanel(title = stringResource(R.string.translation_analytics_driving_dailyTrend)) {
        if (points.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_analytics_driving_noDailyTrend),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            val distanceColor = paletteColor(COLOR_SPEED)
            val drivesColor = paletteColor(COLOR_TREND_LINE)
            val distanceLabel = units.distance.label
            val drivesLabel = stringResource(R.string.translation_analytics_driving_drives)
            val series =
                remember(points, distanceLabel, drivesLabel, distanceColor, drivesColor) {
                    listOf(
                        ChartSeries(
                            key = "distance",
                            label = distanceLabel,
                            values = DrivingProjection.dailyDistanceValues(points),
                            kind = ChartSeriesKind.Area,
                            color = distanceColor,
                        ),
                        ChartSeries(
                            key = "drives",
                            label = drivesLabel,
                            values = DrivingProjection.dailyDrivesValues(points),
                            kind = ChartSeriesKind.Line,
                            color = drivesColor,
                        ),
                    )
                }
            val legend =
                remember(distanceLabel, drivesLabel, distanceColor, drivesColor) {
                    listOf(
                        LegendEntry(key = "distance", label = distanceLabel, color = distanceColor),
                        LegendEntry(key = "drives", label = drivesLabel, color = drivesColor),
                    )
                }
            ComboWithLegend(
                series = series,
                xLabels = DrivingProjection.shortDates(points),
                legend = legend,
                height = COMPOSED_HEIGHT,
                locale = locale,
            )
        }
    }
}

/** Efficiency trend — a single area of the daily efficiency, filtered to positive values (web `<AreaChart>`). */
@Composable
private fun EfficiencyTrendPanel(
    points: List<DailyDrivePoint>,
    units: UnitPref,
    locale: Locale,
) {
    ChartPanel(title = stringResource(R.string.translation_analytics_driving_effTrend)) {
        val trend = remember(points) { DrivingProjection.efficiencyTrend(points) }
        if (trend.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_analytics_driving_noEffTrend),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            val color = paletteColor(COLOR_EFFICIENCY)
            val effUnit = DrivingProjection.efficiencyUnitLabel(units.distance)
            val series =
                remember(trend, effUnit, color) {
                    listOf(
                        ChartSeries(
                            key = "efficiency",
                            label = effUnit,
                            values = DrivingProjection.efficiencyValues(trend),
                            kind = ChartSeriesKind.Area,
                            color = color,
                        ),
                    )
                }
            AreaChartWrapper(
                series = series,
                xLabels = DrivingProjection.shortDates(trend),
                height = AREA_HEIGHT,
                yValueFormatter = { value -> ChartFormat.number(value, COMBO_DECIMALS, locale) },
            )
        }
    }
}

/** Temperature vs efficiency scatter — the only chart that converts at the display boundary. */
@Composable
private fun TempVsEfficiencyPanel(
    samples: List<TempEfficiencySample>,
    units: UnitPref,
    locale: Locale,
) {
    ChartPanel(title = stringResource(R.string.translation_analytics_driving_tempVsEff)) {
        val projection =
            remember(samples, units.distance, units.temperature) {
                DrivingScatter.project(samples, units.distance, units.temperature)
            }
        if (projection.isEmpty) {
            EmptyState(
                message = stringResource(R.string.translation_analytics_driving_noTempEff),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            val tempUnit = units.temperature.label
            val efficiencyUnit = DrivingProjection.efficiencyUnitLabel(units.distance)
            val tempLabel = stringResource(R.string.translation_analytics_driving_temp)
            val efficiencyLabel = stringResource(R.string.translation_analytics_driving_efficiency)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(efficiencyUnit)
                TempEfficiencyScatter(
                    projection = projection,
                    color = paletteColor(COLOR_EFFICIENCY),
                    description = "$tempLabel / $efficiencyLabel",
                    height = COMPOSED_HEIGHT,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Caption(ChartFormat.withUnit(projection.xMin, tempUnit, SCATTER_AXIS_DECIMALS, locale))
                    Caption(tempLabel)
                    Caption(ChartFormat.withUnit(projection.xMax, tempUnit, SCATTER_AXIS_DECIMALS, locale))
                }
            }
        }
    }
}

// ── Shared section building blocks ──────────────────────────────────────────────────────────────────

/** A `<GlassPanel className="p-4">` with a `SectionTitle` over its [content] — the web section shell. */
@Composable
private fun ChartPanel(
    title: String,
    content: @Composable () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(title)
        Spacer(Modifier.height(Spacing.md))
        content()
    }
}

/** A composed chart plus its tappable legend (web `<ComposedChart>` + `<Legend>`). */
@Composable
private fun ComboWithLegend(
    series: List<ChartSeries>,
    xLabels: List<String>,
    legend: List<LegendEntry>,
    height: Dp,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        ComboChart(
            series = series,
            xLabels = xLabels,
            height = height,
            yValueFormatter = { value -> ChartFormat.number(value, COMBO_DECIMALS, locale) },
        )
        ChartLegend(entries = legend, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * The bespoke temperature-vs-efficiency scatter — bubbles positioned by the unit-tested [DrivingScatter]
 * geometry (x = temperature, y = efficiency, area = distance). Drawn with a plain Compose [Canvas] so the
 * surface stays free of any direct Vico dependency. [description] is the TalkBack label for the opaque plot.
 */
@Composable
private fun TempEfficiencyScatter(
    projection: ScatterProjection,
    color: Color,
    description: String,
    height: Dp,
) {
    val axisColor = MaterialTheme.colorScheme.outlineVariant
    val bubbleColor = color.copy(alpha = BUBBLE_ALPHA)
    Canvas(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(height)
                .clearAndSetSemantics { contentDescription = description },
    ) {
        val maxRadius = MAX_BUBBLE_RADIUS.toPx()
        val minRadius = MIN_BUBBLE_RADIUS.toPx()
        val left = maxRadius
        val right = (size.width - maxRadius).coerceAtLeast(left + 1f)
        val top = maxRadius
        val bottom = (size.height - maxRadius).coerceAtLeast(top + 1f)
        val spanX = right - left
        val spanY = bottom - top

        drawLine(axisColor, Offset(left, top), Offset(left, bottom), AXIS_STROKE.toPx())
        drawLine(axisColor, Offset(left, bottom), Offset(right, bottom), AXIS_STROKE.toPx())

        projection.points.forEach { point ->
            val nx = DrivingScatter.normalize(point.x, projection.xMin, projection.xMax).toFloat()
            val ny = DrivingScatter.normalize(point.y, projection.yMin, projection.yMax).toFloat()
            val radiusFraction =
                DrivingScatter.radiusFraction(point.size, projection.sizeMin, projection.sizeMax).toFloat()
            val center = Offset(left + nx * spanX, bottom - ny * spanY)
            drawCircle(
                color = bubbleColor,
                radius = minRadius + (maxRadius - minRadius) * radiusFraction,
                center = center,
            )
        }
    }
}

// ── Lifecycle chrome ────────────────────────────────────────────────────────────────────────────────

/** First-load skeleton — one chart-shaped shimmer per section so no panel is ever a blank box. */
@Composable
private fun DrivingTabLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    repeat(SECTION_COUNT) { index ->
        GlassPanel(padding = PanelPadding.Md) {
            val base = Modifier.fillMaxWidth()
            val skeletonModifier =
                if (index == 0) base.semantics { contentDescription = loadingLabel } else base
            ChartBlockSkeleton(modifier = skeletonModifier, height = BAR_HEIGHT)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DrivingTabError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * The freshness chip rendered above the charts when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun DrivingFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberDrivingFreshnessFormatter(),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDrivingFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ────────────────────────

private val PREVIEW_ANALYTICS =
    DrivingAnalytics(
        speedDistribution =
            listOf(
                DistributionBucket("0-20", 4),
                DistributionBucket("20-40", 9),
                DistributionBucket("40-60", 6),
            ),
        distanceDistribution =
            listOf(
                DistributionBucket("0-5", 7),
                DistributionBucket("5-15", 12),
                DistributionBucket("15-40", 5),
            ),
        hourlyPattern =
            listOf(
                HourlyDrivePoint(hour = 7, drives = 3, distance = 22.0),
                HourlyDrivePoint(hour = 8, drives = 6, distance = 41.0),
                HourlyDrivePoint(hour = 17, drives = 5, distance = 33.0),
            ),
        tempVsEfficiency =
            listOf(
                TempEfficiencySample(temp = 5.0, efficiency = 182.0, distance = 12.0),
                TempEfficiencySample(temp = 18.0, efficiency = 150.0, distance = 25.0),
                TempEfficiencySample(temp = 30.0, efficiency = 165.0, distance = 8.0),
            ),
        dailyTrend =
            listOf(
                DailyDrivePoint(date = "2026-04-02", drives = 3, distance = 40.0, efficiency = 168.0),
                DailyDrivePoint(date = "2026-04-03", drives = 5, distance = 62.0, efficiency = 155.0),
            ),
        durationDistribution =
            listOf(
                DistributionBucket("0-15m", 6),
                DistributionBucket("15-30m", 9),
            ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun DrivingTabContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTabContent(
            state = UiState(UiPhase.Content, data = PREVIEW_ANALYTICS),
            onRetry = {},
            units = UnitFormatter.default().prefs,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun DrivingTabLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTabContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            units = UnitFormatter.default().prefs,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun DrivingTabEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTabContent(
            state = UiState(UiPhase.Empty, data = DrivingAnalytics.EMPTY),
            onRetry = {},
            units = UnitFormatter.default().prefs,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun DrivingTabErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTabContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            units = UnitFormatter.default().prefs,
            locale = Locale.US,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun DrivingTabOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTabContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_ANALYTICS,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            units = UnitFormatter.default().prefs,
            locale = Locale.US,
        )
    }
}
