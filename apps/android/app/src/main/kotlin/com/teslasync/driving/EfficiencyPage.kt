// The native Jetpack Compose + Material 3 EfficiencyPage driving surface — a parity port of
// web/src/features/driving/pages/EfficiencyPage.tsx, the energy-consumption / driving-efficiency dashboard. It
// reproduces the page's thirteen panels (the hero radial gauge + three count-up tiles, the four efficiency stat cards
// with their no-stats fallback, the daily-efficiency area chart, the efficiency-by-speed-range bar chart, the
// speed-vs-efficiency and temperature-vs-efficiency scatter plots, the temperature-bucketed table, the metric-bars
// summary and the energy-insights grid), every data state (loading / empty / error / success, plus the
// cache-then-network stale/offline tier the bound state holders carry), and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [EfficiencyPage] is the stateful entry (constructs the view-model over the host-wired source, records the
// one-shot `view.opened` diagnostic, collects the drives + stats feeds + the live display prefs + the date range);
// [EfficiencyPageContent] is the stateless render layer. The `useDrives` feed (date-range filtered) is folded by the
// framework-free model (deriveEfficiencyData) into the chart/table series, while the decoded `useDrivingStats` aggregate
// drives the gauges, stat cards, metric bars and insights — exactly as the web page threads its hooks through its
// `useMemo` chain. SI values are converted to the user's units only here at the display boundary via the model's prefs
// helpers (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete panel set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
    "LargeClass",
    "LongParameterList",
)

package io.teslasync.android.driving.efficiency

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The `$` cost prefix the web renders as a literal (never i18n) and the `kg` / `%` unit suffixes. */
private const val CURRENCY_PREFIX = "$"
private const val PERCENT_SUFFIX = "%"
private const val KG_SUFFIX = "kg"
private const val PER_KWH_SUFFIX = "/kWh"

/** Hero count-up precision (web `AnimatedNumber decimals`). */
private const val KM_PER_KWH_DECIMALS = 1

/** Helper-text precision for the drive-time + regen energy figures (web `{ precision: 1 }`). */
private const val SUMMARY_PRECISION = 1

private val SCATTER_HEIGHT = 220.dp
private const val GAUGE_WEIGHT = 1f

/** The temperature-bucket range column is slightly wider than the numeric columns (web first-column emphasis). */
private const val RANGE_COL_WEIGHT = 1.4f

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [EfficiencyPageViewModel] over the supplied [source] (the host wires the shared
 * Driving repository + the active-vehicle selection + the shared settings holder via [efficiencyPageSourceOf]).
 * [logger] defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live
 * state to the content.
 */
@Composable
fun EfficiencyPage(
    source: EfficiencyPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: EfficiencyPageViewModel =
        viewModel(
            key = EfficiencyPageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { EfficiencyPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val drives by viewModel.drivesState.collectAsStateWithLifecycle()
    val stats by viewModel.statsState.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val range by viewModel.dateRange.collectAsStateWithLifecycle()

    EfficiencyPageContent(
        drives = drives,
        stats = stats,
        prefs = prefs,
        range = range,
        onRangeChange = viewModel::setDateRange,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker + the date-range
 * filter + the stale/offline banner), then a centered loader on a first load, a retryable error panel on a hard
 * failure of both feeds, or the loaded panels otherwise. Each panel renders its own content-or-empty surface so no
 * section is ever hidden (web per-section truthiness guards).
 */
@Composable
fun EfficiencyPageContent(
    drives: UiState<List<Drive>>,
    stats: UiState<EfficiencyStats>,
    prefs: EfficiencyDisplayPrefs,
    range: EfficiencyDateRange,
    onRangeChange: (Long?, Long?) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        EfficiencyChrome(drives = drives, range = range, onRangeChange = onRangeChange)

        when {
            stats.isLoading && drives.isLoading -> EfficiencyLoading()
            stats.isError && drives.isError -> EfficiencyError(onRetry = onRetry)
            else ->
                EfficiencyBody(
                    drives = drives.data.orEmpty(),
                    stats = stats.data ?: EfficiencyStats.EMPTY,
                    prefs = prefs,
                    range = range,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the scope picker, the range filter, and the stale banner. */
@Composable
private fun EfficiencyChrome(
    drives: UiState<List<Drive>>,
    range: EfficiencyDateRange,
    onRangeChange: (Long?, Long?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_efficiency_title))
                BodyText(
                    stringResource(R.string.translation_efficiency_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = drives.fetchedAt,
                isFetching = drives.refreshing,
                isStale = drives.stale,
                isError = drives.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        VehicleSelect(withIcon = true)
        DateRangeFilter(
            startEpochDay = range.startEpochDay,
            endEpochDay = range.endEpochDay,
            onRangeChange = onRangeChange,
        )
        if (drives.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun EfficiencyLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun EfficiencyError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun EfficiencyBody(
    drives: List<Drive>,
    stats: EfficiencyStats,
    prefs: EfficiencyDisplayPrefs,
    range: EfficiencyDateRange,
) {
    val data =
        remember(drives, prefs, range) {
            deriveEfficiencyData(drives, prefs, range.startEpochDay, range.endEpochDay)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { HeroPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { StatCardsSection(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { DailyTrendPanel(data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { SpeedRangePanel(data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { SpeedScatterPanel(data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { TempScatterPanel(data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { TempBucketPanel(data, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { SummaryPanel(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 8) { InsightsPanel(stats, prefs) }
    }
}

// ── Panel 1 — Hero gauges (GlassPanel1) ─────────────────────────────────────────────────────────────────────────

/** GlassPanel1 — the average-consumption radial gauge plus the km/kWh, CO₂-saved and total-distance count-up tiles. */
@Composable
private fun HeroPanel(
    stats: EfficiencyStats,
    prefs: EfficiencyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        if (stats.hasData) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                HeroCell(modifier = Modifier.weight(GAUGE_WEIGHT)) {
                    RadialGauge(
                        value = prefs.toEfficiency(stats.avgEfficiencyWhKm),
                        max = EFFICIENCY_GAUGE_MAX,
                        label = "${stringResource(R.string.translation_efficiency_avg)} ${prefs.efficiencyUnit}",
                        color = tierColor(efficiencyTier(stats.avgEfficiencyWhKm)),
                    )
                }
                HeroValueCell(modifier = Modifier.weight(GAUGE_WEIGHT)) {
                    AnimatedNumber(value = efficiencyKmPerKwhValue(stats), decimals = KM_PER_KWH_DECIMALS, locale = prefs.locale)
                    MetricLabel(stringResource(R.string.translation_efficiency_kmPerKwh))
                }
                HeroValueCell(modifier = Modifier.weight(GAUGE_WEIGHT)) {
                    AnimatedNumber(value = stats.co2SavedKg, locale = prefs.locale)
                    MetricLabel(stringResource(R.string.translation_efficiency_co2Saved))
                }
                HeroValueCell(modifier = Modifier.weight(GAUGE_WEIGHT)) {
                    AnimatedNumber(value = prefs.toDistance(stats.totalDistanceKm), locale = prefs.locale)
                    MetricLabel("${stringResource(R.string.translation_efficiency_totalDistance)} ${prefs.distanceLabel}")
                }
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_efficiency_noStats))
        }
    }
}

// ── Panels 2-6 — Efficiency stat cards (GlassPanel2-5) + the no-stats fallback (GlassPanel6) ─────────────────────

/** GlassPanel2-5 — the avg-consumption / avg-speed / est-cost / drives-analyzed cards, or GlassPanel6's no-stats panel. */
@Composable
private fun StatCardsSection(
    stats: EfficiencyStats,
    prefs: EfficiencyDisplayPrefs,
) {
    if (stats.hasData) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = "${stringResource(R.string.translation_efficiency_avgConsumption)} ${prefs.efficiencyUnit}",
                    value = prefs.number(prefs.toEfficiency(stats.avgEfficiencyWhKm)),
                    icon = EfficiencyGlyphs.Zap,
                    accent = TeslaTokens.chart.energy,
                )
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = "${stringResource(R.string.translation_efficiency_avgSpeed)} ${prefs.speedLabel}",
                    value = prefs.number(prefs.toSpeed(stats.avgSpeedKmh)),
                    icon = EfficiencyGlyphs.TrendingUp,
                    accent = TeslaTokens.chart.battery,
                )
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_efficiency_costPerKm),
                    value = CURRENCY_PREFIX + efficiencyCostPerKm(stats, prefs),
                    icon = EfficiencyGlyphs.Fuel,
                    accent = TeslaTokens.chart.regen,
                )
                MetricCard(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_efficiency_drivesAnalyzed),
                    value = prefs.integer(stats.totalDrives * 1.0),
                    icon = EfficiencyGlyphs.Gauge,
                    accent = TeslaTokens.chart.power,
                )
            }
        }
    } else {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            EmptyState(message = stringResource(R.string.translation_efficiency_noStatCards))
        }
    }
}

// ── Panel 7 — Daily-efficiency area chart (efficiency-dailyTrend) ────────────────────────────────────────────────

/** efficiency-dailyTrend — the daily-efficiency area chart, or the empty state when fewer than three trend points. */
@Composable
private fun DailyTrendPanel(
    data: EfficiencyChartData,
    prefs: EfficiencyDisplayPrefs,
) {
    val ready = data.dailyTrend.size > EfficiencyPageRegistration.MIN_TREND_POINTS
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_efficiency_dailyTrend, prefs.efficiencyUnit),
        accessibleDescription = stringResource(R.string.translation_efficiency_dailyTrend_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_common_noData),
        dataTableHeader = listOf(stringResource(R.string.translation_efficiency_col_date), prefs.efficiencyUnit),
        dataTableRows = data.dailyTrend.map { listOf(it.label, prefs.integer(it.efficiency)) },
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "efficiency",
                        label = prefs.efficiencyUnit,
                        values = data.dailyTrend.map { it.efficiency },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.regen,
                    ),
                ),
            xLabels = data.dailyTrend.map { it.label },
            yValueFormatter = { prefs.integer(it) },
        )
    }
}

// ── Panel 8 — Efficiency-by-speed-range bar chart (Efficiency-by-Speed-Range) ───────────────────────────────────

/** Efficiency-by-Speed-Range — the avg-efficiency-per-speed-bucket bar chart, or the empty state when no buckets fill. */
@Composable
private fun SpeedRangePanel(
    data: EfficiencyChartData,
    prefs: EfficiencyDisplayPrefs,
) {
    val ready = data.speedDistribution.isNotEmpty()
    val avgLabel = "${stringResource(R.string.translation_efficiency_avg)} ${prefs.efficiencyUnit}"
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_efficiency_speedDist),
        accessibleDescription = stringResource(R.string.translation_efficiency_speedDist_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_common_noData),
        dataTableHeader = listOf(stringResource(R.string.translation_efficiency_col_range), avgLabel),
        dataTableRows = data.speedDistribution.map { listOf(it.range, prefs.integer(it.avgEfficiency)) },
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "avgEff",
                        label = avgLabel,
                        values = data.speedDistribution.map { it.avgEfficiency },
                        kind = ChartSeriesKind.Bar,
                        color = TeslaTokens.chart.regen,
                    ),
                ),
            xLabels = data.speedDistribution.map { it.range },
            yValueFormatter = { prefs.integer(it) },
        )
    }
}

// ── Panel 9 — Speed-vs-efficiency scatter (Speed-vs-Efficiency) ──────────────────────────────────────────────────

/** Speed-vs-Efficiency — the per-drive speed-vs-efficiency scatter, or the empty state below four points. */
@Composable
private fun SpeedScatterPanel(
    data: EfficiencyChartData,
    prefs: EfficiencyDisplayPrefs,
) {
    val ready = data.speedVsEfficiency.size > EfficiencyPageRegistration.MIN_SCATTER_POINTS
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_efficiency_speedVsEfficiency),
        accessibleDescription = stringResource(R.string.translation_efficiency_speedVsEfficiency_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        EfficiencyScatterChart(
            points = data.speedVsEfficiency.map { EfficiencyScatterPoint(it.speed, it.efficiency) },
            pointColor = TeslaTokens.chart.energy,
            height = SCATTER_HEIGHT,
            xUnit = prefs.speedLabel,
            yUnit = prefs.efficiencyUnit,
            xAxisName = stringResource(R.string.translation_efficiency_speed),
            yAxisName = prefs.efficiencyUnit,
            locale = prefs.locale,
        )
    }
}

// ── Panel 10 — Temperature-vs-efficiency scatter (Temperature-vs-Efficiency) ─────────────────────────────────────

/** Temperature-vs-Efficiency — the per-drive temperature-vs-efficiency scatter, or the empty state below four points. */
@Composable
private fun TempScatterPanel(
    data: EfficiencyChartData,
    prefs: EfficiencyDisplayPrefs,
) {
    val ready = data.tempVsEfficiency.size > EfficiencyPageRegistration.MIN_SCATTER_POINTS
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_efficiency_tempVsEfficiency),
        accessibleDescription = stringResource(R.string.translation_efficiency_tempVsEfficiency_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        EfficiencyScatterChart(
            points = data.tempVsEfficiency.map { EfficiencyScatterPoint(it.temp, it.efficiency) },
            pointColor = TeslaTokens.chart.power,
            height = SCATTER_HEIGHT,
            xUnit = prefs.temperatureLabel,
            yUnit = prefs.efficiencyUnit,
            xAxisName = stringResource(R.string.translation_efficiency_temp),
            yAxisName = prefs.efficiencyUnit,
            locale = prefs.locale,
        )
    }
}

// ── Panel 11 — Temperature-bucketed table (GlassPanel11) ────────────────────────────────────────────────────────

/** GlassPanel11 — the per-temperature-range efficiency table, or the not-enough-data empty state. */
@Composable
private fun TempBucketPanel(
    data: EfficiencyChartData,
    prefs: EfficiencyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(EfficiencyGlyphs.Thermometer, contentDescription = null, tint = TeslaTokens.chart.energy, size = IconSize.Sm)
            SectionTitle(stringResource(R.string.translation_efficiency_tempEfficiency))
        }
        Spacer(Modifier.height(Spacing.md))
        if (data.tempBuckets.isNotEmpty()) {
            DataTable(
                columns = tempBucketColumns(prefs),
                rows = data.tempBuckets,
                keyOf = { it.range },
                emptyText = stringResource(R.string.translation_efficiency_noTempData),
            )
        } else {
            EmptyState(message = stringResource(R.string.translation_efficiency_noTempData))
        }
    }
}

/** The six temperature-bucket columns (web `DataTable columns`): range, drives, avg efficiency, km/kWh, total distance, avg speed. */
@Composable
private fun tempBucketColumns(prefs: EfficiencyDisplayPrefs): List<TableColumn<TempBucketRow>> =
    listOf(
        TableColumn(
            key = "range",
            header = stringResource(R.string.translation_efficiency_tempRange),
            weight = RANGE_COL_WEIGHT,
            cell = { BodyText(it.range) },
        ),
        TableColumn(
            key = "count",
            header = stringResource(R.string.translation_efficiency_drives),
            alignEnd = true,
            cell = { BodyText(prefs.integer(it.count * 1.0), color = MaterialTheme.colorScheme.onSurfaceVariant) },
        ),
        TableColumn(
            key = "avgEff",
            header = "${stringResource(R.string.translation_efficiency_avg)} ${prefs.efficiencyUnit}",
            alignEnd = true,
            cell = {
                BodyText(
                    prefs.integer(prefs.toEfficiency(it.avgEfficiencyWhKm)),
                    color = tierColor(efficiencyTier(it.avgEfficiencyWhKm)),
                )
            },
        ),
        TableColumn(
            key = "kmPerKwh",
            header = "${prefs.distanceLabel}$PER_KWH_SUFFIX",
            alignEnd = true,
            cell = { BodyText(tempBucketKmPerKwh(it, prefs), color = TeslaTokens.chart.regen) },
        ),
        TableColumn(
            key = "totalDist",
            header = "${stringResource(R.string.translation_efficiency_total)} ${prefs.distanceLabel}",
            alignEnd = true,
            cell = {
                BodyText(prefs.integer(prefs.toDistance(it.totalDistanceDisplay)), color = MaterialTheme.colorScheme.onSurfaceVariant)
            },
        ),
        TableColumn(
            key = "avgSpeed",
            header = stringResource(R.string.translation_efficiency_avgSpeedCol),
            alignEnd = true,
            cell = {
                BodyText(
                    "${prefs.integer(prefs.toSpeed(it.avgSpeedDisplay))} ${prefs.speedLabel}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
        ),
    )

// ── Panel 12 — Metric-bars summary (GlassPanel12) ───────────────────────────────────────────────────────────────

/** GlassPanel12 — the avg-consumption / avg-speed / regen-ratio / drive-time metric bars, or the no-summary empty state. */
@Composable
private fun SummaryPanel(
    stats: EfficiencyStats,
    prefs: EfficiencyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        if (stats.hasData) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(EfficiencyGlyphs.Zap, contentDescription = null, tint = TeslaTokens.chart.energy, size = IconSize.Sm)
                SectionTitle(stringResource(R.string.translation_efficiency_summary))
            }
            Spacer(Modifier.height(Spacing.md))
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Column {
                    MetricBar(
                        value = prefs.toEfficiency(stats.avgEfficiencyWhKm),
                        max = CONSUMPTION_BAR_MAX,
                        label = stringResource(R.string.translation_efficiency_avgConsumption),
                        color = TeslaTokens.chart.regen,
                    )
                    HelperText("${prefs.number(prefs.toEfficiency(stats.avgEfficiencyWhKm))} ${prefs.efficiencyUnit}")
                }
                Column {
                    MetricBar(
                        value = prefs.toSpeed(stats.avgSpeedKmh),
                        max = SPEED_BAR_MAX,
                        label = stringResource(R.string.translation_efficiency_avgSpeed),
                        color = TeslaTokens.chart.battery,
                    )
                    HelperText("${prefs.integer(prefs.toSpeed(stats.avgSpeedKmh))} ${prefs.speedLabel}")
                }
                Column {
                    MetricBar(
                        value = efficiencyRegenPercent(stats),
                        max = REGEN_BAR_MAX,
                        label = stringResource(R.string.translation_efficiency_regenRatio),
                        color = TeslaTokens.chart.power,
                    )
                    HelperText("${prefs.number(efficiencyRegenPercent(stats))}$PERCENT_SUFFIX")
                }
                Column {
                    MetricBar(
                        value = stats.totalDurationS,
                        max = efficiencyDriveTimeMax(stats),
                        label = stringResource(R.string.translation_efficiency_totalDriveTime),
                        color = TeslaTokens.chart.energy,
                    )
                    HelperText(prefs.formatDuration(stats.totalDurationS, SUMMARY_PRECISION))
                }
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_efficiency_noSummary))
        }
    }
}

// ── Panel 13 — Energy insights grid (GlassPanel13) ──────────────────────────────────────────────────────────────

/** GlassPanel13 — the six energy-insight figures (total regen, regen ratio, CO₂, distance, top speed, cost), or the empty state. */
@Composable
private fun InsightsPanel(
    stats: EfficiencyStats,
    prefs: EfficiencyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        if (stats.hasData) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(EfficiencyGlyphs.Thermometer, contentDescription = null, tint = TeslaTokens.chart.energy, size = IconSize.Sm)
                SectionTitle(stringResource(R.string.translation_efficiency_insights))
            }
            Spacer(Modifier.height(Spacing.md))
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    InsightCell(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_efficiency_totalRegen),
                        value = prefs.formatEnergy(stats.regenEnergyWh, SUMMARY_PRECISION),
                        color = TeslaTokens.status.success,
                    )
                    InsightCell(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_efficiency_regenRatioLabel),
                        value = "${prefs.number(efficiencyRegenPercent(stats))}$PERCENT_SUFFIX",
                        color = TeslaTokens.chart.regen,
                    )
                    InsightCell(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_efficiency_co2Label),
                        value = "${prefs.integer(stats.co2SavedKg)} $KG_SUFFIX",
                        color = TeslaTokens.status.success,
                    )
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    InsightCell(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_efficiency_totalDistLabel),
                        value = "${prefs.integer(prefs.toDistance(stats.totalDistanceKm))} ${prefs.distanceLabel}",
                        color = TeslaTokens.chart.regen,
                    )
                    InsightCell(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_efficiency_topSpeed),
                        value = "${prefs.integer(prefs.toSpeed(stats.topSpeedKmh))} ${prefs.speedLabel}",
                        color = TeslaTokens.chart.power,
                    )
                    InsightCell(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_efficiency_costPerKmLabel),
                        value = CURRENCY_PREFIX + efficiencyCostPerKm(stats, prefs),
                        color = TeslaTokens.chart.energy,
                    )
                }
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_efficiency_noInsights))
        }
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A centered hero gauge cell (web hero gauge column): centered in its weighted slot. */
@Composable
private fun HeroCell(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        content = content,
    )
}

/** A centered hero count-up tile (web hero value column): a count-up number over its muted label. */
@Composable
private fun HeroValueCell(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        content = content,
    )
}

/** A single energy-insight figure (web insight cell): a muted label over a colored value. */
@Composable
private fun InsightCell(
    label: String,
    value: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        BodyText(value, color = color)
    }
}

/** Maps an [EfficiencyTier] to its design-token color (web `efficiencyColor`; ADR-005 — no hardcoded hex). */
@Composable
private fun tierColor(tier: EfficiencyTier): Color =
    when (tier) {
        EfficiencyTier.Excellent -> TeslaTokens.status.success
        EfficiencyTier.Good -> TeslaTokens.chart.battery
        EfficiencyTier.Fair -> TeslaTokens.chart.regen
        EfficiencyTier.Poor -> TeslaTokens.chart.energy
        EfficiencyTier.Bad -> TeslaTokens.chart.temperature
    }
