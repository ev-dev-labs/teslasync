// The native Jetpack Compose + Material 3 EnergyFlowPage battery surface — a parity port of
// web/src/features/battery/pages/EnergyFlowPage.tsx, the power-distribution & energy-analysis dashboard. It reproduces
// the page's twenty-two panels (the eight-panel real-time energy-flow diagram with its battery radial gauge, the six
// summary metric cards, the daily-energy area chart, the daily-distance + daily-efficiency bar charts, the
// three-metric efficiency-metrics panel, and the daily-energy-history table), every data state (loading / empty /
// error / success, plus the cache-then-network stale/offline tier), and every visible string (resolved from the
// generated res/values catalog `energyFlow.*`, ADR-014).
//
// Composition: [EnergyFlowPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the stats + flow feeds, the display preferences and the day window);
// [EnergyFlowPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip / vehicle
// scope picker / range picker — then the loading / error / empty / loaded body). The loaded body draws every panel from
// the decoded models; all decode + formatting lives in the framework-free model (EnergyFlowPageModel.kt), so this file
// only resolves i18n + draws. SI values are converted to the user's units only here at the display boundary via the
// model's `formatDistance`/`formatEnergy`/`efficiencyDisplay` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.battery.energyflow

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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
import io.teslasync.android.components.charts.AreaChartWrapper
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Battery state-of-charge gauge ceiling (web `RadialGauge max={100}`). */
private const val SOC_MAX = 100.0

/** Decimals for the live kW / kWh power & energy figures (web `fmtNumber(value, 1)`). */
private const val POWER_DECIMALS = 1

/** Decimals for the CO₂ figure (web `fmtNumber(co2_saved_kg, 1)`). */
private const val CO2_DECIMALS = 1

/** The gauge is rendered compact so it fits the centre node of the five-across flow row. */
private val FLOW_GAUGE_SIZE = 56.dp

/** Height of the daily charts (web `ResponsiveContainer height={280}`). */
private val CHART_HEIGHT = 240.dp

/** Palette index per accent so the colors stay theme-aware yet match the web per-element CHART_COLORS. */
private const val ACCENT_CYAN = 0
private const val ACCENT_GREEN = 1
private const val ACCENT_AMBER = 2
private const val ACCENT_RED = 3
private const val ACCENT_PURPLE = 4
private const val ACCENT_BLUE = 5

/** The web trailing-day range presets surfaced by the picker (web `PRESET_IDS`). */
private val FIXED_RANGE_DAYS = listOf(1, 7, 30, 90)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [EnergyFlowPageViewModel] over the supplied [source] (the host wires the shared S8
 * Energy + Settings holders + the app-scoped active-vehicle selection via [energyFlowPageSourceOf]). [logger] defaults
 * to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun EnergyFlowPage(
    source: EnergyFlowPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: EnergyFlowPageViewModel =
        viewModel(
            key = EnergyFlowPageRegistration.SLUG,
            factory = viewModelFactory { initializer { EnergyFlowPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val flow by viewModel.flow.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val selectedDays by viewModel.selectedDays.collectAsStateWithLifecycle()

    EnergyFlowPageContent(
        state = state,
        flow = flow,
        prefs = prefs,
        selectedDays = selectedDays,
        onRetry = viewModel::retry,
        onSelectDays = viewModel::selectDays,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker + the
 * range picker), then the stats-gated body — a centered loader on a first load, a retryable error panel on a hard
 * failure, a `No Data` empty-state when no window has loaded, or the loaded panels otherwise. The secondary flow feed
 * renders its own diagram-or-fallback surface so no section is ever hidden.
 */
@Composable
fun EnergyFlowPageContent(
    state: UiState<EnergyStats>,
    flow: UiState<EnergyFlow>,
    prefs: EnergyFlowDisplayPrefs,
    selectedDays: Int,
    onRetry: () -> Unit,
    onSelectDays: (Int) -> Unit,
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
        EnergyFlowChrome(state = state, selectedDays = selectedDays, onSelectDays = onSelectDays)

        when {
            state.isLoading -> EnergyFlowLoading()
            state.isError -> EnergyFlowError(onRetry = onRetry)
            state.isEmpty -> EnergyFlowNoData()
            else ->
                EnergyFlowBody(
                    stats = state.data ?: EnergyStats.EMPTY,
                    flow = flow.data ?: EnergyFlow.EMPTY,
                    prefs = prefs,
                )
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer` title/subtitle), the freshness chip, scope + range pickers. */
@Composable
private fun EnergyFlowChrome(
    state: UiState<EnergyStats>,
    selectedDays: Int,
    onSelectDays: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_energyFlow_title))
                BodyText(
                    stringResource(R.string.translation_energyFlow_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web actions: <VehicleSelect /> + <RangePicker presetsOnly /> — the scope + trailing-window controls.
        VehicleSelect(withIcon = true)
        RangePicker(selectedDays = selectedDays, onSelectDays = onSelectDays)
    }
}

/** The trailing-day window picker (web `RangePicker presetsOnly`); Month/Year-to-date resolve to trailing windows. */
@Composable
private fun RangePicker(
    selectedDays: Int,
    onSelectDays: (Int) -> Unit,
) {
    val today = remember { LocalDate.now() }
    val options =
        buildList {
            add(SelectOption(FIXED_RANGE_DAYS[0].toString(), stringResource(R.string.translation_energyFlow_rangeToday)))
            add(SelectOption(FIXED_RANGE_DAYS[1].toString(), stringResource(R.string.translation_energyFlow_range7d)))
            add(SelectOption(FIXED_RANGE_DAYS[2].toString(), stringResource(R.string.translation_energyFlow_range30d)))
            add(SelectOption(FIXED_RANGE_DAYS[3].toString(), stringResource(R.string.translation_energyFlow_range90d)))
            add(SelectOption(today.dayOfMonth.toString(), stringResource(R.string.translation_energyFlow_rangeMtd)))
            add(SelectOption(today.dayOfYear.toString(), stringResource(R.string.translation_energyFlow_rangeYtd)))
        }.distinctBy { it.value }
    Select(
        options = options,
        selectedValue = selectedDays.toString(),
        onSelect = { value -> value.toIntOrNull()?.let(onSelectDays) },
        label = stringResource(R.string.translation_energyFlow_timeRange),
    )
}

/** The first-load surface — a centered brand loader (web `PageContainer loading` ▸ skeleton). */
@Composable
private fun EnergyFlowLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun EnergyFlowError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-data surface — the web `<EmptyState icon=Zap title="No Data" message="No energy flow data…" />`. */
@Composable
private fun EnergyFlowNoData() {
    EmptyState(
        message = stringResource(R.string.translation_energyFlow_noDataMessage),
        title = stringResource(R.string.translation_energyFlow_noData),
        icon = EnergyFlowGlyphs.Bolt,
    )
}

/** The loaded body — the six sections (twenty-two panels) in their web order, each entering with a staggered fade. */
@Composable
private fun EnergyFlowBody(
    stats: EnergyStats,
    flow: EnergyFlow,
    prefs: EnergyFlowDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { FlowDiagramPanel(flow = flow, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { SummaryMetricsGrid(stats = stats, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { DailyEnergyUsagePanel(stats = stats, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { DailyTrendsRow(stats = stats, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { EfficiencyMetricsPanel(stats = stats, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { DailyHistoryPanel(stats = stats, prefs = prefs) }
    }
}

// ── Section 1 — Energy Flow Diagram (GlassPanel1-8 + the SoC RadialGauge) ────────────────────────────────────────

/** GlassPanel1 — the real-time energy-flow diagram: Grid▸Charging▸Battery▸Driving▸Motor + the four live aux readings. */
@Composable
private fun FlowDiagramPanel(
    flow: EnergyFlow,
    prefs: EnergyFlowDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(EnergyFlowGlyphs.Bolt, contentDescription = null, size = IconSize.Lg, tint = paletteColor(ACCENT_CYAN))
                PanelTitle(stringResource(R.string.translation_energyFlow_diagram))
            }
            val chargeState = flow.chargeState
            if (chargeState != null) {
                Badge(
                    text = chargeState,
                    variant = if (chargeState == CHARGING_STATE) BadgeVariant.Success else BadgeVariant.Neutral,
                    dot = true,
                )
            }
        }
        Spacer(modifier = Modifier.height(Spacing.md))

        // Grid ▸ (charging) ▸ Battery ▸ (driving) ▸ Motor — the five-node flow (web grid-cols-5).
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FlowNodePanel(
                modifier = Modifier.weight(1f),
                icon = EnergyFlowGlyphs.Plug,
                iconTint = paletteColor(ACCENT_GREEN),
                label = stringResource(R.string.translation_energyFlow_grid),
                accent = PanelAccent.Success,
            )
            FlowArrow(
                label = stringResource(R.string.translation_energyFlow_charging),
                valueText = "${prefs.number(flow.chargePower, POWER_DECIMALS)} ${stringResource(R.string.translation_energyFlow_kw)}",
                color = paletteColor(ACCENT_GREEN),
                active = flow.chargePower > FLOW_ACTIVE_EPSILON,
            )
            BatteryNodePanel(modifier = Modifier.weight(BATTERY_NODE_WEIGHT), flow = flow, prefs = prefs)
            FlowArrow(
                label = stringResource(R.string.translation_energyFlow_driving),
                valueText = stringResource(R.string.translation_energyFlow_na),
                color = paletteColor(ACCENT_CYAN),
                active = false,
            )
            MotorNodePanel(modifier = Modifier.weight(1f))
        }

        Spacer(modifier = Modifier.height(Spacing.md))

        // Live aux readings (web grid-cols-2 ▸ sm:grid-cols-4): DC / AC live, HVAC / Accessories greyed-out.
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            FlowAuxPanel(
                modifier = Modifier.weight(1f),
                icon = EnergyFlowGlyphs.Bolt,
                iconTint = paletteColor(ACCENT_GREEN),
                label = stringResource(R.string.translation_energyFlow_dcPower),
                valueText = "${prefs.number(flow.dcChargingPower, POWER_DECIMALS)} ${stringResource(R.string.translation_energyFlow_kw)}",
                valueColor = paletteColor(ACCENT_GREEN),
            )
            FlowAuxPanel(
                modifier = Modifier.weight(1f),
                icon = EnergyFlowGlyphs.Activity,
                iconTint = paletteColor(ACCENT_BLUE),
                label = stringResource(R.string.translation_energyFlow_acPower),
                valueText = "${prefs.number(flow.acChargingPower, POWER_DECIMALS)} ${stringResource(R.string.translation_energyFlow_kw)}",
                valueColor = paletteColor(ACCENT_BLUE),
            )
        }
        Spacer(modifier = Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            FlowAuxPanel(
                modifier = Modifier.weight(1f),
                icon = EnergyFlowGlyphs.Thermometer,
                iconTint = paletteColor(ACCENT_RED),
                label = stringResource(R.string.translation_energyFlow_hvac),
                valueText = stringResource(R.string.translation_energyFlow_na),
                valueColor = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowAuxPanel(
                modifier = Modifier.weight(1f),
                icon = EnergyFlowGlyphs.Cpu,
                iconTint = paletteColor(ACCENT_AMBER),
                label = stringResource(R.string.translation_energyFlow_accessories),
                valueText = stringResource(R.string.translation_energyFlow_na),
                valueColor = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** GlassPanel2 / GlassPanel4 — a flow node: an icon over a label (web glow panels). */
@Composable
private fun FlowNodePanel(
    icon: ImageVector,
    iconTint: Color,
    label: String,
    accent: PanelAccent,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm, accent = accent) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Lg, tint = iconTint)
            Caption(label)
        }
    }
}

/** GlassPanel3 — the battery node: the SoC radial gauge + the optional remaining-energy readout. */
@Composable
private fun BatteryNodePanel(
    flow: EnergyFlow,
    prefs: EnergyFlowDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm, accent = PanelAccent.Info) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(EnergyFlowGlyphs.Battery, contentDescription = null, size = IconSize.Md, tint = paletteColor(ACCENT_CYAN))
            RadialGauge(
                value = flow.soc,
                max = SOC_MAX,
                label = stringResource(R.string.translation_energyFlow_battery),
                unit = PERCENT_UNIT,
                color = paletteColor(ACCENT_CYAN),
                size = FLOW_GAUGE_SIZE,
            )
            val remaining = flow.energyRemaining
            if (remaining != null) {
                Caption("${prefs.number(remaining, POWER_DECIMALS)} ${stringResource(R.string.translation_energyFlow_kwh)}")
            }
        }
    }
}

/** GlassPanel4 — the motor node: greyed-out since no live drive telemetry is available (web `No live data`). */
@Composable
private fun MotorNodePanel(modifier: Modifier = Modifier) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                EnergyFlowGlyphs.Car,
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(stringResource(R.string.translation_energyFlow_motor))
            Caption(stringResource(R.string.translation_energyFlow_noLiveData))
        }
    }
}

/** A flow arrow pill — a directional flow label over an icon + power chip (web `FlowArrow`). */
@Composable
private fun FlowArrow(
    label: String,
    valueText: String,
    color: Color,
    active: Boolean,
) {
    val tint = if (active) color else color.copy(alpha = INACTIVE_ALPHA)
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(label)
        Surface(
            shape = RoundedCornerShape(Radius.pill),
            color = tint.copy(alpha = CHIP_WASH_ALPHA),
            contentColor = tint,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(EnergyFlowGlyphs.ArrowRight, contentDescription = null, size = IconSize.Xs, tint = tint)
                Text(valueText, style = MaterialTheme.typography.labelSmall, color = tint)
            }
        }
    }
}

/** GlassPanel5-8 — a small live aux reading: an icon, a muted label, and a value (web bottom flow grid). */
@Composable
private fun FlowAuxPanel(
    icon: ImageVector,
    iconTint: Color,
    label: String,
    valueText: String,
    valueColor: Color,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Md, tint = iconTint)
            MetricLabel(label)
            Text(valueText, style = MaterialTheme.typography.labelMedium, color = valueColor, fontWeight = FontWeight.SemiBold)
        }
    }
}

// ── Section 2 — Summary metric cards (panels 9-14) ───────────────────────────────────────────────────────────────

/** Total-Energy / Total-Charged / Distance / Efficiency / CO₂-Saved / Period — the web summary `<MetricCard>` grid. */
@Composable
private fun SummaryMetricsGrid(
    stats: EnergyStats,
    prefs: EnergyFlowDisplayPrefs,
) {
    val avgEfficiency = prefs.efficiencyDisplay(stats.avgEfficiencyWhPerM)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_totalEnergy),
                value = prefs.formatEnergy(stats.totalEnergyUsedWh),
                icon = EnergyFlowGlyphs.Bolt,
                accent = paletteColor(ACCENT_CYAN),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_totalCharged),
                value = prefs.formatEnergy(stats.totalEnergyChargedWh),
                icon = EnergyFlowGlyphs.Plug,
                accent = paletteColor(ACCENT_GREEN),
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_distance),
                value = prefs.formatDistance(stats.totalDistanceM),
                icon = EnergyFlowGlyphs.Car,
                accent = paletteColor(ACCENT_PURPLE),
                subtitle = prefs.distanceLabel,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_efficiency),
                value = prefs.integer(avgEfficiency),
                icon = EnergyFlowGlyphs.Gauge,
                accent = paletteColor(ACCENT_AMBER),
                subtitle = prefs.efficiencyUnit,
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_co2Saved),
                value = prefs.number(stats.co2SavedKg, CO2_DECIMALS),
                icon = EnergyFlowGlyphs.Leaf,
                accent = paletteColor(ACCENT_GREEN),
                subtitle = stringResource(R.string.translation_energyFlow_kg),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_period),
                value = stats.periodDays.toString(),
                icon = EnergyFlowGlyphs.Calendar,
                accent = paletteColor(ACCENT_BLUE),
                subtitle = stringResource(R.string.translation_energyFlow_days),
            )
        }
    }
}

// ── Section 3 — Daily energy usage (GlassPanel15 + AreaChart) ─────────────────────────────────────────────────────

/** GlassPanel15 — the daily-energy-usage area chart (kWh per day), or the `noDailyEnergy` empty-state. */
@Composable
private fun DailyEnergyUsagePanel(
    stats: EnergyStats,
    prefs: EnergyFlowDisplayPrefs,
) {
    val rows = stats.dailyBreakdown
    ChartPanel(
        icon = EnergyFlowGlyphs.Activity,
        iconTint = paletteColor(ACCENT_CYAN),
        title = stringResource(R.string.translation_energyFlow_dailyEnergyUsage),
        accessibleDescription = stringResource(R.string.translation_energyFlow_dailyEnergyUsage_aria),
        hasData = rows.isNotEmpty(),
        emptyMessage = stringResource(R.string.translation_energyFlow_noDailyEnergy),
    ) {
        AreaChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "energy",
                        label = stringResource(R.string.translation_energyFlow_energy),
                        values = rows.map { prefs.energyDisplay(it.energyWh) },
                        kind = ChartSeriesKind.Area,
                        color = paletteColor(ACCENT_CYAN),
                    ),
                ),
            xLabels = rows.map { formatDayShort(it.date, prefs.locale) },
            height = CHART_HEIGHT,
            yValueFormatter = { prefs.number(it, POWER_DECIMALS) },
        )
    }
}

// ── Section 4 — Daily distance + efficiency (GlassPanel16 + GlassPanel17, two BarCharts) ──────────────────────────

/** GlassPanel16 + GlassPanel17 — the daily-distance + daily-efficiency bar charts side by side. */
@Composable
private fun DailyTrendsRow(
    stats: EnergyStats,
    prefs: EnergyFlowDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        DailyDistancePanel(stats = stats, prefs = prefs)
        DailyEfficiencyPanel(stats = stats, prefs = prefs)
    }
}

/** GlassPanel16 — the daily-distance bar chart (display distance per day), or the `noDailyDistance` empty-state. */
@Composable
private fun DailyDistancePanel(
    stats: EnergyStats,
    prefs: EnergyFlowDisplayPrefs,
) {
    val rows = stats.dailyBreakdown
    ChartPanel(
        icon = EnergyFlowGlyphs.Chart,
        iconTint = paletteColor(ACCENT_GREEN),
        title = stringResource(R.string.translation_energyFlow_dailyDistance),
        accessibleDescription = stringResource(R.string.translation_energyFlow_dailyDistance_aria),
        hasData = rows.isNotEmpty(),
        emptyMessage = stringResource(R.string.translation_energyFlow_noDailyDistance),
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "distance",
                        label = "${stringResource(R.string.translation_energyFlow_distance)} (${prefs.distanceLabel})",
                        values = rows.map { prefs.distanceDisplay(it.distanceM) },
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_GREEN),
                    ),
                ),
            xLabels = rows.map { formatDayShort(it.date, prefs.locale) },
            height = CHART_HEIGHT,
            yValueFormatter = { prefs.number(it, 0) },
        )
    }
}

/** GlassPanel17 — the daily-efficiency bar chart (positive-efficiency rows only), or the `noEfficiency` empty-state. */
@Composable
private fun DailyEfficiencyPanel(
    stats: EnergyStats,
    prefs: EnergyFlowDisplayPrefs,
) {
    val rows = stats.efficiencyRows
    ChartPanel(
        icon = EnergyFlowGlyphs.TrendingUp,
        iconTint = paletteColor(ACCENT_RED),
        title = stringResource(R.string.translation_energyFlow_dailyEfficiency),
        accessibleDescription = stringResource(R.string.translation_energyFlow_dailyEfficiency_aria),
        hasData = rows.isNotEmpty(),
        emptyMessage = stringResource(R.string.translation_energyFlow_noEfficiency),
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "efficiency",
                        label = prefs.efficiencyUnit,
                        values = rows.map { prefs.efficiencyDisplay(it.efficiencyWhPerM) },
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_RED),
                    ),
                ),
            xLabels = rows.map { formatDayShort(it.date, prefs.locale) },
            height = CHART_HEIGHT,
            yValueFormatter = { prefs.number(it, 0) },
        )
    }
}

// ── Section 5 — Efficiency metrics (GlassPanel18 + GlassPanel19-21) ───────────────────────────────────────────────

/** GlassPanel18 — the efficiency-metrics panel wrapping the three summary sub-panels. */
@Composable
private fun EfficiencyMetricsPanel(
    stats: EnergyStats,
    prefs: EnergyFlowDisplayPrefs,
) {
    val avgEfficiency = prefs.efficiencyDisplay(stats.avgEfficiencyWhPerM)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(
            icon = EnergyFlowGlyphs.TrendingUp,
            iconTint = paletteColor(ACCENT_GREEN),
            title = stringResource(R.string.translation_energyFlow_efficiencyMetrics),
        )
        Spacer(modifier = Modifier.height(Spacing.md))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            EfficiencyMetricTile(
                modifier = Modifier.weight(1f),
                label = prefs.efficiencyUnit,
                value = prefs.integer(avgEfficiency),
                valueColor = paletteColor(ACCENT_CYAN),
                badge = efficiencyBadge(prefs.efficiencyTier(avgEfficiency)),
            )
            EfficiencyMetricTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_co2Saved),
                value = prefs.number(stats.co2SavedKg, CO2_DECIMALS),
                valueColor = paletteColor(ACCENT_GREEN),
                badge = EfficiencyBadge(stringResource(R.string.translation_energyFlow_kgCo2), BadgeVariant.Success),
            )
            EfficiencyMetricTile(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energyFlow_avgEnergyDay),
                value = prefs.formatEnergy(stats.avgEnergyPerDayWh),
                valueColor = paletteColor(ACCENT_RED),
                badge = EfficiencyBadge(stringResource(R.string.translation_energyFlow_perDay), BadgeVariant.Info),
            )
        }
    }
}

/** GlassPanel19-21 — one efficiency sub-tile: a unit caption, a colored value, and a status badge. */
@Composable
private fun EfficiencyMetricTile(
    label: String,
    value: String,
    valueColor: Color,
    badge: EfficiencyBadge,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(label)
            Text(
                value,
                color = valueColor,
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            )
            Badge(text = badge.text, variant = badge.variant)
        }
    }
}

/** A resolved badge for an efficiency tile (label + semantic variant). */
private data class EfficiencyBadge(
    val text: String,
    val variant: BadgeVariant,
)

/** Maps an [EfficiencyTier] to its localized badge (web `Excellent` / `Good` / `High` / `No Data`). */
@Composable
private fun efficiencyBadge(tier: EfficiencyTier): EfficiencyBadge =
    when (tier) {
        EfficiencyTier.NoData -> EfficiencyBadge(stringResource(R.string.translation_energyFlow_noData), BadgeVariant.Neutral)
        EfficiencyTier.Excellent -> EfficiencyBadge(stringResource(R.string.translation_energyFlow_excellent), BadgeVariant.Success)
        EfficiencyTier.Good -> EfficiencyBadge(stringResource(R.string.translation_energyFlow_good), BadgeVariant.Warning)
        EfficiencyTier.High -> EfficiencyBadge(stringResource(R.string.translation_energyFlow_high), BadgeVariant.Danger)
    }

// ── Section 6 — Daily energy history (GlassPanel22 + DataTable) ───────────────────────────────────────────────────

/** GlassPanel22 — the daily-energy-history table (date / energy / distance / efficiency), or its empty-state. */
@Composable
private fun DailyHistoryPanel(
    stats: EnergyStats,
    prefs: EnergyFlowDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(
            icon = EnergyFlowGlyphs.Chart,
            iconTint = paletteColor(ACCENT_PURPLE),
            title = stringResource(R.string.translation_energyFlow_dailyEnergyHistory),
        )
        Spacer(modifier = Modifier.height(Spacing.md))
        val rows = stats.dailyBreakdown
        if (rows.isEmpty()) {
            EmptyState(message = stringResource(R.string.translation_energyFlow_noEnergyHistory), icon = EnergyFlowGlyphs.Chart)
        } else {
            var sort by remember { mutableStateOf(SortState(EnergyHistorySort.DATE, SortDirection.Desc)) }
            val ordered =
                remember(rows, sort) {
                    sortDailyRows(rows, sort.key ?: EnergyHistorySort.DATE, sort.direction == SortDirection.Asc)
                }
            DataTable(
                columns = historyColumns(prefs),
                rows = ordered,
                keyOf = { it.date },
                sortState = sort,
                onSortChange = { key -> sort = sort.toggledBy(key) },
                emptyText = stringResource(R.string.translation_energyFlow_noEnergyRecords),
            )
        }
    }
}

/** The history table columns (web `historyColumns`): Date / Energy / Distance (unit) / efficiency-unit. */
@Composable
private fun historyColumns(prefs: EnergyFlowDisplayPrefs): List<TableColumn<EnergyDailyEntry>> =
    listOf(
        TableColumn(
            key = EnergyHistorySort.DATE,
            header = stringResource(R.string.translation_energyFlow_date),
            sortable = true,
        ) { row -> Caption(formatDayShort(row.date, prefs.locale)) },
        TableColumn(
            key = EnergyHistorySort.ENERGY,
            header = stringResource(R.string.translation_energyFlow_energy),
            sortable = true,
            alignEnd = true,
        ) { row -> BodyText(prefs.formatEnergy(row.energyWh)) },
        TableColumn(
            key = EnergyHistorySort.DISTANCE,
            header = "${stringResource(R.string.translation_energyFlow_distance)} (${prefs.distanceLabel})",
            sortable = true,
            alignEnd = true,
        ) { row -> BodyText(prefs.formatDistance(row.distanceM)) },
        TableColumn(
            key = EnergyHistorySort.EFFICIENCY,
            header = prefs.efficiencyUnit,
            sortable = true,
            alignEnd = true,
        ) { row -> BodyText(prefs.integer(prefs.efficiencyDisplay(row.efficiencyWhPerM))) },
    )

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-up metric row (the phone-width grid cell the web 6-col grid collapses to). */
@Composable
private fun MetricRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** A panel section header — a small colored icon before the title (web section headers). */
@Composable
private fun SectionHeader(
    icon: ImageVector,
    iconTint: Color,
    title: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Md, tint = iconTint)
        PanelTitle(title)
    }
}

/**
 * A chart section panel (web `GlassPanel` + header + chart/empty): the header, then the [content] chart when [hasData],
 * or a friendly empty-state. The chart body carries [accessibleDescription] for TalkBack (the opaque canvas fallback).
 */
@Composable
private fun ChartPanel(
    icon: ImageVector,
    iconTint: Color,
    title: String,
    accessibleDescription: String,
    hasData: Boolean,
    emptyMessage: String,
    content: @Composable () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(icon = icon, iconTint = iconTint, title = title)
        Spacer(modifier = Modifier.height(Spacing.md))
        if (hasData) {
            Box(modifier = Modifier.semantics { contentDescription = accessibleDescription }) { content() }
        } else {
            EmptyState(message = emptyMessage, icon = icon)
        }
    }
}

/** The live charge-state value that flips the diagram badge to success (web `chargeState === 'Charging'`). */
private const val CHARGING_STATE = "Charging"

/** The hard-coded percent unit the SoC gauge reads as a literal (web `unit="%"`, never i18n). */
private const val PERCENT_UNIT = "%"

/** Power above which the charging flow arrow reads as active (web `Math.abs(power) > 0.01`). */
private const val FLOW_ACTIVE_EPSILON = 0.01

/** Dimming applied to an inactive flow arrow (web `opacity-30`). */
private const val INACTIVE_ALPHA = 0.3f

/** Low-alpha wash behind a flow-arrow chip (web `${color}18`). */
private const val CHIP_WASH_ALPHA = 0.12f

/** The battery centre node is slightly wider so the gauge fits between the two flow arrows. */
private const val BATTERY_NODE_WEIGHT = 1.3f
