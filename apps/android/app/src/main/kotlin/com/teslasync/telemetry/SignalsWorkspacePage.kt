// The native Jetpack Compose + Material 3 SignalsWorkspacePage telemetry surface — a parity port of
// web/src/features/telemetry/pages/SignalsWorkspacePage.tsx, the unified /signals workspace. The web page is a
// thin orchestrator that composes the seven shared telemetry surfaces around two mutually-exclusive Live /
// Compare mode toggles (leaving a Historical default): the catalog tree (Add-signals disclosure), the headline
// StatCards, the workspace toolbar, the compare controls + server-diff table + bulk pin/unpin, and the
// historical chart / stats / history table. This native host reproduces that whole tree — it sets the page
// header (title + subtitle + VehicleSelect + live-connection badge + share), lifts the selection + mode out of
// the shared children so the StatCards and Run/Live gating read from one source of truth (a
// SignalsWorkspacePageViewModel bound to the shared P1/S8 holders), and embeds the shared A3 feature views for
// every panel (SignalCompareControls, SignalDiffTable, LiveSignalTail, SignalStatsPanel, SignalChartPanel,
// SignalHistoryTable) rather than re-implementing them (DRY, ADR-006). Every visible string resolves from the
// generated res/values catalog (ADR-014); the page records the one-shot PII-safe view.opened diagnostic for the
// /signals route (P1/S11). Values stay raw SI — the embedded surfaces format at their own boundary (Phase-48).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.signalsworkspace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.BulkAction
import io.teslasync.android.components.datadisplay.BulkActionToolbar
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.ui.Accordion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpTooltip
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.signalchartpanel.SignalChartMode
import io.teslasync.android.featureviews.signalchartpanel.SignalChartPanel
import io.teslasync.android.featureviews.signalcomparecontrols.SignalCompareControls
import io.teslasync.android.featureviews.signalcomparecontrols.SignalCompareTime
import io.teslasync.android.featureviews.signaldifftable.SignalDiffTable
import io.teslasync.android.featureviews.signaldifftable.asSignalDiffTableSource
import io.teslasync.android.featureviews.signalhistorytable.SignalHistoryTable
import io.teslasync.android.featureviews.signalstatspanel.SignalStatsPanel
import io.teslasync.android.featureviews.livesignaltail.LiveSignalTail
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.sharedsurfaces.signalquerycontrols.TIME_RANGE_PRESETS
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalDiffRow
import java.time.ZoneId

private const val EM_DASH: String = "\u2014"

// ── Stateful entry point ────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SignalsWorkspacePageViewModel] over the shared P1/S8 holders (selection,
 * pins, fleet) and the page-local Telemetry data port, records the one-shot `view.opened` diagnostic (P1/S11),
 * collects the four manifest feeds + the live-connection snapshot, and renders the workspace. The host supplies
 * the [telemetryRepository] (an adapter over the shared resilient client + offline cache); [logger] defaults to
 * the app's redacting logger.
 */
@Composable
fun SignalsWorkspacePage(
    telemetryRepository: TelemetryRepository,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val container = LocalDataContainer.current
    val viewModel: SignalsWorkspacePageViewModel =
        viewModel(
            key = SignalsWorkspacePageRegistration.SLUG,
            factory =
                SignalsWorkspacePageViewModel.Factory.create(
                    telemetryRepository = telemetryRepository,
                    pinnedStore = container.pinnedStore,
                    selectedVehicleStore = container.selectedVehicleStore,
                    vehiclesStore = container.vehiclesStore,
                    logger = logger,
                ),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val vehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()
    val signalsState by viewModel.signals.collectAsStateWithLifecycle()
    val pinnedState by viewModel.pinned.collectAsStateWithLifecycle()
    val liveState by container.liveSessionStore.state.collectAsStateWithLifecycle()

    val diffSource = remember(telemetryRepository) { telemetryRepository.asSignalDiffTableSource() }
    val connected = liveState.status == LiveConnectionStatus.Connected
    val liveSignalCount = liveState.vehicle(vehicleId).signalCount

    SignalsWorkspacePageContent(
        viewModel = viewModel,
        vehicleId = vehicleId ?: 0L,
        signalsState = signalsState,
        pinnedState = pinnedState,
        connected = connected,
        liveSignalCount = liveSignalCount,
        diffSource = diffSource,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The workspace body — the preview/UI-test entry point. Owns the ephemeral view state the web page keeps in URL
 * params (the lifted selection, the Live/Compare/Historical mode, the time range, per-page, the compare window +
 * filter, the chart layout, and the diff bulk selection), and renders the header, the four headline StatCards,
 * the Add-signals catalog, the workspace toolbar, and the active mode's section. Scrolls vertically so every
 * panel is reachable on a phone.
 */
@Composable
fun SignalsWorkspacePageContent(
    viewModel: SignalsWorkspacePageViewModel,
    vehicleId: Long,
    signalsState: UiState<List<String>>,
    pinnedState: UiState<List<PinnedItem>>,
    connected: Boolean,
    liveSignalCount: Int,
    diffSource: io.teslasync.android.featureviews.signaldifftable.SignalDiffTableSource,
    modifier: Modifier = Modifier,
) {
    val zone = remember { ZoneId.systemDefault() }
    val availableSignals = signalsState.data ?: emptyList()
    val pinnedItems = pinnedState.data ?: emptyList()
    val pinnedSignals = remember(pinnedItems) { pinnedSignalNames(pinnedItems) }
    val signalsCsv = remember(availableSignals) { availableSignals.joinToString(",") }

    var selected by remember { mutableStateOf<List<String>>(emptyList()) }
    var mode by remember { mutableStateOf(WorkspaceMode.Historical) }
    var perPage by remember { mutableIntStateOf(SignalsWorkspacePageRegistration.DEFAULT_PER_PAGE) }
    var rangeHours by remember { mutableIntStateOf(DEFAULT_RANGE_HOURS) }
    var page by remember { mutableIntStateOf(1) }
    var runKey by remember { mutableStateOf<Long?>(null) }
    var atA by remember { mutableStateOf(SignalCompareTime.toLocalDatetimeInput(System.currentTimeMillis() - ONE_HOUR_MS, zone)) }
    var atB by remember { mutableStateOf(SignalCompareTime.toLocalDatetimeInput(System.currentTimeMillis(), zone)) }
    var diffSearch by remember { mutableStateOf("") }
    var diffCategory by remember { mutableStateOf<String?>(null) }
    var chartMode by remember { mutableStateOf(SignalChartMode.Auto) }
    var bulkSelection by remember { mutableStateOf<Set<String>>(emptySet()) }

    val isLive = mode.isLive
    val isCompare = mode.isCompare
    val hasRun = runKey != null
    val canExplore = selected.isNotEmpty() && vehicleId > 0L

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        WorkspaceHeader(isLive = isLive, connected = connected)

        if (signalsState.hasError) {
            AlertBanner(
                message = stringResource(R.string.translation_error_loadFailed),
                tone = Tone.Danger,
            )
        }

        if (vehicleId == 0L) {
            EmptyState(
                message = stringResource(R.string.translation_signalsWorkspace_noVehicleDesc),
                icon = NavGlyphs.Pulse,
                title = stringResource(R.string.translation_signalsWorkspace_noVehicle),
            )
        }

        HeadlineStatStrip(
            selectedCount = selected.size,
            mode = mode,
            isLive = isLive,
            liveSignalCount = liveSignalCount,
            pinnedCount = pinnedSignals.size,
        )

        AddSignalsAccordion(
            availableSignals = availableSignals,
            selected = selected,
            onToggle = { name ->
                selected = if (name in selected) selected - name else selected + name
            },
        )

        WorkspaceToolbar(
            isLive = isLive,
            isCompare = isCompare,
            perPage = perPage,
            onPerPageChange = { perPage = it; page = 1 },
            rangeHours = rangeHours,
            onRangeHoursChange = { rangeHours = it },
            canExplore = canExplore,
            running = hasRun && (signalsState.refreshing),
            onRun = { if (canExplore) { page = 1; runKey = System.currentTimeMillis() } },
            onToggleLive = { mode = if (mode.isLive) WorkspaceMode.Historical else WorkspaceMode.Live },
            onToggleCompare = { mode = if (mode.isCompare) WorkspaceMode.Historical else WorkspaceMode.Compare },
            liveEnabled = selected.isNotEmpty() || isLive,
        )

        if (isCompare) {
            CompareSection(
                viewModel = viewModel,
                vehicleId = vehicleId,
                atA = atA,
                atB = atB,
                onChangeA = { atA = it },
                onChangeB = { atB = it },
                search = diffSearch,
                onSearchChange = { diffSearch = it },
                category = diffCategory,
                onCategoryChange = { diffCategory = it },
                signalsCsv = signalsCsv,
                pinnedSignals = pinnedSignals,
                bulkSelection = bulkSelection,
                onBulkSelectionChange = { bulkSelection = it },
                diffSource = diffSource,
                zone = zone,
            )
        } else {
            HistoricalLiveSection(
                viewModel = viewModel,
                vehicleId = vehicleId,
                selectedSignals = selected,
                rangeHours = rangeHours,
                runKey = runKey,
                isLive = isLive,
                page = page,
                perPage = perPage,
                onPageChange = { page = it },
                chartMode = chartMode,
                onChartModeChange = { chartMode = it },
            )
        }

        WorkspaceFooter()
    }
}

// ── Header ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The page header — the web `PageContainer` props for /signals: the title + descriptive subtitle, the global
 * `VehicleSelect` action, the live-connection badge (only while Live is active, web), and the share affordance.
 */
@Composable
private fun WorkspaceHeader(
    isLive: Boolean,
    connected: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_signalsWorkspace_title))
            BodyText(
                text = stringResource(R.string.translation_signalsWorkspace_subtitle),
                color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            VehicleSelect(modifier = Modifier.weight(1f))
            if (isLive) {
                Badge(
                    text =
                        if (connected) {
                            stringResource(R.string.translation_liveMonitor_connected)
                        } else {
                            stringResource(R.string.translation_liveMonitor_disconnected)
                        },
                    variant = if (connected) BadgeVariant.Success else BadgeVariant.Danger,
                    dot = true,
                )
            }
            CopyButton(
                text = SignalsWorkspacePageRegistration.WEB_PATH,
                copyLabel = stringResource(R.string.translation_signalsWorkspace_share),
                copiedLabel = stringResource(R.string.translation_signalsWorkspace_share),
                size = ButtonSize.Sm,
            )
        }
    }
}

// ── Headline StatCards ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The four headline StatCards (web headline strip): the lifted selection count, the active mode, the live rate,
 * and the pinned-signal count. The live-rate card shows the live signal count while streaming and the em-dash
 * otherwise (web `isLive ? rate : '—'`); the authoritative per-second rate is shown by the embedded live tail.
 */
@Composable
private fun HeadlineStatStrip(
    selectedCount: Int,
    mode: WorkspaceMode,
    isLive: Boolean,
    liveSignalCount: Int,
    pinnedCount: Int,
) {
    val modeLabel =
        when (mode) {
            WorkspaceMode.Compare -> stringResource(R.string.translation_signalsWorkspace_compare)
            WorkspaceMode.Live -> stringResource(R.string.translation_signalsWorkspace_live)
            WorkspaceMode.Historical -> stringResource(R.string.translation_signalsWorkspace_historical)
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                label = stringResource(R.string.translation_signalsWorkspace_selected),
                value = selectedCount.toString(),
                icon = NavGlyphs.Sliders,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_signalsWorkspace_mode),
                value = modeLabel,
                icon = NavGlyphs.Workflow,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
            StatCard(
                label = stringResource(R.string.translation_signalsWorkspace_liveRate),
                value = if (isLive) liveSignalCount.toString() else EM_DASH,
                icon = DataDisplayGlyphs.Wifi,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_signalsWorkspace_pinned),
                value = pinnedCount.toString(),
                icon = TeslaGlyphs.Pin,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// ── Add-signals catalog ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The collapsible "Add signals" disclosure (web Accordion + SignalCategoryTree): a searchable checkbox catalog
 * of the vehicle's available signals, lifting the selection into the page so every dependent panel reads one
 * source of truth. The header badge mirrors the web "{{count}} selected" / "None selected" summary.
 */
@Composable
private fun AddSignalsAccordion(
    availableSignals: List<String>,
    selected: List<String>,
    onToggle: (String) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    val filtered =
        remember(availableSignals, search) {
            if (search.isBlank()) availableSignals else availableSignals.filter { it.contains(search.trim(), ignoreCase = true) }
        }
    Accordion(
        title = stringResource(R.string.translation_signalsWorkspace_addSignals),
        leading = { Icon(imageVector = NavGlyphs.Chart, contentDescription = null) },
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Badge(
                text =
                    if (selected.isNotEmpty()) {
                        stringResource(R.string.translation_signalsWorkspace_signalsSelected, selected.size)
                    } else {
                        stringResource(R.string.translation_signalsWorkspace_noneSelected)
                    },
                variant = if (selected.isNotEmpty()) BadgeVariant.Info else BadgeVariant.Neutral,
            )
            SearchInput(value = search, onValueChange = { search = it }, modifier = Modifier.fillMaxWidth())
            filtered.forEach { name ->
                Checkbox(
                    checked = name in selected,
                    onCheckedChange = { onToggle(name) },
                    label = name,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

// ── Workspace toolbar (GlassPanel) ──────────────────────────────────────────────────────────────────────────

/**
 * The workspace toolbar (web GlassPanel): the time range + per-page selects (historical only), the Run trigger,
 * the mutually-exclusive Live / Compare toggles, and the live/compare help tooltip.
 */
@Composable
private fun WorkspaceToolbar(
    isLive: Boolean,
    isCompare: Boolean,
    perPage: Int,
    onPerPageChange: (Int) -> Unit,
    rangeHours: Int,
    onRangeHoursChange: (Int) -> Unit,
    canExplore: Boolean,
    running: Boolean,
    onRun: () -> Unit,
    onToggleLive: () -> Unit,
    onToggleCompare: () -> Unit,
    liveEnabled: Boolean,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md), modifier = Modifier.fillMaxWidth()) {
            if (!isCompare) {
                Select(
                    options = remember { TIME_RANGE_PRESETS.map { SelectOption(value = it.hours.toString(), label = it.label) } },
                    selectedValue = rangeHours.toString(),
                    onSelect = { onRangeHoursChange(it.toIntOrNull() ?: DEFAULT_RANGE_HOURS) },
                    label = stringResource(R.string.translation_fsm_timeRange),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (!isLive && !isCompare) {
                Select(
                    options = remember { PER_PAGE_VALUES.map { SelectOption(value = it.toString(), label = it.toString()) } },
                    selectedValue = perPage.toString(),
                    onSelect = { onPerPageChange(it.toIntOrNull() ?: SignalsWorkspacePageRegistration.DEFAULT_PER_PAGE) },
                    label = stringResource(R.string.translation_fsm_perPage),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (!isLive && !isCompare) {
                    Button(
                        label = stringResource(R.string.translation_signalsWorkspace_run),
                        onClick = onRun,
                        variant = ButtonVariant.Primary,
                        enabled = canExplore,
                        loading = running,
                        leadingIcon = NavGlyphs.Server,
                    )
                }
                Button(
                    label =
                        if (isLive) {
                            stringResource(R.string.translation_signalsWorkspace_stopLive)
                        } else {
                            stringResource(R.string.translation_signalsWorkspace_live)
                        },
                    onClick = onToggleLive,
                    variant = if (isLive) ButtonVariant.Danger else ButtonVariant.Outline,
                    enabled = liveEnabled,
                    leadingIcon = DataDisplayGlyphs.Wifi,
                )
                Button(
                    label =
                        if (isCompare) {
                            stringResource(R.string.translation_signalsWorkspace_exitCompare)
                        } else {
                            stringResource(R.string.translation_signalsWorkspace_compare)
                        },
                    onClick = onToggleCompare,
                    variant = if (isCompare) ButtonVariant.Primary else ButtonVariant.Outline,
                )
                HelpTooltip(
                    title = stringResource(R.string.translation_signalsWorkspace_mode),
                    helpText = stringResource(R.string.translation_help_signal_live),
                    helpContentDescription = stringResource(R.string.translation_help_signal_live_aria),
                )
            }
        }
    }
}

// ── Compare mode ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The Compare-mode body (web compare branch): the snapshot-window controls, the four compare StatCards (changed
 * / visible-after-filter / pinned / window-span), the bulk pin-unpin-csv-alert toolbar, and the server-diff
 * table with its pinned-signal chips. The page binds the same `useSignalDiffServer` feed the embedded table
 * folds into so the StatCards' counts and the table stay consistent.
 */
@Composable
private fun CompareSection(
    viewModel: SignalsWorkspacePageViewModel,
    vehicleId: Long,
    atA: String,
    atB: String,
    onChangeA: (String) -> Unit,
    onChangeB: (String) -> Unit,
    search: String,
    onSearchChange: (String) -> Unit,
    category: String?,
    onCategoryChange: (String?) -> Unit,
    signalsCsv: String,
    pinnedSignals: Set<String>,
    bulkSelection: Set<String>,
    onBulkSelectionChange: (Set<String>) -> Unit,
    diffSource: io.teslasync.android.featureviews.signaldifftable.SignalDiffTableSource,
    zone: ZoneId,
) {
    val clipboard = LocalClipboardManager.current
    val atAIso = remember(atA, zone) { SignalCompareTime.isoOrEmpty(atA, zone) }
    val atBIso = remember(atB, zone) { SignalCompareTime.isoOrEmpty(atB, zone) }
    val diffEnabled = vehicleId > 0L && atAIso.isNotEmpty() && atBIso.isNotEmpty()

    val diffFlow =
        remember(vehicleId, atAIso, atBIso, signalsCsv, diffEnabled) {
            if (diffEnabled) {
                viewModel.diffState(vehicleId, atAIso, atBIso, signalsCsv)
            } else {
                kotlinx.coroutines.flow.MutableStateFlow(UiState<io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse>(io.teslasync.android.data.UiPhase.Empty))
            }
        }
    val diffState by diffFlow.collectAsStateWithLifecycle()
    val allRows: List<SignalDiffRow> = diffState.data?.data ?: emptyList()
    val filteredRows = remember(allRows, search, category) { filterDiffRows(allRows, search, category) }
    val filterActive = diffFilterActive(search, category)
    val diffLoading = diffState.isLoading

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg), modifier = Modifier.fillMaxWidth()) {
        SignalCompareControls(
            atA = atA,
            atB = atB,
            onChangeA = onChangeA,
            onChangeB = onChangeB,
            search = search,
            onSearchChange = onSearchChange,
            category = category,
            onCategoryChange = onCategoryChange,
        )

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
                StatCard(
                    label = stringResource(R.string.translation_signalDiff_totalChanged),
                    value = if (diffLoading) EM_DASH else allRows.size.toString(),
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    label = stringResource(R.string.translation_signalDiff_visible),
                    value = if (diffLoading) EM_DASH else filteredRows.size.toString(),
                    modifier = Modifier.weight(1f),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), modifier = Modifier.fillMaxWidth()) {
                StatCard(
                    label = stringResource(R.string.translation_signalDiff_pinnedCount),
                    value = pinnedSignals.size.toString(),
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    label = stringResource(R.string.translation_signalDiff_windowSpan),
                    value = windowSpanSeconds(atAIso, atBIso)?.let { "$it s" } ?: EM_DASH,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        BulkActionToolbar(
            selectedCount = bulkSelection.size,
            onClear = { onBulkSelectionChange(emptySet()) },
            total = filteredRows.size,
            actions =
                listOf(
                    BulkAction(
                        id = "pin",
                        label = stringResource(R.string.translation_signalDiff_bulk_pin),
                        onClick = {
                            bulkSelection.filterNot { it in pinnedSignals }.forEach { viewModel.togglePin(vehicleId, it, true) }
                        },
                    ),
                    BulkAction(
                        id = "unpin",
                        label = stringResource(R.string.translation_signalDiff_bulk_unpin),
                        onClick = {
                            bulkSelection.filter { it in pinnedSignals }.forEach { viewModel.togglePin(vehicleId, it, false) }
                        },
                    ),
                    BulkAction(
                        id = "csv",
                        label = stringResource(R.string.translation_signalDiff_bulk_csv),
                        onClick = {
                            val rows = filteredRows.filter { it.name in bulkSelection }
                            clipboard.setText(AnnotatedString(diffRowsToCsv(rows)))
                        },
                    ),
                    BulkAction(
                        id = "alert",
                        label = stringResource(R.string.translation_signalDiff_bulk_addAlert),
                        onClick = {
                            clipboard.setText(AnnotatedString(bulkSelection.joinToString(",")))
                        },
                    ),
                ),
        )

        GlassPanel(padding = PanelPadding.Md) {
            if (allRows.isEmpty() && !filterActive && diffEnabled && !diffLoading) {
                EmptyState(
                    message = stringResource(R.string.translation_signalDiff_noChanges),
                    icon = DataDisplayGlyphs.History,
                )
            } else {
                SignalDiffTable(
                    source = diffSource,
                    vehicleId = vehicleId,
                    atA = atAIso,
                    atB = atBIso,
                    signalsCsv = signalsCsv,
                )
            }
            if (pinnedSignals.isNotEmpty()) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Caption(stringResource(R.string.translation_signalDiff_pinnedLabel))
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                        pinnedSignals.sorted().take(MAX_PINNED_CHIPS).forEach { Badge(text = it, variant = BadgeVariant.Neutral) }
                    }
                }
            }
        }
    }
}

// ── Live / Historical mode ──────────────────────────────────────────────────────────────────────────────────

/**
 * The Live / Historical body (web non-compare branch). Live shows the connection-titled, self-contained live
 * tail; a run-and-historical view shows the per-signal stats, the chart-layout switch, the multi-line chart,
 * and the paginated history table over the real fetched series; the resting default shows the friendly
 * "pick signals and run" empty panel. Never a blank region.
 */
@Composable
private fun HistoricalLiveSection(
    viewModel: SignalsWorkspacePageViewModel,
    vehicleId: Long,
    selectedSignals: List<String>,
    rangeHours: Int,
    runKey: Long?,
    isLive: Boolean,
    page: Int,
    perPage: Int,
    onPageChange: (Int) -> Unit,
    chartMode: SignalChartMode,
    onChartModeChange: (SignalChartMode) -> Unit,
) {
    val historyFlow =
        remember(vehicleId, selectedSignals, rangeHours, runKey) {
            if (runKey != null) {
                viewModel.historyState(vehicleId, selectedSignals, rangeHours)
            } else {
                kotlinx.coroutines.flow.MutableStateFlow(UiState<List<io.teslasync.android.sharedsurfaces.signalquerycontrols.SignalLogEntry>>(io.teslasync.android.data.UiPhase.Empty))
            }
        }
    val historyState by historyFlow.collectAsStateWithLifecycle()
    val rows = historyState.data ?: emptyList()
    val chartRows = remember(rows) { toChartRows(rows) }
    val stats = remember(rows) { toStats(rows) }
    val hasRun = runKey != null
    val loading = historyState.isLoading

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg), modifier = Modifier.fillMaxWidth()) {
        if ((hasRun || isLive) && selectedSignals.isNotEmpty()) {
            SignalStatsPanel(stats = stats.toStatsPanelStats(), selectedSignals = selectedSignals, loading = loading && !isLive)
        }

        if (hasRun || isLive) {
            if (selectedSignals.size >= MIN_CHART_LAYOUT_SIGNALS) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Caption(stringResource(R.string.translation_signalsWorkspace_chartMode))
                    TabNav(
                        items =
                            listOf(
                                TabNavItem(key = "auto", label = stringResource(R.string.translation_signalsWorkspace_chartAuto)),
                                TabNavItem(key = "overlay", label = stringResource(R.string.translation_signalsWorkspace_chartOverlay)),
                                TabNavItem(key = "grid", label = stringResource(R.string.translation_signalsWorkspace_chartGrid)),
                            ),
                        selectedKey = chartMode.name.lowercase(),
                        onSelect = { onChartModeChange(chartModeOf(it)) },
                    )
                }
            }
            SignalChartPanel(
                selectedSignals = selectedSignals,
                data = chartRows,
                stats = stats,
                isLive = isLive,
                loading = loading && !isLive,
                pointsLoaded = rows.size,
                chartMode = chartMode,
            )
        }

        if (isLive) {
            SectionTitle(stringResource(R.string.translation_liveMonitor_title))
            LiveSignalTail(bufferMax = SignalsWorkspacePageRegistration.LIVE_TAIL_MAX)
        } else if (hasRun) {
            SignalHistoryTable(
                rows = paginateRows(rows, page, perPage).toHistoryTableRows(),
                selectedSignals = selectedSignals,
                page = page,
                pageSize = perPage,
                totalRows = rows.size,
                onPageChange = onPageChange,
                loading = loading,
                title = stringResource(R.string.translation_signalsWorkspace_historyTitle),
            )
        } else {
            GlassPanel(padding = PanelPadding.Md) {
                EmptyState(
                    message = stringResource(R.string.translation_signalsWorkspace_emptyDesc),
                    icon = NavGlyphs.Server,
                    title = stringResource(R.string.translation_signalsWorkspace_emptyTitle),
                )
            }
        }
    }
}

// ── Footer ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The catalog-refresh helper footer (web `signalGap.refreshInterval` tip). */
@Composable
private fun WorkspaceFooter() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = DataDisplayGlyphs.History, contentDescription = null)
        Caption(stringResource(R.string.translation_signalGap_refreshInterval))
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

private fun chartModeOf(key: String): SignalChartMode =
    when (key) {
        "overlay" -> SignalChartMode.Overlay
        "grid" -> SignalChartMode.Grid
        else -> SignalChartMode.Auto
    }

private fun diffRowsToCsv(rows: List<SignalDiffRow>): String {
    val header = "signal,window_a,window_b,source_a,source_b"
    val body =
        rows.joinToString("\n") { row ->
            listOf(
                row.name,
                row.valueA?.toString() ?: "",
                row.valueB?.toString() ?: "",
                row.sourceA ?: "",
                row.sourceB ?: "",
            ).joinToString(",")
        }
    return if (body.isEmpty()) header else "$header\n$body"
}

private fun List<io.teslasync.android.featureviews.signalchartpanel.SignalStat>.toStatsPanelStats(): List<io.teslasync.android.featureviews.signalstatspanel.SignalStat> =
    map {
        io.teslasync.android.featureviews.signalstatspanel.SignalStat(
            signal = it.signal,
            min = it.min,
            max = it.max,
            avg = it.avg,
            count = it.count,
        )
    }

private fun List<io.teslasync.android.sharedsurfaces.signalquerycontrols.SignalLogEntry>.toHistoryTableRows():
    List<io.teslasync.android.featureviews.signalhistorytable.SignalLogEntry> =
    map {
        io.teslasync.android.featureviews.signalhistorytable.SignalLogEntry(
            createdAt = it.createdAt,
            signal = it.signal,
            valueNum = it.valueNum,
            valueStr = it.valueStr,
            valueBool = it.valueBool,
        )
    }

private const val ONE_HOUR_MS: Long = 3_600_000L
private const val DEFAULT_RANGE_HOURS: Int = 24
private const val MIN_CHART_LAYOUT_SIGNALS: Int = 2
private const val MAX_PINNED_CHIPS: Int = 24
private val PER_PAGE_VALUES: List<Int> = listOf(25, 50, 100, 500)

private typealias PinnedItem = io.teslasync.shared.core.presentation.pinned.PinnedItem
