// The native Jetpack Compose + Material 3 DrivesListPage driving surface — a parity port of
// web/src/features/driving/pages/DrivesListPage.tsx, the drive-history dashboard. It reproduces the page's
// overview KPI card (the six metric tiles + the no-stats empty panel), the metric-switcher trend chart, the
// collections pill row, the sort controls, the bulk-selectable date-grouped drive list with pagination, every
// data state (loading skeleton / empty / error-retry / content, plus the cache-then-network stale/offline tier
// the bound state holder carries), and every visible string (resolved from the generated res/values catalog,
// ADR-014).
//
// Composition: [DrivesListPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the drives feed + the interaction snapshot + the live
// display preferences); [DrivesListPageContent] is the stateless render layer. The single `useDrives` feed +
// the interaction + the prefs are folded by the framework-free model (deriveDrivesListData) into the slices the
// panels read — exactly as the web page threads its loaded `drives` through the long useMemo chain. SI values
// are converted to the user's units only here at the display boundary via the model's prefs helpers (Phase-48
// SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete
// panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.driving.driveslist

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.MetricSwitcherChart
import io.teslasync.android.components.charts.MetricSwitcherMetric
import io.teslasync.android.components.datadisplay.BatteryDelta
import io.teslasync.android.components.datadisplay.BulkAction
import io.teslasync.android.components.datadisplay.BulkActionToolbar
import io.teslasync.android.components.datadisplay.ComparisonHeader
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.DateGroup
import io.teslasync.android.components.datadisplay.DateGroupedList
import io.teslasync.android.components.datadisplay.Delta
import io.teslasync.android.components.datadisplay.DeltaDisplay
import io.teslasync.android.components.datadisplay.Direction
import io.teslasync.android.components.datadisplay.HistoryListRow
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.KpiOverviewCard
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.components.datadisplay.RouteDisplay
import io.teslasync.android.components.datadisplay.RouteEndpoint
import io.teslasync.android.components.datadisplay.ScoreBadge
import io.teslasync.android.components.datadisplay.ScoreGrade
import io.teslasync.android.components.datadisplay.resolveSemantic
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.forms.PillFilterBar
import io.teslasync.android.components.forms.PillItem
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The web `maxSpeedMps > 58.1152` high-speed badge threshold (≈130 mph in m/s). */
private const val HIGH_SPEED_MPS = 58.1152

/** Search debounce after which the "filtering…" pending chip clears (web `useDeferredValue` settle). */
private const val SEARCH_PENDING_MS = 350L

/** Per-metric trend-series colors (web CHART_COLORS hex; dynamic chart values, not static theme tokens). */
private val TREND_COLORS: Map<TrendMetric, Color> =
    mapOf(
        TrendMetric.Drives to Color(0xFF00F0FF),
        TrendMetric.Distance to Color(0xFF10B981),
        TrendMetric.Score to Color(0xFFA855F7),
        TrendMetric.Efficiency to Color(0xFFF59E0B),
        TrendMetric.Cost to Color(0xFFEF4444),
    )

/** The page's interaction callbacks, wired to the [DrivesListPageViewModel] (web event handlers). */
data class DrivesListActions(
    val onSetSort: (DriveSort) -> Unit,
    val onSetCollection: (DriveCollection) -> Unit,
    val onSetTrendMetric: (TrendMetric) -> Unit,
    val onSetPage: (Int) -> Unit,
    val onSetSearch: (String) -> Unit,
    val onToggleSelected: (Long, Boolean) -> Unit,
    val onClearSelection: () -> Unit,
    val onRetainSelection: (Set<Long>) -> Unit,
    val onDeleteSelected: () -> Unit,
    val onResetFilters: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DrivesListPageViewModel] over the supplied [source] (the host wires the shared
 * driving repository + settings holder + the app-scoped active-vehicle selection via [drivesListPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun DrivesListPage(
    source: DrivesListPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DrivesListPageViewModel =
        viewModel(
            key = DrivesListPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DrivesListPageViewModel(source, logger) } },
        )
    DrivesListPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] drives feed + interaction snapshot + display prefs to the content. */
@Composable
fun DrivesListPage(
    viewModel: DrivesListPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val drivesState by viewModel.drivesState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val deleting by viewModel.deleting.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            DrivesListActions(
                onSetSort = viewModel::setSort,
                onSetCollection = viewModel::setCollection,
                onSetTrendMetric = viewModel::setTrendMetric,
                onSetPage = viewModel::setPage,
                onSetSearch = viewModel::setSearch,
                onToggleSelected = viewModel::toggleSelected,
                onClearSelection = viewModel::clearSelection,
                onRetainSelection = viewModel::retainSelection,
                onDeleteSelected = viewModel::deleteSelected,
                onResetFilters = viewModel::resetFilters,
                onRetry = viewModel::retry,
            )
        }

    DrivesListPageContent(
        drivesState = drivesState,
        interaction = interaction,
        prefs = prefs,
        deleting = deleting,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed (with nothing cached) renders the full-page skeleton; otherwise
 * the page header is drawn, then the hard-error retry surface or the loaded body (which itself renders the
 * empty-data states inline — the overview no-stats panel + the list empty state — so no region ever blanks).
 */
@Composable
fun DrivesListPageContent(
    drivesState: UiState<List<Drive>>,
    interaction: DrivesListInteraction,
    prefs: DrivesDisplayPrefs,
    deleting: Boolean,
    actions: DrivesListActions,
    modifier: Modifier = Modifier,
) {
    if (drivesState.isLoading) {
        DrivesListLoading(modifier)
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DrivesListHeader(drivesState = drivesState)

        if (drivesState.isError) {
            DrivesListError(onRetry = actions.onRetry)
        } else {
            DrivesListLoaded(
                drives = drivesState.data.orEmpty(),
                interaction = interaction,
                prefs = prefs,
                deleting = deleting,
                actions = actions,
            )
        }
    }
}

/** The page header — the `<h1>` title + muted subtitle + the query-freshness chip (web `PageContainer`). */
@Composable
private fun DrivesListHeader(drivesState: UiState<List<Drive>>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_drives_title))
            BodyText(
                stringResource(R.string.translation_drives_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DataFreshness(
            updatedAtMillis = drivesState.fetchedAt?.takeIf { it > 0L },
            isFetching = drivesState.refreshing,
            isStale = drivesState.stale,
            isError = drivesState.hasError,
            compact = true,
        )
    }
}

/** The hard-error surface for the drives feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun DrivesListError(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_error_serverError_message),
                title = stringResource(R.string.translation_error_serverError_title),
                onRetry = onRetry,
                retryLabel = stringResource(R.string.translation_common_retry),
            )
        }
    }
}

/**
 * The loaded surface — the sticky summary, the search + pending chip, the overview KPI card (or its no-stats
 * empty panel), the metric-switcher trend chart, the collections pill row, the sort controls, the
 * bulk-selectable date-grouped list and pagination. The single drives feed + interaction + prefs are folded by
 * the framework-free model into every slice.
 */
@Composable
private fun DrivesListLoaded(
    drives: List<Drive>,
    interaction: DrivesListInteraction,
    prefs: DrivesDisplayPrefs,
    deleting: Boolean,
    actions: DrivesListActions,
) {
    val zone = remember { ZoneId.systemDefault() }
    val format = remember(prefs) { DrivesFormat(prefs.locale, zone) }
    val data = remember(drives, interaction, prefs) { deriveDrivesListData(drives, interaction, prefs, zone) }

    // Prune the bulk selection to the visible filtered set (web `useEffect` over `filteredDrives`).
    val visibleIds = remember(data.filteredDrives) { data.filteredDrives.map { it.id }.toSet() }
    LaunchedEffect(visibleIds) { actions.onRetainSelection(visibleIds) }

    DrivesStickySummary(data = data, interaction = interaction, format = format)
    DrivesSearchRow(interaction = interaction, actions = actions)

    FadeIn { DrivesOverviewSection(data = data, interaction = interaction, prefs = prefs, format = format, actions = actions) }

    if (data.currentStats.count > 0) {
        FadeIn(delayMs = FADE_STEP_MS) {
            DrivesTrendChart(data = data, interaction = interaction, prefs = prefs, format = format, actions = actions)
        }
    }

    FadeIn(delayMs = FADE_STEP_MS * 2) { DrivesCollectionsRow(data = data, interaction = interaction, actions = actions) }

    DrivesListControls(data = data, interaction = interaction, format = format, actions = actions)

    DrivesListSection(
        data = data,
        interaction = interaction,
        prefs = prefs,
        format = format,
        deleting = deleting,
        actions = actions,
    )
}

// ── Sticky summary (web `PageHeaderSticky`) ─────────────────────────────────────────────────────────────────

@Composable
private fun DrivesStickySummary(
    data: DrivesListData,
    interaction: DrivesListInteraction,
    format: DrivesFormat,
) {
    val collectionLabel = stringResource(collectionLabelRes(interaction.collection))
    val ariaLabel = stringResource(R.string.translation_drives_stickyBar_aria)
    val title = stringResource(R.string.translation_drives_title)
    val results = stringResource(R.string.translation_drives_results)
    val avgLabel = stringResource(R.string.translation_drives_avgScore)
    val period = "${format.dayLong(data.range.start)} \u2013 ${format.dayLong(data.range.end)}"
    val summary =
        buildString {
            append("$title \u00b7 $period \u00b7 $collectionLabel \u00b7 ${format.int(1.0 * data.filteredCount)} $results")
            if (data.avgGrade != DriveGrade.None) append(" \u00b7 $avgLabel ${data.avgGrade.label}")
        }
    Caption(summary, modifier = Modifier.fillMaxWidth().semantics { contentDescription = ariaLabel })
}

// ── Search + pending (web `SearchInput` + `useDeferredValue` spinner) ────────────────────────────────────────

@Composable
private fun DrivesSearchRow(
    interaction: DrivesListInteraction,
    actions: DrivesListActions,
) {
    val pendingLabel = stringResource(R.string.translation_filter_pending)
    var searchPending by remember { mutableStateOf(false) }
    LaunchedEffect(interaction.search) {
        if (interaction.search.isNotBlank()) {
            searchPending = true
            delay(SEARCH_PENDING_MS)
        }
        searchPending = false
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SearchInput(
            value = interaction.search,
            onValueChange = actions.onSetSearch,
            modifier = Modifier.weight(1f),
            hint = stringResource(R.string.translation_drives_searchPlaceholder), // parity:allow web i18n key id contains 'searchPlaceholder', not a stub
        )
        if (searchPending) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp).semantics { contentDescription = pendingLabel },
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
    DrivesActiveFilters(interaction = interaction, actions = actions)
}

/** The active-filter chips (web `ActiveFilterChips`) — surfaces the search + collection filter labels. */
@Composable
private fun DrivesActiveFilters(
    interaction: DrivesListInteraction,
    actions: DrivesListActions,
) {
    val searchLabel = stringResource(R.string.translation_drives_filterLabel_search)
    val collectionFilterLabel = stringResource(R.string.translation_drives_filterLabel_collection)
    val collectionLabel = stringResource(collectionLabelRes(interaction.collection))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (interaction.search.isNotBlank()) {
            Badge("$searchLabel: ${interaction.search}", variant = BadgeVariant.Info)
        }
        if (interaction.collection != DriveCollection.All) {
            Badge("$collectionFilterLabel: $collectionLabel", variant = BadgeVariant.Neutral)
        }
    }
}

// ── Overview KPI card — the 7 panels (web `KpiOverviewCard` / no-stats `GlassPanel`) ──────────────────────────

@Composable
private fun DrivesOverviewSection(
    data: DrivesListData,
    interaction: DrivesListInteraction,
    prefs: DrivesDisplayPrefs,
    format: DrivesFormat,
    actions: DrivesListActions,
) {
    val stats = data.currentStats
    if (stats.count <= 0) {
        // Panel 7 — GlassPanel7: the no-stats empty panel (web `<GlassPanel><EmptyState/></GlassPanel>`).
        GlassPanel(padding = PanelPadding.Lg) {
            EmptyState(message = stringResource(R.string.translation_drives_noStatsRange))
        }
        return
    }

    val prior = data.priorStats
    val showDelta = data.priorHasData && prior != null
    val distanceUnit = prefs.distanceLabel
    val efficiencyUnit = prefs.efficiencyLabel
    val distDisplay = prefs.toDistance(stats.totalDistanceM)
    val priorDistDisplay = prior?.let { prefs.toDistance(it.totalDistanceM) }
    val driveTimeMin = stats.totalDurationS / 60.0
    val priorDriveTimeMin = prior?.let { it.totalDurationS / 60.0 }
    val avgEffDisplay = stats.avgEfficiencyWhKm?.let { prefs.toEfficiency(it) }
    val priorEffDisplay = prior?.avgEfficiencyWhKm?.let { prefs.toEfficiency(it) }
    val totalCost = stats.totalEnergyKwh * prefs.costPerKwh
    val priorTotalCost = prior?.let { it.totalEnergyKwh * prefs.costPerKwh }

    val periodLabel = "${format.dayLong(data.range.start)} \u2013 ${format.dayLong(data.range.end)}"
    val priorLabel: String? =
        when {
            data.priorHasData && data.priorRange != null ->
                stringResource(
                    R.string.translation_drives_priorPeriod,
                    format.dayLong(data.priorRange.start),
                    format.dayLong(data.priorRange.end),
                )
            data.priorRange != null ->
                stringResource(
                    R.string.translation_drives_noPriorData,
                    format.dayLong(data.priorRange.start),
                    format.dayLong(data.priorRange.end),
                )
            else -> null
        }

    val secondary =
        buildString {
            append("${stringResource(R.string.translation_drives_topSpeed)} ")
            append("${format.int(prefs.toSpeed(stats.topSpeedMps))} ${prefs.speedLabel} \u00b7 ")
            append("${stringResource(R.string.translation_drives_longest)} ")
            append("${format.number(prefs.toDistance(stats.longest?.distanceM ?: 0.0))} $distanceUnit \u00b7 ")
            append("${stringResource(R.string.translation_drives_avgTrip)} ")
            append("${format.number(prefs.toDistance(stats.totalDistanceM / stats.count))} $distanceUnit \u00b7 ")
            append("${format.durationMinutes(driveTimeMin / stats.count)} ")
            append(stringResource(R.string.translation_drives_avgDur))
        }

    KpiOverviewCard(
        header = {
            ComparisonHeader(
                title = stringResource(R.string.translation_drives_overview),
                currentLabel = periodLabel,
                comparisonLabel = priorLabel,
            )
        },
        kpis = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    // Panel 1 — Drives.
                    MetricCard(
                        label = stringResource(R.string.translation_drives_totalDrives),
                        value = format.int(1.0 * stats.count),
                        modifier = Modifier.weight(1f),
                        delta =
                            deltaSlotOrNull(showDelta) {
                                Delta(1.0 * stats.count, prior?.count?.let { 1.0 * it }, resolveSemantic("trip_count"), display = DeltaDisplay.Percent)
                            },
                    )
                    // Panel 2 — MetricCard2 (Distance).
                    MetricCard(
                        label = "${stringResource(R.string.translation_drives_distance)} ($distanceUnit)",
                        value = format.int(distDisplay),
                        modifier = Modifier.weight(1f),
                        delta =
                            deltaSlotOrNull(showDelta) {
                                Delta(distDisplay, priorDistDisplay, resolveSemantic("distance"), display = DeltaDisplay.Percent)
                            },
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    // Panel 3 — Drive-time.
                    MetricCard(
                        label = stringResource(R.string.translation_drives_driveTime),
                        value = format.durationMinutes(driveTimeMin),
                        modifier = Modifier.weight(1f),
                        delta =
                            deltaSlotOrNull(showDelta) {
                                Delta(driveTimeMin, priorDriveTimeMin, MetricSemantic("drive_time", Direction.Neutral), display = DeltaDisplay.Percent)
                            },
                    )
                    // Panel 4 — Avg-score.
                    MetricCard(
                        label = stringResource(R.string.translation_drives_avgScore),
                        value = data.avgGrade.label,
                        modifier = Modifier.weight(1f),
                        delta =
                            deltaSlotOrNull(showDelta) {
                                Delta(stats.avgGradeNumeric, prior?.avgGradeNumeric, resolveSemantic("drive_score"), display = DeltaDisplay.Percent)
                            },
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    // Panel 5 — MetricCard5 (Efficiency).
                    MetricCard(
                        label = "${stringResource(R.string.translation_drives_efficiency)} ($efficiencyUnit)",
                        value = avgEffDisplay?.let { format.int(it) } ?: "\u2014",
                        modifier = Modifier.weight(1f),
                        delta =
                            deltaSlotOrNull(showDelta) {
                                Delta(avgEffDisplay, priorEffDisplay, resolveSemantic("efficiency"), display = DeltaDisplay.Percent)
                            },
                    )
                    // Panel 6 — Cost.
                    MetricCard(
                        label = stringResource(R.string.translation_drives_cost),
                        value = prefs.formatEnergyCost(stats.totalEnergyKwh),
                        modifier = Modifier.weight(1f),
                        delta =
                            deltaSlotOrNull(showDelta) {
                                Delta(totalCost, priorTotalCost, resolveSemantic("cost"), display = DeltaDisplay.Percent)
                            },
                    )
                }
            }
        },
        secondary = secondary,
        footer = {
            if (data.anomalyDrives.isNotEmpty() && interaction.collection != DriveCollection.Anomalies) {
                DrivesAnomalyFooter(data = data, actions = actions)
            }
        },
    )
}

/** The anomaly callout footer (web `InlineCallout` + `View anomalies` action). */
@Composable
private fun DrivesAnomalyFooter(
    data: DrivesListData,
    actions: DrivesListActions,
) {
    val count = data.anomalyDrives.size
    val noun =
        if (count == 1) {
            stringResource(R.string.translation_drives_anomaly_one)
        } else {
            stringResource(R.string.translation_drives_anomaly_other)
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DataDisplayGlyphs.AlertTriangle,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.tertiary,
        )
        Caption(
            stringResource(R.string.translation_drives_anomalyCount, count.toString(), noun),
            modifier = Modifier.weight(1f),
        )
        Button(
            label = stringResource(R.string.translation_drives_viewAnomalies),
            onClick = { actions.onSetCollection(DriveCollection.Anomalies) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

// ── Trend chart — MetricSwitcherChart (web `MetricSwitcherChart`) ─────────────────────────────────────────────

@Composable
private fun DrivesTrendChart(
    data: DrivesListData,
    interaction: DrivesListInteraction,
    prefs: DrivesDisplayPrefs,
    format: DrivesFormat,
    actions: DrivesListActions,
) {
    val ariaLabel = stringResource(R.string.translation_drives_overTime_aria)
    val emptyMessage = stringResource(R.string.translation_drives_overTime_empty)
    val metrics = rememberTrendMetrics(data = data, prefs = prefs, format = format)
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            PanelTitle(stringResource(R.string.translation_drives_overTime))
            Box(modifier = Modifier.fillMaxWidth().semantics { contentDescription = ariaLabel }) {
                MetricSwitcherChart(
                    metrics = metrics,
                    activeKey = interaction.trendMetric.key,
                    onMetricChange = { actions.onSetTrendMetric(TrendMetric.fromKey(it)) },
                    emptyMessage = emptyMessage,
                )
            }
        }
    }
}

/** Builds the five switchable trend metrics (web `trendMetricsConfig`) from the SI trend series + display prefs. */
@Composable
private fun rememberTrendMetrics(
    data: DrivesListData,
    prefs: DrivesDisplayPrefs,
    format: DrivesFormat,
): List<MetricSwitcherMetric> {
    val labels =
        mapOf(
            TrendMetric.Drives to stringResource(R.string.translation_drives_metric_drives),
            TrendMetric.Distance to stringResource(R.string.translation_drives_metric_distance),
            TrendMetric.Score to stringResource(R.string.translation_drives_metric_score),
            TrendMetric.Efficiency to stringResource(R.string.translation_drives_metric_efficiency),
            TrendMetric.Cost to stringResource(R.string.translation_drives_metric_cost),
        )
    return TrendMetric.entries.map { metric ->
        val points = data.trendSeries[metric].orEmpty()
        val label = labels.getValue(metric)
        val values: List<Double?> =
            points.map { p ->
                when (metric) {
                    TrendMetric.Drives -> p.value
                    TrendMetric.Distance -> prefs.toDistance(p.value)
                    TrendMetric.Score -> p.value
                    TrendMetric.Efficiency -> prefs.toEfficiency(p.value)
                    TrendMetric.Cost -> p.value * prefs.costPerKwh
                }
            }
        MetricSwitcherMetric(
            key = metric.key,
            label = label,
            series =
                ChartSeries(
                    key = metric.key,
                    label = label,
                    values = values,
                    kind = if (metric == TrendMetric.Score || metric == TrendMetric.Efficiency) ChartSeriesKind.Line else ChartSeriesKind.Bar,
                    color = TREND_COLORS[metric],
                ),
            xLabels = points.map { format.dayShort(it.date) },
            yValueFormatter = { value ->
                when (metric) {
                    TrendMetric.Score -> ChartFormat.number(value, 1, prefs.locale)
                    TrendMetric.Cost -> prefs.formatCurrency(value, 2)
                    else -> ChartFormat.number(value, 0, prefs.locale)
                }
            },
        )
    }
}

// ── Collections pill row (web `PillFilterBar`) ────────────────────────────────────────────────────────────────

@Composable
private fun DrivesCollectionsRow(
    data: DrivesListData,
    interaction: DrivesListInteraction,
    actions: DrivesListActions,
) {
    val ariaLabel = stringResource(R.string.translation_drives_collections_aria)
    val items =
        listOf(
            PillItem(DriveCollection.All.key, stringResource(R.string.translation_drives_coll_all), data.allCount),
            PillItem(DriveCollection.Anomalies.key, stringResource(R.string.translation_drives_coll_anomalies), data.anomalyDrives.size),
            PillItem(DriveCollection.Notable.key, stringResource(R.string.translation_drives_coll_notable), data.notableDrives.size),
            PillItem(DriveCollection.Commutes.key, stringResource(R.string.translation_drives_coll_commutes), data.commuteDrives.size),
            PillItem(DriveCollection.Tagged.key, stringResource(R.string.translation_drives_coll_tagged), 0),
        )
    PillFilterBar(
        items = items,
        selectedId = interaction.collection.key,
        onSelect = { actions.onSetCollection(DriveCollection.fromKey(it)) },
        modifier = Modifier.semantics { contentDescription = ariaLabel },
    )
}

// ── List controls — title + sort (web sort buttons) ──────────────────────────────────────────────────────────

@Composable
private fun DrivesListControls(
    data: DrivesListData,
    interaction: DrivesListInteraction,
    format: DrivesFormat,
    actions: DrivesListActions,
) {
    if (data.sortedDrives.isEmpty()) {
        EmptyState(message = stringResource(R.string.translation_common_noData))
        return
    }
    val sortByTemplate = stringResource(R.string.translation_drives_sortByAria)
    val sortOptions =
        listOf(
            DriveSort.Date to stringResource(R.string.translation_drives_sortRecent),
            DriveSort.Distance to stringResource(R.string.translation_drives_sortDistance),
            DriveSort.Efficiency to stringResource(R.string.translation_drives_sortEfficiency),
        )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            SectionTitle(stringResource(R.string.translation_drives_allDrives))
            Caption("(${format.int(1.0 * data.sortedDrives.size)})")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            sortOptions.forEach { (sort, label) ->
                Button(
                    label = label,
                    onClick = { actions.onSetSort(sort) },
                    modifier = Modifier.semantics { contentDescription = String.format(sortByTemplate, label) },
                    variant = if (interaction.sort == sort) ButtonVariant.Primary else ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }
    }
}

// ── Drive list + bulk toolbar + pagination (web list, BulkActionsToolbar, Pagination) ─────────────────────────

@Composable
private fun DrivesListSection(
    data: DrivesListData,
    interaction: DrivesListInteraction,
    prefs: DrivesDisplayPrefs,
    format: DrivesFormat,
    deleting: Boolean,
    actions: DrivesListActions,
) {
    if (data.paginatedGroups.isEmpty()) {
        DrivesListEmpty(collection = interaction.collection, actions = actions)
        return
    }

    DrivesBulkToolbar(interaction = interaction, total = data.filteredCount, deleting = deleting, actions = actions)

    val groups =
        data.paginatedGroups.map { group ->
            val noun =
                if (group.items.size == 1) {
                    stringResource(R.string.translation_bulk_noun_drive_one)
                } else {
                    stringResource(R.string.translation_bulk_noun_drive_other)
                }
            val distM = group.items.sumOf { it.distanceM }
            DateGroup(
                dateKey = group.dateKey,
                dateLabel = format.dayLong(group.dateKey),
                items = group.items,
                summary = "${group.items.size} $noun \u00b7 ${format.number(prefs.toDistance(distM))} ${prefs.distanceLabel}",
            )
        }

    FadeIn(delayMs = FADE_STEP_MS) {
        DateGroupedList(groups = groups) { drive ->
            DriveRow(
                drive = drive,
                prefs = prefs,
                format = format,
                isAnomaly = data.anomalyIds.contains(drive.id),
                selected = interaction.selectedIds.contains(drive.id),
                onToggle = actions.onToggleSelected,
            )
        }
    }

    DrivesPagination(page = interaction.page, total = data.sortedDrives.size, locale = prefs.locale, onPageChange = actions.onSetPage)
}

@Composable
private fun DrivesBulkToolbar(
    interaction: DrivesListInteraction,
    total: Int,
    deleting: Boolean,
    actions: DrivesListActions,
) {
    var showConfirm by remember { mutableStateOf(false) }
    val selectedCount = interaction.selectedIds.size
    BulkActionToolbar(
        selectedCount = selectedCount,
        onClear = actions.onClearSelection,
        actions =
            listOf(
                BulkAction(
                    id = "delete",
                    label = stringResource(R.string.translation_bulk_actions_delete),
                    onClick = { showConfirm = true },
                    danger = true,
                    loading = deleting,
                ),
            ),
        total = total,
    )
    if (showConfirm) {
        val noun =
            if (selectedCount == 1) {
                stringResource(R.string.translation_bulk_noun_drive_one)
            } else {
                stringResource(R.string.translation_bulk_noun_drive_other)
            }
        ConfirmDialog(
            title = stringResource(R.string.translation_bulk_deleteConfirmTitle, selectedCount.toString(), noun),
            message = stringResource(R.string.translation_bulk_deleteConfirmDescription),
            confirmLabel = stringResource(R.string.translation_common_delete),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            onConfirm = {
                actions.onDeleteSelected()
                showConfirm = false
            },
            onCancel = { showConfirm = false },
            loading = deleting,
            closeLabel = stringResource(R.string.translation_common_close),
        )
    }
}

@Composable
private fun DrivesPagination(
    page: Int,
    total: Int,
    locale: Locale,
    onPageChange: (Int) -> Unit,
) {
    val showingTemplate = stringResource(R.string.translation_pagination_showing)
    Pagination(
        page = page,
        pageSize = DrivesListPageRegistration.PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count -> String.format(locale, showingTemplate, start.toString(), end.toString(), count.toString()) },
    )
}

/** The list empty state (web `EmptyState`): collection-specific or first-run copy + a Reset-filters CTA. */
@Composable
private fun DrivesListEmpty(
    collection: DriveCollection,
    actions: DrivesListActions,
) {
    val title =
        if (collection != DriveCollection.All) {
            stringResource(R.string.translation_drives_emptyForCollection)
        } else {
            stringResource(R.string.translation_drives_emptyTitle)
        }
    val message =
        if (collection != DriveCollection.All) {
            stringResource(R.string.translation_drives_emptyForCollection_msg)
        } else {
            stringResource(R.string.translation_drives_emptyMessage)
        }
    EmptyState(
        title = title,
        message = message,
        action = EmptyStateAction(label = stringResource(R.string.translation_drives_empty_cta), onClick = actions.onResetFilters),
    )
}

// ── A single drive row (web `DriveCard` / `HistoryListRow`) ───────────────────────────────────────────────────

@Composable
private fun DriveRow(
    drive: Drive,
    prefs: DrivesDisplayPrefs,
    format: DrivesFormat,
    isAnomaly: Boolean,
    selected: Boolean,
    onToggle: (Long, Boolean) -> Unit,
) {
    val grade = gradeFromEfficiency(getEfficiency(drive))
    val scoreAria = stringResource(R.string.translation_drives_scoreAria, grade.label)
    val selectAria = stringResource(R.string.translation_drives_selectDrive, format.timeOfDay(drive.startTs.toEpochMilliseconds()))

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Checkbox(
            checked = selected,
            onCheckedChange = { onToggle(drive.id, it) },
            modifier = Modifier.semantics { contentDescription = selectAria },
        )
        HistoryListRow(
            modifier = Modifier.weight(1f),
            leading = {
                ScoreBadge(grade = grade.toScoreGrade(), contentDescription = scoreAria)
            },
            primary = { DriveRowPrimary(drive = drive, prefs = prefs, format = format, isAnomaly = isAnomaly) },
            route = {
                RouteDisplay(
                    start = RouteEndpoint(address = drive.startAddress, lat = drive.startLat, lon = drive.startLon),
                    end = RouteEndpoint(address = drive.endAddress, lat = drive.endLat, lon = drive.endLon),
                )
            },
            metrics = { DriveRowMetrics(drive = drive, prefs = prefs, format = format) },
            showChevron = true,
        )
    }
}

@Composable
private fun RowScope.DriveRowPrimary(
    drive: Drive,
    prefs: DrivesDisplayPrefs,
    format: DrivesFormat,
    isAnomaly: Boolean,
) {
    val isCompleted = drive.endTs != null
    val hasData = drive.distanceM > 0.0 || drive.durationS > 0L
    Caption(format.timeOfDay(drive.startTs.toEpochMilliseconds()))
    Caption("\u00b7")
    Caption(format.durationMinutes(drive.durationS / 60.0))
    when {
        hasData ->
            Badge("${format.number(prefs.toDistance(drive.distanceM))} ${prefs.distanceLabel}", variant = BadgeVariant.Info)
        isCompleted ->
            Badge(stringResource(R.string.translation_drives_noTelemetry), variant = BadgeVariant.Warning)
        else ->
            Badge(stringResource(R.string.translation_drives_inProgress), variant = BadgeVariant.Success)
    }
    if ((drive.maxSpeedMps ?: 0.0) > HIGH_SPEED_MPS) {
        Badge(stringResource(R.string.translation_drives_highSpeed), variant = BadgeVariant.Danger)
    }
    if (isAnomaly) {
        Badge(stringResource(R.string.translation_drives_lowEfficiencyBadge), variant = BadgeVariant.Danger)
    }
}

@Composable
private fun RowScope.DriveRowMetrics(
    drive: Drive,
    prefs: DrivesDisplayPrefs,
    format: DrivesFormat,
) {
    val avgSpeed =
        when {
            drive.avgSpeedMps != null -> format.int(prefs.toSpeed(drive.avgSpeedMps!!))
            drive.durationS > 0L && drive.distanceM > 0.0 -> format.int(prefs.toSpeed(drive.distanceM / drive.durationS))
            else -> "\u2014"
        }
    InlineMetric(
        icon = DataDisplayGlyphs.Gauge,
        value = "${stringResource(R.string.translation_drives_avg)} $avgSpeed ${prefs.speedLabel}",
    )
    drive.maxSpeedMps?.let { maxSpeed ->
        InlineMetric(
            icon = DataDisplayGlyphs.ArrowUp,
            value = "${stringResource(R.string.translation_drives_max)} ${format.int(prefs.toSpeed(maxSpeed))} ${prefs.speedLabel}",
        )
    }
    val startPct = drive.startBatteryPct
    val endPct = drive.endBatteryPct
    if (startPct != null && endPct != null && !(startPct == 0L && endPct == 0L && drive.endTs != null)) {
        BatteryDelta(startPct = 1.0 * startPct, endPct = 1.0 * endPct)
    }
    getEfficiency(drive)?.let { eff ->
        InlineMetric(
            icon = DataDisplayGlyphs.Bolt,
            value = "${format.int(prefs.toEfficiency(eff))} ${prefs.efficiencyLabel}",
        )
    }
}

// ── Loading skeleton (web `Skeleton` cascade) ────────────────────────────────────────────────────────────────

@Composable
private fun DrivesListLoading(modifier: Modifier = Modifier) {
    FadeIn {
        Column(
            modifier =
                modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            PageHeaderSkeleton()
            Skeleton(widthFraction = SEARCH_SKELETON_FRACTION, height = 48.dp)
            StatGridSkeleton(count = OVERVIEW_SKELETON_TILES)
            ChartBlockSkeleton(height = 200.dp)
            repeat(LIST_SKELETON_ROWS) { Skeleton(height = 72.dp) }
        }
    }
}

// ── Display formatting + small mappers ───────────────────────────────────────────────────────────────────────

/** Date/time/number formatting bound to the user's [locale] + the active [zone] (web `dateFormat`/`numberFormat`). */
private class DrivesFormat(
    val locale: Locale,
    private val zone: ZoneId,
) {
    private val longDate = DateTimeFormatter.ofPattern("MMM d, yyyy", locale)
    private val shortDate = DateTimeFormatter.ofPattern("MMM d", locale)
    private val timeFmt = DateTimeFormatter.ofPattern("h:mm a", locale)

    /** Grouped integer (web `fmtInt`). */
    fun int(value: Double): String = ChartFormat.number(value, 0, locale)

    /** Grouped one-decimal number (web `fmtNumber`). */
    fun number(value: Double): String = ChartFormat.number(value, 1, locale)

    /** A `YYYY-MM-DD` key as a long, year-bearing label (web `formatDayKey` long). */
    fun dayLong(key: String): String = runCatching { LocalDate.parse(key).format(longDate) }.getOrDefault(key)

    /** A `YYYY-MM-DD` key as a short axis label (web `formatDayKey` short). */
    fun dayShort(key: String): String = runCatching { LocalDate.parse(key).format(shortDate) }.getOrDefault(key)

    /** An epoch-milli timestamp as a time-of-day label in [zone] (web `formatTime`). */
    fun timeOfDay(epochMs: Long): String = Instant.ofEpochMilli(epochMs).atZone(zone).format(timeFmt)

    /** Whole-minute duration as `Hh Mm` / `Mm` (web `formatDurationMinutes`). */
    fun durationMinutes(minutes: Double): String {
        val total = minutes.roundToInt().coerceAtLeast(0)
        val h = total / 60
        val m = total % 60
        return if (h > 0) "${h}h ${m}m" else "${m}m"
    }
}

/** Maps a [DriveGrade] onto the shared [ScoreGrade] the [ScoreBadge] renders. */
private fun DriveGrade.toScoreGrade(): ScoreGrade =
    when (this) {
        DriveGrade.APlus -> ScoreGrade.APlus
        DriveGrade.A -> ScoreGrade.A
        DriveGrade.B -> ScoreGrade.B
        DriveGrade.C -> ScoreGrade.C
        DriveGrade.D -> ScoreGrade.D
        DriveGrade.None -> ScoreGrade.None
    }

/** The `res/values` label key for a [DriveCollection] (web `collectionPills` labels). */
private fun collectionLabelRes(collection: DriveCollection): Int =
    when (collection) {
        DriveCollection.All -> R.string.translation_drives_coll_all
        DriveCollection.Anomalies -> R.string.translation_drives_coll_anomalies
        DriveCollection.Notable -> R.string.translation_drives_coll_notable
        DriveCollection.Commutes -> R.string.translation_drives_coll_commutes
        DriveCollection.Tagged -> R.string.translation_drives_coll_tagged
    }

/** Returns a [Delta] slot composable when [show] is true, else `null` (the web conditional delta prop). */
private fun deltaSlotOrNull(
    show: Boolean,
    slot: @Composable () -> Unit,
): (@Composable () -> Unit)? = if (show) slot else null

/** Width fraction of the parent the search-row loading skeleton fills. */
private const val SEARCH_SKELETON_FRACTION = 1f

/** Tile count for the overview-grid loading skeleton (the web six-card grid, sized for the mobile row). */
private const val OVERVIEW_SKELETON_TILES = 3

/** Row count for the drive-list loading skeleton. */
private const val LIST_SKELETON_ROWS = 5
