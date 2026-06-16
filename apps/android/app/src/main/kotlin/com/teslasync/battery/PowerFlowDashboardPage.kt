// The native Jetpack Compose + Material 3 PowerFlowDashboardPage surface — a parity port of
// web/src/features/battery/pages/PowerFlowDashboardPage.tsx, the real-time Tesla Energy power-flow dashboard. It
// reproduces the page's eight panels (the four current-power stat cards — solar / battery / home / grid — the
// battery-state panel with its state-of-charge bar + energy-remaining + total-capacity rows, the power-flow diagram
// with its directional flow arrows, the power-over-time area chart and the state-of-charge line chart), every data
// state (loading / empty / error / success, plus the cache-then-network stale/offline tier), and every visible string
// (resolved from the generated res/values catalog `powerFlow.*`, ADR-014).
//
// Composition: [PowerFlowDashboardPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the two feeds + the refresh flag); [PowerFlowDashboardPageContent]
// is the stateless render layer (the page chrome — title / subtitle / freshness chip / refresh button / status badges —
// then the loading / error / loaded body gated on the primary live-status feed). The loaded body draws every panel from
// the decoded models; all decode + derivation lives in the framework-free model (PowerFlowDashboardPageModel.kt), so
// this file only resolves i18n + draws. Power (W) and energy (Wh) are SI on the wire and rendered verbatim by the
// model's magnitude formatters (no unit-system conversion); charge is a unitless percentage.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.battery.powerflow

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** State-of-charge ceiling for the SOC bar + the SOC chart y-axis (web `Math.min(soc, 100)` / `domain={[0, 100]}`). */
private const val SOC_MAX = 100.0

/** Low-alpha wash behind a colored status badge (mirrors the shared `Badge` component's `BADGE_WASH_ALPHA`). */
private const val BADGE_WASH_ALPHA = 0.16f

private val POWER_CHART_HEIGHT = 320.dp
private val SOC_CHART_HEIGHT = 240.dp

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [PowerFlowDashboardPageViewModel] over the supplied [source] (the host wires the shared
 * Energy holder via [powerFlowDashboardPageSourceOf]). [logger] defaults to the app's redacting logger. Records the
 * one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun PowerFlowDashboardPage(
    source: PowerFlowDashboardPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: PowerFlowDashboardPageViewModel =
        viewModel(
            key = PowerFlowDashboardPageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { PowerFlowDashboardPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val live by viewModel.live.collectAsStateWithLifecycle()
    val history by viewModel.history.collectAsStateWithLifecycle()
    val refreshing by viewModel.isRefreshing.collectAsStateWithLifecycle()

    PowerFlowDashboardPageContent(
        live = live,
        history = history,
        refreshing = refreshing,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + refresh button + status badges + the
 * stale/offline banner), then the live-status-gated body — a centered loader on a first load, a retryable error panel
 * on a hard failure, or the loaded panels otherwise. In the loaded body the battery-state and power-flow panels each
 * render their own content-or-empty surface (web per-panel `live ? … : <EmptyState/>`), so no section is ever hidden.
 */
@Composable
fun PowerFlowDashboardPageContent(
    live: UiState<PowerFlowLive>,
    history: UiState<List<PowerFlowSample>>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
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
        PowerFlowChrome(live = live, refreshing = refreshing, onRefresh = onRefresh)

        when {
            live.isLoading -> PowerFlowLoading()
            live.isError -> PowerFlowError(onRetry = onRetry)
            else -> PowerFlowBody(live = live.data ?: PowerFlowLive.EMPTY, history = history)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), freshness chip, the refresh button, and the status badges. */
@Composable
private fun PowerFlowChrome(
    live: UiState<PowerFlowLive>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_powerFlow_title))
                BodyText(
                    stringResource(R.string.translation_powerFlow_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = live.fetchedAt,
                isFetching = live.refreshing || refreshing,
                isStale = live.stale,
                isError = live.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `<Button onClick={refreshMutation.mutate}>` — the "Refresh from Tesla" affordance.
        Button(
            label = stringResource(R.string.translation_powerFlow_refresh),
            onClick = onRefresh,
            leadingIcon = PowerFlowGlyphs.Refresh,
            loading = refreshing,
            enabled = !refreshing,
        )
        PowerFlowStatusBadges(live.data ?: PowerFlowLive.EMPTY)
        // web `<LiveStaleDataBanner />` — surfaced only while cached data is shown because the network is unreachable.
        if (live.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun PowerFlowLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun PowerFlowError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun PowerFlowBody(
    live: PowerFlowLive,
    history: UiState<List<PowerFlowSample>>,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { PowerStatCardsGrid(live) }
        FadeIn(delayMs = FADE_STEP_MS) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                BatteryStatePanel(live, modifier = Modifier.weight(1f))
                PowerFlowDiagramPanel(live, modifier = Modifier.weight(1f))
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 2) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                SectionTitle(stringResource(R.string.translation_powerFlow_history))
                PowerOverTimeChart(history)
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 3) { SocOverTimeChart(history) }
    }
}

// ── Status badges (chrome) ──────────────────────────────────────────────────────────────────────────────────────

/** The web status-badge row: grid status, plus storm-mode / backup-capable / last-update when applicable. */
@Composable
private fun PowerFlowStatusBadges(live: PowerFlowLive) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val gridLabel = stringResource(R.string.translation_powerFlow_grid)
        val gridStatus = live.gridStatus ?: "\u2014"
        PowerStatusBadge(
            icon = PowerFlowGlyphs.Bolt,
            text = "$gridLabel: $gridStatus",
            tint = if (live.gridStatus == GRID_STATUS_ACTIVE) TeslaTokens.status.success else TeslaTokens.status.danger,
        )
        if (live.stormModeActive) {
            PowerStatusBadge(
                icon = PowerFlowGlyphs.ShieldAlert,
                text = stringResource(R.string.translation_powerFlow_stormMode),
                tint = TeslaTokens.status.warning,
            )
        }
        if (live.backupCapable) {
            PowerStatusBadge(
                icon = PowerFlowGlyphs.Battery,
                text = stringResource(R.string.translation_powerFlow_backupCapable),
                tint = TeslaTokens.status.info,
            )
        }
        if (live.timestamp != null) {
            PowerStatusBadge(
                icon = PowerFlowGlyphs.Activity,
                text = "${stringResource(R.string.translation_powerFlow_lastUpdate)}: ${dateTimeLabel(live.timestamp)}",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** A status chip with a leading icon (web `<Badge><Icon/> …</Badge>`); a low-alpha [tint] wash behind tinted content. */
@Composable
private fun PowerStatusBadge(
    icon: ImageVector,
    text: String,
    tint: Color,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = tint.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = tint,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Xs, tint = tint)
            Text(text, style = MaterialTheme.typography.labelSmall)
        }
    }
}

// ── Panels 1-4 — current-power stat cards ───────────────────────────────────────────────────────────────────────

/** The four current-power tiles (web 2×4 `StatCard` grid): Solar / Battery / Home / Grid, laid out two-up. */
@Composable
private fun PowerStatCardsGrid(live: PowerFlowLive) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_powerFlow_solarPower),
                value = formatWatts(live.solarPowerW),
                icon = PowerFlowGlyphs.Sun,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_powerFlow_batteryPower),
                value = formatWatts(live.batteryPowerW),
                unit = batteryDirectionLabel(live.batteryPowerW),
                icon = PowerFlowGlyphs.Battery,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_powerFlow_homeConsumption),
                value = formatWatts(live.loadPowerW),
                icon = PowerFlowGlyphs.Home,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_powerFlow_gridPower),
                value = formatWatts(live.gridPowerW),
                unit = gridDirectionLabel(live.gridPowerW),
                icon = PowerFlowGlyphs.Bolt,
            )
        }
    }
}

/** The battery tile's sublabel (web `< 0 ? Charging : > 0 ? Discharging : undefined`). */
@Composable
private fun batteryDirectionLabel(watts: Double?): String? {
    val w = watts ?: 0.0
    return when {
        w < 0.0 -> stringResource(R.string.translation_powerFlow_charging)
        w > 0.0 -> stringResource(R.string.translation_powerFlow_discharging)
        else -> null
    }
}

/** The grid tile's sublabel (web `> 0 ? Importing : < 0 ? Exporting : undefined`). */
@Composable
private fun gridDirectionLabel(watts: Double?): String? {
    val w = watts ?: 0.0
    return when {
        w > 0.0 -> stringResource(R.string.translation_powerFlow_importing)
        w < 0.0 -> stringResource(R.string.translation_powerFlow_exporting)
        else -> null
    }
}

// ── Panel 5 — battery state ─────────────────────────────────────────────────────────────────────────────────────

/** Battery-state panel (web GlassPanel): SOC bar + energy-remaining + total-capacity, or the no-data empty state. */
@Composable
private fun BatteryStatePanel(
    live: PowerFlowLive,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        PanelTitle(stringResource(R.string.translation_powerFlow_batteryState))
        if (live.hasData) {
            Column(
                modifier = Modifier.padding(top = Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                MetricBar(
                    value = live.percentageCharged ?: 0.0,
                    max = SOC_MAX,
                    label = stringResource(R.string.translation_powerFlow_stateOfCharge),
                    valueText = formatPercent(live.percentageCharged),
                    color = TeslaTokens.chart.battery,
                )
                InfoRow(
                    label = stringResource(R.string.translation_powerFlow_energyLeft),
                    value = formatWattHours(live.energyLeftWh),
                )
                InfoRow(
                    label = stringResource(R.string.translation_powerFlow_totalCapacity),
                    value = formatWattHours(live.totalPackEnergyWh),
                )
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_powerFlow_noBatteryData),
                icon = PowerFlowGlyphs.Battery,
            )
        }
    }
}

// ── Panel 6 — power-flow diagram ────────────────────────────────────────────────────────────────────────────────

/** Power-flow diagram panel (web GlassPanel): directional flow arrows, or the no-data empty state. */
@Composable
private fun PowerFlowDiagramPanel(
    live: PowerFlowLive,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier) {
        PanelTitle(stringResource(R.string.translation_powerFlow_flowDiagram))
        if (live.hasData) {
            val solar = stringResource(R.string.translation_powerFlow_solar)
            val battery = stringResource(R.string.translation_powerFlow_batteryLabel)
            val grid = stringResource(R.string.translation_powerFlow_grid)
            val home = stringResource(R.string.translation_powerFlow_home)
            val gridServices = stringResource(R.string.translation_powerFlow_gridServices)
            Column(
                modifier = Modifier.padding(top = Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                FlowArrow(from = solar, to = home, powerW = live.solarPowerW, active = (live.solarPowerW ?: 0.0) > 0.0)
                FlowArrow(from = battery, to = home, powerW = live.batteryPowerW, active = (live.batteryPowerW ?: 0.0) != 0.0)
                FlowArrow(from = grid, to = home, powerW = live.gridPowerW, active = (live.gridPowerW ?: 0.0) != 0.0)
                if ((live.gridServicesPowerW ?: 0.0) != 0.0) {
                    FlowArrow(from = gridServices, to = grid, powerW = live.gridServicesPowerW, active = true)
                }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_powerFlow_noFlowData),
                icon = PowerFlowGlyphs.Activity,
            )
        }
    }
}

/** One power-flow leg (web `FlowArrow`): a from/to pair, a direction arrow, and the formatted power, right-aligned. */
@Composable
private fun FlowArrow(
    from: String,
    to: String,
    powerW: Double?,
    active: Boolean,
) {
    val tint = if (active) TeslaTokens.chart.regen else MaterialTheme.colorScheme.onSurfaceVariant
    Surface(
        shape = RoundedCornerShape(Radius.sm),
        color = if (active) TeslaTokens.chart.regen.copy(alpha = BADGE_WASH_ALPHA) else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = tint,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(from, style = MaterialTheme.typography.labelMedium)
            Icon(
                if ((powerW ?: 0.0) >= 0.0) PowerFlowGlyphs.ArrowDown else PowerFlowGlyphs.ArrowUp,
                contentDescription = null,
                size = IconSize.Xs,
                tint = tint,
            )
            Text(to, style = MaterialTheme.typography.labelMedium)
            Text(
                formatWatts(powerW),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelMedium,
                textAlign = TextAlign.End,
            )
        }
    }
}

/** A `label … value` row (web `flex justify-between`) used by the battery-state panel. */
@Composable
private fun InfoRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        BodyText(value)
    }
}

// ── Panels 7-8 — historical charts ──────────────────────────────────────────────────────────────────────────────

/** Power-over-time area chart (web stacked `AreaChart`): solar / battery / grid / home power flow over time. */
@Composable
private fun PowerOverTimeChart(history: UiState<List<PowerFlowSample>>) {
    val samples = history.data ?: emptyList()
    val xLabels = samples.map { shortDateLabel(it.timestamp) }
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_powerFlow_powerOverTime),
        subtitle = stringResource(R.string.translation_powerFlow_powerOverTimeDesc),
        accessibleDescription = stringResource(R.string.translation_powerFlow_powerOverTime_aria),
        status = chartStatus(history, samples),
        height = POWER_CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_powerFlow_noFlowData),
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "solar",
                        label = stringResource(R.string.translation_powerFlow_solar),
                        values = samples.map { it.solarW },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.energy,
                    ),
                    ChartSeries(
                        key = "battery",
                        label = stringResource(R.string.translation_powerFlow_batteryLabel),
                        values = samples.map { it.batteryW },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.battery,
                    ),
                    ChartSeries(
                        key = "grid",
                        label = stringResource(R.string.translation_powerFlow_grid),
                        values = samples.map { it.gridW },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.power,
                    ),
                    ChartSeries(
                        key = "home",
                        label = stringResource(R.string.translation_powerFlow_home),
                        values = samples.map { it.loadW },
                        kind = ChartSeriesKind.Area,
                        color = TeslaTokens.chart.speed,
                    ),
                ),
            xLabels = xLabels,
            height = POWER_CHART_HEIGHT,
            yValueFormatter = { formatWatts(it) },
        )
    }
}

/** State-of-charge line chart (web `LineChart`): battery percentage over time, 0–100. */
@Composable
private fun SocOverTimeChart(history: UiState<List<PowerFlowSample>>) {
    val samples = history.data ?: emptyList()
    val xLabels = samples.map { shortDateLabel(it.timestamp) }
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_powerFlow_socOverTime),
        subtitle = stringResource(R.string.translation_powerFlow_socOverTimeDesc),
        accessibleDescription = stringResource(R.string.translation_powerFlow_socOverTime_aria),
        status = chartStatus(history, samples),
        height = SOC_CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_powerFlow_noBatteryData),
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "soc",
                        label = stringResource(R.string.translation_powerFlow_stateOfCharge),
                        values = samples.map { it.socPct },
                        kind = ChartSeriesKind.Line,
                        color = paletteColor(1),
                    ),
                ),
            xLabels = xLabels,
            height = SOC_CHART_HEIGHT,
            yValueFormatter = { "${ChartFormat.number(it, 0)}%" },
        )
    }
}

/** Maps the history feed onto the chart lifecycle (web `loading={historyLoading} empty={chartData.length === 0}`). */
private fun chartStatus(
    history: UiState<List<PowerFlowSample>>,
    samples: List<PowerFlowSample>,
): ChartStatus =
    when {
        history.isLoading -> ChartStatus.Loading
        samples.isEmpty() -> ChartStatus.Empty
        else -> ChartStatus.Ready
    }
