// The native Jetpack Compose + Material 3 StateMachineDebuggerPage system surface — a parity port of
// web/src/features/system/pages/StateMachineDebuggerPage.tsx, the multi-FSM transition debugger mounted at
// /state-debugger. It reproduces the web page's header (title + subtitle + the vehicle switcher, the "Live 10s"
// auto-refresh indicator, and the share-permalink action), the FSM-type/per-page filter panel, the live-state hero,
// the live state-timeline + signal-snapshot inspector, the state-distribution donut, the transition-counts table, the
// four summary cards (Transitions / Total / Flap Warnings / Current State), the paged transition log, and the selected
// transition detail — every visible string resolved from the generated res/values catalog (ADR-014); FSM payloads are
// non-unit-bearing so there is no SI conversion to do at the boundary.
//
// Composition: [StateMachineDebuggerPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the resolved snapshot + the inspector feed + the filter and
// selection state, and wires the share-to-clipboard action); [StateMachineDebuggerContent] is the stateless render
// layer that switches the loading / empty / error / content surfaces off the bound [UiState] and lays out every panel.
//
// State matrix (web parity): loading (cold) → page skeleton; error (hard, no cache) → error banner + retry; empty (no
// enrolled vehicle, web `!vehicleOptions.length`) → the filter panel's no-vehicles empty + each panel's own empty; and
// content → every panel from the resolved [DebuggerData], with the transition feed's own in-flight flag driving the
// per-panel skeletons (the live-state hero renders while the table still loads, exactly as the web page does).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.statemachinedebugger

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.PageSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.diagnostics.Logger

private val DonutHeight = 220.dp
private val DotSize = 10.dp
private val TimelineChipMinWidth = 96.dp

// ── Stateful entry points ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [StateMachineDebuggerPageViewModel] over the supplied [source] (the host wires the
 * shared Vehicles + FSM holders via [stateMachineDebuggerPageSourceOf]). [logger] defaults to the app's redacting
 * logger.
 */
@Composable
fun StateMachineDebuggerPage(
    source: StateMachineDebuggerPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: StateMachineDebuggerPageViewModel =
        viewModel(
            key = StateMachineDebuggerRegistration.SLUG,
            factory = StateMachineDebuggerPageViewModel.factory(source, logger),
        )
    StateMachineDebuggerPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved page snapshot, the
 * inspector feed, and the filter/selection state, wires the share-to-clipboard action, and hands the stateless content
 * the accessibility pane title (web `usePageTitle(t('fsm.title'))`).
 */
@Composable
fun StateMachineDebuggerPage(
    viewModel: StateMachineDebuggerPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snapshotState by viewModel.snapshotState.collectAsStateWithLifecycle()
    val filters by viewModel.filterState.collectAsStateWithLifecycle()
    val selection by viewModel.selectionState.collectAsStateWithLifecycle()

    val clipboard = LocalClipboardManager.current
    val onShare: (Long?) -> Unit =
        remember(clipboard) {
            { id ->
                val suffix = id?.let { "?vehicle_id=$it" } ?: ""
                clipboard.setText(AnnotatedString(StateMachineDebuggerRegistration.SHARE_DEEP_LINK_PREFIX + suffix))
            }
        }

    val title = stringRes(R.string.translation_fsm_title)

    StateMachineDebuggerContent(
        uiState = uiState,
        snapshotState = snapshotState,
        filters = filters,
        selectedId = selection?.id,
        onSelectVehicle = viewModel::selectVehicle,
        onFsmType = viewModel::setFsmType,
        onPageChange = viewModel::setPage,
        onPerPageChange = viewModel::setPerPage,
        onToggleTransition = viewModel::toggleTransition,
        onShare = onShare,
        onRetry = viewModel::refresh,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the header, then either the cold-loading
 * skeleton, the hard-error banner, or the full panel set — every panel drawing its own loading/empty surface off the
 * resolved [DebuggerData].
 */
@Composable
fun StateMachineDebuggerContent(
    uiState: UiState<DebuggerData>,
    snapshotState: UiState<SnapshotData>,
    filters: DebuggerFilters,
    selectedId: Long?,
    onSelectVehicle: (Long) -> Unit,
    onFsmType: (FsmType) -> Unit,
    onPageChange: (Int) -> Unit,
    onPerPageChange: (Int) -> Unit,
    onToggleTransition: (Long, String) -> Unit,
    onShare: (Long?) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val data = uiState.data

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DebuggerHeader(
            vehicles = data?.vehicles.orEmpty(),
            selectedVehicleId = data?.selectedId,
            onSelectVehicle = onSelectVehicle,
            onShare = onShare,
        )

        when {
            data == null && uiState.isError -> DebuggerErrorState(onRetry = onRetry)
            data == null -> DebuggerLoadingState()
            else ->
                DebuggerBody(
                    data = data,
                    snapshotState = snapshotState,
                    filters = filters,
                    selectedId = selectedId,
                    onFsmType = onFsmType,
                    onPageChange = onPageChange,
                    onPerPageChange = onPerPageChange,
                    onToggleTransition = onToggleTransition,
                )
        }
    }
}

/** Cold-loading surface (web `PageContainer loading`). */
@Composable
private fun DebuggerLoadingState() {
    FadeIn { PageSkeleton(statCount = 4) }
}

/** Hard-error surface with a retry affordance (web `ErrorDisplay` — never a blank region). */
@Composable
private fun DebuggerErrorState(onRetry: () -> Unit) {
    GlassPanel(accent = io.teslasync.android.components.ui.PanelAccent.Danger) {
        EmptyState(
            message = stringRes(R.string.translation_fsm_noState),
            icon = FsmGlyphs.AlertTriangle,
            action =
                io.teslasync.android.components.feedback.EmptyStateAction(
                    label = stringRes(R.string.translation_common_retry),
                    onClick = onRetry,
                ),
        )
    }
}

/** The header — title + subtitle and the actions row (vehicle switcher, the "Live 10s" indicator, share-permalink). */
@Composable
private fun DebuggerHeader(
    vehicles: List<VehicleOption>,
    selectedVehicleId: Long?,
    onSelectVehicle: (Long) -> Unit,
    onShare: (Long?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringRes(R.string.translation_fsm_title))
        BodyText(
            stringRes(R.string.translation_fsm_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (vehicles.isNotEmpty()) {
                Select(
                    options = vehicles.map { SelectOption(value = it.id.toString(), label = it.label) },
                    selectedValue = selectedVehicleId?.toString(),
                    onSelect = { value -> value.toLongOrNull()?.let(onSelectVehicle) },
                    label = stringRes(R.string.translation_fsm_selectVehicle),
                    modifier = Modifier.weight(1f),
                )
            } else {
                Box(modifier = Modifier.weight(1f))
            }
            AutoRefreshIndicator()
            IconButton(
                imageVector = FsmGlyphs.Share,
                contentDescription = stringRes(R.string.translation_debugger_share),
                onClick = { onShare(selectedVehicleId) },
                variant = IconButtonVariant.Tonal,
                size = IconSize.Sm,
            )
        }
    }
}

/** The "Live 10s" auto-refresh indicator (web header `RefreshCw` + `fsm.autoRefresh`). */
@Composable
private fun AutoRefreshIndicator() {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            FsmGlyphs.Refresh,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Caption(stringRes(R.string.translation_fsm_autoRefresh))
    }
}

/** The full panel set, every panel always shown (web mounts all sections; each draws its own loading/empty surface). */
@Composable
private fun DebuggerBody(
    data: DebuggerData,
    snapshotState: UiState<SnapshotData>,
    filters: DebuggerFilters,
    selectedId: Long?,
    onFsmType: (FsmType) -> Unit,
    onPageChange: (Int) -> Unit,
    onPerPageChange: (Int) -> Unit,
    onToggleTransition: (Long, String) -> Unit,
) {
    val emptyRangeMessage =
        stringRes(R.string.translation_fsm_noTransitionsInRange, stringRes(R.string.translation_fsm_allTime))

    FadeIn { FiltersPanel(data = data, filters = filters, onFsmType = onFsmType, onPerPageChange = onPerPageChange) }
    FadeIn { CurrentStatePanel(data = data) }
    FadeIn {
        TimelinePanel(
            data = data,
            snapshotState = snapshotState,
            selectedId = selectedId,
            emptyMessage = emptyRangeMessage,
            onToggleTransition = onToggleTransition,
        )
    }
    FadeIn { DistributionPanel(data = data, emptyMessage = emptyRangeMessage) }
    FadeIn { TransitionCountsPanel(data = data, emptyMessage = emptyRangeMessage) }
    FadeIn { SummaryCards(data = data) }
    FadeIn {
        TransitionLogPanel(
            data = data,
            selectedId = selectedId,
            emptyMessage = emptyRangeMessage,
            onPageChange = onPageChange,
            onPerPageChange = onPerPageChange,
            onToggleTransition = onToggleTransition,
        )
    }
    data.transitionById(selectedId)?.let { transition ->
        FadeIn { TransitionDetailPanel(transition = transition) }
    }
}

// ── Panel 1 (GlassPanel1) — FSM-type + per-page filters ───────────────────────────────────────────────────────────

@Composable
private fun FiltersPanel(
    data: DebuggerData,
    filters: DebuggerFilters,
    onFsmType: (FsmType) -> Unit,
    onPerPageChange: (Int) -> Unit,
) {
    GlassPanel {
        if (!data.hasVehicles) {
            EmptyState(message = stringRes(R.string.translation_fsm_noVehicles), icon = FsmGlyphs.Activity)
            return@GlassPanel
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FieldLabelText(stringRes(R.string.translation_fsm_fsmType))
            Icon(
                FsmGlyphs.Info,
                contentDescription = stringRes(R.string.translation_help_fsm_type_aria),
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Select(
            options = fsmTypeOptions(),
            selectedValue = filters.fsmType.name,
            onSelect = { value -> onFsmType(fsmTypeFromName(value)) },
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        )
        Select(
            options = PER_PAGE_OPTIONS.map { SelectOption(value = it.toString(), label = it.toString()) },
            selectedValue = filters.perPage.toString(),
            onSelect = { value -> value.toIntOrNull()?.let(onPerPageChange) },
            label = stringRes(R.string.translation_fsm_perPage),
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
        )
    }
}

// ── Panel 2 (GlassPanel2) — current vehicle live state ────────────────────────────────────────────────────────────

@Composable
private fun CurrentStatePanel(data: DebuggerData) {
    GlassPanel {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(stringRes(R.string.translation_fsm_vehicleLiveState))
            Icon(
                FsmGlyphs.Info,
                contentDescription = stringRes(R.string.translation_help_fsm_liveState_aria),
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val state = data.currentState
        when {
            data.currentStateLoading -> Skeleton(modifier = Modifier.padding(top = Spacing.sm), height = 72.dp)
            state != null ->
                Column(
                    modifier = Modifier.padding(top = Spacing.sm),
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    StatusBadge(status = state.state, size = ChipSize.Md)
                    KeyValueRow(stringRes(R.string.translation_fsm_type), stringRes(R.string.translation_fsm_vehicle))
                    KeyValueRow(stringRes(R.string.translation_fsm_mode), stringRes(modeStringId(state)))
                    KeyValueRow(
                        stringRes(R.string.translation_fsm_since),
                        state.since?.let { formatAbsoluteTime(it) } ?: EM_DASH,
                    )
                }
            else ->
                EmptyState(
                    message = stringRes(R.string.translation_fsm_noState),
                    icon = FsmGlyphs.Activity,
                )
        }
    }
}

// ── Panel 3 (GlassPanel3) — live state timeline + signal-snapshot inspector ────────────────────────────────────────

@Composable
private fun TimelinePanel(
    data: DebuggerData,
    snapshotState: UiState<SnapshotData>,
    selectedId: Long?,
    emptyMessage: String,
    onToggleTransition: (Long, String) -> Unit,
) {
    GlassPanel {
        val recent = data.recentTransitions
        when {
            data.transitionsLoading -> Skeleton(height = 48.dp)
            recent.isEmpty() -> HelperText(emptyMessage)
            else ->
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    recent.forEach { transition ->
                        TimelineChip(
                            transition = transition,
                            selected = transition.id == selectedId,
                            onClick = { onToggleTransition(transition.id, transition.ts) },
                        )
                    }
                }
        }
        if (selectedId != null && data.transitionById(selectedId) != null) {
            SnapshotInspector(snapshotState = snapshotState, modifier = Modifier.padding(top = Spacing.md))
        }
    }
}

@Composable
private fun TimelineChip(
    transition: FsmTransition,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val border = if (selected) io.teslasync.android.components.ui.PanelAccent.Primary else io.teslasync.android.components.ui.PanelAccent.None
    GlassPanel(
        modifier = Modifier.width(TimelineChipMinWidth).clip(MaterialTheme.shapes.medium).clickable(onClick = onClick),
        padding = PanelPadding.Sm,
        accent = border,
    ) {
        StatusBadge(status = transition.toState, size = ChipSize.Sm)
        Caption(formatClockTime(transition.ts), modifier = Modifier.padding(top = Spacing.xs))
    }
}

@Composable
private fun SnapshotInspector(
    snapshotState: UiState<SnapshotData>,
    modifier: Modifier = Modifier,
) {
    val snapshot = snapshotState.data
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        when {
            snapshotState.isLoading -> Skeleton(height = 40.dp)
            snapshot == null || snapshot.signals.isEmpty() -> HelperText(stringRes(R.string.translation_fsm_noState))
            else ->
                snapshot.signals.take(SNAPSHOT_PREVIEW_LIMIT).forEach { signal ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        Caption(signal.name, modifier = Modifier.weight(1f))
                        CodeText(signal.value)
                    }
                }
        }
    }
}

// ── Panel 4 (State-Distribution) — ChartContainer + donut (PieChart) ───────────────────────────────────────────────

@Composable
private fun DistributionPanel(
    data: DebuggerData,
    emptyMessage: String,
) {
    val slices = data.distribution
    val status =
        when {
            data.transitionsLoading -> ChartStatus.Loading
            slices.isEmpty() -> ChartStatus.Empty
            else -> ChartStatus.Ready
        }
    ChartContainer(
        title = stringRes(R.string.translation_fsm_distributionByState),
        status = status,
        height = DonutHeight,
        accessibleDescription = stringRes(R.string.translation_fsm_distributionByState_aria),
        emptyMessage = emptyMessage,
        dataTableHeader =
            listOf(
                stringRes(R.string.translation_fsm_col_state),
                stringRes(R.string.translation_fsm_col_count),
            ),
        dataTableRows = slices.map { listOf(it.name, formatCount(it.value)) },
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            StateDistributionDonut(slices = slices)
            DistributionLegend(slices = slices)
        }
    }
}

@Composable
private fun StateDistributionDonut(slices: List<StateSlice>) {
    val total = slices.sumOf { it.value }.coerceAtLeast(1)
    val colors = remember(slices) { slices.indices.map { paletteColor(it) } }
    Canvas(modifier = Modifier.fillMaxWidth().height(DonutHeight)) {
        val thickness = size.minDimension * 0.18f
        val diameter = size.minDimension - thickness
        val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
        val arcSize = Size(diameter, diameter)
        var startAngle = -90f
        slices.forEachIndexed { index, slice ->
            val sweep = 360f * slice.value / total
            drawArc(
                color = colors.getOrElse(index) { Color.Gray },
                startAngle = startAngle,
                sweepAngle = (sweep - 2f).coerceAtLeast(0f),
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = thickness, cap = StrokeCap.Butt),
            )
            startAngle += sweep
        }
    }
}

@Composable
private fun DistributionLegend(slices: List<StateSlice>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        slices.forEachIndexed { index, slice ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(modifier = Modifier.size(DotSize).clip(CircleShape).background(paletteColor(index)))
                Caption(slice.name)
                HelperText(formatCount(slice.value))
            }
        }
    }
}

// ── Panel 5 (GlassPanel5) — transition counts table ────────────────────────────────────────────────────────────────

@Composable
private fun TransitionCountsPanel(
    data: DebuggerData,
    emptyMessage: String,
) {
    GlassPanel {
        PanelTitle(stringRes(R.string.translation_fsm_transitionCounts))
        val rows = data.summaryRows
        when {
            data.transitionsLoading -> TableSkeleton(modifier = Modifier.padding(top = Spacing.sm), rows = 4, columns = 3)
            rows.isEmpty() -> EmptyState(message = emptyMessage, icon = FsmGlyphs.Activity)
            else -> {
                TableHeaderRow(
                    listOf(
                        stringRes(R.string.translation_fsm_state),
                        stringRes(R.string.translation_fsm_count),
                        stringRes(R.string.translation_fsm_avgInterval),
                    ),
                )
                rows.forEach { row ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(modifier = Modifier.weight(1f)) { StatusBadge(status = row.toState, size = ChipSize.Sm) }
                        CodeText(formatCount(row.count), modifier = Modifier.weight(1f))
                        CodeText(
                            if (row.avgIntervalSec > 0) formatDuration(row.avgIntervalSec) else EM_DASH,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

// ── Panels 6-9 (Transitions-Page / Total-Transitions / Flap-Warnings / Current-State) — summary cards ───────────────

@Composable
private fun SummaryCards(data: DebuggerData) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringRes(R.string.translation_fsm_totalOnPage),
                value = "${formatCount(data.totalOnPage)} / ${formatCount(data.totalTransitions)}",
                icon = FsmGlyphs.Activity,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringRes(R.string.translation_fsm_totalTransitions),
                value = formatCount(data.totalTransitions),
                icon = FsmGlyphs.Activity,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringRes(R.string.translation_fsm_flapCount),
                value = formatCount(data.flapCount),
                icon = FsmGlyphs.AlertTriangle,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringRes(R.string.translation_fsm_currentState),
                value = data.currentStateName ?: EM_DASH,
                icon = FsmGlyphs.Zap,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// ── Panel 10 (GlassPanel10) — paged transition log ─────────────────────────────────────────────────────────────────

@Composable
private fun TransitionLogPanel(
    data: DebuggerData,
    selectedId: Long?,
    emptyMessage: String,
    onPageChange: (Int) -> Unit,
    onPerPageChange: (Int) -> Unit,
    onToggleTransition: (Long, String) -> Unit,
) {
    GlassPanel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(stringRes(R.string.translation_fsm_timelineTitle))
            if (data.totalTransitions > 0) {
                HelperText("${formatCount(data.totalTransitions)} ${stringRes(R.string.translation_fsm_total)}")
            }
        }
        when {
            data.transitionsLoading -> TableSkeleton(modifier = Modifier.padding(top = Spacing.sm), rows = 5, columns = 5)
            data.transitions.isEmpty() -> EmptyState(message = emptyMessage, icon = FsmGlyphs.Activity)
            else -> {
                TableHeaderRow(
                    listOf(
                        stringRes(R.string.translation_fsm_time),
                        stringRes(R.string.translation_fsm_type),
                        stringRes(R.string.translation_fsm_from),
                        stringRes(R.string.translation_fsm_to),
                        stringRes(R.string.translation_fsm_trigger),
                    ),
                )
                data.transitions.forEach { transition ->
                    TransitionRow(
                        transition = transition,
                        selected = transition.id == selectedId,
                        onToggle = { onToggleTransition(transition.id, transition.ts) },
                    )
                }
                Pagination(
                    page = data.page,
                    pageSize = data.perPage,
                    total = data.totalTransitions,
                    onPageChange = onPageChange,
                    firstLabel = stringRes(R.string.translation_pagination_first),
                    previousLabel = stringRes(R.string.translation_common_previous),
                    nextLabel = stringRes(R.string.translation_common_next),
                    lastLabel = stringRes(R.string.translation_pagination_last),
                    showingText = paginationShowing(),
                )
                PerPageSelector(perPage = data.perPage, onPerPageChange = onPerPageChange)
            }
        }
    }
}

@Composable
private fun TransitionRow(
    transition: FsmTransition,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle)
                .padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(formatClockTime(transition.ts), modifier = Modifier.weight(1f))
        Caption(transition.fsmName.ifBlank { EM_DASH }, modifier = Modifier.weight(1f))
        Box(modifier = Modifier.weight(1f)) { StatusBadge(status = transition.fromState, size = ChipSize.Sm) }
        Box(modifier = Modifier.weight(1f)) { StatusBadge(status = transition.toState, size = ChipSize.Sm) }
        Caption(transition.trigger.ifBlank { EM_DASH }, modifier = Modifier.weight(1f))
        Icon(
            if (selected) FsmGlyphs.ChevronDown else FsmGlyphs.ChevronRight,
            contentDescription = stringRes(R.string.translation_fsm_viewDetail),
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PerPageSelector(
    perPage: Int,
    onPerPageChange: (Int) -> Unit,
) {
    Select(
        options = PER_PAGE_OPTIONS.map { SelectOption(value = it.toString(), label = it.toString()) },
        selectedValue = perPage.toString(),
        onSelect = { value -> value.toIntOrNull()?.let(onPerPageChange) },
        label = stringRes(R.string.translation_fsm_perPage),
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm),
    )
}

// ── Panel 11 (GlassPanel11) — selected transition detail ───────────────────────────────────────────────────────────

@Composable
private fun TransitionDetailPanel(transition: FsmTransition) {
    GlassPanel {
        PanelTitle(stringRes(R.string.translation_fsm_detailTitle))
        Column(
            modifier = Modifier.padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            KeyValueRow(stringRes(R.string.translation_fsm_detail_id), transition.id.toString())
            KeyValueRow(stringRes(R.string.translation_fsm_detail_vehicleId), transition.vehicleId.toString())
            if (transition.fsmName.isNotBlank()) {
                KeyValueRow(stringRes(R.string.translation_fsm_detail_name), transition.fsmName)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                Caption(stringRes(R.string.translation_fsm_detail_from), modifier = Modifier.weight(1f))
                Box(modifier = Modifier.weight(2f)) { StatusBadge(status = transition.fromState, size = ChipSize.Sm) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
                Caption(stringRes(R.string.translation_fsm_detail_to), modifier = Modifier.weight(1f))
                Box(modifier = Modifier.weight(2f)) { StatusBadge(status = transition.toState, size = ChipSize.Sm) }
            }
            KeyValueRow(stringRes(R.string.translation_fsm_detail_trigger), transition.trigger.ifBlank { EM_DASH })
            transition.details["guard"]?.takeIf { it.isNotBlank() && it != EM_DASH }?.let { guard ->
                KeyValueRow(stringRes(R.string.translation_fsm_detail_guard), guard)
            }
            durationLabel(transition.details["duration_in_state_ms"])?.let { duration ->
                KeyValueRow(stringRes(R.string.translation_fsm_detail_duration), duration)
            }
            KeyValueRow(stringRes(R.string.translation_fsm_detail_timestamp), formatAbsoluteTime(transition.ts))
            if (transition.details.isNotEmpty()) {
                Caption(stringRes(R.string.translation_fsm_detail_context), modifier = Modifier.padding(top = Spacing.xs))
                transition.details.forEach { (key, value) ->
                    CodeText("$key: $value")
                }
            }
        }
    }
}

// ── Shared building blocks ─────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun KeyValueRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label, modifier = Modifier.weight(1f))
        BodyText(value, modifier = Modifier.weight(2f))
    }
}

@Composable
private fun TableHeaderRow(cells: List<String>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.sm, bottom = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        cells.forEach { cell -> Caption(cell, modifier = Modifier.weight(1f)) }
    }
}

@Composable
private fun fsmTypeOptions(): List<SelectOption> =
    listOf(
        SelectOption(value = FsmType.ALL.name, label = stringRes(R.string.translation_fsm_allFsms)),
        SelectOption(value = FsmType.VEHICLE.name, label = stringRes(R.string.translation_fsm_vehicle)),
        SelectOption(
            value = FsmType.TELEMETRY_CONNECTION.name,
            label = stringRes(R.string.translation_fsm_telemetryConnection),
        ),
    )

private fun fsmTypeFromName(name: String): FsmType =
    FsmType.entries.firstOrNull { it.name == name } ?: FsmType.ALL

private fun modeStringId(state: FsmCurrentState): Int =
    when (fsmModeOf(state)) {
        FsmMode.Charging -> R.string.translation_fsm_modeCharging
        FsmMode.Drive -> R.string.translation_fsm_modeDrive
        FsmMode.Sleep -> R.string.translation_fsm_modeSleep
        FsmMode.Idle -> R.string.translation_fsm_modeIdle
    }

private fun durationLabel(raw: String?): String? {
    val text = raw ?: return null
    val millis = runCatching { java.lang.Double.parseDouble(text) }.getOrNull() ?: return null
    if (millis <= 0.0) return null
    return formatDuration(millis / 1000.0)
}

private const val EM_DASH = "—"
private const val SNAPSHOT_PREVIEW_LIMIT = 12

/** Pre-resolved "Showing X–Y of Z" formatter (web `Pagination` summary), captured for the non-composable callback. */
@Composable
private fun paginationShowing(): (Int, Int, Int) -> String {
    val format = stringRes(R.string.translation_pagination_showing)
    return { start, end, total -> String.format(format, start, end, total) }
}

/** Thin alias over [androidx.compose.ui.res.stringResource] so every literal resolves from the catalog (ADR-014). */
@Composable
private fun stringRes(id: Int): String = androidx.compose.ui.res.stringResource(id)

@Composable
private fun stringRes(
    id: Int,
    vararg formatArgs: Any,
): String = androidx.compose.ui.res.stringResource(id, *formatArgs)
