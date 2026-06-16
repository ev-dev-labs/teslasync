// The native Jetpack Compose + Material 3 TirePressurePage surface — a parity port of
// web/src/features/vehicle-systems/pages/TirePressurePage.tsx, the four-corner TPMS dashboard. It reproduces the
// page's nine panels, two charts (four corner RadialGauges + the pressure-history LineChart), every data state
// (loading / empty / error / success, plus the per-chart/table empty surface and the stale/offline tier), and every
// visible string (resolved from the generated translation_* catalog + the app-owned tire_pressure_* resources,
// ADR-014).
//
// Panel ↔ symbol map (the 9 manifest panels + the 2 charts):
//   1 GlassPanel1   → [WarningBannerPanel]   (web warning <GlassPanel>, L407)
//   2 GlassPanel2   → [CurrentReadingsPanel] (web gauges <GlassPanel>, L430)   chart RadialGauge → [TireGaugeCell]
//   3 GlassPanel3   → [TireGaugeCell]        (web per-corner <GlassPanel>, L448, ×4)
//   4 Avg-Pressure  → [SummaryMetricsGrid] MetricCard (web <MetricCard>, L479)
//   5 Min-Pressure  → [SummaryMetricsGrid] MetricCard (web <MetricCard>, L489)
//   6 Warning-Count → [SummaryMetricsGrid] MetricCard (web <MetricCard>, L499)
//   7 Last-Updated  → [SummaryMetricsGrid] MetricCard (web <MetricCard>, L505)
//   8 GlassPanel8   → [PressureHistoryPanel] ChartContainer (web history <GlassPanel>, L514) chart LineChart
//   9 GlassPanel9   → [HistoryTablePanel]    (web table <GlassPanel>, L565)
//
// Composition: [TirePressurePage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the snapshot feed + the live display preferences);
// [TirePressurePageContent] is the stateless render layer (the chrome — title / subtitle / freshness chip /
// vehicle-scope picker — then the snapshot-gated body: a first-load loader, a retryable error, or the nine panels).
// All decode + derivation lives in the framework-free model (TirePressurePageModel.kt); this file only resolves i18n +
// converts SI pressure (Pa) to the user's display unit at the render boundary (web `convertPressureFromSI`) + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete
// panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LargeClass")

package io.teslasync.android.vehiclesystems.tirepressure

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The em dash shown for a missing summary value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 100

/** The per-corner radial gauge size (web `RadialGauge size={120}`). */
private val GAUGE_SIZE = 120.dp

/** The display pressure axis / value decimals (web `fmtNumber(v, 1)`). */
private const val PRESSURE_AXIS_DECIMALS = 1

/** Theme-aware chart-palette accent indices (web per-card color), one per metric tile. */
private const val ACCENT_CYAN = 0
private const val ACCENT_GREEN = 1
private const val ACCENT_AMBER = 2
private const val ACCENT_PURPLE = 4

/** Relative widths of the six history-table columns (web `compact` table). */
private const val COL_WEIGHT_TIME = 1.8f
private const val COL_WEIGHT_CORNER = 1.1f
private const val COL_WEIGHT_WARN = 1.3f

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TirePressurePageViewModel] over the supplied [source] (the host wires the shared
 * VehicleSystems + Settings holders + the app-scoped active-vehicle selection via [tirePressurePageSourceOf]).
 * [logger] defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live
 * state to the content.
 */
@Composable
fun TirePressurePage(
    source: TirePressurePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TirePressurePageViewModel =
        viewModel(
            key = TirePressurePageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { TirePressurePageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    TirePressurePageContent(
        state = state,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker + the stale/offline
 * banner + the inline load-error banner), then the snapshot-gated body — a centered loader on a first load, a
 * retryable error panel on a hard failure, or the nine panels otherwise. Each chart/table renders its own
 * content-or-empty surface so no section is ever hidden.
 */
@Composable
fun TirePressurePageContent(
    state: UiState<TirePressureSnapshot>,
    prefs: TireDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // web `usePageTitle(t('tirePressure.title', 'Tire Pressure'))` — the screen/document title; surfaced to TalkBack
    // as the accessible pane title (ADR-015), distinct from the visible title header below.
    val paneTitleText = stringResource(R.string.translation_tirePressure_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .semantics { paneTitle = paneTitleText }
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TirePressureChrome(state = state)

        when {
            state.isLoading -> TirePressureLoading()
            state.isError -> TirePressureError(onRetry = onRetry)
            else -> TirePressureBody(snapshot = state.data ?: TirePressureSnapshot.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the vehicle picker, and the banners. */
@Composable
private fun TirePressureChrome(state: UiState<TirePressureSnapshot>) {
    val snapshot = state.data
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_tirePressure_title))
                BodyText(
                    stringResource(R.string.translation_tirePressure_subtitle),
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
        // web `actions={<VehicleSelect ariaLabel={t('tirePressure.selectVehicle')} />}` — the global active-vehicle
        // scope picker, with the localized aria label exposed to TalkBack (ADR-015).
        val selectVehicleLabel = stringResource(R.string.tire_pressure_select_vehicle)
        VehicleSelect(
            withIcon = true,
            modifier = Modifier.semantics { contentDescription = selectVehicleLabel },
        )
        // web `<LiveStaleDataBanner />` — surfaced only while cached data is shown because the network is unreachable.
        if (state.isOffline) LiveStaleDataBanner()
        // web inline `<AlertBanner variant="danger">{t('error.loadFailed')}</AlertBanner>` — shown when the history
        // feed failed while the latest reading still renders (a hard latest failure routes to the error surface).
        if (state.isContent && snapshot?.historyError == true) InlineLoadError()
    }
}

/** The inline history-load error banner (web `AlertBanner` with the AlertCircle icon + `error.loadFailed`). */
@Composable
private fun InlineLoadError() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md, accent = PanelAccent.Danger) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(TireGlyphs.AlertCircle, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.danger)
            BodyText(stringResource(R.string.translation_error_loadFailed), color = TeslaTokens.status.danger)
        }
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun TirePressureLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error={latestError}`). */
@Composable
private fun TirePressureError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun TirePressureBody(
    snapshot: TirePressureSnapshot,
    prefs: TireDisplayPrefs,
) {
    if (snapshot.hasWarning) {
        FadeIn { WarningBannerPanel(hardWarning = snapshot.hasHardWarning) }
    }
    FadeIn(delayMs = FADE_STEP_MS) { CurrentReadingsPanel(snapshot = snapshot, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 2) { SummaryMetricsGrid(snapshot = snapshot, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 3) { PressureHistoryPanel(snapshot = snapshot, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 4) { HistoryTablePanel(snapshot = snapshot, prefs = prefs) }
}

// ── Panel 1 — TPMS warning banner (GlassPanel1) ─────────────────────────────────────────────────────────────────

/**
 * GlassPanel1 — the web warning banner `<GlassPanel>`: an alert icon + a badge reading "Hard Warning Active" (red) or
 * "Soft Warning Active" (amber), shown only when the latest reading reports a TPMS warning (web `hasWarning`).
 */
@Composable
private fun WarningBannerPanel(hardWarning: Boolean) {
    val tone = if (hardWarning) TeslaTokens.status.danger else TeslaTokens.status.warning
    GlassPanel(
        modifier = Modifier.fillMaxWidth(),
        padding = PanelPadding.Md,
        accent = if (hardWarning) PanelAccent.Danger else PanelAccent.Warning,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(TireGlyphs.AlertTriangle, contentDescription = null, size = IconSize.Md, tint = tone)
            Badge(
                text =
                    stringResource(
                        if (hardWarning) {
                            R.string.tire_pressure_hard_warning_active
                        } else {
                            R.string.tire_pressure_soft_warning_active
                        },
                    ),
                variant = if (hardWarning) BadgeVariant.Danger else BadgeVariant.Warning,
            )
        }
    }
}

// ── Panel 2 + 3 — Current readings (GlassPanel2) with the four corner gauges (GlassPanel3) ───────────────────────

/**
 * GlassPanel2 — the web current-readings `<GlassPanel>`: a "Current Readings" header chip, then the four corner
 * pressure [TireGaugeCell]s (GlassPanel3) laid out two-up. Always rendered (gauges read 0 before a reading lands).
 */
@Composable
private fun CurrentReadingsPanel(
    snapshot: TirePressureSnapshot,
    prefs: TireDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(TireGlyphs.Gauge, contentDescription = null, size = IconSize.Md, tint = paletteColor(ACCENT_CYAN))
            Badge(text = stringResource(R.string.tire_pressure_current_readings), variant = BadgeVariant.Info)
        }
        Spacer(Modifier.size(Spacing.sm))
        GaugeRow {
            TireGaugeCell(TirePosition.FL, snapshot.latest?.pressurePa(TirePosition.FL) ?: 0.0, prefs)
            TireGaugeCell(TirePosition.FR, snapshot.latest?.pressurePa(TirePosition.FR) ?: 0.0, prefs)
        }
        Spacer(Modifier.size(Spacing.md))
        GaugeRow {
            TireGaugeCell(TirePosition.RL, snapshot.latest?.pressurePa(TirePosition.RL) ?: 0.0, prefs)
            TireGaugeCell(TirePosition.RR, snapshot.latest?.pressurePa(TirePosition.RR) ?: 0.0, prefs)
        }
    }
}

/**
 * GlassPanel3 — one web per-corner gauge `<GlassPanel hover>`: a [RadialGauge] swept to the corner's display pressure
 * (colored by the gauge tier) plus a status badge. The chart wrapper is the native Compose-canvas RadialGauge — never
 * a webview.
 */
@Composable
private fun RowScope.TireGaugeCell(
    pos: TirePosition,
    pressurePa: Double,
    prefs: TireDisplayPrefs,
) {
    val status = pressureStatus(pressurePa)
    GlassPanel(modifier = Modifier.weight(1f), padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = prefs.displayValue(pressurePa),
                max = prefs.displayValue(GAUGE_MAX_PA),
                label = cornerLabel(pos),
                unit = prefs.unitLabel,
                color = gaugeTierColor(gaugeTier(pressurePa)),
                size = GAUGE_SIZE,
                decimals = PRESSURE_AXIS_DECIMALS,
            )
            Badge(text = statusLabel(status), variant = statusBadgeVariant(statusTone(status)))
        }
    }
}

// ── Panels 4-7 — Summary metric tiles ───────────────────────────────────────────────────────────────────────────

/**
 * Avg-Pressure / Min-Pressure / Warning-Count / Last-Updated — the web 4-up summary `<MetricCard>` grid (always
 * visible, showing em-dash / 0 before data lands), collapsed to two phone-width rows.
 */
@Composable
private fun SummaryMetricsGrid(
    snapshot: TirePressureSnapshot,
    prefs: TireDisplayPrefs,
) {
    val summary = snapshot.summary
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        GaugeRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.tire_pressure_avg_pressure),
                value = summary?.let { prefs.pressureWithUnit(it.avgPa) } ?: EM_DASH,
                icon = TireGlyphs.Activity,
                accent = paletteColor(ACCENT_CYAN),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.tire_pressure_min_pressure),
                value = summary?.let { prefs.pressureWithUnit(it.minPa) } ?: EM_DASH,
                icon = TireGlyphs.TrendingDown,
                accent = paletteColor(ACCENT_GREEN),
            )
        }
        GaugeRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.tire_pressure_warning_count),
                value = prefs.count(summary?.warningCount ?: 0),
                icon = TireGlyphs.AlertTriangle,
                accent = paletteColor(ACCENT_AMBER),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.tire_pressure_last_updated),
                value = snapshot.lastUpdatedAt?.let { prefs.dateTime(it) } ?: EM_DASH,
                icon = TireGlyphs.Clock,
                accent = paletteColor(ACCENT_PURPLE),
            )
        }
    }
}

// ── Panel 8 — Pressure-history line chart (GlassPanel8) ──────────────────────────────────────────────────────────

/**
 * GlassPanel8 — the web `Pressure History` line `<GlassPanel>`: the four corner pressures over the selected window as
 * a [LineChartWrapper] inside a [ChartContainer], or the loading/empty surface when the history feed is loading / has
 * no rows (web skeleton / `No History Data` empty state).
 */
@Composable
private fun PressureHistoryPanel(
    snapshot: TirePressureSnapshot,
    prefs: TireDisplayPrefs,
) {
    val rows = snapshot.historyAsc
    val status =
        when {
            snapshot.historyLoading -> ChartStatus.Loading
            rows.isEmpty() -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }
    val xLabels = rows.map { prefs.dateTime(it.createdAt) }
    val cornerHeader = TirePosition.entries.map { cornerLabel(it) }
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.tire_pressure_pressure_history),
        accessibleDescription = stringResource(R.string.tire_pressure_pressure_history),
        status = status,
        emptyMessage = stringResource(R.string.tire_pressure_no_history_data),
        dataTableHeader = if (status == ChartStatus.Ready) listOf(stringResource(R.string.translation_Time)) + cornerHeader else null,
        dataTableRows =
            if (status == ChartStatus.Ready) {
                rows.map { row ->
                    listOf(prefs.dateTime(row.createdAt)) + TirePosition.entries.map { prefs.pressureText(row.pressurePa(it)) }
                }
            } else {
                null
            },
    ) {
        LineChartWrapper(
            series =
                TirePosition.entries.map { pos ->
                    ChartSeries(
                        key = pos.name.lowercase(),
                        label = cornerLabel(pos),
                        values = rows.map { prefs.displayValue(it.pressurePa(pos)) },
                        kind = ChartSeriesKind.Line,
                        color = paletteColor(cornerPaletteIndex(pos)),
                        unit = prefs.unitLabel,
                    )
                },
            xLabels = xLabels,
            yValueFormatter = { ChartFormat.number(it, PRESSURE_AXIS_DECIMALS, prefs.locale) },
        )
    }
}

// ── Panel 9 — History table (GlassPanel9) ───────────────────────────────────────────────────────────────────────

/**
 * GlassPanel9 — the web `History Table` `<GlassPanel>`: a header chip, then either the sortable [DataTable] of every
 * reading (time / four corner badges / warnings badge) or the `No History Data` empty state (web skeleton while the
 * history feed loads, empty state when it has no rows).
 */
@Composable
private fun HistoryTablePanel(
    snapshot: TirePressureSnapshot,
    prefs: TireDisplayPrefs,
) {
    var sortState by remember { mutableStateOf(SortState(TireSortKey.TIME, SortDirection.Desc)) }
    val rows =
        remember(snapshot.historyAsc, sortState) {
            sortReadings(snapshot.historyAsc, sortState.key, sortState.direction == SortDirection.Desc)
        }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(TireGlyphs.Clock, contentDescription = null, size = IconSize.Md, tint = paletteColor(ACCENT_PURPLE))
            Badge(text = stringResource(R.string.tire_pressure_history_table), variant = BadgeVariant.Info)
        }
        Spacer(Modifier.size(Spacing.sm))
        if (snapshot.historyAsc.isEmpty() && !snapshot.historyLoading) {
            EmptyState(
                modifier = Modifier.fillMaxWidth(),
                message = stringResource(R.string.tire_pressure_no_history_data),
            )
        } else {
            DataTable(
                columns = historyColumns(prefs),
                rows = rows,
                keyOf = { it.id },
                sortState = sortState,
                onSortChange = { key -> sortState = sortState.toggledBy(key) },
                loading = snapshot.historyLoading,
                emptyText = stringResource(R.string.tire_pressure_no_history_data),
            )
        }
    }
}

/** The six history columns (web `Column<TirePressureReading>[]`): time + four corner badges + a warnings badge. */
@Composable
private fun historyColumns(prefs: TireDisplayPrefs): List<TableColumn<TirePressureReading>> {
    val timeHeader = stringResource(R.string.translation_Time)
    val warningsHeader = stringResource(R.string.translation_Warnings)
    val cornerHeaders = TirePosition.entries.associateWith { pos -> "${cornerLabel(pos)} (${prefs.unitLabel})" }
    return buildList {
        add(
            TableColumn(
                key = TireSortKey.TIME,
                header = timeHeader,
                weight = COL_WEIGHT_TIME,
                sortable = true,
            ) { BodyText(prefs.dateTime(it.createdAt)) },
        )
        TirePosition.entries.forEach { pos ->
            add(
                TableColumn(
                    key = pos.sortKey(),
                    header = cornerHeaders.getValue(pos),
                    weight = COL_WEIGHT_CORNER,
                    sortable = true,
                ) { row ->
                    val pa = row.pressurePa(pos)
                    Badge(text = prefs.pressureText(pa), variant = statusBadgeVariant(statusTone(pressureStatus(pa))))
                },
            )
        }
        add(
            TableColumn(
                key = "warnings",
                header = warningsHeader,
                weight = COL_WEIGHT_WARN,
            ) { row -> WarningCell(row) },
        )
    }
}

/** The per-row warnings badge (web: hard → danger "Hard Warning", soft → warning "Soft Warning", else success "Ok"). */
@Composable
private fun WarningCell(row: TirePressureReading) {
    when {
        hasTpmsWarning(row.tpmsHardWarnings) ->
            Badge(text = stringResource(R.string.tire_pressure_hard_warning), variant = BadgeVariant.Danger, dot = true)
        hasTpmsWarning(row.tpmsSoftWarnings) ->
            Badge(text = stringResource(R.string.tire_pressure_soft_warning), variant = BadgeVariant.Warning, dot = true)
        else -> Badge(text = stringResource(R.string.translation_Ok), variant = BadgeVariant.Success)
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-up row (the phone-width grid cell the web `grid-cols-2` collapses to). */
@Composable
private fun GaugeRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
        content = content,
    )
}

/** The localized corner label (web `TIRE_LABELS`). */
@Composable
private fun cornerLabel(pos: TirePosition): String =
    stringResource(
        when (pos) {
            TirePosition.FL -> R.string.tire_pressure_corner_fl
            TirePosition.FR -> R.string.tire_pressure_corner_fr
            TirePosition.RL -> R.string.tire_pressure_corner_rl
            TirePosition.RR -> R.string.tire_pressure_corner_rr
        },
    )

/** The localized pressure-status label (web `STATUS_LABELS`). */
@Composable
private fun statusLabel(status: PressureStatus): String =
    stringResource(
        when (status) {
            PressureStatus.Normal -> R.string.tire_pressure_status_normal
            PressureStatus.Low -> R.string.tire_pressure_status_low
            PressureStatus.High -> R.string.tire_pressure_status_high
            PressureStatus.Critical -> R.string.tire_pressure_status_critical
        },
    )

/** Maps the gauge color tier to the theme-aware status color the gauge sweeps in (web `pressureColor`). */
@Composable
private fun gaugeTierColor(tier: GaugeTier): Color =
    when (tier) {
        GaugeTier.Normal -> TeslaTokens.status.success
        GaugeTier.Soft -> TeslaTokens.status.warning
        GaugeTier.Critical -> TeslaTokens.status.danger
    }

/** Maps the framework-free [StatusTone] to its badge variant (web `statusVariant`). */
private fun statusBadgeVariant(tone: StatusTone): BadgeVariant =
    when (tone) {
        StatusTone.Success -> BadgeVariant.Success
        StatusTone.Warning -> BadgeVariant.Warning
        StatusTone.Danger -> BadgeVariant.Danger
    }

/** The line-series palette index per corner (web `LINE_COLORS`: fl=0, fr=2, rl=1, rr=3). */
private fun cornerPaletteIndex(pos: TirePosition): Int =
    when (pos) {
        TirePosition.FL -> 0
        TirePosition.FR -> 2
        TirePosition.RL -> 1
        TirePosition.RR -> 3
    }

/** The stable sort-column key for a corner (web `Column.key` = the lower-case position id). */
private fun TirePosition.sortKey(): String =
    when (this) {
        TirePosition.FL -> TireSortKey.FL
        TirePosition.FR -> TireSortKey.FR
        TirePosition.RL -> TireSortKey.RL
        TirePosition.RR -> TireSortKey.RR
    }
