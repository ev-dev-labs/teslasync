// The native Jetpack Compose + Material 3 TrueCostPage analytics surface — a parity port of
// web/src/features/analytics/pages/TrueCostPage.tsx, the EV-vs-gas total-cost-of-ownership dashboard. It reproduces
// the page's nine panels (the four cost/savings hero cards, the cumulative-savings area chart, the cost-per-kilometre
// comparison, the monthly EV-vs-gas bar chart, the savings-breakdown panel, and the no-data empty panel), all three
// charts, every data state (loading / empty / error / success, plus the cache-then-network stale/offline tier), and
// every visible string (resolved from the generated res/values catalog `tco.*` + `common.unit.*`, ADR-014).
//
// Composition: [TrueCostPage] is the stateful entry (constructs the view-model over the host-wired source, records the
// one-shot `view.opened` diagnostic, collects the cost feed + the live display preferences); [TrueCostPageContent] is
// the stateless render layer (the page chrome — title / subtitle / freshness chip / vehicle scope picker — then the
// loading / error / empty / loaded body). The loaded body draws every panel from the single decoded [CostBreakdown];
// all decode + formatting lives in the framework-free model (TrueCostPageModel.kt), so this file only resolves i18n +
// draws. SI values (watt-hours, kilometres) are converted to the user's units only here at the display boundary via
// the model's `prefs.energy`/`prefs.distanceDisplay`/`prefs.currency` (Phase-48 SI-canonical).
//
// Chart colors come from the design-token status palette (ADR-005): EV → status.info (the brand cyan #00f0ff),
// gas/ICE → status.danger (#ef4444), savings → status.success (#10b981) — the token analogues of the web neon hexes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.analytics.truecost

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
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
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The cumulative-savings area chart plot height (web `h-64 sm:h-80`). */
private val CUMULATIVE_CHART_HEIGHT = 280.dp

/** The two comparison bar charts' plot height (web `h-56`). */
private val COMPARISON_CHART_HEIGHT = 224.dp

/** Currency Y-axis fraction digits for the whole-figure charts (web `formatCurrency(v, 0)`). */
private const val AXIS_DECIMALS = 0

/** Per-kilometre fraction digits (web `formatCurrency(v, 3)` + `<Currency precision={3} />`). */
private const val PER_KM_DECIMALS = 3

/** Hard-coded unit symbol the web renders as a literal next to the gas efficiency figure (`{mpg} MPG`). */
private const val MPG_UNIT = "MPG"

/** The web `·` separator between a hero card's two sub-figures. */
private const val MIDDOT = " \u00B7 "

/** The web `→` between the first and last data dates in the total-savings tile. */
private const val DATE_ARROW = " \u2192 "

/** Background tint alpha for a per-km cost pill (web `bg-neon-{c}/10`). */
private const val PILL_BG_ALPHA = 0.10f

/** Border tint alpha for a per-km cost pill (web `border-neon-{c}/20`). */
private const val PILL_BORDER_ALPHA = 0.25f

// ── Stateful entry point ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TrueCostPageViewModel] over the supplied [source] (the host wires the shared
 * Analytics + Settings holders + the active-vehicle selection via [trueCostPageSourceOf]). [logger] defaults to the
 * app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun TrueCostPage(
    source: TrueCostPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TrueCostPageViewModel =
        viewModel(
            key = TrueCostPageRegistration.SLUG,
            factory = viewModelFactory { initializer { TrueCostPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    TrueCostPageContent(
        state = state,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the page chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker),
 * then the state-dependent body — a centered loader on a first load, a retryable error panel on a hard failure, the
 * no-data empty panel when the query resolved with no envelope (web `noData`), or the loaded panels otherwise.
 */
@Composable
fun TrueCostPageContent(
    state: UiState<CostBreakdown>,
    prefs: TrueCostDisplayPrefs,
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
        TrueCostChrome(state = state)

        when {
            state.isLoading -> TrueCostLoading()
            state.isError -> TrueCostError(onRetry = onRetry)
            state.isEmpty -> TrueCostEmptyPanel()
            else -> TrueCostBody(tco = state.data ?: CostBreakdown.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — the title + subtitle (web `PageContainer` title/subtitle) and the actions row. */
@Composable
private fun TrueCostChrome(state: UiState<CostBreakdown>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_tco_title))
                BodyText(
                    stringResource(R.string.translation_tco_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            // web `DataFreshnessAuto query={tcoQuery}` — the cagg-driven freshness chip.
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `<VehicleSelect />` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun TrueCostLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun TrueCostError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * GlassPanel9 — the no-data empty panel (web `<GlassPanel className="p-8"><EmptyState icon message /></GlassPanel>`),
 * surfaced when the query resolved with no envelope: no vehicle selected, or an all-zero account ("Start charging to
 * see your cost analysis").
 */
@Composable
private fun TrueCostEmptyPanel() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        EmptyState(
            modifier = Modifier.fillMaxWidth(),
            icon = TrueCostGlyphs.DollarSign,
            message = stringResource(R.string.translation_tco_noData),
        )
    }
}

/** The loaded body — the eight content panels in their web order, each entering with a staggered fade. */
@Composable
private fun TrueCostBody(
    tco: CostBreakdown,
    prefs: TrueCostDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { HeroCardsGrid(tco, prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { CumulativeSavingsChart(tco, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { CostPerKmChart(tco, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { MonthlyEvVsGasChart(tco, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { SavingsBreakdownPanel(tco, prefs) }
    }
}

// ── Panels 1-4 — Hero cost/savings cards ──────────────────────────────────────────────────────────────────────

/** GlassPanel1-4 — the four cost/savings hero cards in a 2×2 grid (web `StaggerContainer` 4-up `<GlassPanel>` grid). */
@Composable
private fun HeroCardsGrid(
    tco: CostBreakdown,
    prefs: TrueCostDisplayPrefs,
) {
    val gasUnitLabel =
        if (prefs.isLiterGasUnit) {
            stringResource(R.string.translation_common_unit_liter)
        } else {
            stringResource(R.string.translation_common_unit_gallon)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            HeroCard(
                modifier = Modifier.weight(1f),
                accent = PanelAccent.Info,
                icon = TrueCostGlyphs.Zap,
                iconTint = TeslaTokens.status.info,
                label = stringResource(R.string.translation_tco_totalEvCost),
                value = prefs.currency(tco.totalChargingCost),
                sublabel =
                    prefs.energy(tco.totalWh) + MIDDOT +
                        prefs.integer(tco.totalSessions) + " " +
                        stringResource(R.string.translation_tco_sessions),
            )
            HeroCard(
                modifier = Modifier.weight(1f),
                accent = PanelAccent.Danger,
                icon = TrueCostGlyphs.Fuel,
                iconTint = TeslaTokens.status.danger,
                label = stringResource(R.string.translation_tco_equivGasCost),
                value = prefs.currency(tco.equivalentGasCost),
                sublabel =
                    "@ " + prefs.currency(tco.gasPrice) + "/" + gasUnitLabel + MIDDOT +
                        prefs.integer(tco.gasEfficiencyMpg) + " " + MPG_UNIT,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            HeroCard(
                modifier = Modifier.weight(1f),
                accent = PanelAccent.Success,
                icon = TrueCostGlyphs.Leaf,
                iconTint = TeslaTokens.status.success,
                label = stringResource(R.string.translation_tco_totalSavings),
                value = prefs.currency(tco.totalSavings),
                sublabel = stringResource(R.string.translation_tco_overMonths, prefs.number(tco.monthsOfOwnership, 0)),
            )
            HeroCard(
                modifier = Modifier.weight(1f),
                accent = PanelAccent.Success,
                icon = TrueCostGlyphs.TrendingUp,
                iconTint = TeslaTokens.status.success,
                label = stringResource(R.string.translation_tco_monthlySavings),
                value = prefs.currency(tco.monthlySavings),
                sublabel = stringResource(R.string.translation_tco_plusMaintenance),
            )
        }
    }
}

/** One hero cost/savings card — a tinted-accent [GlassPanel] with a leading icon, a label, a big value, and a sub-line. */
@Composable
private fun HeroCard(
    accent: PanelAccent,
    icon: ImageVector,
    iconTint: Color,
    label: String,
    value: String,
    sublabel: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = accent) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(icon, contentDescription = null, size = IconSize.Md, tint = iconTint)
            MetricLabel(label)
        }
        Spacer(modifier = Modifier.height(Spacing.sm))
        MetricValue(value)
        Spacer(modifier = Modifier.height(Spacing.xs))
        HelperText(sublabel)
    }
}

// ── Panel 5 / Chart 1 — Cumulative savings (area) ─────────────────────────────────────────────────────────────

/** Cumulative-Savings-Over-Time — the web `ChartContainer` + `AreaChart` of `cumulative_savings` over the months. */
@Composable
private fun CumulativeSavingsChart(
    tco: CostBreakdown,
    prefs: TrueCostDisplayPrefs,
) {
    val months = tco.monthlyBreakdown
    val savingsColor = TeslaTokens.status.success
    val series =
        listOf(
            ChartSeries(
                key = "cumulative_savings",
                label = stringResource(R.string.translation_tco_cumulativeSavings),
                values = months.map { it.cumulativeSavings },
                kind = ChartSeriesKind.Area,
                color = savingsColor,
            ),
        )
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_tco_cumulativeSavings),
        accessibleDescription = stringResource(R.string.translation_tco_cumulativeSavings_aria),
        status = if (months.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = CUMULATIVE_CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_tco_noMonthlyData),
    ) {
        AreaChartWrapper(
            series = series,
            xLabels = months.map { it.month },
            height = CUMULATIVE_CHART_HEIGHT,
            yValueFormatter = { prefs.currency(it, AXIS_DECIMALS) },
            emptyMessage = stringResource(R.string.translation_tco_noMonthlyData),
        )
    }
}

// ── Panel 6 / Chart 2 — Cost per kilometre (bar) ──────────────────────────────────────────────────────────────

/** Cost-per-Kilometer — the web `ChartContainer` + `BarChart` comparing EV vs ICE per-km cost, plus the two pill cards. */
@Composable
private fun CostPerKmChart(
    tco: CostBreakdown,
    prefs: TrueCostDisplayPrefs,
) {
    val evColor = TeslaTokens.status.info
    val iceColor = TeslaTokens.status.danger
    val evLabel = stringResource(R.string.translation_tco_evElectric)
    val iceLabel = stringResource(R.string.translation_tco_iceGas)
    // Web single `<Bar dataKey="cost" name="Cost/km">` with per-row cyan/red fills — the native single "Cost/km"
    // series carries both categories; the cyan-EV / red-ICE split is surfaced by the two pill cards below.
    val series =
        listOf(
            ChartSeries(
                key = "cost",
                label = stringResource(R.string.translation_tco_costKm),
                values = listOf(tco.costPerKmEv, tco.costPerKmIce),
                kind = ChartSeriesKind.Bar,
                color = paletteColor(0),
            ),
        )
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_tco_costPerKm),
        accessibleDescription = stringResource(R.string.translation_tco_costPerKm_aria),
        status = ChartStatus.Ready,
        height = COMPARISON_CHART_HEIGHT,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            BarChartWrapper(
                series = series,
                xLabels = listOf(evLabel, iceLabel),
                height = COMPARISON_CHART_HEIGHT,
                yValueFormatter = { prefs.currency(it, PER_KM_DECIMALS) },
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
                CostPill(
                    modifier = Modifier.weight(1f),
                    tint = evColor,
                    value = prefs.currency(tco.costPerKmEv, PER_KM_DECIMALS),
                    label = stringResource(R.string.translation_tco_perKmEv),
                )
                CostPill(
                    modifier = Modifier.weight(1f),
                    tint = iceColor,
                    value = prefs.currency(tco.costPerKmIce, PER_KM_DECIMALS),
                    label = stringResource(R.string.translation_tco_perKmGas),
                )
            }
        }
    }
}

/** One per-km cost pill — a tinted card showing a colored value + a muted caption (web `bg-neon-{c}/10` cards). */
@Composable
private fun CostPill(
    tint: Color,
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.semantics { contentDescription = "$label $value" },
        shape = RoundedCornerShape(Radius.lg),
        color = tint.copy(alpha = PILL_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, tint.copy(alpha = PILL_BORDER_ALPHA)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(value, color = tint)
            HelperText(label)
        }
    }
}

// ── Panel 7 / Chart 3 — Monthly EV vs gas (bar) ───────────────────────────────────────────────────────────────

/** Monthly-EV-vs-Gas-Cost — the web `ChartContainer` + `BarChart` of per-month EV cost vs equivalent gas cost. */
@Composable
private fun MonthlyEvVsGasChart(
    tco: CostBreakdown,
    prefs: TrueCostDisplayPrefs,
) {
    val months = tco.monthlyBreakdown
    val evColor = TeslaTokens.status.info
    val gasColor = TeslaTokens.status.danger
    val series =
        listOf(
            ChartSeries(
                key = "ev_cost",
                label = stringResource(R.string.translation_tco_evCost),
                values = months.map { it.evCost },
                kind = ChartSeriesKind.Bar,
                color = evColor,
            ),
            ChartSeries(
                key = "equiv_gas_cost",
                label = stringResource(R.string.translation_tco_gasEquiv),
                values = months.map { it.equivGasCost },
                kind = ChartSeriesKind.Bar,
                color = gasColor,
            ),
        )
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_tco_monthlyEvVsGas),
        accessibleDescription = stringResource(R.string.translation_tco_monthlyEvVsGas_aria),
        status = if (months.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = COMPARISON_CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_tco_noMonthlyData),
    ) {
        BarChartWrapper(
            series = series,
            xLabels = months.map { it.month },
            height = COMPARISON_CHART_HEIGHT,
            yValueFormatter = { prefs.currency(it, AXIS_DECIMALS) },
            emptyMessage = stringResource(R.string.translation_tco_noMonthlyData),
        )
    }
}

// ── Panel 8 — Savings breakdown ───────────────────────────────────────────────────────────────────────────────

/** GlassPanel8 — the three-tile savings breakdown (web `Savings Breakdown` panel). */
@Composable
private fun SavingsBreakdownPanel(
    tco: CostBreakdown,
    prefs: TrueCostDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(TrueCostGlyphs.DollarSign, contentDescription = null, size = IconSize.Lg, tint = TeslaTokens.status.success)
            SectionTitle(stringResource(R.string.translation_tco_savingsBreakdown))
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SavingsTile(
                label = stringResource(R.string.translation_tco_fuelSavings),
                value = prefs.currency(tco.totalSavings),
                sublabel = stringResource(R.string.translation_tco_electricityVsGas),
            )
            SavingsTile(
                label = stringResource(R.string.translation_tco_maintenanceSavings),
                value = prefs.currency(tco.maintenanceSavingsEstimate),
                sublabel = stringResource(R.string.translation_tco_noOilChanges),
            )
            SavingsTile(
                label = stringResource(R.string.translation_tco_totalEstSavings),
                value = prefs.currency(tco.totalEstimatedSavings),
                sublabel =
                    prefs.integer(prefs.distanceDisplay(tco.totalKm)) + " " + prefs.distanceLabel +
                        MIDDOT + tco.firstDate + DATE_ARROW + tco.lastDate,
            )
        }
    }
}

/** One savings-breakdown tile — an inset card with a muted label, a value, and a muted sub-line. */
@Composable
private fun SavingsTile(
    label: String,
    value: String,
    sublabel: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = INSET_TILE_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Caption(label)
            PanelTitle(value)
            HelperText(sublabel)
        }
    }
}

private const val INSET_TILE_ALPHA = 0.45f
