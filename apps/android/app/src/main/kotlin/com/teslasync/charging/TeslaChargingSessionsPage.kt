// The native Jetpack Compose + Material 3 TeslaChargingSessionsPage charging surface — a parity port of
// web/src/features/charging/pages/TeslaChargingSessionsPage.tsx, the Fleet Charging Sessions explorer (business
// accounts only). It reproduces all ten panels (the business-account info banner; the VIN + refresh controls bar; the
// five summary StatCards — Total Sessions / Total Energy / Total Cost / Avg Cost per kWh / Peak Power; the monthly-cost
// bar chart; the session-location map; the session DataTable), both charts (the framing ChartContainer + the BarChart),
// every data state (loading skeleton / empty / hard-error retry / content, plus the cache-then-network stale/offline
// tier the bound state holder carries), and every visible string (resolved from the generated res/values catalog,
// ADR-014).
//
// Composition: [TeslaChargingSessionsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the four bound state flows); [TeslaChargingSessionsPageContent]
// is the stateless render layer. The single `useTeslaChargingSessions` feed drives the summary cards, the monthly-cost
// chart, the location map, and the table; `useVehicles` backs the VIN picker; the `/settings` document drives the
// currency + locale + SI energy boundary; and `useRefreshTeslaChargingSessions` drives the spinning refresh control +
// the "Business account required" hint. The embedded TeslaChargingSessionsMap A3 feature view renders the markers.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 charging pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslachargingsessions

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.DataTableBulkBar
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.teslachargingsessionsmap.ChargingSessionsSource
import io.teslasync.android.featureviews.teslachargingsessionsmap.TeslaChargingSessionsMap
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 30

/** The monthly-cost chart height — the web `<ChartContainer height={280}>`. */
private val CHART_HEIGHT: Dp = 280.dp

/** The Peak-Power card's unit symbol — the web hardcodes `unit={'kW'}` (not an i18n key, like the web). */
private const val UNIT_KW = "kW"

/** The MIME type the bulk "Export CSV" share intent advertises. */
private const val CSV_MIME = "text/csv"

/** The page's interaction callbacks, wired to the [TeslaChargingSessionsPageViewModel]. */
data class TeslaChargingSessionsActions(
    val onSelectVehicle: (String) -> Unit,
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TeslaChargingSessionsPageViewModel] over the supplied [source] (the host wires the
 * shared charging repository + the shared Vehicles / Settings holders via [teslaChargingSessionsPageSourceOf]). [logger]
 * defaults to the app's redacting logger.
 */
@Composable
fun TeslaChargingSessionsPage(
    source: TeslaChargingSessionsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: TeslaChargingSessionsPageViewModel =
        viewModel(
            key = TeslaChargingSessionsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { TeslaChargingSessionsPageViewModel(source, logger) } },
        )
    TeslaChargingSessionsPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] state flows + interaction callbacks to the stateless content. */
@Composable
fun TeslaChargingSessionsPage(
    viewModel: TeslaChargingSessionsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val sessions by viewModel.sessions.collectAsStateWithLifecycle()
    val vehicles by viewModel.vehicles.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val refreshState by viewModel.refreshState.collectAsStateWithLifecycle()
    val selectedVin by viewModel.selectedVin.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            TeslaChargingSessionsActions(
                onSelectVehicle = viewModel::selectVehicle,
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
            )
        }

    TeslaChargingSessionsPageContent(
        sessions = sessions,
        vehicles = vehicles.data ?: emptyList(),
        prefs = prefs,
        refreshState = refreshState,
        selectedVin = selectedVin,
        actions = actions,
        mapSourceFor = viewModel::mapSource,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the page chrome (title + subtitle) followed by the ten always-present panels. Each
 * data-bearing panel renders the full state matrix internally (loading skeleton / content / friendly empty state) so no
 * region ever collapses to a blank box; a hard error (no cached fallback) surfaces a localized retry banner above the
 * panels, exactly as the web `PageContainer` swaps its body for an error surface.
 */
@Composable
fun TeslaChargingSessionsPageContent(
    sessions: UiState<TeslaChargingSessionsResponse>,
    vehicles: List<Vehicle>,
    prefs: TeslaChargingDisplayPrefs,
    refreshState: TeslaChargingRefreshState,
    selectedVin: String,
    actions: TeslaChargingSessionsActions,
    mapSourceFor: (String?) -> ChargingSessionsSource,
    modifier: Modifier = Modifier,
) {
    val response = sessions.data ?: TeslaChargingSessionsResponse()
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SessionsHeader()

        FadeIn { BusinessNoteBanner() }
        FadeIn(delayMs = FADE_STEP_MS) {
            ControlsBar(
                vehicles = vehicles,
                selectedVin = selectedVin,
                refreshState = refreshState,
                sessions = response.sessions,
                prefs = prefs,
                onSelectVehicle = actions.onSelectVehicle,
                onRefresh = actions.onRefresh,
            )
        }

        if (sessions.isError) {
            FadeIn { SessionsErrorBanner(onRetry = actions.onRetry) }
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            SummaryStats(summary = response.summary, loading = sessions.isLoading, prefs = prefs)
        }
        FadeIn(delayMs = FADE_STEP_MS) {
            MonthlyCostChart(sessions = response.sessions, loading = sessions.isLoading, prefs = prefs)
        }
        FadeIn(delayMs = FADE_STEP_MS) {
            SessionLocationsPanel(sessions = response.sessions, selectedVin = selectedVin, mapSourceFor = mapSourceFor)
        }
        FadeIn(delayMs = FADE_STEP_MS) {
            SessionsTablePanel(sessions = response.sessions, loading = sessions.isLoading, prefs = prefs)
        }
    }
}

/** The page chrome — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun SessionsHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_tesla_sessions_title))
        BodyText(
            stringResource(R.string.translation_tesla_sessions_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** GlassPanel 1 — the business-account info banner (web first `FadeIn` panel). */
@Composable
private fun BusinessNoteBanner() {
    GlassPanel(padding = PanelPadding.Md) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                TeslaChargingSessionsGlyphs.Building2,
                contentDescription = null,
                size = IconSize.Lg,
                tint = TeslaTokens.status.warning,
            )
            BodyText(
                stringResource(R.string.translation_tesla_sessions_businessNote),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** GlassPanel 2 — the controls bar (VIN picker + refresh control + 403 hint + last-synced label). */
@Composable
private fun ControlsBar(
    vehicles: List<Vehicle>,
    selectedVin: String,
    refreshState: TeslaChargingRefreshState,
    sessions: List<TeslaChargingSessionRow>,
    prefs: TeslaChargingDisplayPrefs,
    onSelectVehicle: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    val allVehiclesLabel = stringResource(R.string.translation_tesla_sessions_allVehicles)
    val options =
        remember(vehicles, allVehiclesLabel) {
            buildList {
                add(SelectOption(value = "", label = allVehiclesLabel))
                vehicles.forEach { vehicle ->
                    add(
                        SelectOption(
                            value = vehicle.vin,
                            label = TeslaChargingSessionsFormat.vehicleOptionLabel(vehicle.displayName, vehicle.vin),
                        ),
                    )
                }
            }
        }
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Select(
                options = options,
                selectedValue = selectedVin,
                onSelect = onSelectVehicle,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Button(
                    label =
                        if (refreshState.pending) {
                            stringResource(R.string.translation_tesla_sessions_refreshing)
                        } else {
                            stringResource(R.string.translation_tesla_sessions_refresh)
                        },
                    onClick = onRefresh,
                    enabled = !refreshState.pending,
                    loading = refreshState.pending,
                    leadingIcon = TeslaChargingSessionsGlyphs.Refresh,
                )
                if (refreshState.forbidden) {
                    BodyText(
                        stringResource(R.string.translation_tesla_sessions_businessOnly),
                        color = TeslaTokens.status.warning,
                    )
                }
            }
            if (sessions.isNotEmpty()) {
                val lastSync = TeslaChargingSessionsFormat.dateTime(sessions.first().fetchedAt, prefs.locale)
                Caption("${stringResource(R.string.translation_tesla_sessions_lastSync)}: $lastSync")
            }
        }
    }
}

/** The hard-error surface (web `PageContainer error`) — a localized, retry-able error above the panels. */
@Composable
private fun SessionsErrorBanner(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
        )
    }
}

/** GlassPanels 3–7 — the five summary StatCards, stacked one-per-row to match the web mobile breakpoint. */
@Composable
private fun SummaryStats(
    summary: TeslaChargingSummary,
    loading: Boolean,
    prefs: TeslaChargingDisplayPrefs,
) {
    val locale = prefs.locale
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_tesla_sessions_stats_sessions),
            value = TeslaChargingSessionsFormat.integer(summary.totalSessions, locale),
            icon = TeslaChargingSessionsGlyphs.Bolt,
            loading = loading,
        )
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_tesla_sessions_stats_energy),
            value = summary.totalWh?.let { prefs.unitFormatter.energy(it, precision = ENERGY_DECIMALS) } ?: EM_DASH,
            icon = TeslaChargingSessionsGlyphs.Gauge,
            loading = loading,
        )
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_tesla_sessions_stats_cost_decimal),
            value =
                summary.totalCost
                    ?.let { TeslaChargingSessionsFormat.currencyBySymbol(it, prefs.currencySymbol, COST_DECIMALS, locale) }
                    ?: EM_DASH,
            icon = TeslaChargingSessionsGlyphs.DollarSign,
            loading = loading,
        )
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_tesla_sessions_stats_avgCost),
            value =
                summary.avgCostPerKwh
                    ?.let { TeslaChargingSessionsFormat.currencyBySymbol(it, prefs.currencySymbol, RATE_DECIMALS, locale) }
                    ?: EM_DASH,
            icon = TeslaChargingSessionsGlyphs.TrendingUp,
            loading = loading,
        )
        StatCard(
            modifier = Modifier.fillMaxWidth(),
            label = stringResource(R.string.translation_tesla_sessions_stats_peakPower),
            value = summary.peakPowerKw?.let { TeslaChargingSessionsFormat.number(it, POWER_DECIMALS, locale) } ?: EM_DASH,
            unit = summary.peakPowerKw?.let { UNIT_KW },
            icon = TeslaChargingSessionsGlyphs.Clock,
            loading = loading,
        )
    }
}

/** GlassPanel 8 — the monthly charging-cost bar chart (the framing ChartContainer + the BarChart). */
@Composable
private fun MonthlyCostChart(
    sessions: List<TeslaChargingSessionRow>,
    loading: Boolean,
    prefs: TeslaChargingDisplayPrefs,
) {
    val monthly = remember(sessions) { buildMonthlyCost(sessions) }
    val totalLabel = stringResource(R.string.translation_tesla_sessions_col_total)
    val status =
        when {
            loading && monthly.isEmpty() -> ChartStatus.Loading
            monthly.isEmpty() -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }
    val series =
        remember(monthly, totalLabel) {
            listOf(
                ChartSeries(
                    key = "total",
                    label = totalLabel,
                    values = monthly.map { it.total },
                    kind = ChartSeriesKind.Bar,
                ),
            )
        }
    val yFormatter: (Double) -> String = { value ->
        TeslaChargingSessionsFormat.currencyBySymbol(value, prefs.currencySymbol, POWER_DECIMALS, prefs.locale)
    }
    ChartContainer(
        title = stringResource(R.string.translation_tesla_sessions_monthlyCost),
        status = status,
        height = CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_tesla_sessions_monthlyCost_aria),
        emptyMessage = stringResource(R.string.translation_tesla_sessions_noChartData),
        dataTableHeader =
            listOf(
                stringResource(R.string.translation_tesla_sessions_col_month),
                totalLabel,
            ),
        dataTableRows = monthly.map { listOf(it.month, yFormatter(it.total)) },
    ) {
        BarChartWrapper(
            series = series,
            xLabels = monthly.map { it.month },
            height = CHART_HEIGHT,
            yValueFormatter = yFormatter,
        )
    }
}

/** GlassPanel 9 — the session-location map (web `<LazyMap sessions={mapPoints}>`), with its no-location empty state. */
@Composable
private fun SessionLocationsPanel(
    sessions: List<TeslaChargingSessionRow>,
    selectedVin: String,
    mapSourceFor: (String?) -> ChargingSessionsSource,
) {
    val mapTitle = stringResource(R.string.translation_tesla_sessions_map)
    val hasLocations = remember(sessions) { sessions.any { it.hasLocation } }
    GlassPanel(modifier = Modifier.semantics { contentDescription = mapTitle }, padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                TeslaChargingSessionsGlyphs.MapPin,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.primary,
            )
            SectionTitle(mapTitle)
        }
        if (hasLocations) {
            val mapSource = remember(selectedVin) { mapSourceFor(selectedVin.ifEmpty { null }) }
            TeslaChargingSessionsMap(
                source = mapSource,
                instanceKey = "teslaChargingSessions.map:$selectedVin",
            )
        } else {
            EmptyState(
                icon = TeslaChargingSessionsGlyphs.MapPin,
                message = stringResource(R.string.translation_tesla_sessions_noMapData),
            )
        }
    }
}

/** GlassPanel 10 — the session DataTable (sortable columns, multi-select + CSV export, paginated), with its empty state. */
@Composable
private fun SessionsTablePanel(
    sessions: List<TeslaChargingSessionRow>,
    loading: Boolean,
    prefs: TeslaChargingDisplayPrefs,
) {
    GlassPanel(padding = PanelPadding.Md) {
        SectionTitle(stringResource(R.string.translation_tesla_sessions_table))
        Column(modifier = Modifier.padding(top = Spacing.md)) {
            when {
                loading && sessions.isEmpty() -> SessionsTableBody(sessions = emptyList(), loading = true, prefs = prefs)
                sessions.isEmpty() ->
                    EmptyState(
                        icon = TeslaChargingSessionsGlyphs.Info,
                        message = stringResource(R.string.translation_tesla_sessions_noData),
                    )
                else -> SessionsTableBody(sessions = sessions, loading = false, prefs = prefs)
            }
        }
    }
}

/** The table body — hoists the sort / page / selection state and renders the bulk bar + [DataTable] + pagination. */
@Composable
private fun SessionsTableBody(
    sessions: List<TeslaChargingSessionRow>,
    loading: Boolean,
    prefs: TeslaChargingDisplayPrefs,
) {
    val context = LocalContext.current
    var sortState by remember { mutableStateOf(SortState(key = TeslaChargingSessionsSort.DATE, direction = SortDirection.Desc)) }
    var page by remember { mutableIntStateOf(1) }
    var selectedKeys by remember { mutableStateOf(emptySet<Any>()) }

    val sorted =
        remember(sessions, sortState) {
            sortSessions(
                sessions = sessions,
                sortKey = sortState.key ?: TeslaChargingSessionsSort.DATE,
                descending = sortState.direction == SortDirection.Desc,
            )
        }
    val total = sorted.size
    val pageCount = ((total + SESSIONS_PAGE_SIZE - 1) / SESSIONS_PAGE_SIZE).coerceAtLeast(1)
    val current = page.coerceIn(1, pageCount)
    val visible = remember(sorted, current) { sorted.drop((current - 1) * SESSIONS_PAGE_SIZE).take(SESSIONS_PAGE_SIZE) }
    val columns = sessionColumns(prefs)

    val selectedTemplate = stringResource(R.string.translation_table_bulkActions_selected)
    val clearLabel = stringResource(R.string.translation_table_bulkActions_clear)
    val exportLabel = stringResource(R.string.translation_table_bulkActions_exportCsv)
    val showingTemplate = stringResource(R.string.translation_pagination_showing)

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        DataTableBulkBar(
            count = selectedKeys.size,
            onClear = { selectedKeys = emptySet() },
            selectedText = { count -> String.format(prefs.locale, selectedTemplate, count) },
            clearLabel = clearLabel,
        ) {
            Button(
                label = exportLabel,
                onClick = { shareSessionsCsv(context, sorted.filter { it.sessionId in selectedKeys }) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = TeslaChargingSessionsGlyphs.Download,
            )
        }
        DataTable(
            columns = columns,
            rows = visible,
            keyOf = { it.sessionId },
            modifier = Modifier.fillMaxWidth(),
            sortState = sortState,
            onSortChange = { key -> sortState = sortState.toggledBy(key) },
            selectable = true,
            selectedKeys = selectedKeys,
            onSelectedChange = { selectedKeys = it },
            loading = loading,
            emptyText = stringResource(R.string.translation_tesla_sessions_noData),
            selectAllLabel = stringResource(R.string.translation_table_selection_selectAll),
            footer =
                if (total > SESSIONS_PAGE_SIZE) {
                    {
                        Pagination(
                            page = current,
                            pageSize = SESSIONS_PAGE_SIZE,
                            total = total,
                            onPageChange = { page = it },
                            firstLabel = stringResource(R.string.translation_pagination_first),
                            previousLabel = stringResource(R.string.translation_pagination_previous),
                            nextLabel = stringResource(R.string.translation_pagination_next),
                            lastLabel = stringResource(R.string.translation_pagination_last),
                            showingText = { start, end, count ->
                                String.format(prefs.locale, showingTemplate, start, end, count)
                            },
                        )
                    }
                } else {
                    null
                },
        )
    }
}

/**
 * The nine session columns in web order (date, location, vin, energy, peakPower, duration, cost, rate, type). The four
 * web-sortable columns (date / energy / peakPower / cost) carry [TableColumn.sortable]; every cell renders the formatted
 * value or the em-dash fallback for an absent figure.
 */
@Composable
private fun sessionColumns(prefs: TeslaChargingDisplayPrefs): List<TableColumn<TeslaChargingSessionRow>> {
    val locale = prefs.locale
    return listOf(
        TableColumn(
            key = TeslaChargingSessionsSort.DATE,
            header = stringResource(R.string.translation_tesla_sessions_col_date),
            weight = 1.6f,
            sortable = true,
        ) { row -> BodyText(TeslaChargingSessionsFormat.dateTime(row.chargeStartDatetime, locale)) },
        TableColumn(
            key = "location",
            header = stringResource(R.string.translation_tesla_sessions_col_location),
            weight = 1.6f,
        ) { row ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(
                    TeslaChargingSessionsGlyphs.MapPin,
                    contentDescription = null,
                    size = IconSize.Xs,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                BodyText(row.siteLocationName?.takeIf { it.isNotEmpty() } ?: EM_DASH, maxLines = 1)
            }
        },
        TableColumn(
            key = "vin",
            header = stringResource(R.string.translation_tesla_sessions_col_vin),
            weight = 1f,
        ) { row -> Caption(TeslaChargingSessionsFormat.vinSuffix(row.vin)) },
        TableColumn(
            key = TeslaChargingSessionsSort.ENERGY,
            header = stringResource(R.string.translation_tesla_sessions_col_energy),
            weight = 1.1f,
            sortable = true,
            alignEnd = true,
        ) { row ->
            BodyText(
                row.totalEnergyAddedWh
                    ?.let { TeslaChargingSessionsFormat.number(TeslaChargingSessionsFormat.energyKwh(it), ENERGY_DECIMALS, locale) }
                    ?: EM_DASH,
            )
        },
        TableColumn(
            key = TeslaChargingSessionsSort.PEAK_POWER,
            header = stringResource(R.string.translation_tesla_sessions_col_peakPower),
            weight = 1f,
            sortable = true,
            alignEnd = true,
        ) { row ->
            BodyText(row.peakPowerKw?.let { TeslaChargingSessionsFormat.number(it, POWER_DECIMALS, locale) } ?: EM_DASH)
        },
        TableColumn(
            key = "duration",
            header = stringResource(R.string.translation_tesla_sessions_col_duration),
            weight = 1f,
        ) { row -> BodyText(TeslaChargingSessionsFormat.duration(row.chargeDurationS)) },
        TableColumn(
            key = TeslaChargingSessionsSort.COST,
            header = stringResource(R.string.translation_tesla_sessions_col_cost_decimal),
            weight = 1.1f,
            sortable = true,
            alignEnd = true,
        ) { row ->
            BodyText(
                row.totalCost
                    ?.let {
                        TeslaChargingSessionsFormat.currencyByCode(it, row.currencyCode, prefs.currencySymbol, COST_DECIMALS, locale)
                    }
                    ?: EM_DASH,
            )
        },
        TableColumn(
            key = "rate",
            header = stringResource(R.string.translation_tesla_sessions_col_rate),
            weight = 1.1f,
            alignEnd = true,
        ) { row ->
            Caption(
                row.perKwhRate
                    ?.let {
                        TeslaChargingSessionsFormat.currencyByCode(it, row.currencyCode, prefs.currencySymbol, RATE_DECIMALS, locale)
                    }
                    ?: EM_DASH,
            )
        },
        TableColumn(
            key = "type",
            header = stringResource(R.string.translation_tesla_sessions_col_type),
            weight = 1f,
        ) { row -> Caption(row.chargerType?.uppercase(locale) ?: EM_DASH) },
    )
}

/**
 * Shares the selected sessions as a CSV via the platform chooser (the native analogue of the web Blob download in
 * `exportSelectedCsv`). The body is built by the pure [buildSessionsCsv]; a sheet lets the user save or send the file.
 */
private fun shareSessionsCsv(
    context: android.content.Context,
    rows: List<TeslaChargingSessionRow>,
) {
    if (rows.isEmpty()) return
    val intent =
        Intent(Intent.ACTION_SEND).apply {
            type = CSV_MIME
            putExtra(Intent.EXTRA_TEXT, buildSessionsCsv(rows))
        }
    context.startActivity(Intent.createChooser(intent, null))
}

