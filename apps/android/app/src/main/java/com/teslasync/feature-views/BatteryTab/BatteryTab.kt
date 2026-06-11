// The native Jetpack Compose + Material 3 Battery analytics feature view — a parity port of
// web/src/features/analytics/components/analytics/BatteryTab.tsx. The web component is purely
// presentational: its parent (the Analytics page) loads the `FleetAnalytics` document and passes it down,
// and BatteryTab reads `data?.battery_trend ?? []`, rendering an empty state when the trend is empty or, with
// data, a five-card latest-point summary (Health Score / Capacity / Degradation / Est. Range / Cycles) above
// four trend charts (Health Score Timeline area, Capacity Trend line, Range Trend line, and a
// Degradation & Cycles composed area+line with a legend).
//
// This port keeps that contract end to end and adds the lifecycle chrome every native surface must render.
// It performs NO HTTP: its only web hooks are `useTranslation` (mapped to the i18n catalog) and `useUnits`
// (mapped to the live [UnitFormatter] from the shared P1/S8 data layer). The host supplies the trend rows as
// a [UiState] (the cache-then-network projection of the fleet-analytics feed), so this view renders every
// lifecycle state that layer can carry — loading, hard error with retry, empty, content, and stale/offline
// (cached "last known") — without ever fetching. A web-parity overload that takes the raw `FleetAnalytics`
// document + a `loading` flag is also provided. The native [ChartContainer] + chart wrappers are the faithful
// counterparts of the web `GlassPanel` + `SectionTitle` + Recharts composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryTab — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterytab

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.ChartSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** Plot heights mirroring the web `<ResponsiveContainer height>` values (280 for tall, 260 for the pair). */
private val CHART_HEIGHT_TALL: Dp = 280.dp
private val CHART_HEIGHT_SHORT: Dp = 260.dp

/** Responsive metric-grid breakpoints — the Android analogue of web `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`. */
private val METRIC_BREAK_MD: Dp = 380.dp
private val METRIC_BREAK_LG: Dp = 640.dp
private const val METRIC_COLS_SM = 2
private const val METRIC_COLS_MD = 3
private const val METRIC_COLS_LG = 5

/** Series keys (web Recharts `dataKey`s) and their categorical palette indices (web `CHART_COLORS[i]`). */
private const val HEALTH_KEY = "health_score"
private const val CAPACITY_KEY = "capacity_wh"
private const val RANGE_KEY = "range"
private const val DEGRADATION_KEY = "degradation_pct"
private const val CYCLE_KEY = "cycle_count"
private const val HEALTH_COLOR_INDEX = 1
private const val CAPACITY_COLOR_INDEX = 0
private const val RANGE_COLOR_INDEX = 2
private const val DEGRADATION_COLOR_INDEX = 5
private const val CYCLE_COLOR_INDEX = 4

/**
 * Stateful entry point for the Battery analytics tab. Binds `useUnits` (the live [UnitFormatter] from the
 * shared P1/S8 data layer), records the one-shot PII-safe `view.opened` diagnostic (P1/S11), and renders
 * every lifecycle [state] the fleet-analytics feed can carry. The host owns the feed and supplies [onRetry]
 * (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the parsed `battery_trend` rows (web `data.battery_trend`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BatteryTab(
    state: UiState<List<BatteryTrendPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { recordBatteryTabOpened(logger) }
    BatteryTabContent(state = state, onRetry = onRetry, modifier = modifier, formatter = formatter)
}

/**
 * Web-parity overload mirroring the web component's `data: FleetAnalytics | undefined` + `loading` props,
 * for hosts that already hold the loaded analytics document. Parses `battery_trend` and classifies the
 * surface (loading / empty / content) exactly as the web does (web `trend.length === 0`). There is no fetch
 * behind it, so the offered retry is a no-op by default.
 */
@Composable
fun BatteryTab(
    analytics: JsonElement?,
    loading: Boolean,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(analytics, loading) { batteryTabStateOf(analytics, loading) }
    BatteryTab(state = state, onRetry = onRetry, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the preview/UI-test entry point. Maps the host feed's
 * [UiState] onto the loading / error+retry / empty / content surfaces and renders the metric cards + four
 * trend charts in the content state, reproducing the web composition. Stale (non-error) cached data
 * auto-refreshes and shows a freshness chip, mirroring the web freshness contract. [formatter] is the
 * `useUnits` boundary; [locale] formats the numeric axes and table cells.
 */
@Composable
fun BatteryTabContent(
    state: UiState<List<BatteryTrendPoint>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    formatter: UnitFormatter = UnitFormatter.default(),
    locale: Locale = Locale.getDefault(),
    strings: BatteryTabStrings = rememberBatteryTabStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val display =
        remember(state.data, formatter, locale) {
            BatteryTabProjection.project(state.data ?: emptyList(), formatter, locale)
        }
    FadeIn(modifier = modifier) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            when (batteryTabSurface(state)) {
                BatteryTabSurface.Loading -> BatteryTabLoading()
                BatteryTabSurface.Error -> BatteryTabError(state = state, onRetry = onRetry)
                BatteryTabSurface.Empty -> BatteryTabEmpty()
                BatteryTabSurface.Content ->
                    BatteryTabBody(
                        display = display,
                        state = state,
                        formatter = formatter,
                        strings = strings,
                        locale = locale,
                    )
            }
        }
    }
}

/**
 * The populated tab — the freshness chip (when cached data is refreshing / stale / offline), the five
 * latest-point metric cards, and the four trend charts. Each chart is framed by a [ChartContainer] (the
 * native `GlassPanel` + title counterpart) with an accessible fallback data table.
 */
@Composable
private fun BatteryTabBody(
    display: BatteryTabDisplay,
    state: UiState<*>,
    formatter: UnitFormatter,
    strings: BatteryTabStrings,
    locale: Locale,
) {
    val dateHeader = stringResource(R.string.translation_common_date)
    val noData = stringResource(R.string.translation_chart_noData)
    val showFreshness = !state.isLoading && !state.isError && (state.refreshing || state.stale || state.hasError)
    if (showFreshness) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            BatteryFreshnessChip(state)
        }
    }
    BatteryMetricGrid(metrics = rememberBatteryMetrics(display, strings))
    BatteryHealthChart(display = display, strings = strings, locale = locale, dateHeader = dateHeader, noData = noData)
    BatteryCapacityChart(display = display, strings = strings, formatter = formatter, dateHeader = dateHeader, noData = noData)
    BatteryRangeChart(display = display, strings = strings, locale = locale, dateHeader = dateHeader, noData = noData)
    BatteryDegradationCyclesChart(display = display, strings = strings, locale = locale, dateHeader = dateHeader, noData = noData)
}

/** The Health Score Timeline area chart (web `<AreaChart dataKey="health_score">`). */
@Composable
private fun BatteryHealthChart(
    display: BatteryTabDisplay,
    strings: BatteryTabStrings,
    locale: Locale,
    dateHeader: String,
    noData: String,
) {
    val color = paletteColor(HEALTH_COLOR_INDEX)
    BatteryChartPanel(
        title = strings.healthTimeline,
        accessibleDescription = "${strings.healthTimeline}: ${strings.healthSeries}",
        tableHeader = listOf(dateHeader, strings.healthSeries),
        tableRows = display.healthTable,
        height = CHART_HEIGHT_TALL,
    ) {
        AreaChartWrapper(
            series = listOf(ChartSeries(HEALTH_KEY, strings.healthSeries, display.healthValues, ChartSeriesKind.Area, color)),
            xLabels = display.xLabels,
            height = CHART_HEIGHT_TALL,
            yValueFormatter = { ChartFormat.number(it, HEALTH_DECIMALS, locale) },
            emptyMessage = noData,
        )
    }
}

/**
 * The Capacity Trend line chart (web `<LineChart dataKey="capacity_wh">`). The raw SI watt-hour samples are
 * plotted and the Y axis is formatted through the live `useUnits` energy boundary, so the labels read in the
 * user's energy unit (the web card's `formatEnergy`) while the plotted SI data stays untouched.
 */
@Composable
private fun BatteryCapacityChart(
    display: BatteryTabDisplay,
    strings: BatteryTabStrings,
    formatter: UnitFormatter,
    dateHeader: String,
    noData: String,
) {
    val color = paletteColor(CAPACITY_COLOR_INDEX)
    BatteryChartPanel(
        title = strings.capacityTrend,
        accessibleDescription = "${strings.capacityTrend}: ${strings.capacity}",
        tableHeader = listOf(dateHeader, strings.capacity),
        tableRows = display.capacityTable,
        height = CHART_HEIGHT_SHORT,
    ) {
        LineChartWrapper(
            series = listOf(ChartSeries(CAPACITY_KEY, strings.capacity, display.capacityValues, ChartSeriesKind.Line, color)),
            xLabels = display.xLabels,
            height = CHART_HEIGHT_SHORT,
            yValueFormatter = { formatter.energy(it, CAPACITY_DECIMALS) },
            emptyMessage = noData,
        )
    }
}

/** The Range Trend line chart (web `<LineChart dataKey="range">`); plots the display-converted distance. */
@Composable
private fun BatteryRangeChart(
    display: BatteryTabDisplay,
    strings: BatteryTabStrings,
    locale: Locale,
    dateHeader: String,
    noData: String,
) {
    val color = paletteColor(RANGE_COLOR_INDEX)
    val seriesName = "${strings.rangeSeries} (${display.distanceUnit})"
    BatteryChartPanel(
        title = strings.rangeTrend,
        accessibleDescription = "${strings.rangeTrend}: $seriesName",
        tableHeader = listOf(dateHeader, seriesName),
        tableRows = display.rangeTable,
        height = CHART_HEIGHT_SHORT,
    ) {
        LineChartWrapper(
            series = listOf(ChartSeries(RANGE_KEY, seriesName, display.rangeValues, ChartSeriesKind.Line, color)),
            xLabels = display.xLabels,
            height = CHART_HEIGHT_SHORT,
            yValueFormatter = { ChartFormat.number(it, RANGE_DECIMALS, locale) },
            emptyMessage = noData,
        )
    }
}

/**
 * The Degradation & Cycles composed chart with a legend (web `<ComposedChart>` + `<Area>` + `<Line>` +
 * `<Legend>`). Vico's combo chart shares one value axis across the area + line layers (the charts SURVEY's
 * single-axis composition), so the web's dual left/right axes collapse to one shared axis here; the precise
 * degradation-% and cycle-count values are carried by the accessible data table regardless.
 */
@Composable
private fun BatteryDegradationCyclesChart(
    display: BatteryTabDisplay,
    strings: BatteryTabStrings,
    locale: Locale,
    dateHeader: String,
    noData: String,
) {
    val degradColor = paletteColor(DEGRADATION_COLOR_INDEX)
    val cycleColor = paletteColor(CYCLE_COLOR_INDEX)
    BatteryChartPanel(
        title = strings.degradationCycles,
        accessibleDescription = "${strings.degradationCycles}: ${strings.degradPct}, ${strings.cycleCount}",
        tableHeader = listOf(dateHeader, strings.degradPct, strings.cycleCount),
        tableRows = display.degradationCyclesTable,
        height = CHART_HEIGHT_TALL,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ComboChart(
                series =
                    listOf(
                        ChartSeries(DEGRADATION_KEY, strings.degradPct, display.degradationValues, ChartSeriesKind.Area, degradColor),
                        ChartSeries(CYCLE_KEY, strings.cycleCount, display.cycleValues, ChartSeriesKind.Line, cycleColor),
                    ),
                xLabels = display.xLabels,
                height = CHART_HEIGHT_TALL,
                yValueFormatter = { ChartFormat.number(it, CYCLE_DECIMALS, locale) },
                emptyMessage = noData,
            )
            ChartLegend(
                entries =
                    listOf(
                        LegendEntry(DEGRADATION_KEY, strings.degradPct, degradColor),
                        LegendEntry(CYCLE_KEY, strings.cycleCount, cycleColor),
                    ),
            )
        }
    }
}

/** Shared chart frame: a titled [ChartContainer] (always Ready in the content state) + accessible data table. */
@Composable
private fun BatteryChartPanel(
    title: String,
    accessibleDescription: String,
    tableHeader: List<String>,
    tableRows: List<List<String>>,
    height: Dp,
    chart: @Composable () -> Unit,
) {
    ChartContainer(
        title = title,
        status = ChartStatus.Ready,
        height = height,
        accessibleDescription = accessibleDescription,
        dataTableHeader = tableHeader,
        dataTableRows = tableRows,
        dataTableLabel = stringResource(R.string.translation_Details),
        content = chart,
    )
}

/** Responsive metric-card grid (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`). */
@Composable
private fun BatteryMetricGrid(metrics: List<BatteryMetric>) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth < METRIC_BREAK_MD -> METRIC_COLS_SM
                maxWidth < METRIC_BREAK_LG -> METRIC_COLS_MD
                else -> METRIC_COLS_LG
            }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            metrics.chunked(columns).forEach { rowMetrics ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    rowMetrics.forEach { metric ->
                        MetricCard(
                            label = metric.label,
                            value = metric.value,
                            modifier = Modifier.weight(1f),
                            icon = metric.icon,
                            accent = metric.accent,
                            subtitle = metric.subtitle,
                            iconContentDescription = null,
                        )
                    }
                    repeat(columns - rowMetrics.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The five latest-point metric cards, with their accents resolved from the theme token palette. */
@Composable
private fun rememberBatteryMetrics(
    display: BatteryTabDisplay,
    strings: BatteryTabStrings,
): List<BatteryMetric> {
    val green = TeslaTokens.status.success
    val cyan = TeslaTokens.chart.regen
    val amber = TeslaTokens.status.warning
    val purple = TeslaTokens.chart.power
    return remember(display, strings, green, cyan, amber, purple) {
        listOf(
            BatteryMetric(strings.healthScore, display.healthScoreValue, BATTERY_PERCENT, BatteryTabGlyphs.Heart, green),
            BatteryMetric(strings.capacity, display.capacityValue, null, DataDisplayGlyphs.Battery, cyan),
            BatteryMetric(strings.degradation, display.degradationValue, BATTERY_PERCENT, BatteryTabGlyphs.TrendingUp, amber),
            BatteryMetric(strings.estRange, display.estRangeValue, display.distanceUnit, DataDisplayGlyphs.MapPin, purple),
            BatteryMetric(strings.cycles, display.cyclesValue, null, BatteryTabGlyphs.Activity, cyan),
        )
    }
}

/** One metric card's render inputs (web `<MetricCard label value subtitle icon color>`). */
private data class BatteryMetric(
    val label: String,
    val value: String,
    val subtitle: String?,
    val icon: ImageVector,
    val accent: Color,
)

/** Loading chrome — the skeleton stat grid + three chart blocks (never a blank panel). */
@Composable
private fun BatteryTabLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatGridSkeleton(count = METRIC_COLS_MD)
        ChartSkeleton(height = CHART_HEIGHT_TALL)
        ChartSkeleton(height = CHART_HEIGHT_SHORT)
        ChartSkeleton(height = CHART_HEIGHT_TALL)
    }
}

/** Hard-error surface with a retry affordance (web `QueryError`), personalised with the Battery tab label. */
@Composable
private fun BatteryTabError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    GlassPanel {
        QueryError(
            kind =
                classifyQueryError(
                    status = state.httpStatus,
                    online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
                    transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
                ),
            resourceName = stringResource(R.string.translation_analytics_tabs_battery),
            onRetry = onRetry,
        )
    }
}

/** The friendly empty state (web `<GlassPanel><EmptyState icon={Battery} message=noData /></GlassPanel>`). */
@Composable
private fun BatteryTabEmpty() {
    GlassPanel {
        EmptyState(
            message = stringResource(R.string.translation_analytics_battery_noData),
            icon = DataDisplayGlyphs.Battery,
        )
    }
}

/**
 * The freshness chip shown in the content header when cached data is refreshing / stale / offline — the
 * honest "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized
 * "Offline" label; a stale-but-reachable value reads its relative age. Carries no English literal.
 */
@Composable
private fun BatteryFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberBatteryFreshnessFormatter(),
    )
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberBatteryFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> BATTERY_EM_DASH
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

/** Resolves the [BatteryTabStrings] from the i18n catalog (P1/S10) — the `analytics.battery.*` keys. */
@Composable
private fun rememberBatteryTabStrings(): BatteryTabStrings {
    val healthScore = stringResource(R.string.translation_analytics_battery_healthScore)
    val capacity = stringResource(R.string.translation_analytics_battery_capacity)
    val degradation = stringResource(R.string.translation_analytics_battery_degradation)
    val estRange = stringResource(R.string.translation_analytics_battery_estRange)
    val cycles = stringResource(R.string.translation_analytics_battery_cycles)
    val healthTimeline = stringResource(R.string.translation_analytics_battery_healthTimeline)
    val capacityTrend = stringResource(R.string.translation_analytics_battery_capacityTrend)
    val rangeTrend = stringResource(R.string.translation_analytics_battery_rangeTrend)
    val degradationCycles = stringResource(R.string.translation_analytics_battery_degradationCycles)
    val healthSeries = stringResource(R.string.translation_analytics_battery_health)
    val rangeSeries = stringResource(R.string.translation_analytics_battery_range)
    val degradPct = stringResource(R.string.translation_analytics_battery_degradPct)
    val cycleCount = stringResource(R.string.translation_analytics_battery_cycleCount)
    return remember(
        healthScore,
        capacity,
        degradation,
        estRange,
        cycles,
        healthTimeline,
        capacityTrend,
        rangeTrend,
        degradationCycles,
        healthSeries,
        rangeSeries,
        degradPct,
        cycleCount,
    ) {
        BatteryTabStrings(
            healthScore = healthScore,
            capacity = capacity,
            degradation = degradation,
            estRange = estRange,
            cycles = cycles,
            healthTimeline = healthTimeline,
            capacityTrend = capacityTrend,
            rangeTrend = rangeTrend,
            degradationCycles = degradationCycles,
            healthSeries = healthSeries,
            rangeSeries = rangeSeries,
            degradPct = degradPct,
            cycleCount = cycleCount,
        )
    }
}

// ── Previews (tooling-only; one @Preview entry per rendered state) ──────────────────────────────────

private val PREVIEW_TREND =
    listOf(
        BatteryTrendPoint("2026-01-01", 99.2, 75_000.0, 0.80, 480.0, 120.0),
        BatteryTrendPoint("2026-02-01", 98.6, 74_200.0, 1.40, 470.0, 138.0),
        BatteryTrendPoint("2026-03-01", 98.1, 73_800.0, 1.90, 462.0, 151.0),
        BatteryTrendPoint("2026-04-01", 97.7, 73_100.0, 2.30, 455.0, 167.0),
    )

@Preview(name = "BatteryTab · content", showBackground = true)
@Composable
private fun BatteryTabContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryTabContent(state = UiState(UiPhase.Content, data = PREVIEW_TREND, fetchedAt = 1L), onRetry = {})
    }
}

@Preview(name = "BatteryTab · empty", showBackground = true)
@Composable
private fun BatteryTabEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryTabContent(state = UiState(UiPhase.Empty, data = emptyList()), onRetry = {})
    }
}

@Preview(name = "BatteryTab · loading", showBackground = true)
@Composable
private fun BatteryTabLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryTabContent(state = UiState.loading(), onRetry = {})
    }
}

@Preview(name = "BatteryTab · error", showBackground = true)
@Composable
private fun BatteryTabErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryTabContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = {})
    }
}

@Preview(name = "BatteryTab · offline (cached)", showBackground = true)
@Composable
private fun BatteryTabOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryTabContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_TREND,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
        )
    }
}
