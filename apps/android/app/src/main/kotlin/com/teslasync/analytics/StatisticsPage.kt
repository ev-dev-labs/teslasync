// The native Jetpack Compose + Material 3 StatisticsPage analytics surface — a parity port of
// web/src/features/analytics/pages/StatisticsPage.tsx, the lifetime vehicle-statistics & records dashboard. It
// reproduces the page's twenty panels (five period stat-cards, three averages, the battery-health panel with its
// radial gauge + four metrics, the state-distribution pie, the mileage-summary panel with its four metrics, and the
// fleet vehicle-comparison bar chart), every data state (loading / empty / error / success, plus the
// cache-then-network stale/offline tier), and every visible string (resolved from the generated res/values catalog
// `statistics.*`, ADR-014).
//
// Composition: [StatisticsPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the six feeds + the live display preferences);
// [StatisticsPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip / vehicle
// scope picker — then the loading / error / empty / loaded body). The loaded body draws every panel from the decoded
// models; all decode + formatting lives in the framework-free model (StatisticsPageModel.kt), so this file only
// resolves i18n + draws. SI values are converted to the user's units only here at the display boundary via the model's
// `prefs.fromKm`/`whPerKmToDisplay`/`currency`/`number` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.analytics.statistics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Battery state-of-health gauge ceiling (web `RadialGauge max={100}`). */
private const val SOH_MAX = 100.0

/** Hard-coded unit symbols the web reads as literals (never i18n): `kWh` / `kg` / `%`, plus the `%/yr` + `mo` suffixes. */
private const val ENERGY_UNIT = "kWh"
private const val CO2_UNIT = "kg"
private const val PERCENT_UNIT = "%"
private const val PER_YEAR_SUFFIX = "%/yr"
private const val MONTHS_SUFFIX = "mo"

/** The em dash shown for a missing cost-per-km value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Decimals for the battery capacity / degradation figures (web `fmtNumber(value, 1)` / `(value, 2)`). */
private const val CAPACITY_DECIMALS = 1
private const val DEGRADATION_DECIMALS = 2

/** Cost-per-km precision (web `formatCurrency(value, 3)`). */
private const val COST_PER_KM_DECIMALS = 3

/** Zero-decimal currency for the total-cost card (web `formatCurrency(total_cost, 0)`). */
private const val COST_DECIMALS = 0

/** Palette index per metric card so the accents stay visually distinct yet theme-aware (web per-card colors). */
private const val ACCENT_CYAN = 0
private const val ACCENT_GREEN = 1
private const val ACCENT_AMBER = 2
private const val ACCENT_RED = 3
private const val ACCENT_PURPLE = 4

private val GAUGE_SIZE = 140.dp
private val PIE_SIZE = 168.dp
private val PIE_RING = 30.dp
private val LEGEND_DOT = 10.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [StatisticsPageViewModel] over the supplied [source] (the host wires the page-local
 * period-stats repository + the shared Energy/Analytics/Settings holders + the active-vehicle selection via
 * [statisticsPageSourceOf]). [logger] defaults to the app's redacting logger. Records the one-shot `view.opened`
 * diagnostic and binds the live state to the content.
 */
@Composable
fun StatisticsPage(
    source: StatisticsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: StatisticsPageViewModel =
        viewModel(
            key = StatisticsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { StatisticsPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val battery by viewModel.battery.collectAsStateWithLifecycle()
    val mileage by viewModel.mileage.collectAsStateWithLifecycle()
    val states by viewModel.states.collectAsStateWithLifecycle()
    val comparison by viewModel.comparison.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    StatisticsPageContent(
        state = state,
        battery = battery,
        mileage = mileage,
        states = states,
        comparison = comparison,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker), then
 * the period-stats-gated body — a centered loader on a first load, a retryable error panel on a hard failure, a
 * `noData` empty-state when no totals have accrued, or the loaded panels otherwise. The secondary panels each render
 * their own content-or-empty surface so no section is ever hidden.
 */
@Composable
fun StatisticsPageContent(
    state: UiState<StatisticsPeriodStats>,
    battery: UiState<StatisticsBatteryHealth>,
    mileage: UiState<StatisticsMileage>,
    states: UiState<List<StatisticsStateShare>>,
    comparison: UiState<List<StatisticsVehicleComparison>>,
    prefs: StatisticsDisplayPrefs,
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
        StatisticsChrome(state = state)

        when {
            state.isLoading -> StatisticsLoading()
            state.isError -> StatisticsError(onRetry = onRetry)
            state.isEmpty -> StatisticsNoData()
            else ->
                StatisticsBody(
                    stats = state.data ?: StatisticsPeriodStats.EMPTY,
                    battery = battery,
                    mileage = mileage,
                    states = states,
                    comparison = comparison,
                    prefs = prefs,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer` title/subtitle), the freshness chip, and the scope picker. */
@Composable
private fun StatisticsChrome(state: UiState<StatisticsPeriodStats>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_statistics_title))
                BodyText(
                    stringResource(R.string.translation_statistics_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // web `DataFreshnessAuto` — the period-stats freshness chip.
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `<Select … />` over the fleet — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading` ▸ skeleton). */
@Composable
private fun StatisticsLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun StatisticsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-data surface — the web `<EmptyState … noData />` shown when no statistics exist for the scope. */
@Composable
private fun StatisticsNoData() {
    EmptyState(
        message = stringResource(R.string.translation_statistics_noDataMsg),
        title = stringResource(R.string.translation_statistics_noData),
        icon = StatisticsGlyphs.Chart,
    )
}

/** The loaded body — the twenty panels in their web order, each entering with a staggered fade. */
@Composable
private fun StatisticsBody(
    stats: StatisticsPeriodStats,
    battery: UiState<StatisticsBatteryHealth>,
    mileage: UiState<StatisticsMileage>,
    states: UiState<List<StatisticsStateShare>>,
    comparison: UiState<List<StatisticsVehicleComparison>>,
    prefs: StatisticsDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { PeriodStatsGrid(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { AveragesGrid(stats, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { BatteryPanel(battery, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { StateDistributionPanel(states) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { MileagePanel(mileage, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { VehicleComparisonPanel(comparison, prefs) }
    }
}

// ── Panels 1-5 — Period stat cards ────────────────────────────────────────────────────────────────────────────

/** Total-Distance / Total-Drives / Total-Energy / Total-Cost / CO₂-Saved — the web 5-up `<MetricCard>` grid. */
@Composable
private fun PeriodStatsGrid(
    stats: StatisticsPeriodStats,
    prefs: StatisticsDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_totalDistance),
                value = "${prefs.integer(prefs.fromKm(stats.totalDistanceKm))} ${prefs.distanceLabel}",
                icon = StatisticsGlyphs.MapPin,
                accentIndex = ACCENT_CYAN,
            )
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_totalDrives),
                value = prefs.integer(stats.totalDrives),
                icon = StatisticsGlyphs.TrendingUp,
                accentIndex = ACCENT_GREEN,
            )
        }
        MetricRow {
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_totalEnergy),
                value = "${prefs.number(stats.energyUsedKwh)} $ENERGY_UNIT",
                icon = StatisticsGlyphs.Bolt,
                accentIndex = ACCENT_AMBER,
            )
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_totalCost),
                value = prefs.currency(stats.totalCost, COST_DECIMALS),
                icon = StatisticsGlyphs.DollarSign,
                accentIndex = ACCENT_RED,
            )
        }
        MetricRow {
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_co2Saved),
                value = "${prefs.number(stats.co2SavedKg)} $CO2_UNIT",
                icon = StatisticsGlyphs.Leaf,
                accentIndex = ACCENT_GREEN,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

// ── Panels 6-8 — Averages ─────────────────────────────────────────────────────────────────────────────────────

/** Avg-Drive-Distance / Avg-Efficiency / Cost-per-km — the web averages `<MetricCard>` grid. */
@Composable
private fun AveragesGrid(
    stats: StatisticsPeriodStats,
    prefs: StatisticsDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_avgDriveDistance),
                value = "${prefs.number(prefs.fromKm(stats.avgDriveDistanceKm))} ${prefs.distanceLabel}",
                icon = StatisticsGlyphs.MapPin,
                accentIndex = ACCENT_CYAN,
            )
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_avgEfficiency),
                value = "${prefs.number(prefs.whPerKmToDisplay(stats.avgEfficiencyWhKm))} ${prefs.efficiencyUnit}",
                icon = StatisticsGlyphs.Gauge,
                accentIndex = ACCENT_GREEN,
            )
        }
        MetricRow {
            StatMetric(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_statistics_costPerKm),
                value = stats.costPerKm?.let { prefs.currency(it, COST_PER_KM_DECIMALS) } ?: EM_DASH,
                icon = StatisticsGlyphs.DollarSign,
                accentIndex = ACCENT_AMBER,
            )
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

// ── Panel 9 — Battery health (+ panels 10-13 + the radial gauge) ────────────────────────────────────────────────

/** GlassPanel9 — the battery-health panel: the SoH radial gauge + Capacity/Degradation/Cycles/Age, or an empty-state. */
@Composable
private fun BatteryPanel(
    battery: UiState<StatisticsBatteryHealth>,
    prefs: StatisticsDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_statistics_batteryHealth))
        Spacer(modifier = Modifier.height(Spacing.md))
        val data = battery.data
        if (battery.isContent && data != null) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    RadialGauge(
                        value = data.currentSoh,
                        max = SOH_MAX,
                        label = stringResource(R.string.translation_statistics_health),
                        unit = PERCENT_UNIT,
                        color = TeslaTokens.status.success,
                        size = GAUGE_SIZE,
                    )
                }
                MetricRow {
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_capacity),
                        value = "${prefs.number(data.estimatedCapacityKwh, CAPACITY_DECIMALS)} $ENERGY_UNIT",
                        icon = StatisticsGlyphs.Battery,
                        accentIndex = ACCENT_CYAN,
                    )
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_degradation),
                        value = "${prefs.number(data.degradationRateYr, DEGRADATION_DECIMALS)}$PER_YEAR_SUFFIX",
                        icon = StatisticsGlyphs.TrendingUp,
                        accentIndex = ACCENT_AMBER,
                    )
                }
                MetricRow {
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_cycles),
                        value = prefs.integer(data.totalCycles),
                        icon = StatisticsGlyphs.Refresh,
                        accentIndex = ACCENT_PURPLE,
                    )
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_age),
                        value = "${data.batteryAgeMonths} $MONTHS_SUFFIX",
                        icon = StatisticsGlyphs.Clock,
                        accentIndex = ACCENT_GREEN,
                    )
                }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_statistics_noBattery),
                icon = StatisticsGlyphs.Battery,
            )
        }
    }
}

// ── Panel 14 — State distribution (pie + chart container) ───────────────────────────────────────────────────────

/** State-Distribution — the web pie `<ChartContainer>`: the donut + legend, or the `noStates` empty-state. */
@Composable
private fun StateDistributionPanel(states: UiState<List<StatisticsStateShare>>) {
    val shares = states.data.orEmpty()
    val ready = states.isContent && shares.isNotEmpty()
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_statistics_stateDistribution),
        accessibleDescription = stringResource(R.string.translation_statistics_stateDistribution_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_statistics_noStates),
    ) {
        StateDistributionChart(shares = shares)
    }
}

/** The page-local Compose-canvas donut + legend (the A3 chart library carries no pie wrapper). */
@Composable
private fun StateDistributionChart(shares: List<StatisticsStateShare>) {
    val colors = remember(shares) { shares.map { paletteColor(it.colorIndex) } }
    val totalPercent = remember(shares) { shares.sumOf { it.percent }.toFloat().coerceAtLeast(1f) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.size(PIE_SIZE)) {
                val strokePx = PIE_RING.toPx()
                val diameter = size.minDimension - strokePx
                val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
                val arcSize = Size(diameter, diameter)
                var startAngle = PIE_START_ANGLE
                shares.forEachIndexed { index, share ->
                    val sweep = share.percent / totalPercent * PIE_FULL_SWEEP
                    drawArc(
                        color = colors.getOrElse(index) { Color.Gray },
                        startAngle = startAngle,
                        sweepAngle = sweep,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = strokePx),
                    )
                    startAngle += sweep
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            shares.forEachIndexed { index, share ->
                LegendRow(color = colors.getOrElse(index) { Color.Gray }, label = "${share.state} ${share.percent}$PERCENT_UNIT")
            }
        }
    }
}

/** One legend row — a color swatch + the state name and its percentage. */
@Composable
private fun LegendRow(
    color: Color,
    label: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(color))
        Caption(label)
    }
}

// ── Panel 15 — Mileage summary (+ panels 16-19) ─────────────────────────────────────────────────────────────────

/** GlassPanel15 — the mileage-summary panel: Total-Distance / Daily-Average / Total-Drives / Yearly-Projection. */
@Composable
private fun MileagePanel(
    mileage: UiState<StatisticsMileage>,
    prefs: StatisticsDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_statistics_mileage))
        Spacer(modifier = Modifier.height(Spacing.md))
        val data = mileage.data
        if (mileage.isContent && data != null) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                MetricRow {
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_totalMileage),
                        value = "${prefs.integer(prefs.fromKm(data.lifetimeKm))} ${prefs.distanceLabel}",
                        icon = StatisticsGlyphs.MapPin,
                        accentIndex = ACCENT_CYAN,
                    )
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_dailyAvg),
                        value = "${prefs.number(prefs.fromKm(data.dailyAvgKm))} ${prefs.distanceLabel}",
                        icon = StatisticsGlyphs.Car,
                        accentIndex = ACCENT_GREEN,
                    )
                }
                MetricRow {
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_totalDrives),
                        value = prefs.integer(data.driveCountLifetime),
                        icon = StatisticsGlyphs.Clock,
                        accentIndex = ACCENT_PURPLE,
                    )
                    StatMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_statistics_yearlyProjection),
                        value = "${prefs.integer(prefs.fromKm(data.yearlyProjectionKm))} ${prefs.distanceLabel}",
                        icon = StatisticsGlyphs.TrendingUp,
                        accentIndex = ACCENT_AMBER,
                    )
                }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_statistics_noMileage),
                icon = StatisticsGlyphs.Car,
            )
        }
    }
}

// ── Panel 20 — Vehicle comparison (bar + chart container) ───────────────────────────────────────────────────────

/** Vehicle-Comparison — the web fleet bar `<ChartContainer>`: distance + energy per vehicle, or the `singleVehicle` empty-state. */
@Composable
private fun VehicleComparisonPanel(
    comparison: UiState<List<StatisticsVehicleComparison>>,
    prefs: StatisticsDisplayPrefs,
) {
    val rows = comparison.data.orEmpty()
    val ready = comparison.isContent && rows.size > 1
    val distanceLabel = "${stringResource(R.string.translation_statistics_distance)} (${prefs.distanceLabel})"
    val energyLabel = stringResource(R.string.translation_statistics_energy)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_statistics_vehicleComparison),
        accessibleDescription = stringResource(R.string.translation_statistics_vehicleComparison_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_statistics_singleVehicle),
        dataTableHeader = if (ready) listOf("", distanceLabel, energyLabel) else null,
        dataTableRows =
            if (ready) {
                rows.map {
                    listOf(
                        it.name,
                        prefs.number(prefs.fromKm(it.distanceKm), 0),
                        prefs.number(it.energyKwh, 0),
                    )
                }
            } else {
                null
            },
    ) {
        val series =
            listOf(
                ChartSeries(
                    key = "distance",
                    label = distanceLabel,
                    values = rows.map { prefs.fromKm(it.distanceKm) },
                    kind = ChartSeriesKind.Bar,
                    color = paletteColor(ACCENT_CYAN),
                ),
                ChartSeries(
                    key = "energy",
                    label = energyLabel,
                    values = rows.map { it.energyKwh },
                    kind = ChartSeriesKind.Bar,
                    color = paletteColor(ACCENT_GREEN),
                ),
            )
        BarChartWrapper(
            series = series,
            xLabels = rows.map { it.name },
            yValueFormatter = { ChartFormat.number(it, 0, prefs.locale) },
        )
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-up metric row (the phone-width grid cell the web `grid-cols-2` collapses to). */
@Composable
private fun MetricRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** A [MetricCard] whose accent resolves from the theme-aware chart palette by [accentIndex] (web per-card color). */
@Composable
private fun StatMetric(
    label: String,
    value: String,
    icon: ImageVector,
    accentIndex: Int,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        modifier = modifier,
        label = label,
        value = value,
        icon = icon,
        accent = paletteColor(accentIndex),
    )
}

private const val PIE_START_ANGLE = -90f
private const val PIE_FULL_SWEEP = 360f
