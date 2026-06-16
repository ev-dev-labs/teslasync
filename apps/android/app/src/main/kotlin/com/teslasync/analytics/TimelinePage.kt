// The native Jetpack Compose + Material 3 TimelinePage analytics surface — a parity port of
// web/src/features/analytics/pages/TimelinePage.tsx, the vehicle state-history dashboard. It reproduces the page's
// seven panels (the four total stat-cards, the proportional state-distribution bar, the daily-breakdown bar chart,
// and the state-transitions table), every data state (loading / empty / error / success, plus the cache-then-network
// stale/offline tier), the one BarChart, and every visible string (resolved from the generated res/values catalog
// `timeline.*` + `error.loadFailed`, ADR-014).
//
// Composition: [TimelinePage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the timeline feed + the fleet feed + the active selection);
// [TimelinePageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip / vehicle
// scope picker / refresh — then the loading / error / loaded body). The loaded body draws every panel from the single
// decoded [TimelineData]; all decode + derivation lives in the framework-free model (TimelinePageModel.kt), so this
// file only resolves i18n, maps states to design tokens, and draws. There are no SI unit values on this surface (only
// durations + counts), so nothing is converted at the display boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.analytics.timeline

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartLegend
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.LegendEntry
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PaginationMath
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.ZoneId
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The web `<div className="h-56 sm:h-64">` daily-breakdown plot height. */
private val CHART_HEIGHT: Dp = 256.dp

/** The web `<div className="flex h-8">` state-distribution bar height. */
private val DISTRIBUTION_BAR_HEIGHT: Dp = 32.dp

/** Rows per page in the transitions table (web `DataTable pagination`). */
private const val TRANSITIONS_PAGE_SIZE = 10

/** The minimum percentage a distribution slice must reach to render (web `if (pct < 0.3) return null`). */
private const val MIN_SLICE_PERCENT = 0.3

/** Table column keys — also the sort keys (web `Column.key`). */
private const val COL_TIME = "ts"
private const val COL_FROM = "from_state"
private const val COL_TO = "to_state"
private const val COL_DURATION = "duration"
private const val COL_TRIGGER = "trigger_field"

/** Daily-breakdown series keys (web `<Bar dataKey=…>`). */
private const val KEY_DRIVING = "driving"
private const val KEY_CHARGING = "charging"
private const val KEY_IDLE = "idle"
private const val KEY_SLEEPING = "sleeping"

// ── Stateful entry point ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TimelinePageViewModel] over the supplied [source] (the host wires the shared
 * Vehicles + Analytics holders + the active-vehicle selection via [timelinePageSourceOf]). [logger] defaults to the
 * app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun TimelinePage(
    source: TimelinePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TimelinePageViewModel =
        viewModel(
            key = TimelinePageRegistration.SLUG,
            factory = viewModelFactory { initializer { TimelinePageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val vehicles by viewModel.vehicles.collectAsStateWithLifecycle()
    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()

    TimelinePageContent(
        state = state,
        vehicles = vehicles,
        selectedVehicleId = selectedVehicleId,
        onSelect = viewModel::select,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the page chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker +
 * the refresh affordance), then the state-dependent body — a centered loader on a first load, a retryable error panel
 * on a hard failure (both FSM endpoints 404 post Phase-42), or the seven loaded panels otherwise. The cards always
 * render their (possibly zero) totals; each section shows its friendly empty-state when the payload carries no
 * transitions, so a region is never blank.
 */
@Composable
fun TimelinePageContent(
    state: UiState<TimelineData>,
    vehicles: UiState<List<TimelineVehicleOption>>,
    selectedVehicleId: Long?,
    onSelect: (Long) -> Unit,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TimelineChrome(
            state = state,
            vehicles = vehicles,
            selectedVehicleId = selectedVehicleId,
            onSelect = onSelect,
            onRefresh = onRefresh,
        )

        when {
            state.isLoading -> TimelineLoading()
            state.isError -> TimelineError(onRetry = onRetry)
            else -> TimelineBody(state = state, locale = locale, zoneId = zoneId)
        }
    }
}

/** The page chrome — the title + subtitle (web `PageContainer` title/subtitle) and the actions row + vehicle picker. */
@Composable
private fun TimelineChrome(
    state: UiState<TimelineData>,
    vehicles: UiState<List<TimelineVehicleOption>>,
    selectedVehicleId: Long?,
    onSelect: (Long) -> Unit,
    onRefresh: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_timeline_title))
                BodyText(
                    stringResource(R.string.translation_timeline_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                // web `DataFreshnessAuto` — the query-driven freshness chip.
                DataFreshness(
                    updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                    isFetching = state.refreshing,
                    isStale = state.stale,
                    isError = state.hasError,
                    compact = true,
                    fetchingLabel = stringResource(R.string.translation_freshness_updating),
                    errorLabel = stringResource(R.string.translation_freshness_error),
                )
                // web `<Button variant="ghost"><RefreshCw /></Button>` — the refresh affordance.
                IconButton(
                    imageVector = TimelineGlyphs.Refresh,
                    contentDescription = stringResource(R.string.translation_common_refresh),
                    onClick = onRefresh,
                    size = IconSize.Md,
                )
            }
        }
        // web `<Select … />` using the `timeline.selectVehicle` empty label, shown only for a fleet of >= 1 vehicle.
        TimelineVehiclePicker(vehicles = vehicles, selectedVehicleId = selectedVehicleId, onSelect = onSelect)
    }
}

/**
 * The vehicle-scope picker (web `useVehicles` + `<Select>`). Renders every state of the fleet feed: a select-shaped
 * skeleton while loading, the dropdown once the fleet resolves (web `vehicles.length > 0`), and nothing for an
 * empty/failed fleet (the web omits the picker — the body's own error/empty surfaces cover that case).
 */
@Composable
private fun TimelineVehiclePicker(
    vehicles: UiState<List<TimelineVehicleOption>>,
    selectedVehicleId: Long?,
    onSelect: (Long) -> Unit,
) {
    when {
        vehicles.isLoading -> Skeleton(modifier = Modifier.fillMaxWidth(), height = SELECT_SKELETON_HEIGHT, rounded = true)
        else -> {
            val options = vehicles.data.orEmpty()
            if (options.isEmpty()) return
            Select(
                options = options.map { SelectOption(it.id.toString(), it.label) },
                selectedValue = selectedVehicleId?.toString(),
                onSelect = { value -> value.toLongOrNull()?.let(onSelect) },
                emptyLabel = stringResource(R.string.translation_timeline_selectVehicle),
            )
        }
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun TimelineLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `AlertBanner` + the refresh affordance). */
@Composable
private fun TimelineError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The loaded body — the seven panels in their web order, each entering with a staggered fade. */
@Composable
private fun TimelineBody(
    state: UiState<TimelineData>,
    locale: Locale,
    zoneId: ZoneId,
) {
    val data = state.data ?: TimelineData.EMPTY
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        // web `{anyError && <AlertBanner variant="danger">…</AlertBanner>}` — shown over cached/offline data.
        if (state.hasError && state.hasData) {
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        FadeIn { SummaryCards(data = data, locale = locale) }
        FadeIn(delayMs = FADE_STEP_MS) { DistributionPanel(data = data, locale = locale) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { DailyBreakdownPanel(data = data, locale = locale) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { TransitionsPanel(data = data, locale = locale, zoneId = zoneId) }
    }
}

// ── Panels 1-4 — Summary stat cards ────────────────────────────────────────────────────────────────────────

/** Total-Transitions / Driving-Time / Charging-Time / Idle-Sleep-Time — the web 4-up `<MetricCard>` grid. */
@Composable
private fun SummaryCards(
    data: TimelineData,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_timeline_totalTransitions),
                value = formatInt(data.totalTransitions + 0.0, locale),
                icon = TimelineGlyphs.ArrowRightLeft,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_timeline_drivingTime),
                value = formatHoursFromSeconds(data.drivingSeconds, locale),
                icon = TimelineGlyphs.Car,
                accent = TeslaTokens.status.success,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_timeline_chargingTime),
                value = formatHoursFromSeconds(data.chargingSeconds, locale),
                icon = TimelineGlyphs.BatteryCharging,
                accent = TeslaTokens.chart.regen,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_timeline_idleSleepTime),
                value = formatHoursFromSeconds(data.idleSeconds + data.sleepingSeconds, locale),
                icon = TimelineGlyphs.Moon,
            )
        }
    }
}

// ── Panel 5 — State distribution ───────────────────────────────────────────────────────────────────────────

/** GlassPanel5 — the proportional state-distribution bar + the full-state legend, or the empty state. */
@Composable
private fun DistributionPanel(
    data: TimelineData,
    locale: Locale,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_timeline_stateTimeline))
        Spacer(Modifier.height(Spacing.md))
        if (data.distribution.isEmpty() || data.totalStateSeconds <= 0.0) {
            EmptyState(
                message = stringResource(R.string.translation_timeline_noStateData),
                icon = TimelineGlyphs.Clock,
            )
        } else {
            DistributionBar(data = data, locale = locale)
            Spacer(Modifier.height(Spacing.md))
            DistributionLegend()
        }
    }
}

/** The proportional bar — one weighted segment per present state (web `flex h-8`), tiny slices skipped. */
@Composable
private fun DistributionBar(
    data: TimelineData,
    locale: Locale,
) {
    val slices = data.distribution.filter { it.percentage >= MIN_SLICE_PERCENT }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(DISTRIBUTION_BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill)),
    ) {
        slices.forEach { slice ->
            Box(
                modifier =
                    Modifier
                        .weight(slice.percentage.toFloat())
                        .fillMaxHeight()
                        .background(stateColor(slice.state))
                        .semantics {
                            contentDescription =
                                "${slice.state}: ${formatDurationFromSeconds(slice.seconds, locale)} (${formatPercent(slice.percentage, locale)})"
                        },
            )
        }
    }
}

/** The legend — every FSM state with a color swatch + its capitalized key (web `Object.entries(STATE_COLORS)`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DistributionLegend() {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        STATE_ORDER.forEach { stateKey ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Box(
                    modifier =
                        Modifier
                            .size(LEGEND_DOT)
                            .clip(RoundedCornerShape(Radius.pill))
                            .background(stateColor(stateKey)),
                )
                Caption(stateKey.replaceFirstChar { it.uppercase() })
            }
        }
    }
}

// ── Panel 6 — Daily breakdown bar chart ────────────────────────────────────────────────────────────────────

/** GlassPanel6 — the stacked daily-breakdown [BarChartWrapper] + its legend, or the empty state. THE chart. */
@Composable
private fun DailyBreakdownPanel(
    data: TimelineData,
    locale: Locale,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(TimelineGlyphs.BarChart3, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.chart.regen)
            PanelTitle(stringResource(R.string.translation_timeline_dailyBreakdown))
        }
        Spacer(Modifier.height(Spacing.md))
        if (data.dailyBreakdown.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_timeline_noDailyData),
                icon = TimelineGlyphs.BarChart3,
            )
        } else {
            val drivingColor = TeslaTokens.chart.battery
            val chargingColor = TeslaTokens.chart.regen
            val idleColor = TeslaTokens.chart.energy
            val sleepingColor = MaterialTheme.colorScheme.onSurfaceVariant
            val drivingLabel = stringResource(R.string.translation_timeline_driving)
            val chargingLabel = stringResource(R.string.translation_timeline_charging)
            val idleLabel = stringResource(R.string.translation_timeline_idle)
            val sleepingLabel = stringResource(R.string.translation_timeline_sleeping)
            val days = data.dailyBreakdown.map { it.day }
            val series =
                listOf(
                    ChartSeries(KEY_DRIVING, drivingLabel, data.dailyBreakdown.map { it.driving + 0.0 }, ChartSeriesKind.Bar, drivingColor),
                    ChartSeries(KEY_CHARGING, chargingLabel, data.dailyBreakdown.map { it.charging + 0.0 }, ChartSeriesKind.Bar, chargingColor),
                    ChartSeries(KEY_IDLE, idleLabel, data.dailyBreakdown.map { it.idle + 0.0 }, ChartSeriesKind.Bar, idleColor),
                    ChartSeries(KEY_SLEEPING, sleepingLabel, data.dailyBreakdown.map { it.sleeping + 0.0 }, ChartSeriesKind.Bar, sleepingColor),
                )
            BarChartWrapper(
                series = series,
                xLabels = days,
                height = CHART_HEIGHT,
                yValueFormatter = { value -> formatInt(value, locale) },
                emptyMessage = stringResource(R.string.translation_timeline_noDailyData),
            )
            Spacer(Modifier.height(Spacing.sm))
            ChartLegend(
                entries =
                    listOf(
                        LegendEntry(KEY_DRIVING, drivingLabel, drivingColor),
                        LegendEntry(KEY_CHARGING, chargingLabel, chargingColor),
                        LegendEntry(KEY_IDLE, idleLabel, idleColor),
                        LegendEntry(KEY_SLEEPING, sleepingLabel, sleepingColor),
                    ),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// ── Panel 7 — State transitions table ──────────────────────────────────────────────────────────────────────

/** GlassPanel7 — the sortable + paginated state-transitions [DataTable] (web `DataTable pagination`). */
@Composable
private fun TransitionsPanel(
    data: TimelineData,
    locale: Locale,
    zoneId: ZoneId,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_timeline_stateTransitions))
        Spacer(Modifier.height(Spacing.md))
        TransitionsTable(rows = data.transitions, locale = locale, zoneId = zoneId)
    }
}

@Composable
private fun TransitionsTable(
    rows: List<TransitionRow>,
    locale: Locale,
    zoneId: ZoneId,
) {
    var sortState by remember { mutableStateOf(SortState()) }
    val sorted = remember(rows, sortState) { sortTransitions(rows, sortState) }
    val total = sorted.size
    var page by remember(total) { mutableIntStateOf(1) }
    val visible =
        remember(sorted, page, total) {
            if (total == 0) {
                emptyList()
            } else {
                val bounds = PaginationMath.sliceBounds(page, TRANSITIONS_PAGE_SIZE, total)
                sorted.subList(bounds.first, bounds.last + 1)
            }
        }
    val footer: (@Composable () -> Unit)? =
        if (total > TRANSITIONS_PAGE_SIZE) {
            { TransitionsPagination(page = page, total = total, onPageChange = { page = it }) }
        } else {
            null
        }
    DataTable(
        columns = transitionColumns(headers = rememberTransitionHeaders(), locale = locale, zoneId = zoneId),
        rows = visible,
        keyOf = { it.index },
        sortState = sortState,
        onSortChange = { key -> sortState = sortState.toggledBy(key) },
        emptyText = stringResource(R.string.translation_timeline_noTransitions),
        footer = footer,
    )
}

/** Localized table column headers (web `Column.header`). */
private data class TransitionHeaders(
    val time: String,
    val fromState: String,
    val toState: String,
    val duration: String,
    val trigger: String,
)

@Composable
private fun rememberTransitionHeaders(): TransitionHeaders =
    TransitionHeaders(
        time = stringResource(R.string.translation_timeline_time),
        fromState = stringResource(R.string.translation_timeline_fromState),
        toState = stringResource(R.string.translation_timeline_toState),
        duration = stringResource(R.string.translation_timeline_duration),
        trigger = stringResource(R.string.translation_timeline_trigger),
    )

/**
 * The five web columns: a sortable timestamp, the From/To state badges, the (non-sortable) destination-state dwell
 * duration, and the sortable trigger field. Cell content maps a [TransitionRow] to a shared primitive.
 */
private fun transitionColumns(
    headers: TransitionHeaders,
    locale: Locale,
    zoneId: ZoneId,
): List<TableColumn<TransitionRow>> =
    listOf(
        TableColumn(key = COL_TIME, header = headers.time, weight = 1.6f, sortable = true) { row ->
            Caption(formatDateTime(row.ts, locale, zoneId))
        },
        TableColumn(key = COL_FROM, header = headers.fromState, weight = 1f, sortable = true) { row ->
            Badge(text = row.fromState, variant = stateBadge(row.fromState))
        },
        TableColumn(key = COL_TO, header = headers.toState, weight = 1f, sortable = true) { row ->
            Badge(text = row.toState, variant = stateBadge(row.toState))
        },
        TableColumn(key = COL_DURATION, header = headers.duration, weight = 1f, sortable = false) { row ->
            val seconds = row.durationSeconds
            if (seconds == null) Caption(EM_DASH) else BodyText(formatDurationFromSeconds(seconds, locale))
        },
        TableColumn(key = COL_TRIGGER, header = headers.trigger, weight = 1f, sortable = true) { row ->
            Caption(row.triggerField ?: EM_DASH)
        },
    )

@Composable
private fun TransitionsPagination(
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
) {
    // Pre-resolve the "showing X-Y of Z" line via stringResource (the lint-sanctioned resource accessor), computing
    // the same page window the Pagination component derives internally so the displayed range matches. String args
    // match the catalog's %s format slots.
    val window = PaginationMath.window(page, TRANSITIONS_PAGE_SIZE, total)
    val start = if (total > 0) window.start else 0
    val showing =
        stringResource(R.string.translation_pagination_showing, start.toString(), window.end.toString(), total.toString())
    Pagination(
        page = page,
        pageSize = TRANSITIONS_PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { _, _, _ -> showing },
    )
}

// ── Pure helpers + token maps ──────────────────────────────────────────────────────────────────────────────

/** Sorts the transition rows by the active column (web sortable `DataTable`); a null key keeps the ASC-by-ts order. */
private fun sortTransitions(
    rows: List<TransitionRow>,
    sortState: SortState,
): List<TransitionRow> {
    val key = sortState.key ?: return rows
    val comparator: Comparator<TransitionRow> =
        when (key) {
            COL_TIME -> compareBy { parseMillis(it.ts) ?: Long.MIN_VALUE }
            COL_FROM -> compareBy { it.fromState }
            COL_TO -> compareBy { it.toState }
            COL_TRIGGER -> compareBy { it.triggerField ?: "" }
            else -> return rows
        }
    return if (sortState.direction == SortDirection.Asc) rows.sortedWith(comparator) else rows.sortedWith(comparator.reversed())
}

/** Maps an FSM state to its distribution/legend color token (web `STATE_COLORS`); never a raw hex in render code. */
@Composable
private fun stateColor(state: String): Color =
    when (state) {
        "driving" -> TeslaTokens.chart.battery
        "charging" -> TeslaTokens.chart.regen
        "idle" -> TeslaTokens.chart.energy
        "sleeping" -> MaterialTheme.colorScheme.onSurfaceVariant
        "online" -> TeslaTokens.chart.speed
        "offline" -> MaterialTheme.colorScheme.outline
        "parked" -> TeslaTokens.chart.power
        "asleep" -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.outline
    }

/** Maps an FSM state to its From/To badge variant (web `STATE_BADGE`). */
private fun stateBadge(state: String): BadgeVariant =
    when (state) {
        "driving" -> BadgeVariant.Success
        "charging" -> BadgeVariant.Info
        "idle" -> BadgeVariant.Warning
        "sleeping" -> BadgeVariant.Neutral
        "online" -> BadgeVariant.Info
        "offline" -> BadgeVariant.Danger
        "parked" -> BadgeVariant.Warning
        "asleep" -> BadgeVariant.Neutral
        else -> BadgeVariant.Neutral
    }

private val SELECT_SKELETON_HEIGHT: Dp = 56.dp
private val LEGEND_DOT: Dp = 10.dp

// ── Previews — one per rendered state (loading / error / empty / content) ─────────────────────────────────────

private fun previewData(): TimelineData =
    buildTimelineData(
        buildJsonArray {
            add(previewTransition("2026-06-01T08:00:00Z", "sleeping", "driving"))
            add(previewTransition("2026-06-01T09:00:00Z", "driving", "charging"))
            add(previewTransition("2026-06-01T10:30:00Z", "charging", "idle"))
            add(previewTransition("2026-06-02T07:15:00Z", "idle", "driving"))
            add(previewTransition("2026-06-02T08:45:00Z", "driving", "sleeping"))
        },
        nowMillis = 1_780_000_000_000L,
    )

private fun previewTransition(
    ts: String,
    from: String,
    to: String,
): JsonObject =
    buildJsonObject {
        put("ts", ts)
        put("from_state", from)
        put("to_state", to)
        put("trigger_field", "shift_state")
        put("trigger_value", "true")
    }

private fun previewFleet(): UiState<List<TimelineVehicleOption>> =
    UiState(io.teslasync.android.data.UiPhase.Content, data = listOf(TimelineVehicleOption(1L, "Red Rocket"), TimelineVehicleOption(2L, "Spacehauler")))

@Preview(name = "Timeline · content", showBackground = true)
@Composable
private fun TimelineContentPreview() {
    io.teslasync.android.ui.theme.TeslaSyncTheme(dynamicColor = false) {
        TimelinePageContent(
            state = UiState(io.teslasync.android.data.UiPhase.Content, data = previewData()),
            vehicles = previewFleet(),
            selectedVehicleId = 1L,
            onSelect = {},
            onRefresh = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Timeline · loading", showBackground = true)
@Composable
private fun TimelineLoadingPreview() {
    io.teslasync.android.ui.theme.TeslaSyncTheme(dynamicColor = false) {
        TimelinePageContent(
            state = UiState.loading(),
            vehicles = UiState.loading(),
            selectedVehicleId = null,
            onSelect = {},
            onRefresh = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Timeline · empty", showBackground = true)
@Composable
private fun TimelineEmptyPreview() {
    io.teslasync.android.ui.theme.TeslaSyncTheme(dynamicColor = false) {
        TimelinePageContent(
            state = UiState(io.teslasync.android.data.UiPhase.Empty, data = TimelineData.EMPTY),
            vehicles = previewFleet(),
            selectedVehicleId = 1L,
            onSelect = {},
            onRefresh = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Timeline · error", showBackground = true)
@Composable
private fun TimelineErrorPreview() {
    io.teslasync.android.ui.theme.TeslaSyncTheme(dynamicColor = false) {
        TimelinePageContent(
            state = UiState(io.teslasync.android.data.UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Http),
            vehicles = previewFleet(),
            selectedVehicleId = 1L,
            onSelect = {},
            onRefresh = {},
            onRetry = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
        )
    }
}
