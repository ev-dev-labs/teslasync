// The native Jetpack Compose + Material 3 ChargingListPage charging surface — a parity port of
// web/src/features/charging/pages/ChargingListPage.tsx, the Charging Sessions overview + list. It reproduces the
// page's seven panels (the six-metric KpiOverviewCard tiles + the no-stats GlassPanel), the metric-switcher trend
// chart, every data state (loading skeleton / empty / error-retry / content, plus the cache-then-network
// stale/offline tier the bound state holders carry) for the sessions + optimizer reads, and every visible string
// (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [ChargingListPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the two feeds + the interaction snapshot);
// [ChargingListPageContent] is the stateless render layer. The single sessions feed is fanned out by the
// framework-free model (ChargingListPageModel) into the overview stats, the trend series, the collection
// counts/filter, the structured search, the sort/pagination/grouping, the anomaly/notable detection, and the
// four conditional analytical inputs the existing A3 feature views consume — exactly as the web page threads its
// loaded `sessions` down to those same components.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.charginglist

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.forms.SortOption
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.acdcstatspanel.AcDcStatsPanel
import io.teslasync.android.featureviews.batterylevelchart.BatteryLevelChart
import io.teslasync.android.featureviews.chargerspecspanel.ChargerSpecsPanel
import io.teslasync.android.featureviews.chargingsessioncard.CardDensity
import io.teslasync.android.featureviews.chargingsessioncard.ChargingSessionCard
import io.teslasync.android.featureviews.efficiencypanel.EfficiencyPanel
import io.teslasync.android.featureviews.optimizersection.ChargingOptimizerData
import io.teslasync.android.featureviews.optimizersection.OptimizerSection
import io.teslasync.android.sharedsurfaces.activefilterchips.ActiveFilterChips
import io.teslasync.android.sharedsurfaces.activefilterchips.FilterChipDescriptor
import io.teslasync.android.sharedsurfaces.bulkactionstoolbar.BulkAction
import io.teslasync.android.sharedsurfaces.bulkactionstoolbar.BulkActionIntent
import io.teslasync.android.sharedsurfaces.bulkactionstoolbar.BulkActionsToolbar
import io.teslasync.android.sharedsurfaces.bulkactionstoolbar.BulkConfirmCopy
import io.teslasync.android.sharedsurfaces.bulkactionstoolbar.BulkItemNoun
import io.teslasync.android.sharedsurfaces.dategroupedlist.DateGroupedList
import io.teslasync.android.sharedsurfaces.dategroupedlist.DateGroupedListGroup
import io.teslasync.android.sharedsurfaces.densitytoggle.Density
import io.teslasync.android.sharedsurfaces.densitytoggle.DensityToggle
import io.teslasync.android.sharedsurfaces.emptystatethreshold.EmptyStateThreshold
import io.teslasync.android.sharedsurfaces.inlinecallout.CalloutVariant
import io.teslasync.android.sharedsurfaces.inlinecallout.InlineCallout
import io.teslasync.android.sharedsurfaces.inlinecallout.InlineCalloutAction
import io.teslasync.android.sharedsurfaces.kpioverviewcard.KpiHeaderModel
import io.teslasync.android.sharedsurfaces.kpioverviewcard.KpiOverviewCard
import io.teslasync.android.sharedsurfaces.metriccard.MetricCard
import io.teslasync.android.sharedsurfaces.metriccard.MetricCardAccent
import io.teslasync.android.sharedsurfaces.metriccard.MetricCardValue
import io.teslasync.android.sharedsurfaces.metricswitcherchart.MetricChartKind
import io.teslasync.android.sharedsurfaces.metricswitcherchart.MetricPoint
import io.teslasync.android.sharedsurfaces.metricswitcherchart.MetricSwitcherChart
import io.teslasync.android.sharedsurfaces.metricswitcherchart.MetricSwitcherMetric
import io.teslasync.android.sharedsurfaces.pageheadersticky.PageHeaderSticky
import io.teslasync.android.sharedsurfaces.pillfilterbar.PillAccent
import io.teslasync.android.sharedsurfaces.pillfilterbar.PillFilterBar
import io.teslasync.android.sharedsurfaces.pillfilterbar.PillFilterBarItem
import io.teslasync.android.sharedsurfaces.sortcontrol.SortControl
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.time.ZoneId

/** The currency symbol used for cost figures + anomaly messages (web `useFormatting().currencySymbol`). */
private const val CURRENCY_SYMBOL = "$"

/** The lenient JSON used to decode the optimizer payload into [ChargingOptimizerData]. */
private val optimizerJson = Json { ignoreUnknownKeys = true }

/** The page's interaction callbacks, wired to the [ChargingListPageViewModel] (web event handlers). */
data class ChargingListActions(
    val onSearch: (String) -> Unit,
    val onCollection: (ChargingCollection) -> Unit,
    val onSortField: (ChargingSortField) -> Unit,
    val onSortDesc: (Boolean) -> Unit,
    val onDensity: (ChargingListDensity) -> Unit,
    val onPage: (Int) -> Unit,
    val onTrendMetric: (ChargingTrendMetric) -> Unit,
    val onToggleBulk: (Long, Boolean) -> Unit,
    val onClearBulk: () -> Unit,
    val onBulkDelete: suspend (List<Long>) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ChargingListPageViewModel] over the supplied [source] (the host wires the
 * shared charging repository + the app-scoped active-vehicle selection via [chargingListPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun ChargingListPage(
    source: ChargingListPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ChargingListPageViewModel =
        viewModel(
            key = ChargingListPageRegistration.SLUG,
            factory = viewModelFactory { initializer { ChargingListPageViewModel(source, logger) } },
        )
    ChargingListPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the stateless content. */
@Composable
fun ChargingListPage(
    viewModel: ChargingListPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val sessionsState by viewModel.sessionsState.collectAsStateWithLifecycle()
    val optimizerState by viewModel.optimizerState.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            ChargingListActions(
                onSearch = viewModel::setSearch,
                onCollection = viewModel::setCollection,
                onSortField = viewModel::setSortField,
                onSortDesc = viewModel::setSortDesc,
                onDensity = viewModel::setDensity,
                onPage = viewModel::setPage,
                onTrendMetric = viewModel::setTrendMetric,
                onToggleBulk = viewModel::toggleBulkSelected,
                onClearBulk = viewModel::clearBulk,
                onBulkDelete = viewModel::deleteCharging,
                onRetry = viewModel::retry,
            )
        }

    ChargingListPageContent(
        interaction = interaction,
        sessionsState = sessionsState,
        optimizerState = optimizerState,
        actions = actions,
        windowStart = viewModel.windowStart,
        windowEnd = viewModel.windowEnd,
        priorRange = viewModel.priorRange,
        zone = viewModel.zone,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading sessions feed (with nothing cached) renders the full-page skeleton
 * (web `LoadingSkeleton`); otherwise the page header is drawn, then — inside a sticky-header scroll container —
 * the error banner, the search + filter chips, the overview (the six-metric KpiOverviewCard or the no-stats
 * GlassPanel), the trend chart, the collections, the conditional analytical sections, the list controls, and the
 * date-grouped session list (with the bulk toolbar + pagination) or the empty state.
 */
@Composable
fun ChargingListPageContent(
    interaction: ChargingListInteraction,
    sessionsState: UiState<List<ChargingSession>>,
    optimizerState: UiState<JsonElement>,
    actions: ChargingListActions,
    windowStart: String,
    windowEnd: String,
    priorRange: DateRange?,
    zone: ZoneId,
    modifier: Modifier = Modifier,
) {
    if (sessionsState.isLoading) {
        ChargingListLoading(modifier)
        return
    }

    val sessions = sessionsState.data.orEmpty()
    val derived =
        remember(sessions, interaction, windowStart, windowEnd, priorRange) {
            deriveChargingList(sessions, interaction, windowStart, windowEnd, priorRange, zone)
        }
    val optimizer = remember(optimizerState) { mapOptimizer(optimizerState) }
    val listState = rememberLazyListState()
    val stickySummary = chargingStickySummary(derived, interaction)

    Box(modifier = modifier.fillMaxSize()) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().padding(horizontal = Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            contentPadding =
                androidx.compose.foundation.layout
                    .PaddingValues(vertical = Spacing.lg),
        ) {
            item { ChargingListHeader() }

            if (sessionsState.isError) {
                item { ChargingListError(onRetry = actions.onRetry) }
            }

            item { ChargingListSearch(interaction = interaction, derived = derived, actions = actions) }

            item { ChargingListOverview(derived = derived, interaction = interaction, actions = actions) }

            if (derived.currentStats.count > 0) {
                item { ChargingListTrend(derived = derived, interaction = interaction, actions = actions) }
            }

            item { ChargingListCollections(derived = derived, interaction = interaction, actions = actions) }

            if (sessions.isNotEmpty()) {
                chargingAnalyticsItems(
                    this,
                    derived = derived,
                    optimizer = optimizer,
                    sessionCount = sessions.size,
                    onRetry = actions.onRetry,
                )
            }

            item { ChargingListControls(derived = derived, interaction = interaction, actions = actions) }

            chargingListBodyItems(this, derived = derived, interaction = interaction, actions = actions)
        }

        PageHeaderSticky(
            listState = listState,
            ariaLabel = stringResource(R.string.translation_charging_stickyBar_aria),
            heroItemIndex = 0,
            summary = stickySummary,
        )
    }
}

// ── Header ────────────────────────────────────────────────────────────────────────────────────────────────────

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun ChargingListHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_charging_list_title))
        BodyText(
            stringResource(R.string.translation_charging_list_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The hard-error banner for the sessions feed (web `QueryError`) — a retry-able panel. */
@Composable
private fun ChargingListError(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Lg) {
        ErrorDisplay(
            message = stringResource(R.string.translation_common_noData),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
        )
    }
}

// ── Search + active filter chips (web FilterBar + ActiveFilterChips) ──────────────────────────────────────────

@Composable
private fun ChargingListSearch(
    interaction: ChargingListInteraction,
    derived: ChargingListData,
    actions: ChargingListActions,
) {
    var searchPending by remember { mutableStateOf(false) }
    LaunchedEffect(interaction.search) {
        if (interaction.search.isEmpty()) {
            searchPending = false
        } else {
            searchPending = true
            delay(SEARCH_PENDING_MS)
            searchPending = false
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Input(
            value = interaction.search,
            onValueChange = actions.onSearch,
            hint = stringResource(R.string.translation_charging_searchPlaceholder), // parity:allow searchPlaceholder is an i18n key name, not a stub
            modifier = Modifier.fillMaxWidth(),
        )
        if (searchPending) {
            Caption(stringResource(R.string.translation_filter_pending))
        }
        val filters =
            buildList {
                if (interaction.search.isNotEmpty()) {
                    add(
                        FilterChipDescriptor(
                            key = "q",
                            label = stringResource(R.string.translation_charging_filterLabel_search),
                            value = interaction.search,
                            onRemove = { actions.onSearch("") },
                        ),
                    )
                }
                if (interaction.collection != ChargingCollection.All) {
                    add(
                        FilterChipDescriptor(
                            key = "coll",
                            label = stringResource(R.string.translation_charging_filterLabel_collection),
                            value = collectionLabel(interaction.collection),
                            onRemove = { actions.onCollection(ChargingCollection.All) },
                        ),
                    )
                }
            }
        ActiveFilterChips(
            filters = filters,
            onClearAll = {
                actions.onSearch("")
                actions.onCollection(ChargingCollection.All)
            },
        )
    }
}

// ── Overview (web KpiOverviewCard with six MetricCards, or the no-stats GlassPanel) ───────────────────────────

@Composable
private fun ChargingListOverview(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    val stats = derived.currentStats
    if (stats.count <= 0) {
        GlassPanel(padding = PanelPadding.Lg) {
            EmptyState(message = stringResource(R.string.translation_charging_noStatsRange))
        }
        return
    }

    val periodLabel = "${formatDayKey(derived.windowStart, long = true)} – ${formatDayKey(derived.windowEnd, long = true)}"
    val priorLabel =
        derived.priorRange?.let { range ->
            if (derived.priorHasData) {
                stringResource(
                    R.string.translation_charging_priorPeriod,
                    formatDayKey(range.start, long = true),
                    formatDayKey(range.end, long = true),
                )
            } else {
                stringResource(
                    R.string.translation_charging_noPriorData,
                    formatDayKey(range.start, long = true),
                    formatDayKey(range.end, long = true),
                )
            }
        }

    KpiOverviewCard(
        header =
            KpiHeaderModel(
                title = stringResource(R.string.translation_charging_overview),
                currentLabel = periodLabel,
                comparisonLabel = priorLabel,
            ),
        secondary = chargingSecondaryLine(stats),
        footer = chargingAnomalyFooter(derived, interaction, actions),
    ) {
        MetricCard(
            label = stringResource(R.string.translation_charging_totalSessions),
            value = MetricCardValue.Text(fmtCompact(stats.count * 1.0)),
            accent = MetricCardAccent.Cyan,
            modifier = Modifier.weight(1f),
        )
        MetricCard(
            label = stringResource(R.string.translation_charging_totalEnergy),
            value = MetricCardValue.Text(fmtCompact(stats.totalEnergyWh / 1000.0)),
            accent = MetricCardAccent.Green,
            modifier = Modifier.weight(1f),
        )
        MetricCard(
            label = stringResource(R.string.translation_charging_totalCost),
            value = MetricCardValue.Text(money(stats.totalCost)),
            accent = MetricCardAccent.Red,
            modifier = Modifier.weight(1f),
        )
        MetricCard(
            label = stringResource(R.string.translation_charging_avgRate),
            value = MetricCardValue.Text(stats.avgRateKw?.let { fmtNumber(it, 1) } ?: EM_DASH),
            accent = MetricCardAccent.Purple,
            modifier = Modifier.weight(1f),
        )
        MetricCard(
            label = stringResource(R.string.translation_charging_avgDuration),
            value = MetricCardValue.Text(stats.avgDurationMin?.let { formatDurationMinutes(it) } ?: EM_DASH),
            accent = MetricCardAccent.Blue,
            modifier = Modifier.weight(1f),
        )
        MetricCard(
            label = stringResource(R.string.translation_charging_avgPower),
            value = MetricCardValue.Text(stats.avgPowerW?.let { fmtNumber(it / 1000.0, 1) } ?: EM_DASH),
            accent = MetricCardAccent.Amber,
            modifier = Modifier.weight(1f),
        )
    }
}

/** The muted secondary line beneath the KPI grid (web `secondaryLine`). */
@Composable
private fun chargingSecondaryLine(stats: ChargingPeriodStats): String {
    val byType =
        stringResource(
            R.string.translation_charging_byType,
            stats.byCategory[ChargerCat.Home] ?: 0,
            stats.byCategory[ChargerCat.Supercharger] ?: 0,
            stats.byCategory[ChargerCat.Dc] ?: 0,
        )
    val free = stringResource(R.string.translation_charging_freeCount, stats.freeCount)
    val parts = mutableListOf(byType, free)
    if (stats.batteryFriendlyScore != null) {
        parts += "${stringResource(R.string.translation_charging_batteryScore)} ${stats.batteryFriendlyGrade.label}"
    }
    stats.mostCommonStartHour?.let { parts += stringResource(R.string.translation_charging_mostCommon, formatHour(it)) }
    return parts.joinToString(" · ")
}

/** The anomaly callout footer (web `anomalyFooter`) — shown unless already viewing the anomalies collection. */
@Composable
private fun chargingAnomalyFooter(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
): (@Composable () -> Unit)? {
    if (derived.anomalies.isEmpty() || interaction.collection == ChargingCollection.Anomalies) return null
    val noun =
        if (derived.anomalies.size == 1) {
            stringResource(R.string.translation_charging_anomaly_one)
        } else {
            stringResource(R.string.translation_charging_anomaly_other)
        }
    val message = stringResource(R.string.translation_charging_anomalyCount, derived.anomalies.size, noun)
    val viewLabel = stringResource(R.string.translation_charging_viewAnomalies)
    return {
        InlineCallout(
            variant = CalloutVariant.Warning,
            message = message,
            action = InlineCalloutAction(label = viewLabel, onActivate = { actions.onCollection(ChargingCollection.Anomalies) }),
        )
    }
}

// ── Trend chart (web MetricSwitcherChart) ─────────────────────────────────────────────────────────────────────

@Composable
private fun ChargingListTrend(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    val metrics =
        listOf(
            MetricSwitcherMetric<MetricPoint>(
                key = "sessions",
                label = stringResource(R.string.translation_charging_metric_sessions),
                getValue = { it.value },
                chart = MetricChartKind.Bar,
                color = Color(0xFF10B981),
                formatValue = { fmtInt(it) },
                formatTick = { fmtInt(it) },
            ),
            MetricSwitcherMetric(
                key = "energy",
                label = stringResource(R.string.translation_charging_metric_energy),
                getValue = { it.value },
                chart = MetricChartKind.Bar,
                color = Color(0xFF06B6D4),
                formatValue = { "${fmtNumber(it, 1)} kWh" },
                formatTick = { fmtNumber(it, 1) },
            ),
            MetricSwitcherMetric(
                key = "cost",
                label = stringResource(R.string.translation_charging_metric_cost),
                getValue = { it.value },
                chart = MetricChartKind.Bar,
                color = Color(0xFFEF4444),
                formatValue = { money(it) },
                formatTick = { money(it) },
            ),
            MetricSwitcherMetric(
                key = "power",
                label = stringResource(R.string.translation_charging_metric_power),
                getValue = { it.value },
                chart = MetricChartKind.Line,
                color = Color(0xFFA855F7),
                formatValue = { "${fmtNumber(it, 1)} kW" },
                formatTick = { fmtNumber(it, 0) },
            ),
        )
    MetricSwitcherChart(
        title = stringResource(R.string.translation_charging_overTime),
        ariaLabel = stringResource(R.string.translation_charging_overTime_aria),
        series = derived.trendSeries,
        metrics = metrics,
        activeMetric = trendKey(interaction.trendMetric),
        onMetricChange = { actions.onTrendMetric(trendFromKey(it)) },
        emptyMessage = stringResource(R.string.translation_charging_overTime_empty),
        xSelector = { it.date },
        formatXTick = { formatDayKey(it, long = false) },
    )
}

// ── Collections (web PillFilterBar) ───────────────────────────────────────────────────────────────────────────

@Composable
private fun ChargingListCollections(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    val counts = derived.counts
    val items =
        listOf(
            PillFilterBarItem(
                key = "all",
                label = stringResource(R.string.translation_charging_coll_all),
                count = counts.all,
                accent = PillAccent.Cyan,
            ),
            PillFilterBarItem(
                key = "home",
                label = stringResource(R.string.translation_charging_coll_home),
                count = counts.home,
                accent = PillAccent.Green,
            ),
            PillFilterBarItem(
                key = "supercharger",
                label = stringResource(R.string.translation_charging_coll_supercharger),
                count = counts.supercharger,
                accent = PillAccent.Red,
            ),
            PillFilterBarItem(
                key = "dc",
                label = stringResource(R.string.translation_charging_coll_dc),
                count = counts.dc,
                accent = PillAccent.Amber,
            ),
            PillFilterBarItem(
                key = "free",
                label = stringResource(R.string.translation_charging_coll_free),
                count = counts.free,
                accent = PillAccent.Green,
            ),
            PillFilterBarItem(
                key = "anomalies",
                label = stringResource(R.string.translation_charging_coll_anomalies),
                count = counts.anomalies,
                accent = PillAccent.Red,
            ),
            PillFilterBarItem(
                key = "notable",
                label = stringResource(R.string.translation_charging_coll_notable),
                count = counts.notable,
                accent = PillAccent.Purple,
            ),
            PillFilterBarItem(
                key = "tagged",
                label = stringResource(R.string.translation_charging_coll_tagged),
                count = 0,
                accent = PillAccent.Cyan,
                disabled = true,
            ),
        )
    PillFilterBar(
        items = items,
        activeKey = collectionKey(interaction.collection),
        onChange = { actions.onCollection(collectionFromKey(it)) },
        ariaLabel = stringResource(R.string.translation_charging_collections_aria),
    )
}

// ── Conditional analytical sections (web charging-list panels, each threshold-gated) ──────────────────────────

private fun chargingAnalyticsItems(
    scope: androidx.compose.foundation.lazy.LazyListScope,
    derived: ChargingListData,
    optimizer: UiState<ChargingOptimizerData>,
    sessionCount: Int,
    onRetry: () -> Unit,
) {
    // AC vs DC overview — even small datasets benefit.
    if (derived.acDc.ac.count + derived.acDc.dc.count >= ChargingListPageRegistration.THRESHOLD_AC_DC) {
        scope.item { AcDcStatsPanel(breakdown = derived.acDc) }
    }

    // Battery start-level distribution — needs ≥5 sessions to be meaningful.
    val hasStartLevels = derived.startLevel.any { it.count > 0 }
    if (hasStartLevels && sessionCount >= ChargingListPageRegistration.THRESHOLD_BATTERY_DIST) {
        scope.item { BatteryLevelChart(buckets = derived.startLevel) }
    } else if (sessionCount in 1 until ChargingListPageRegistration.THRESHOLD_BATTERY_DIST) {
        scope.item {
            EmptyStateThreshold(
                currentCount = sessionCount,
                threshold = ChargingListPageRegistration.THRESHOLD_BATTERY_DIST,
                sectionLabel = stringResource(R.string.translation_charging_section_batteryDist),
                itemNoun = stringResource(R.string.translation_charging_itemNoun),
                description = stringResource(R.string.translation_charging_section_batteryDistDesc),
            )
        }
    }

    // Efficiency panel — renders whenever present.
    if (derived.efficiency != null) {
        scope.item { EfficiencyPanel(stats = derived.efficiency) }
    }

    // Charger specs — needs ≥5 to compare.
    if (derived.chargerSpecs != null && sessionCount >= ChargingListPageRegistration.THRESHOLD_SPECS) {
        scope.item { ChargerSpecsPanel(specs = derived.chargerSpecs) }
    } else if (sessionCount in 1 until ChargingListPageRegistration.THRESHOLD_SPECS) {
        scope.item {
            EmptyStateThreshold(
                currentCount = sessionCount,
                threshold = ChargingListPageRegistration.THRESHOLD_SPECS,
                sectionLabel = stringResource(R.string.translation_charging_section_specs),
                itemNoun = stringResource(R.string.translation_charging_itemNoun),
            )
        }
    }

    // Optimizer — needs ≥10 sessions for patterns; the feature view renders its own loading/empty/error/content.
    if (sessionCount >= ChargingListPageRegistration.THRESHOLD_OPTIMIZER) {
        scope.item { OptimizerSection(state = optimizer, onRetry = onRetry) }
    } else if (sessionCount in 1 until ChargingListPageRegistration.THRESHOLD_OPTIMIZER) {
        scope.item {
            EmptyStateThreshold(
                currentCount = sessionCount,
                threshold = ChargingListPageRegistration.THRESHOLD_OPTIMIZER,
                sectionLabel = stringResource(R.string.translation_charging_section_optimizer),
                itemNoun = stringResource(R.string.translation_charging_itemNoun),
                description = stringResource(R.string.translation_charging_section_optimizerDesc),
            )
        }
    }
}

// ── List controls (web sort / density / export bar) ───────────────────────────────────────────────────────────

@Composable
private fun ChargingListControls(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    if (derived.sorted.isEmpty()) {
        EmptyState(message = stringResource(R.string.translation_common_noData))
        return
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionTitle("${stringResource(R.string.translation_charging_allSessions)} (${fmtCompact(derived.sorted.size * 1.0)})")
        SortControl(
            field = sortKey(interaction.sortField),
            direction = if (interaction.sortDesc) SortDirection.Desc else SortDirection.Asc,
            options =
                listOf(
                    SortOption("date", stringResource(R.string.translation_charging_sort_date)),
                    SortOption("energy", stringResource(R.string.translation_charging_sort_energy)),
                    SortOption("cost", stringResource(R.string.translation_charging_sort_cost)),
                    SortOption("duration", stringResource(R.string.translation_charging_sort_duration)),
                    SortOption("power", stringResource(R.string.translation_charging_sort_power)),
                ),
            onFieldChange = { actions.onSortField(sortFromKey(it)) },
            onDirectionChange = { actions.onSortDesc(it == SortDirection.Desc) },
        )
    }
    DensityToggle(
        value = if (interaction.density == ChargingListDensity.Compact) Density.Compact else Density.Comfortable,
        onChange = { actions.onDensity(if (it == Density.Compact) ChargingListDensity.Compact else ChargingListDensity.Comfortable) },
        options = listOf(Density.Compact, Density.Comfortable),
    )
}

// ── Session list body (web BulkActionsToolbar + DateGroupedList + Pagination, or empty state) ─────────────────

private fun chargingListBodyItems(
    scope: androidx.compose.foundation.lazy.LazyListScope,
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    if (derived.paginated.isEmpty()) {
        scope.item { ChargingListEmpty(interaction = interaction, actions = actions) }
        return
    }

    scope.item { ChargingListBulkBar(derived = derived, actions = actions) }
    scope.item { ChargingListGroups(derived = derived, interaction = interaction, actions = actions) }
    scope.item { ChargingListPagination(derived = derived, interaction = interaction, actions = actions) }
}

@Composable
private fun ChargingListBulkBar(
    derived: ChargingListData,
    actions: ChargingListActions,
) {
    val deleteLabel = stringResource(R.string.translation_bulk_actions_delete)
    val confirmTitle =
        stringResource(
            R.string.translation_bulk_deleteConfirmTitle,
            derived.effectiveSelected.size.toString(),
            bulkNoun(derived.effectiveSelected.size),
        )
    val confirmDescription = stringResource(R.string.translation_bulk_deleteConfirmDescription)
    val confirmLabel = stringResource(R.string.translation_common_delete)
    BulkActionsToolbar(
        selectedIds = derived.effectiveSelected.map { it.toString() },
        onClear = actions.onClearBulk,
        total = derived.filtered.size,
        itemNoun =
            BulkItemNoun(
                one = stringResource(R.string.translation_bulk_noun_session_one),
                other = stringResource(R.string.translation_bulk_noun_session_other),
            ),
        actions =
            listOf(
                BulkAction(
                    id = "delete",
                    label = deleteLabel,
                    onClick = { ids -> actions.onBulkDelete(ids.mapNotNull { it.toLongOrNull() }) },
                    intent = BulkActionIntent.Danger,
                    confirm = BulkConfirmCopy(title = confirmTitle, description = confirmDescription, confirmLabel = confirmLabel),
                ),
            ),
    )
}

@Composable
private fun ChargingListGroups(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    val cardDensity = if (interaction.density == ChargingListDensity.Compact) CardDensity.Compact else CardDensity.Comfortable
    val groups =
        derived.groups.map { group ->
            val noun = bulkNoun(group.sessions.size)
            DateGroupedListGroup(
                dateKey = group.dateKey,
                dateLabel = formatDayKey(group.dateKey, long = true),
                summary = "${group.sessions.size} $noun · ${fmtNumber(group.totalEnergyKwh, 1)} kWh",
                items = group.sessions,
            )
        }
    DateGroupedList(
        groups = groups,
        itemKey = { item, _ -> item.id },
    ) { session, _ ->
        ChargingSessionCard(
            session = session,
            selected = derived.effectiveSelected.contains(session.id),
            onToggleSelect = actions.onToggleBulk,
            anomaly = derived.anomalyById[session.id]?.toCardAnomaly(),
            density = cardDensity,
        )
    }
}

@Composable
private fun ChargingListPagination(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    val showingTemplate = stringResource(R.string.translation_pagination_showing)
    Pagination(
        page = interaction.page,
        pageSize = ChargingListPageRegistration.PAGE_SIZE,
        total = derived.sorted.size,
        onPageChange = actions.onPage,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, total -> String.format(showingTemplate, start.toString(), end.toString(), total.toString()) },
    )
}

@Composable
private fun ChargingListEmpty(
    interaction: ChargingListInteraction,
    actions: ChargingListActions,
) {
    val filtered = interaction.collection != ChargingCollection.All
    EmptyState(
        title =
            if (filtered) {
                stringResource(R.string.translation_charging_emptyForCollection)
            } else {
                stringResource(R.string.translation_charging_emptyTitle)
            },
        message =
            if (filtered) {
                stringResource(R.string.translation_charging_emptyForCollection_msg)
            } else {
                stringResource(R.string.translation_charging_emptyMessage)
            },
        action =
            EmptyStateAction(
                label = stringResource(R.string.translation_charging_empty_cta),
                onClick = {
                    actions.onSearch("")
                    actions.onCollection(ChargingCollection.All)
                    actions.onSortField(ChargingSortField.Date)
                    actions.onPage(1)
                },
            ),
    )
}

// ── Loading skeleton (web `LoadingSkeleton`) ──────────────────────────────────────────────────────────────────

@Composable
private fun ChargingListLoading(modifier: Modifier = Modifier) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeaderSkeleton()
        Skeleton(widthFraction = 1f, height = 44.dp)
        StatGridSkeleton(count = SKELETON_KPIS)
        ChartBlockSkeleton(height = 220.dp)
        Skeleton(widthFraction = 0.6f, height = 32.dp)
        repeat(SKELETON_ROWS) { Skeleton(height = 80.dp) }
    }
}

// ── Sticky summary + small @Composable label helpers ──────────────────────────────────────────────────────────

@Composable
private fun chargingStickySummary(
    derived: ChargingListData,
    interaction: ChargingListInteraction,
): String {
    val title = stringResource(R.string.translation_charging_list_title)
    val collection = collectionLabel(interaction.collection)
    val results = "${fmtCompact(derived.filtered.size * 1.0)} ${stringResource(R.string.translation_charging_results)}"
    val parts = mutableListOf(title, collection, results)
    if (derived.currentStats.batteryFriendlyGrade.label != EM_DASH) {
        parts += "${stringResource(R.string.translation_charging_avgScore)} ${derived.currentStats.batteryFriendlyGrade.label}"
    }
    return parts.joinToString(" · ")
}

@Composable
private fun collectionLabel(collection: ChargingCollection): String =
    when (collection) {
        ChargingCollection.All -> stringResource(R.string.translation_charging_coll_all)
        ChargingCollection.Home -> stringResource(R.string.translation_charging_coll_home)
        ChargingCollection.Supercharger -> stringResource(R.string.translation_charging_coll_supercharger)
        ChargingCollection.Dc -> stringResource(R.string.translation_charging_coll_dc)
        ChargingCollection.Free -> stringResource(R.string.translation_charging_coll_free)
        ChargingCollection.Anomalies -> stringResource(R.string.translation_charging_coll_anomalies)
        ChargingCollection.Notable -> stringResource(R.string.translation_charging_coll_notable)
        ChargingCollection.Tagged -> stringResource(R.string.translation_charging_coll_tagged)
    }

@Composable
private fun bulkNoun(count: Int): String =
    if (count == 1) {
        stringResource(R.string.translation_bulk_noun_session_one)
    } else {
        stringResource(R.string.translation_bulk_noun_session_other)
    }

private const val EM_DASH = "\u2014"
private const val SKELETON_KPIS = 6
private const val SKELETON_ROWS = 5
private const val SEARCH_PENDING_MS = 150L

private fun money(value: Double): String = "$CURRENCY_SYMBOL${fmtNumber(value, 2)}"

private fun trendKey(metric: ChargingTrendMetric): String =
    when (metric) {
        ChargingTrendMetric.Sessions -> "sessions"
        ChargingTrendMetric.Energy -> "energy"
        ChargingTrendMetric.Cost -> "cost"
        ChargingTrendMetric.Power -> "power"
    }

private fun trendFromKey(key: String): ChargingTrendMetric =
    when (key) {
        "energy" -> ChargingTrendMetric.Energy
        "cost" -> ChargingTrendMetric.Cost
        "power" -> ChargingTrendMetric.Power
        else -> ChargingTrendMetric.Sessions
    }

private fun sortKey(field: ChargingSortField): String =
    when (field) {
        ChargingSortField.Date -> "date"
        ChargingSortField.Energy -> "energy"
        ChargingSortField.Cost -> "cost"
        ChargingSortField.Duration -> "duration"
        ChargingSortField.Power -> "power"
    }

private fun sortFromKey(key: String): ChargingSortField =
    when (key) {
        "energy" -> ChargingSortField.Energy
        "cost" -> ChargingSortField.Cost
        "duration" -> ChargingSortField.Duration
        "power" -> ChargingSortField.Power
        else -> ChargingSortField.Date
    }

private fun collectionKey(collection: ChargingCollection): String =
    when (collection) {
        ChargingCollection.All -> "all"
        ChargingCollection.Home -> "home"
        ChargingCollection.Supercharger -> "supercharger"
        ChargingCollection.Dc -> "dc"
        ChargingCollection.Free -> "free"
        ChargingCollection.Anomalies -> "anomalies"
        ChargingCollection.Notable -> "notable"
        ChargingCollection.Tagged -> "tagged"
    }

private fun collectionFromKey(key: String): ChargingCollection =
    when (key) {
        "home" -> ChargingCollection.Home
        "supercharger" -> ChargingCollection.Supercharger
        "dc" -> ChargingCollection.Dc
        "free" -> ChargingCollection.Free
        "anomalies" -> ChargingCollection.Anomalies
        "notable" -> ChargingCollection.Notable
        "tagged" -> ChargingCollection.Tagged
        else -> ChargingCollection.All
    }

/** Decodes the optimizer JSON payload into a [ChargingOptimizerData] UI state, preserving the feed lifecycle. */
private fun mapOptimizer(state: UiState<JsonElement>): UiState<ChargingOptimizerData> {
    val decoded =
        state.data?.let { element ->
            runCatching { optimizerJson.decodeFromJsonElement(ChargingOptimizerData.serializer(), element) }.getOrNull()
        }
    val phase = if (state.phase == UiPhase.Content && decoded == null) UiPhase.Empty else state.phase
    return UiState(
        phase = phase,
        data = decoded,
        fetchedAt = state.fetchedAt,
        stale = state.stale,
        refreshing = state.refreshing,
        errorKind = state.errorKind,
        httpStatus = state.httpStatus,
    )
}
