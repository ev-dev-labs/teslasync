// The native Jetpack Compose + Material 3 EnergyPage battery surface — a parity port of
// web/src/features/battery/pages/EnergyPage.tsx, the energy-intelligence dashboard. It reproduces the page's nine
// panels (the four hero radial gauges, the six-metric quick strip, the lifetime-metrics panel, the two
// cost-vs-gasoline comparison cards, the Energy & Cost Daily composed chart, the Efficiency Trend area chart, the
// Charging-by-Time-of-Day bar chart, the Charger-Type-Breakdown donut, and the recent-sessions table), every data
// state (loading / empty / error / success), and every visible string (resolved from the generated res/values catalog
// `energy.*` + `common.noData`, ADR-014).
//
// Composition: [EnergyPage] is the stateful entry (constructs the view-model over the host-wired source, records the
// one-shot `view.opened` diagnostic, collects the three feeds + the live display preferences); [EnergyPageContent] is
// the stateless render layer (the page chrome — eyebrow / title / subtitle / freshness chip / vehicle scope picker —
// then the loading / error / loaded body). The loaded body draws every panel from the decoded models; all decode +
// derivation lives in the framework-free model (EnergyPageModel.kt), so this file only resolves i18n + draws. SI values
// are converted to the user's units only here at the display boundary via the model's [EnergyDisplayPrefs] (Phase-48
// SI-canonical).
//
// Empty fidelity: the body renders on every non-loading, non-error state, so an empty payload still shows the full
// panel set with the honest empty hero (web `hasNoEnergyData`) plus each chart/table's own empty surface — never a
// page-level blank and never a grid of misleading zeros.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.battery.energy

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import io.teslasync.android.components.charts.ComboChart
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
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
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Palette indices per accent so the colors stay theme-aware (web per-element hex literals). */
private const val ACCENT_CYAN = 0
private const val ACCENT_GREEN = 1
private const val ACCENT_AMBER = 2
private const val ACCENT_RED = 3
private const val ACCENT_PURPLE = 4

/** Hard-coded unit symbols the web reads as literals (never i18n): `kg` for CO₂, `$` for the cost gauge. */
private const val CO2_UNIT = "kg"
private const val COST_UNIT = "$"

/** The `$/kWh` suffix the breakdown legend renders verbatim (web `/kWh`). */
private const val PER_KWH_SUFFIX = "/kWh"

/** Donut geometry (web pie `innerRadius` / `outerRadius`). */
private val DONUT_SIZE = 168.dp
private val DONUT_RING = 26.dp
private val LEGEND_DOT = 10.dp
private const val DONUT_START_ANGLE = -90f
private const val DONUT_FULL_SWEEP = 360f

// ── Stateful entry point ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [EnergyPageViewModel] over the supplied [source] (the host wires the page-local
 * charging repository + the shared Energy/Vehicles/Settings holders + the active-vehicle selection via
 * [energyPageSourceOf]). [logger] defaults to the app's redacting logger. Records the one-shot `view.opened`
 * diagnostic and binds the live state to the content.
 */
@Composable
fun EnergyPage(
    source: EnergyPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: EnergyPageViewModel =
        viewModel(
            key = EnergyPageRegistration.SLUG,
            factory = viewModelFactory { initializer { EnergyPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val sessions by viewModel.sessions.collectAsStateWithLifecycle()
    val live by viewModel.live.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    EnergyPageContent(
        state = state,
        sessions = sessions,
        live = live,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (eyebrow + title + subtitle + the data-freshness chip + the vehicle-scope
 * picker), then the energy-stats-gated body — a centered loader on a first load, a retryable error panel on a hard
 * failure, or the loaded panels otherwise. Every panel renders its own content-or-empty surface so no section is ever
 * hidden, and the empty hero stands in for the success-but-no-data case (web `hasNoEnergyData`).
 */
@Composable
fun EnergyPageContent(
    state: UiState<EnergyStats>,
    sessions: UiState<List<ChargingSession>>,
    live: UiState<EnergyLive>,
    prefs: EnergyDisplayPrefs,
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
        EnergyChrome(state = state)

        when {
            state.isLoading -> EnergyLoading()
            state.isError -> EnergyError(onRetry = onRetry)
            else ->
                EnergyBody(
                    stats = state.data ?: EnergyStats.EMPTY,
                    sessions = sessions.data.orEmpty(),
                    live = live.data ?: EnergyLive.EMPTY,
                    prefs = prefs,
                )
        }
    }
}

/** The page chrome — eyebrow (web tab title) + title + subtitle (web `PageContainer`), the freshness chip, and the scope picker. */
@Composable
private fun EnergyChrome(state: UiState<EnergyStats>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_energy_title))
                PageTitle(stringResource(R.string.translation_energy_pageTitle))
                BodyText(
                    stringResource(R.string.translation_energy_pageSubtitle),
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
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading` ▸ skeleton). */
@Composable
private fun EnergyLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error` + `QueryError`). */
@Composable
private fun EnergyError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — the nine panels in their web order, each entering with a staggered fade. */
@Composable
private fun EnergyBody(
    stats: EnergyStats,
    sessions: List<ChargingSession>,
    live: EnergyLive,
    prefs: EnergyDisplayPrefs,
) {
    val derived = remember(stats, sessions, live) { EnergyDerived(stats, sessions, live) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { HeroGaugesPanel(derived, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { QuickMetricsStrip(derived, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { LifetimeMetricsPanel(derived, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { CostComparisonRow(derived, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { EnergyCostDailyPanel(derived, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { EfficiencyTrendPanel(derived, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 6) { ChargingByTimePanel(sessions, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 7) { ChargerBreakdownPanel(sessions, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 8) { RecentSessionsPanel(sessions, prefs) }
    }
}

// ── Panel 1 — Hero gauges (4 radial gauges) + empty hero ────────────────────────────────────────────────────────

/** GlassPanel1 — the four hero radial gauges (Energy Used / Efficiency / CO₂ Saved / Total Cost), or the empty hero. */
@Composable
private fun HeroGaugesPanel(
    derived: EnergyDerived,
    prefs: EnergyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        if (derived.hasNoEnergyData) {
            EmptyState(
                message = stringResource(R.string.translation_energy_empty_hero),
                icon = EnergyGlyphs.Bolt,
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    RadialGauge(
                        modifier = Modifier.weight(1f),
                        value = derived.energyGaugeValue(prefs),
                        max = derived.energyGaugeMax(prefs),
                        label = stringResource(R.string.translation_energy_gauge_energyUsed),
                        unit = prefs.energyLabel,
                        color = paletteColor(ACCENT_CYAN),
                    )
                    RadialGauge(
                        modifier = Modifier.weight(1f),
                        value = derived.efficiencyGaugeValue(prefs),
                        max = derived.efficiencyGaugeMax(prefs),
                        label = stringResource(R.string.translation_energy_gauge_efficiency),
                        unit = prefs.efficiencyUnit,
                        color = paletteColor(ACCENT_GREEN),
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    RadialGauge(
                        modifier = Modifier.weight(1f),
                        value = derived.co2SavedKg,
                        max = derived.co2GaugeMax(),
                        label = stringResource(R.string.translation_energy_gauge_co2Saved),
                        unit = CO2_UNIT,
                        color = paletteColor(ACCENT_PURPLE),
                    )
                    RadialGauge(
                        modifier = Modifier.weight(1f),
                        value = derived.totalCost,
                        max = derived.costGaugeMax(),
                        label = stringResource(R.string.translation_energy_gauge_totalCost),
                        unit = COST_UNIT,
                        color = paletteColor(ACCENT_AMBER),
                    )
                }
            }
        }
    }
}

// ── Panel 2 — Quick-metrics strip (six chips) ───────────────────────────────────────────────────────────────────

/** GlassPanel2 — the six-metric quick strip (cost/distance, cost/kWh, distance, sessions, monthly + yearly estimate). */
@Composable
private fun QuickMetricsStrip(
    derived: EnergyDerived,
    prefs: EnergyDisplayPrefs,
) {
    val costPerDist =
        if (derived.totalDistanceM > 0.0) derived.totalCost / prefs.fromMeters(derived.totalDistanceM) else 0.0
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricChip(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_metric_costPerDist, prefs.distanceLabel),
                value = prefs.currency(costPerDist),
            )
            MetricChip(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_metric_costPerKwh),
                value = prefs.currency(derived.costPerKwh),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricChip(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_metric_totalDistance),
                value = "${prefs.integer(prefs.fromMeters(derived.totalDistanceM))} ${prefs.distanceLabel}",
            )
            MetricChip(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_metric_sessions),
                value = derived.sessionCount.toString(),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricChip(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_metric_monthlyEst),
                value = prefs.currency(derived.monthlyProjectedCost),
            )
            MetricChip(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_metric_yearlyEst),
                value = prefs.currency(derived.yearlyProjectedCost),
            )
        }
    }
}

/** One quick-metric chip — a label over its value (web `GlassPanel p-3 text-center`). */
@Composable
private fun MetricChip(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricLabel(label)
            MetricValue(value)
        }
    }
}

// ── Panel 3 — Lifetime metrics ──────────────────────────────────────────────────────────────────────────────────

/** GlassPanel3 — the lifetime-metrics panel: lifetime energy used (live snapshot) + the selected-window energy. */
@Composable
private fun LifetimeMetricsPanel(
    derived: EnergyDerived,
    prefs: EnergyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(icon = EnergyGlyphs.Bolt, title = stringResource(R.string.translation_energy_lifetime_title), tint = paletteColor(ACCENT_CYAN))
        Spacer(Modifier.height(Spacing.md))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            LifetimeCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_lifetime_energyUsed),
                value = derived.lifetimeEnergyUsedKwh?.let { "${prefs.number(it)} ${prefs.energyLabel}" } ?: EM_DASH,
                valueColor = paletteColor(ACCENT_CYAN),
                description = if (derived.lifetimeEnergyUsedKwh != null) {
                    stringResource(R.string.translation_energy_lifetime_energyUsedDesc)
                } else {
                    null
                },
            )
            LifetimeCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_energy_lifetime_periodEnergy, derived.windowDays.toString()),
                value = "${prefs.number(prefs.fromWh(derived.totalEnergyWh))} ${prefs.energyLabel}",
                valueColor = paletteColor(ACCENT_GREEN),
                description = stringResource(R.string.translation_energy_lifetime_periodEnergyDesc),
            )
        }
    }
}

/** One lifetime-metric card — a label, a colored value, and an optional description (web inner panels). */
@Composable
private fun LifetimeCard(
    label: String,
    value: String,
    valueColor: Color,
    description: String?,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            MetricLabel(label)
            BodyText(value, color = valueColor)
            if (description != null) HelperText(description)
        }
    }
}

// ── Panel 4 — Cost vs gas savings (two comparison cards) ────────────────────────────────────────────────────────

/** GlassPanel4 — the two cost-vs-gasoline comparison cards (period total + projected annual). */
@Composable
private fun CostComparisonRow(
    derived: EnergyDerived,
    prefs: EnergyDisplayPrefs,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        CostComparisonCard(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_energy_cost_decimal_periodTotal, derived.windowDays.toString()),
            comparison = EnergyCostComparison(evCost = derived.totalCost, gasCost = derived.gasEquivalent),
            icon = EnergyGlyphs.Fuel,
            prefs = prefs,
        )
        CostComparisonCard(
            modifier = Modifier.weight(1f),
            label = stringResource(R.string.translation_energy_cost_decimal_projectedAnnual),
            comparison = EnergyCostComparison(evCost = derived.yearlyProjectedCost, gasCost = derived.annualGasEquivalent),
            icon = EnergyGlyphs.Leaf,
            prefs = prefs,
        )
    }
}

/** One cost-comparison card — EV cost vs gas equivalent, the saving, and the percent-less chip (web `CostComparisonCard`). */
@Composable
private fun CostComparisonCard(
    label: String,
    comparison: EnergyCostComparison,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    prefs: EnergyDisplayPrefs,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Icon(icon, contentDescription = null, size = IconSize.Md, tint = paletteColor(ACCENT_GREEN))
                MetricLabel(label)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(stringResource(R.string.translation_energy_cost_decimal_evCost))
                    BodyText(prefs.currency(comparison.evCost), color = paletteColor(ACCENT_CYAN))
                }
                Icon(EnergyGlyphs.ArrowRight, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    Caption(stringResource(R.string.translation_energy_cost_decimal_gasEquivalent))
                    BodyText(prefs.currency(comparison.gasCost), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                BodyText(
                    "${stringResource(R.string.translation_energy_cost_decimal_saving)} ${prefs.currency(comparison.savings)}",
                    color = paletteColor(ACCENT_GREEN),
                )
                Badge(
                    text = "${prefs.number(comparison.savingsPercent, 0)}% ${stringResource(R.string.translation_energy_cost_decimal_less)}",
                    variant = BadgeVariant.Success,
                )
            }
        }
    }
}

// ── Panel 5 — Energy & Cost Daily (composed chart) ──────────────────────────────────────────────────────────────

/** Energy-Cost-Daily — the web composed `<ChartContainer>`: daily energy bars + an efficiency trend line, or its empty-state. */
@Composable
private fun EnergyCostDailyPanel(
    derived: EnergyDerived,
    prefs: EnergyDisplayPrefs,
) {
    val daily = derived.daily
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_energy_chart_energyCostDaily),
        accessibleDescription = stringResource(R.string.translation_energy_chart_energyCostDaily_aria),
        status = if (daily.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_energy_chart_noEnergyData),
    ) {
        val series =
            listOf(
                ChartSeries(
                    key = "energy_wh",
                    label = stringResource(R.string.translation_energy_chart_energy),
                    values = daily.map { it.energyWh },
                    kind = ChartSeriesKind.Bar,
                    color = paletteColor(ACCENT_CYAN),
                ),
                ChartSeries(
                    key = "efficiency_wh_per_m",
                    label = prefs.efficiencyUnit,
                    values = daily.map { it.efficiencyWhPerM },
                    kind = ChartSeriesKind.Line,
                    color = paletteColor(ACCENT_GREEN),
                ),
            )
        ComboChart(series = series, xLabels = daily.map { it.date })
    }
}

// ── Panel 6 — Efficiency Trend (area chart) ─────────────────────────────────────────────────────────────────────

/** Efficiency-Trend — the web area `<ChartContainer>`: the daily efficiency + distance areas, or its empty-state. */
@Composable
private fun EfficiencyTrendPanel(
    derived: EnergyDerived,
    prefs: EnergyDisplayPrefs,
) {
    val daily = derived.daily
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_energy_chart_efficiencyTrend),
        accessibleDescription = stringResource(R.string.translation_energy_chart_efficiencyTrend_aria),
        status = if (daily.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_energy_chart_noEfficiencyData),
    ) {
        val series =
            listOf(
                ChartSeries(
                    key = "efficiency",
                    label = prefs.efficiencyUnit,
                    values = daily.map { it.efficiencyWhPerM },
                    color = paletteColor(ACCENT_GREEN),
                ),
                ChartSeries(
                    key = "distance",
                    label = stringResource(R.string.translation_energy_chart_distance, prefs.distanceLabel),
                    values = daily.map { it.distanceM },
                    color = paletteColor(ACCENT_CYAN),
                ),
            )
        AreaChartWrapper(series = series, xLabels = daily.map { it.date })
    }
}

// ── Panel 7 — Charging by Time of Day (bar chart) ───────────────────────────────────────────────────────────────

/** Charging-by-Time-of-Day — the web bar `<ChartContainer>`: energy + session count per slot + tips, or `common.noData`. */
@Composable
private fun ChargingByTimePanel(
    sessions: List<ChargingSession>,
    prefs: EnergyDisplayPrefs,
) {
    val buckets = remember(sessions) { timeOfDayBuckets(sessions) }
    val ready = sessions.isNotEmpty()
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_energy_chart_chargingByTime),
        accessibleDescription = stringResource(R.string.translation_energy_chart_chargingByTime_aria),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            val nightLabel = stringResource(R.string.translation_energy_timeOfDay_night)
            val morningLabel = stringResource(R.string.translation_energy_timeOfDay_morning)
            val afternoonLabel = stringResource(R.string.translation_energy_timeOfDay_afternoon)
            val eveningLabel = stringResource(R.string.translation_energy_timeOfDay_evening)
            val labels =
                buckets.map { bucket ->
                    when (bucket.slot) {
                        SLOT_NIGHT -> nightLabel
                        SLOT_MORNING -> morningLabel
                        SLOT_AFTERNOON -> afternoonLabel
                        else -> eveningLabel
                    }
                }
            val series =
                listOf(
                    ChartSeries(
                        key = "energy",
                        label = stringResource(R.string.translation_energy_chart_energyKwh),
                        values = buckets.map { it.energyWh },
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_AMBER),
                    ),
                    ChartSeries(
                        key = "count",
                        label = stringResource(R.string.translation_energy_chart_sessions),
                        values = buckets.map { it.count + 0.0 },
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_PURPLE),
                    ),
                )
            BarChartWrapper(series = series, xLabels = labels)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ChargingTip(icon = EnergyGlyphs.Moon, text = stringResource(R.string.translation_energy_tip_offPeak))
                ChargingTip(icon = EnergyGlyphs.Sun, text = stringResource(R.string.translation_energy_tip_solar))
                    }
                }
    }
}

/** One charging tip — a small icon + its hint copy (web off-peak / solar tips). */
@Composable
private fun ChargingTip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Caption(text)
    }
}

// ── Panel 8 — Charger-Type Breakdown (donut + legend) ───────────────────────────────────────────────────────────

/** Charger-Type-Breakdown — the web pie `<ChartContainer>`: the energy-share donut + legend, or `common.noData`. */
@Composable
private fun ChargerBreakdownPanel(
    sessions: List<ChargingSession>,
    prefs: EnergyDisplayPrefs,
) {
    val slices = remember(sessions) { chargerBreakdown(sessions) }
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_energy_chart_chargerBreakdown),
        accessibleDescription = stringResource(R.string.translation_energy_chart_chargerBreakdown_aria),
        status = if (slices.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_common_noData),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            ChargerDonut(slices = slices)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                slices.forEach { slice -> ChargerLegendRow(slice = slice, prefs = prefs) }
            }
        }
    }
}

/** The page-local Compose-canvas donut sized by each slice's energy share (the A3 chart library carries no pie wrapper). */
@Composable
private fun ChargerDonut(slices: List<EnergyChargerSlice>) {
    val total = slices.sumOf { it.energyWh }
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.size(DONUT_SIZE)) {
            val strokePx = DONUT_RING.toPx()
            val diameter = size.minDimension - strokePx
            val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
            val arcSize = Size(diameter, diameter)
            var startAngle = DONUT_START_ANGLE
            slices.forEach { slice ->
                val fraction = if (total > 0.0) slice.energyWh / total else 1.0 / slices.size
                val sweep = (fraction * DONUT_FULL_SWEEP).toFloat()
                drawArc(
                    color = chargerColor(slice.label),
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
}

/** One breakdown legend row — color swatch + name, session count, and the slice's energy / cost / $-per-kWh. */
@Composable
private fun ChargerLegendRow(
    slice: EnergyChargerSlice,
    prefs: EnergyDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(chargerColor(slice.label)))
            BodyText(slice.label, modifier = Modifier.weight(1f))
            Caption("${slice.count} ${stringResource(R.string.translation_energy_breakdown_sessions)}")
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Caption("${prefs.number(prefs.fromWh(slice.energyWh))} ${prefs.energyLabel}", modifier = Modifier.weight(1f))
            Caption(prefs.currency(slice.cost))
            Caption("${prefs.currency(slice.costPerKwh, PER_KWH_LEGEND_DECIMALS)}$PER_KWH_SUFFIX")
        }
    }
}

// ── Panel 9 — Recent charging sessions (table) ──────────────────────────────────────────────────────────────────

/** GlassPanel9 — the recent-charging-sessions table (web `DataTable`), or the `sessions.empty` empty-state. */
@Composable
private fun RecentSessionsPanel(
    sessions: List<ChargingSession>,
    prefs: EnergyDisplayPrefs,
) {
    val rows = remember(sessions, prefs) { recentSessionRows(sessions, prefs) }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        SectionHeader(
            icon = EnergyGlyphs.Bolt,
            title = stringResource(R.string.translation_energy_sessions_title),
            tint = paletteColor(ACCENT_AMBER),
        )
        Spacer(Modifier.height(Spacing.md))
        if (rows.isNotEmpty()) {
            EnergySessionsTable(rows = rows)
        } else {
            EmptyState(
                message = stringResource(R.string.translation_energy_sessions_empty),
                icon = EnergyGlyphs.Activity,
            )
        }
    }
}

/** The recent-sessions [DataTable] — date / energy / battery / power / type / cost / $-per-kWh columns (web `sessionColumns`). */
@Composable
private fun EnergySessionsTable(rows: List<EnergySessionRow>) {
    val columns: List<TableColumn<EnergySessionRow>> =
        listOf(
            TableColumn<EnergySessionRow>(
                key = "date",
                header = stringResource(R.string.translation_energy_table_date),
                cell = { BodyText(it.date) },
            ),
            TableColumn(
                key = "energy",
                header = stringResource(R.string.translation_energy_table_energy),
                cell = { BodyText(it.energy, color = paletteColor(ACCENT_CYAN)) },
            ),
            TableColumn(
                key = "battery",
                header = stringResource(R.string.translation_energy_table_battery),
                cell = { BatteryCell(it) },
            ),
            TableColumn(
                key = "power",
                header = stringResource(R.string.translation_energy_table_power),
                cell = { BodyText(it.power) },
            ),
            TableColumn(
                key = "type",
                header = stringResource(R.string.translation_energy_table_type),
                cell = { Badge(text = it.chargerLabel, variant = chargerVariant(it)) },
            ),
            TableColumn(
                key = "cost",
                header = stringResource(R.string.translation_energy_table_cost_decimal),
                cell = { BodyText(it.cost) },
            ),
            TableColumn(
                key = "perKwh",
                header = stringResource(R.string.translation_energy_table_perKwh),
                cell = { Caption(it.perKwh) },
            ),
        )
    DataTable(columns = columns, rows = rows, keyOf = { it.id })
}

/** The battery cell — start SoC → end SoC (web `start_soc_pct → end_soc_pct`). */
@Composable
private fun BatteryCell(row: EnergySessionRow) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(socText(row.startSocPct))
        Caption(ARROW)
        BodyText(socText(row.endSocPct), color = paletteColor(ACCENT_GREEN))
    }
}

// ── Shared helpers ──────────────────────────────────────────────────────────────────────────────────────────────

/** A panel header — a tinted icon + the panel title (web `section-title` with a leading lucide icon). */
@Composable
private fun SectionHeader(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    tint: Color,
) {
    Row(
        modifier = Modifier.semantics { contentDescription = title },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Md, tint = tint)
        PanelTitle(title)
    }
}

/** The charger-type accent color (web `CHARGER_COLORS`): Supercharger ▸ red, DC Fast ▸ amber, Home/AC ▸ green. */
private fun chargerColor(label: String): Color =
    when (label) {
        CHARGER_SUPERCHARGER -> paletteColor(ACCENT_RED)
        CHARGER_DC_FAST -> paletteColor(ACCENT_AMBER)
        else -> paletteColor(ACCENT_GREEN)
    }

/** The charger-type badge variant for the table chip (web ring colors). */
private fun chargerVariant(row: EnergySessionRow): BadgeVariant =
    when {
        row.isSupercharger -> BadgeVariant.Danger
        row.isFast -> BadgeVariant.Warning
        else -> BadgeVariant.Success
    }

/** A state-of-charge percentage, or the em dash when absent (web `{soc}%` / `'—'`). */
private fun socText(pct: Double?): String = pct?.let { "${it.toInt()}%" } ?: EM_DASH

/** The arrow drawn between the start and end state-of-charge (web `→`). */
private const val ARROW = "\u2192"

/** Decimals for the breakdown legend's $-per-kWh figure (web `Currency precision={3}`). */
private const val PER_KWH_LEGEND_DECIMALS = 3
