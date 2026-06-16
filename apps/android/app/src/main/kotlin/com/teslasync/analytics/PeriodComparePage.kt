// The native Jetpack Compose + Material 3 PeriodComparePage analytics surface — a parity port of
// web/src/features/analytics/pages/PeriodComparePage.tsx, the two-period comparison surface. It reproduces the
// page's regions: the fleet-comparison disambiguation banner (web `AlertBanner` → /vehicle-comparison), the
// selectors panel (vehicle + Period A + Period B), the six metric cards, the side-by-side bar chart, the
// comparison table, and the deterministic insights — plus every data state (loading / empty / error / success)
// and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [PeriodComparePage] is the stateful entry (constructs the view-model over the host-wired source +
// live unit formatter, records the one-shot `view.opened` diagnostic, collects the single screen state);
// [PeriodComparePageContent] is the stateless render layer. All derivation lives in the framework-free model
// (PeriodComparePageModel.kt); this file only resolves i18n + draws and applies the display-unit conversions at
// the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.periodcompare

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow

/** Up arrow for a non-negative change row (web `↑`). */
private const val ARROW_UP = "\u2191"

/** Down arrow for a negative change row (web `↓`). */
private const val ARROW_DOWN = "\u2193"

/** Bullet prefix for the insight lines (web `• `). */
private const val BULLET = "\u2022"

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 50

/** The page's interaction callbacks, wired to the [PeriodComparePageViewModel] (web event handlers + Link). */
data class PeriodCompareActions(
    val onSelectVehicle: (String) -> Unit,
    val onSelectPeriodA: (PeriodValue) -> Unit,
    val onSelectPeriodB: (PeriodValue) -> Unit,
    val onRetry: () -> Unit,
    val onDismissBanner: () -> Unit,
    val onOpenFleetComparison: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [PeriodComparePageViewModel] over the supplied [source] + live [unitFormatter]
 * (the host wires the shared Vehicles holder, the resilient client, and the units formatter). [logger] defaults
 * to the app's redacting logger.
 */
@Composable
fun PeriodComparePage(
    source: PeriodCompareSource,
    unitFormatter: StateFlow<UnitFormatter>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: PeriodComparePageViewModel =
        viewModel(
            key = PeriodComparePageRegistration.SLUG,
            factory = viewModelFactory { initializer { PeriodComparePageViewModel(source, unitFormatter, logger) } },
        )
    PeriodComparePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: records the one-shot `view.opened` diagnostic and binds the screen state to the content. */
@Composable
fun PeriodComparePage(
    viewModel: PeriodComparePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val model by viewModel.state.collectAsStateWithLifecycle()
    val router = LocalDeepLinkRouter.current
    val actions =
        remember(viewModel, router) {
            PeriodCompareActions(
                onSelectVehicle = viewModel::selectVehicle,
                onSelectPeriodA = viewModel::setPeriodA,
                onSelectPeriodB = viewModel::setPeriodB,
                onRetry = viewModel::retry,
                onDismissBanner = viewModel::dismissBanner,
                onOpenFleetComparison = { router?.request(PeriodComparePageRegistration.FLEET_COMPARE_URI) },
            )
        }

    PeriodComparePageContent(model = model, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header, the optional fleet-comparison disambiguation banner, the
 * always-present selectors panel, then the two-period comparison's loading / error / empty / success surface. On
 * success it draws the six metric cards, the side-by-side bar chart, the comparison table, and the insights.
 */
@Composable
fun PeriodComparePageContent(
    model: PeriodCompareUiModel,
    actions: PeriodCompareActions,
    modifier: Modifier = Modifier,
) {
    val labels = metricLabels()
    val comparison = model.comparison
    val vehiclesPending = model.vehicles.isLoading && !model.vehicles.hasData
    val vehiclesFailed = model.vehicles.isError && !model.vehicles.hasData
    val data = comparison.data

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PeriodCompareHeader()

        if (model.showBanner) {
            FadeIn { DisambiguationBanner(onOpenFleet = actions.onOpenFleetComparison, onDismiss = actions.onDismissBanner) }
        }

        // GlassPanel1 — the vehicle + Period A + Period B selectors (always present).
        FadeIn(delayMs = FADE_STEP_MS) { SelectorsPanel(model = model, actions = actions) }

        when {
            vehiclesPending || comparison.isLoading ->
                FadeIn(delayMs = FADE_STEP_MS * 2) { ComparisonLoading() }

            vehiclesFailed || comparison.isError ->
                FadeIn(delayMs = FADE_STEP_MS * 2) { ComparisonError(onRetry = actions.onRetry) }

            data != null && data.metrics.isNotEmpty() -> {
                // MetricCard2 — the six period-over-period metric cards.
                FadeIn(delayMs = FADE_STEP_MS * 2) { MetricCardsGrid(metrics = data.metrics, labels = labels) }
                // GlassPanel3 — the side-by-side bar chart.
                FadeIn(delayMs = FADE_STEP_MS * 3) { ChartPanel(metrics = data.metrics, labels = labels) }
                // GlassPanel4 — the comparison table.
                FadeIn(delayMs = FADE_STEP_MS * 4) { TablePanel(metrics = data.metrics, labels = labels) }
                // GlassPanel5 — the deterministic insights.
                FadeIn(delayMs = FADE_STEP_MS * 5) { InsightsPanel(data = data) }
            }

            else ->
                FadeIn(delayMs = FADE_STEP_MS * 2) { ComparisonEmpty() }
        }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun PeriodCompareHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_compare_title))
        BodyText(
            stringResource(R.string.translation_compare_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The fleet-comparison disambiguation banner (web `<AlertBanner variant="info">` → /vehicle-comparison). */
@Composable
private fun DisambiguationBanner(
    onOpenFleet: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertBanner(
        message = stringResource(R.string.translation_compare_banner_toFleetPrefix),
        tone = Tone.Info,
        icon = PeriodCompareGlyphs.ArrowLeftRight,
        action = BannerAction(label = stringResource(R.string.translation_compare_banner_toFleetCta), onClick = onOpenFleet),
        onClose = onDismiss,
        closeLabel = stringResource(R.string.translation_common_dismiss),
    )
}

/** GlassPanel1 — the vehicle picker + the two trailing-window selectors (web selectors `GlassPanel`). */
@Composable
private fun SelectorsPanel(
    model: PeriodCompareUiModel,
    actions: PeriodCompareActions,
) {
    val vehicleOptions =
        remember(model.vehicles.data) {
            (model.vehicles.data ?: emptyList()).map { vehicle ->
                SelectOption(vehicle.id.toString(), vehicle.displayName.ifBlank { vehicle.vin })
            }
        }
    val periodOptions = periodOptions()

    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Select(
                options = vehicleOptions,
                selectedValue = model.activeVehicleId,
                onSelect = actions.onSelectVehicle,
                label = stringResource(R.string.translation_compare_vehicle),
            )
            Select(
                options = periodOptions,
                selectedValue = model.periodA.raw,
                onSelect = { raw -> actions.onSelectPeriodA(PeriodValue.fromRaw(raw)) },
                label = stringResource(R.string.translation_compare_periodA),
            )
            Select(
                options = periodOptions,
                selectedValue = model.periodB.raw,
                onSelect = { raw -> actions.onSelectPeriodB(PeriodValue.fromRaw(raw)) },
                label = stringResource(R.string.translation_compare_periodB),
            )
        }
    }
}

/** MetricCard2 — the six metric cards (web `metrics.map(MetricCard)`), two per row. */
@Composable
private fun MetricCardsGrid(
    metrics: List<MetricValue>,
    labels: Map<MetricKind, String>,
) {
    val periodBLabel = stringResource(R.string.translation_compare_periodB)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        metrics.chunked(2).forEach { rowMetrics ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                rowMetrics.forEach { metric ->
                    MetricCardItem(
                        metric = metric,
                        label = labels.getValue(metric.kind),
                        periodBLabel = periodBLabel,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (rowMetrics.size == 1) {
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun MetricCardItem(
    metric: MetricValue,
    label: String,
    periodBLabel: String,
    modifier: Modifier = Modifier,
) {
    val suffix = if (metric.unit.isBlank()) "" else " ${metric.unit}"
    MetricCard(
        label = label,
        value = "${metric.aText}$suffix",
        modifier = modifier,
        icon = metricIcon(metric.kind),
        accent = metricAccent(metric.kind),
        subtitle = "$periodBLabel: ${metric.bText}$suffix",
        delta = { Badge(text = metric.pct.text, variant = changeVariant(metric.pct.positive)) },
    )
}

/** GlassPanel3 — the side-by-side bar chart (web `<BarChart>` Period A vs Period B). */
@Composable
private fun ChartPanel(
    metrics: List<MetricValue>,
    labels: Map<MetricKind, String>,
) {
    val periodALabel = stringResource(R.string.translation_compare_periodA)
    val periodBLabel = stringResource(R.string.translation_compare_periodB)
    val palette = TeslaTokens.chart.categorical
    val series =
        listOf(
            ChartSeries(
                key = "A",
                label = periodALabel,
                values = metrics.map { it.a },
                kind = ChartSeriesKind.Bar,
                color = palette.getOrNull(0),
            ),
            ChartSeries(
                key = "B",
                label = periodBLabel,
                values = metrics.map { it.b },
                kind = ChartSeriesKind.Bar,
                color = palette.getOrNull(1),
            ),
        )
    val xLabels = metrics.map { labels.getValue(it.kind) }

    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_compare_chartTitle))
        Spacer(Modifier.height(Spacing.sm))
        BarChartWrapper(series = series, xLabels = xLabels)
    }
}

/** GlassPanel4 — the comparison table with sortable Period A / Period B / Change columns (web `DataTable`). */
@Composable
private fun TablePanel(
    metrics: List<MetricValue>,
    labels: Map<MetricKind, String>,
) {
    var sortState by remember { mutableStateOf(SortState()) }
    val rows = remember(metrics, sortState) { sortMetrics(metrics, sortState) }
    val columns =
        listOf(
            TableColumn<MetricValue>(
                key = COLUMN_METRIC,
                header = stringResource(R.string.translation_compare_metric),
                weight = 1.4f,
                cell = { BodyText(labels.getValue(it.kind)) },
            ),
            TableColumn(
                key = COLUMN_PERIOD_A,
                header = stringResource(R.string.translation_compare_periodA),
                sortable = true,
                cell = { BodyText(it.aText) },
            ),
            TableColumn(
                key = COLUMN_PERIOD_B,
                header = stringResource(R.string.translation_compare_periodB),
                sortable = true,
                cell = { BodyText(it.bText) },
            ),
            TableColumn(
                key = COLUMN_CHANGE,
                header = stringResource(R.string.translation_compare_change),
                sortable = true,
                cell = { ChangeCell(it) },
            ),
            TableColumn(
                key = COLUMN_PCT,
                header = stringResource(R.string.translation_compare_pctChange),
                cell = { Badge(text = it.pct.text, variant = changeVariant(it.pct.positive)) },
            ),
        )

    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_compare_tableTitle))
        Spacer(Modifier.height(Spacing.sm))
        DataTable(
            columns = columns,
            rows = rows,
            keyOf = { it.kind.name },
            sortState = sortState,
            onSortChange = { key -> sortState = sortState.toggledBy(key) },
        )
    }
}

@Composable
private fun ChangeCell(metric: MetricValue) {
    val arrow = if (metric.pct.positive) ARROW_UP else ARROW_DOWN
    val color = if (metric.pct.positive) TeslaTokens.status.success else TeslaTokens.status.danger
    BodyText("$arrow ${metric.changeText}", color = color)
}

/** GlassPanel5 — the three deterministic insight lines (web `insights.map`). */
@Composable
private fun InsightsPanel(data: PeriodComparison) {
    val more = stringResource(R.string.translation_compare_more)
    val less = stringResource(R.string.translation_compare_less)
    val improved = stringResource(R.string.translation_compare_improved)
    val declined = stringResource(R.string.translation_compare_declined)
    val higher = stringResource(R.string.translation_compare_higher)
    val lower = stringResource(R.string.translation_compare_lower)

    val lines =
        listOf(
            stringResource(
                R.string.translation_compare_insightDistance,
                data.insightDistance.text,
                if (data.insightDistance.positive) more else less,
            ),
            stringResource(
                R.string.translation_compare_insightEfficiency,
                if (data.insightEfficiency.positive) improved else declined,
                data.insightEfficiency.text,
            ),
            stringResource(
                R.string.translation_compare_insightCost,
                data.insightCost.text,
                if (data.insightCost.positive) higher else lower,
            ),
        )

    GlassPanel(padding = PanelPadding.Md) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                PeriodCompareGlyphs.Lightbulb,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.warning,
            )
            PanelTitle(stringResource(R.string.translation_compare_insights))
        }
        Spacer(Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            lines.forEach { line ->
                BodyText("$BULLET $line", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

// ── Data states ─────────────────────────────────────────────────────────────────────────────────────────────

/** First-load surface — six shimmering lines so the comparison region is never blank (web `<Skeleton lines={6}/>`). */
@Composable
private fun ComparisonLoading() {
    GlassPanel(padding = PanelPadding.Md) {
        SkeletonLines(lines = 6)
    }
}

/** Hard-error surface with a retry affordance (web page-tier error). */
@Composable
private fun ComparisonError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                TeslaGlyphs.Octagon,
                contentDescription = null,
                size = IconSize.Xl,
                tint = MaterialTheme.colorScheme.error,
            )
            ErrorText(stringResource(R.string.translation_error_loadFailed))
            Button(
                label = stringResource(R.string.translation_error_retry),
                onClick = onRetry,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The "pick a vehicle and two periods" empty state (web `<EmptyState icon={Calendar} message={compare.empty}>`). */
@Composable
private fun ComparisonEmpty() {
    GlassPanel(padding = PanelPadding.Md) {
        EmptyState(
            message = stringResource(R.string.translation_compare_empty),
            icon = PeriodCompareGlyphs.Calendar,
        )
    }
}

// ── i18n + presentation helpers ───────────────────────────────────────────────────────────────────────────────

private const val COLUMN_METRIC = "metric"
private const val COLUMN_PERIOD_A = "periodA"
private const val COLUMN_PERIOD_B = "periodB"
private const val COLUMN_CHANGE = "change"
private const val COLUMN_PCT = "pctChange"

/** The localized label for every metric kind, resolved once so non-composable contexts (chart/table) can read it. */
@Composable
private fun metricLabels(): Map<MetricKind, String> =
    mapOf(
        MetricKind.Distance to stringResource(R.string.translation_compare_totalDistance),
        MetricKind.Drives to stringResource(R.string.translation_compare_totalDrives),
        MetricKind.Energy to stringResource(R.string.translation_compare_energyUsed),
        MetricKind.Efficiency to stringResource(R.string.translation_compare_avgEfficiency),
        MetricKind.Cost to stringResource(R.string.translation_compare_totalCost),
        MetricKind.Co2 to stringResource(R.string.translation_compare_co2Saved),
    )

/** The trailing-window options for the period selectors (web `periodOptions`). */
@Composable
private fun periodOptions(): List<SelectOption> =
    listOf(
        SelectOption(PeriodValue.LAST_7.raw, stringResource(R.string.translation_compare_last7)),
        SelectOption(PeriodValue.LAST_30.raw, stringResource(R.string.translation_compare_last30)),
        SelectOption(PeriodValue.LAST_90.raw, stringResource(R.string.translation_compare_last90)),
        SelectOption(PeriodValue.LAST_YEAR.raw, stringResource(R.string.translation_compare_lastYear)),
        SelectOption(PeriodValue.ALL_TIME.raw, stringResource(R.string.translation_compare_allTime)),
    )

/** The accent color for a metric card (web cyan/green/purple rotation). */
@Composable
private fun metricAccent(kind: MetricKind): Color =
    when (kind) {
        MetricKind.Distance, MetricKind.Efficiency -> MaterialTheme.colorScheme.primary
        MetricKind.Drives, MetricKind.Cost -> TeslaTokens.status.success
        MetricKind.Energy, MetricKind.Co2 -> TeslaTokens.chart.power
    }

/** The local glyph for a metric card (web lucide icons). */
private fun metricIcon(kind: MetricKind): ImageVector =
    when (kind) {
        MetricKind.Distance -> PeriodCompareGlyphs.Car
        MetricKind.Drives -> PeriodCompareGlyphs.TrendingUp
        MetricKind.Energy -> PeriodCompareGlyphs.Zap
        MetricKind.Efficiency -> PeriodCompareGlyphs.Gauge
        MetricKind.Cost -> PeriodCompareGlyphs.DollarSign
        MetricKind.Co2 -> PeriodCompareGlyphs.Leaf
    }

/** A non-negative change reads as success, a negative one as danger (web `r.positive` badge variant). */
private fun changeVariant(positive: Boolean): BadgeVariant = if (positive) BadgeVariant.Success else BadgeVariant.Danger

/** Sorts the comparison rows by the active column, ascending or descending (web `DataTable` sort). */
private fun sortMetrics(
    metrics: List<MetricValue>,
    sortState: SortState,
): List<MetricValue> {
    val comparator: Comparator<MetricValue> =
        when (sortState.key) {
            COLUMN_PERIOD_A -> compareBy { it.a }
            COLUMN_PERIOD_B -> compareBy { it.b }
            COLUMN_CHANGE -> compareBy { it.change }
            else -> return metrics
        }
    val ascending = metrics.sortedWith(comparator)
    return if (sortState.direction == SortDirection.Asc) ascending else ascending.reversed()
}
