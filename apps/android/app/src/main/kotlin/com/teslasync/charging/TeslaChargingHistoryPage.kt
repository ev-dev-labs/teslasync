// The native Jetpack Compose + Material 3 TeslaChargingHistoryPage charging surface — a parity port of
// web/src/features/charging/pages/TeslaChargingHistoryPage.tsx, the Supercharger/DC fast-charging billing-records
// inspector. It reproduces the page's panels (the four summary stat tiles, the monthly-spending bar chart, and
// the charging-sessions table panel), every data state (loading / empty / error / success), and every visible
// string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [TeslaChargingHistoryPage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the history state + the vehicle list + the
// currency context + the live unit formatter); [TeslaChargingHistoryPageContent] is the stateless render layer
// driven entirely by [UiState] + [TeslaChargingHistoryInteraction] + [TeslaChargingHistoryActions] +
// [TeslaChargingHistoryFormat]. All derivation lives in the framework-free model
// (TeslaChargingHistoryPageModel.kt); this file only resolves i18n, formats at the SI/currency display boundary,
// and draws.
//
// SI boundary (unit-conversion instructions): energy stays SI Wh end-to-end and is converted to the user's unit
// only here, by [io.teslasync.android.data.UnitFormatter.energy] at render; money formats through the
// settings-derived [CurrencyContext]. Nothing is converted or stored non-SI.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.charging.teslacharginghistory

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
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
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Currency
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 50

/** Energy display precision (web `formatEnergy(wh, { precision: 1 })`). */
private const val ENERGY_PRECISION = 1

/** Per-row cost precision (web `formatCurrencyValue(total_due, …, 2)`). */
private const val ROW_COST_PRECISION = 2

/** Summary spend precision (web `formatCurrency(total_spend, 2)`). */
private const val SPEND_PRECISION = 2

/** Average cost / rate precision (web `formatCurrency(avg_cost_per_kwh, 3)` / `fmtNumber(rate_base, 3)`). */
private const val RATE_PRECISION = 3

/** Chart axis money precision (web YAxis `tickFormatter={(v) => formatCurrency(v, 0)}`). */
private const val AXIS_PRECISION = 0

/** Trailing VIN digits shown in the dropdown label (web `v.vin.slice(-6)`). */
private const val VIN_TAIL = 6

/** Monthly-spending chart bar color (web `#22d3ee` gradient) — a dynamic computed value, not a static token. */
private val SPEND_BAR_COLOR = Color(0xFF22D3EE)

/** The page's interaction callbacks, wired to the [TeslaChargingHistoryPageViewModel] (web event handlers). */
data class TeslaChargingHistoryActions(
    val onSelectVehicle: (String) -> Unit,
    val onSearch: (String) -> Unit,
    val onSort: (String) -> Unit,
    val onSelectionChange: (Set<Long>) -> Unit,
    val onRefresh: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TeslaChargingHistoryPageViewModel] over the supplied [source] (the host wires
 * the shared Vehicles/Settings stores + the charging repository via [teslaChargingHistoryPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun TeslaChargingHistoryPage(
    source: TeslaChargingHistoryPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: TeslaChargingHistoryPageViewModel =
        viewModel(
            key = TeslaChargingHistoryPageRegistration.SLUG,
            factory = viewModelFactory { initializer { TeslaChargingHistoryPageViewModel(source, logger) } },
        )
    TeslaChargingHistoryPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot + the display formatter to the content. */
@Composable
fun TeslaChargingHistoryPage(
    viewModel: TeslaChargingHistoryPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val vehicles by viewModel.vehicles.collectAsStateWithLifecycle()
    val currency by viewModel.currency.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            TeslaChargingHistoryActions(
                onSelectVehicle = viewModel::selectVehicle,
                onSearch = viewModel::setSearch,
                onSort = viewModel::toggleSort,
                onSelectionChange = viewModel::setSelectedKeys,
                onRefresh = viewModel::refresh,
                onRetry = viewModel::retry,
            )
        }
    val format = remember(unitFormatter, currency) { TeslaChargingHistoryFormat(unitFormatter, currency) }

    TeslaChargingHistoryPageContent(
        state = state,
        interaction = interaction,
        vehicles = vehicles,
        refreshing = refreshing,
        format = format,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the vehicle/refresh actions, the summary stats, the chart, and the table. */
@Composable
fun TeslaChargingHistoryPageContent(
    state: UiState<TeslaChargingHistoryData>,
    interaction: TeslaChargingHistoryInteraction,
    vehicles: List<Vehicle>,
    refreshing: Boolean,
    format: TeslaChargingHistoryFormat,
    actions: TeslaChargingHistoryActions,
    modifier: Modifier = Modifier,
) {
    val data = state.data ?: TeslaChargingHistoryData.EMPTY

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TeslaChargingHistoryHeader()

        TeslaChargingHistoryActionsRow(
            vehicles = vehicles,
            selectedVin = interaction.selectedVin,
            refreshing = refreshing,
            actions = actions,
        )

        LastSyncLine(entries = data.entries, format = format)

        FadeIn(delayMs = FADE_STEP_MS) {
            SummaryStatsSection(summary = data.summary, loading = state.isLoading, format = format)
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            MonthlySpendingChart(entries = data.entries, loading = state.isLoading, format = format)
        }

        FadeIn(delayMs = FADE_STEP_MS * 3) {
            SessionsPanel(state = state, data = data, interaction = interaction, format = format, actions = actions)
        }
    }
}

@Composable
private fun TeslaChargingHistoryHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_tesla_charging_title))
        BodyText(
            stringResource(R.string.translation_tesla_charging_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The VIN-filter dropdown (web `<Select>`) + the Refresh-from-Tesla action (web `<Button>`). */
@Composable
private fun TeslaChargingHistoryActionsRow(
    vehicles: List<Vehicle>,
    selectedVin: String,
    refreshing: Boolean,
    actions: TeslaChargingHistoryActions,
) {
    val allVehicles = stringResource(R.string.translation_tesla_charging_allVehicles)
    val selectVehicleAria = stringResource(R.string.translation_tesla_charging_selectVehicle)
    val options =
        remember(vehicles, allVehicles) {
            buildList {
                add(SelectOption("", allVehicles))
                vehicles.forEach { add(SelectOption(it.vin, "${it.displayName} (${it.vin.takeLast(VIN_TAIL)})")) }
            }
        }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(modifier = Modifier.semantics { contentDescription = selectVehicleAria }) {
            Select(
                options = options,
                selectedValue = selectedVin,
                onSelect = actions.onSelectVehicle,
                emptyLabel = allVehicles,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            Button(
                label =
                    if (refreshing) {
                        stringResource(R.string.translation_tesla_charging_refreshing)
                    } else {
                        stringResource(R.string.translation_tesla_charging_refresh)
                    },
                onClick = actions.onRefresh,
                variant = ButtonVariant.Primary,
                enabled = !refreshing,
                loading = refreshing,
                leadingIcon = if (refreshing) null else TeslaChargingHistoryGlyphs.RefreshCw,
            )
        }
    }
}

/** The "Last synced" freshness line, shown when history rows are present (web `entries[0]?.fetched_at`). */
@Composable
private fun LastSyncLine(
    entries: List<TeslaChargingHistoryEntry>,
    format: TeslaChargingHistoryFormat,
) {
    val first = entries.firstOrNull() ?: return
    if (first.fetchedAt.isBlank()) return
    FadeIn {
        Caption(
            "${stringResource(R.string.translation_tesla_charging_lastSync)}: ${format.dateTime(first.fetchedAt)}",
        )
    }
}

// ── Summary stats (Total-Sessions / Total-Energy / Total-Spend / Avg-Cost-kWh) ──────────────────────────────

@Composable
private fun SummaryStatsSection(
    summary: TeslaChargingHistorySummary,
    loading: Boolean,
    format: TeslaChargingHistoryFormat,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_tesla_charging_stats_sessions),
                value = format.int(summary.totalSessions),
                modifier = Modifier.weight(1f),
                icon = TeslaChargingHistoryGlyphs.Zap,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_tesla_charging_stats_energy),
                value = summary.totalWh?.let { format.energy(it) } ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = TeslaChargingHistoryGlyphs.Gauge,
                loading = loading,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_tesla_charging_stats_spend),
                value = summary.totalSpend?.let { format.money(it, SPEND_PRECISION) } ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = TeslaChargingHistoryGlyphs.DollarSign,
                loading = loading,
            )
            StatCard(
                label = stringResource(R.string.translation_tesla_charging_stats_avgCost),
                value = summary.avgCostPerKwh?.let { format.money(it, RATE_PRECISION) } ?: EM_DASH,
                modifier = Modifier.weight(1f),
                icon = TeslaChargingHistoryGlyphs.TrendingUp,
                loading = loading,
            )
        }
    }
}

// ── Monthly spending chart (ChartContainer + BarChart) ──────────────────────────────────────────────────────

@Composable
private fun MonthlySpendingChart(
    entries: List<TeslaChargingHistoryEntry>,
    loading: Boolean,
    format: TeslaChargingHistoryFormat,
) {
    val monthly = remember(entries) { buildMonthlySpending(entries) }
    val monthHeader = stringResource(R.string.translation_tesla_charging_col_month)
    val totalHeader = stringResource(R.string.translation_tesla_charging_col_total)

    ChartContainer(
        title = stringResource(R.string.translation_tesla_charging_monthlySpending),
        accessibleDescription = stringResource(R.string.translation_tesla_charging_monthlySpending_aria),
        status = if (loading) ChartStatus.Loading else ChartStatus.Ready,
        dataTableHeader = listOf(monthHeader, totalHeader),
        dataTableRows = monthly.map { listOf(it.month, format.money(it.total, AXIS_PRECISION)) },
        emptyMessage = stringResource(R.string.translation_tesla_charging_noChartData),
    ) {
        if (monthly.isNotEmpty()) {
            BarChartWrapper(
                series =
                    listOf(
                        ChartSeries(
                            key = "total",
                            label = totalHeader,
                            values = monthly.map { it.total },
                            kind = ChartSeriesKind.Bar,
                            color = SPEND_BAR_COLOR,
                        ),
                    ),
                xLabels = monthly.map { it.month },
                yValueFormatter = { format.money(it, AXIS_PRECISION) },
            )
        } else {
            EmptyState(
                icon = TeslaChargingHistoryGlyphs.Receipt,
                message = stringResource(R.string.translation_tesla_charging_noChartData),
            )
        }
    }
}

// ── Sessions table panel (GlassPanel6) + the four data states ───────────────────────────────────────────────

@Composable
private fun SessionsPanel(
    state: UiState<TeslaChargingHistoryData>,
    data: TeslaChargingHistoryData,
    interaction: TeslaChargingHistoryInteraction,
    format: TeslaChargingHistoryFormat,
    actions: TeslaChargingHistoryActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        PanelTitle(stringResource(R.string.translation_tesla_charging_sessions))
        Column(modifier = Modifier.padding(top = Spacing.md)) {
            when {
                state.isLoading -> SessionsLoadingState()
                state.isError -> SessionsErrorState(onRetry = actions.onRetry)
                data.entries.isEmpty() -> SessionsEmptyState()
                else -> SessionsContent(entries = data.entries, interaction = interaction, format = format, actions = actions)
            }
        }
    }
}

@Composable
private fun SessionsLoadingState() {
    Row(modifier = Modifier.fillMaxWidth().padding(Spacing.xl2), horizontalArrangement = Arrangement.Center) {
        Spinner(size = SpinnerSize.Md)
    }
}

@Composable
private fun SessionsErrorState(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

@Composable
private fun SessionsEmptyState() {
    EmptyState(
        icon = TeslaChargingHistoryGlyphs.Zap,
        message = stringResource(R.string.translation_tesla_charging_noData),
    )
}

/** The loaded sessions surface: the search box, the active-filter chip, the bulk-export bar, and the table. */
@Composable
private fun SessionsContent(
    entries: List<TeslaChargingHistoryEntry>,
    interaction: TeslaChargingHistoryInteraction,
    format: TeslaChargingHistoryFormat,
    actions: TeslaChargingHistoryActions,
) {
    val filtered = remember(entries, interaction.search) { filterEntries(entries, interaction.search) }
    val sorted =
        remember(filtered, interaction.sortColumn, interaction.sortDescending) {
            sortEntries(filtered, interaction.sortColumn, interaction.sortDescending)
        }
    val columns = historyColumns(format)
    val clipboard = LocalClipboardManager.current

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SearchInput(
            value = interaction.search,
            onValueChange = actions.onSearch,
            hint = stringResource(R.string.translation_tesla_charging_searchPlaceholder), // parity:allow i18n key mirrors web `searchPlaceholder`; not a stub
        )

        if (interaction.search.isNotEmpty()) {
            ActiveSearchChip(search = interaction.search, onRemove = { actions.onSearch("") })
        }

        if (interaction.selectedKeys.isNotEmpty()) {
            val selectedRows = remember(sorted, interaction.selectedKeys) { sorted.filter { it.sessionId in interaction.selectedKeys } }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(
                    label = stringResource(R.string.translation_table_bulkActions_exportCsv),
                    onClick = { clipboard.setText(AnnotatedString(encodeEntriesCsv(selectedRows))) },
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    leadingIcon = TeslaChargingHistoryGlyphs.Download,
                )
            }
        }

        if (sorted.isNotEmpty()) {
            DataTable(
                columns = columns,
                rows = sorted,
                keyOf = { it.sessionId },
                sortState =
                    SortState(
                        key = interaction.sortKey,
                        direction = if (interaction.sortDescending) SortDirection.Desc else SortDirection.Asc,
                    ),
                onSortChange = actions.onSort,
                selectable = true,
                selectedKeys = interaction.selectedKeys,
                onSelectedChange = { keys -> actions.onSelectionChange(keys.filterIsInstance<Long>().toSet()) },
                emptyText = stringResource(R.string.translation_tesla_charging_noMatches),
            )
        } else {
            EmptyState(
                icon = TeslaChargingHistoryGlyphs.Zap,
                message = stringResource(R.string.translation_tesla_charging_noMatches),
            )
        }
    }
}

/** The web `ActiveFilterChips` search chip — the `Search` label, the value, and a remove affordance. */
@Composable
private fun ActiveSearchChip(
    search: String,
    onRemove: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .clickable(onClick = onRemove)
                .padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption("${stringResource(R.string.translation_tesla_charging_filterLabel_search)}: $search")
        Icon(TeslaChargingHistoryGlyphs.Receipt, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Table columns (web DataTable `columns`) ─────────────────────────────────────────────────────────────────

@Composable
private fun historyColumns(format: TeslaChargingHistoryFormat): List<TableColumn<TeslaChargingHistoryEntry>> {
    val uriHandler = LocalUriHandler.current
    val downloadInvoice = stringResource(R.string.translation_tesla_charging_downloadInvoice)
    val invoiceLabel = stringResource(R.string.translation_charging_invoice)
    return listOf(
        TableColumn(
            key = HistorySortColumn.Date.key,
            header = stringResource(R.string.translation_tesla_charging_col_date),
            weight = 1.4f,
            sortable = true,
        ) { row -> BodyText(format.dateTime(row.chargeStartDatetime)) },
        TableColumn(
            key = "location",
            header = stringResource(R.string.translation_tesla_charging_col_location),
            weight = 1.6f,
        ) { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Icon(TeslaChargingHistoryGlyphs.MapPin, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                BodyText(row.siteLocationName.ifBlank { EM_DASH })
            }
        },
        TableColumn(
            key = "duration",
            header = stringResource(R.string.translation_tesla_charging_col_duration),
        ) { row -> BodyText(formatDurationMinutes(durationMinutes(row.chargeStartDatetime, row.chargeStopDatetime))) },
        TableColumn(
            key = HistorySortColumn.Energy.key,
            header = stringResource(R.string.translation_tesla_charging_col_energy),
            sortable = true,
            alignEnd = true,
        ) { row -> BodyText(row.usageWh?.let { format.energy(it) } ?: EM_DASH, color = MaterialTheme.colorScheme.primary) },
        TableColumn(
            key = HistorySortColumn.Cost.key,
            header = stringResource(R.string.translation_tesla_charging_col_cost_decimal),
            sortable = true,
            alignEnd = true,
        ) { row -> BodyText(row.totalDue?.let { format.rowCost(it, row.currencyCode) } ?: EM_DASH, color = TeslaTokens.status.success) },
        TableColumn(
            key = "rate",
            header = stringResource(R.string.translation_tesla_charging_col_rate),
        ) { row ->
            BodyText(
                row.rateBase?.let { "${format.rate(it)}/${row.pricingType ?: "kWh"}" } ?: EM_DASH,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        TableColumn(
            key = "invoice",
            header = stringResource(R.string.translation_tesla_charging_col_invoice),
        ) { row -> InvoiceCell(row = row, label = invoiceLabel, downloadLabel = downloadInvoice, uriHandler = uriHandler::openUri) },
    )
}

@Composable
private fun InvoiceCell(
    row: TeslaChargingHistoryEntry,
    label: String,
    downloadLabel: String,
    uriHandler: (String) -> Unit,
) {
    val contentId = row.invoiceContentId
    if (row.hasInvoice && contentId != null) {
        val url = remember(contentId) { teslaChargingInvoiceUrl(contentId) }
        Row(
            modifier =
                Modifier
                    .clickable { uriHandler(url) }
                    .semantics { contentDescription = downloadLabel },
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(TeslaChargingHistoryGlyphs.Download, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.primary)
            Caption(label)
        }
    } else {
        BodyText(EM_DASH, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The absolute invoice download URL — the web `getTeslaChargingInvoiceURL` path under the deployment base URL. */
private fun teslaChargingInvoiceUrl(contentId: String): String =
    BuildConfig.API_BASE_URL.trimEnd('/') + "/api/v1/tesla/charging/invoice/$contentId"

// ── Display-boundary formatter (SI energy + settings currency + locale number/date) ─────────────────────────

/**
 * The locale-/units-aware formatter resolved once per composition from the live [UnitFormatter] and the
 * settings-derived [CurrencyContext] — the native analogue of the web `useUnits`/`useFormatting` hooks. Energy is
 * the SI display boundary (`UnitFormatter.energy`); money is the web `formatCurrency` (symbol + grouped number)
 * for summaries and the web `formatCurrencyValue` (ISO currency) for per-row costs; dates use the device locale +
 * zone. It performs no unit math itself and never mutates an SI source.
 */
class TeslaChargingHistoryFormat(
    private val unitFormatter: UnitFormatter,
    private val currency: CurrencyContext,
) {
    private val locale: Locale = resolveLocale(currency.locale)
    private val integerFormat: NumberFormat = NumberFormat.getIntegerInstance(locale)
    private val dateTimeFormatter: DateTimeFormatter =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(ZoneId.systemDefault())

    /** SI watt-hours → the user's energy unit at precision 1 (web `formatEnergy(wh, { precision: 1 })`). */
    fun energy(wattHours: Double?): String = unitFormatter.energy(wattHours, ENERGY_PRECISION)

    /** A locale-grouped integer (web `fmtInt`). */
    fun int(value: Int): String = integerFormat.format(value.toLong())

    /** A locale-grouped decimal at [decimals] fraction digits (web `fmtNumber`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String =
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = decimals
            maximumFractionDigits = decimals
        }.format(value)

    /** The web `formatCurrency` — the settings currency symbol prefixing a grouped number. */
    fun money(
        amount: Double,
        decimals: Int,
    ): String = currency.symbol + number(amount, decimals)

    /** A `fmtNumber(rate, 3)` rate figure (web rate cell). */
    fun rate(value: Double): String = number(value, RATE_PRECISION)

    /**
     * The web `formatCurrencyValue(amount, code ?? currencyCodeFromSymbol(symbol), locale, 2, useGrouping)` — ISO
     * currency formatting via the row's [code], falling back to the settings symbol's code, then to a plain
     * `"<code> <number>"` for an invalid ISO code.
     */
    fun rowCost(
        amount: Double,
        code: String?,
    ): String {
        val resolved = code?.takeIf { it.isNotBlank() } ?: currencyCodeFromSymbol(currency.symbol)
        return runCatching {
            NumberFormat.getCurrencyInstance(locale).apply {
                this.currency = Currency.getInstance(resolved)
                minimumFractionDigits = ROW_COST_PRECISION
                maximumFractionDigits = ROW_COST_PRECISION
            }.format(amount)
        }.getOrElse { "$resolved ${number(amount, ROW_COST_PRECISION)}" }
    }

    /** A localized date-time stamp (web `formatDateTime`); the raw ISO string on a parse failure. */
    fun dateTime(iso: String): String =
        parseInstant(iso)?.let { runCatching { dateTimeFormatter.format(it) }.getOrNull() } ?: iso

    private companion object {
        fun resolveLocale(tag: String): Locale {
            val resolved = runCatching { Locale.forLanguageTag(tag) }.getOrNull()
            return if (resolved == null || resolved.language.isEmpty()) Locale.US else resolved
        }
    }
}
