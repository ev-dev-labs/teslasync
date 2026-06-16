// The native Jetpack Compose + Material 3 DataRepairPage system surface — a parity port of
// web/src/features/system/pages/DataRepairPage.tsx, the "fix incomplete or stale sessions" repair surface. It
// reproduces the page's panels (the four stat cards — Total Stale / Stale Charging / Stale Drives / Status — the
// charging + drive list-row panels, and the two inline edit-form panels), every data state
// (loading / empty / error / success), and every visible string (resolved from the generated res/values catalog,
// ADR-014): the title + subtitle header, the record-kind tabs with their open counts, the per-row summary, the
// inline repair forms (update / close / discard), and the success/failure toasts.
//
// Composition: [DataRepairPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed + interaction snapshot, drains the one-shot
// toast events); [DataRepairPageContent] is the stateless render layer driven entirely by [UiState] +
// [DataRepairInteraction] + [DataRepairActions]. All derivation lives in the framework-free model
// (DataRepairPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.system.datarepair

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** How long a repair-outcome toast stays before auto-dismissing (web `toast` lifetime). */
private const val TOAST_DURATION_MS = 3_200L

/** The most toasts stacked at once (web toaster cap). */
private const val MAX_TOASTS = 3

/** The ISO-format ghost prompt shown in the "End Date (ISO)" field (web edit-form example value). */
private const val ISO_HINT = "2026-03-30T04:00:00Z"

/** The page's interaction callbacks, wired to the [DataRepairPageViewModel] (web event handlers). */
data class DataRepairActions(
    val onSelectTab: (DataRepairTab) -> Unit,
    val onToggleExpand: (Long) -> Unit,
    val onUpdateCharging: (Long, DataRepairChargingForm) -> Unit,
    val onCloseCharging: (Long) -> Unit,
    val onDiscardCharging: (Long) -> Unit,
    val onUpdateDrive: (Long, DataRepairDriveForm) -> Unit,
    val onCloseDrive: (Long) -> Unit,
    val onDiscardDrive: (Long) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DataRepairPageViewModel] over the supplied [source] (the host wires the shared
 * resilient client via [dataRepairPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun DataRepairPage(
    source: DataRepairSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DataRepairPageViewModel =
        viewModel(
            key = DataRepairPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DataRepairPageViewModel(source, logger) } },
        )
    DataRepairPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic, binds the feed + interaction snapshot to the
 * stateless content, and drains the one-shot repair-outcome toasts into the bottom [ToastHost].
 */
@Composable
fun DataRepairPage(
    viewModel: DataRepairPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val updating by viewModel.updating.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            DataRepairActions(
                onSelectTab = viewModel::selectTab,
                onToggleExpand = viewModel::toggleExpanded,
                onUpdateCharging = viewModel::updateCharging,
                onCloseCharging = viewModel::closeCharging,
                onDiscardCharging = viewModel::discardCharging,
                onUpdateDrive = viewModel::updateDrive,
                onCloseDrive = viewModel::closeDrive,
                onDiscardDrive = viewModel::discardDrive,
                onRetry = viewModel::retry,
            )
        }

    val scope = rememberCoroutineScope()
    val toasts = remember { mutableStateListOf<ToastItem>() }
    var nextToastId by remember { mutableStateOf(0L) }
    val toastMessages = rememberUpdatedState(dataRepairToastMessages())

    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            if (event !is UiEvent.Message) return@collect
            val text = toastMessages.value[event.messageKey] ?: return@collect
            val id = nextToastId++
            val item = ToastItem(id = id, message = text, tone = event.severity.toTone())
            val updated = enqueueToast(toasts.toList(), item, MAX_TOASTS)
            toasts.clear()
            toasts.addAll(updated)
            scope.launch {
                delay(TOAST_DURATION_MS)
                val pruned = dismissToast(toasts.toList(), id)
                toasts.clear()
                toasts.addAll(pruned)
            }
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        DataRepairPageContent(
            state = state,
            interaction = interaction,
            updating = updating,
            actions = actions,
        )
        ToastHost(
            toasts = toasts.toList(),
            onDismiss = { id ->
                val pruned = dismissToast(toasts.toList(), id)
                toasts.clear()
                toasts.addAll(pruned)
            },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header, then — gated on the feed phase exactly as the web
 * `PageContainer` gates `loading`/`error` — either the first-load spinner, the retryable error, or the full body
 * (the four stat cards, the record-kind tabs, and the selected tab's list or its "all complete" empty state).
 */
@Composable
fun DataRepairPageContent(
    state: UiState<DataRepairStaleData>,
    interaction: DataRepairInteraction,
    updating: Boolean,
    actions: DataRepairActions,
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
        DataRepairHeader(data = state.data)

        when {
            state.isLoading -> FadeIn { GlassPanel(padding = PanelPadding.Md) { LoadingState() } }
            state.isError -> FadeIn { GlassPanel(padding = PanelPadding.Md) { ErrorState(onRetry = actions.onRetry) } }
            else -> {
                val data = state.data ?: DataRepairStaleData()
                FadeIn { StatsGrid(data = data) }
                FadeIn(delayMs = FADE_STEP_MS) {
                    DataRepairTabs(
                        tab = interaction.tab,
                        chargingCount = data.staleCharging.size,
                        drivesCount = data.staleDrives.size,
                        onSelect = actions.onSelectTab,
                    )
                }
                FadeIn(delayMs = FADE_STEP_MS * 2) {
                    DataRepairRecords(
                        data = data,
                        interaction = interaction,
                        updating = updating,
                        actions = actions,
                    )
                }
            }
        }
    }
}

/** The header — page title plus the dynamic stale-count subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun DataRepairHeader(data: DataRepairStaleData?) {
    val total = data?.totalStale ?: 0
    val subtitle =
        if (total > 0) {
            val plural = if (total != 1) "s" else ""
            "$total ${stringResource(R.string.translation_dataRepair_incompleteSession)}$plural " +
                stringResource(R.string.translation_dataRepair_found)
        } else {
            stringResource(R.string.translation_dataRepair_subtitle)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_dataRepair_title))
        BodyText(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Data states ─────────────────────────────────────────────────────────────────────────────────────────────

/** First-load surface — a centered spinner so the region is never blank (web `PageContainer loading`). */
@Composable
private fun LoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

/** Hard-error surface with a retry affordance (web `PageContainer error`). */
@Composable
private fun ErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DataRepairGlyphs.AlertTriangle,
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

// ── Stat cards (Total-Stale / Stale-Charging / Stale-Drives / Status panels) ──────────────────────────────────

/** The four stat cards in a 2×2 grid (web `grid grid-cols-2 sm:grid-cols-4`). */
@Composable
private fun StatsGrid(data: DataRepairStaleData) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            // Total-Stale panel.
            MetricCard(
                label = stringResource(R.string.translation_dataRepair_totalStale),
                value = data.totalStale.toString(),
                icon = DataRepairGlyphs.AlertTriangle,
                accent = TeslaTokens.status.warning,
                iconContentDescription = stringResource(R.string.translation_dataRepair_totalStale),
                modifier = Modifier.weight(1f),
            )
            // Stale-Charging panel.
            MetricCard(
                label = stringResource(R.string.translation_dataRepair_staleCharging),
                value = data.staleCharging.size.toString(),
                icon = DataRepairGlyphs.BatteryCharging,
                accent = TeslaTokens.status.info,
                iconContentDescription = stringResource(R.string.translation_dataRepair_staleCharging),
                modifier = Modifier.weight(1f),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            // Stale-Drives panel.
            MetricCard(
                label = stringResource(R.string.translation_dataRepair_staleDrives),
                value = data.staleDrives.size.toString(),
                icon = DataRepairGlyphs.Route,
                accent = MaterialTheme.colorScheme.primary,
                iconContentDescription = stringResource(R.string.translation_dataRepair_staleDrives),
                modifier = Modifier.weight(1f),
            )
            // Status panel.
            val statusValue =
                if (data.isClean) {
                    stringResource(R.string.translation_dataRepair_clean)
                } else {
                    stringResource(R.string.translation_dataRepair_needsRepair)
                }
            MetricCard(
                label = stringResource(R.string.translation_dataRepair_status),
                value = statusValue,
                icon = DataRepairGlyphs.Wrench,
                accent = if (data.isClean) TeslaTokens.status.success else TeslaTokens.status.danger,
                iconContentDescription = stringResource(R.string.translation_dataRepair_status),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The record-kind tab pills with their open counts (web ghost-button tab bar). */
@Composable
private fun DataRepairTabs(
    tab: DataRepairTab,
    chargingCount: Int,
    drivesCount: Int,
    onSelect: (DataRepairTab) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        TabPill(
            selected = tab == DataRepairTab.Charging,
            icon = DataRepairGlyphs.BatteryCharging,
            label = stringResource(R.string.translation_dataRepair_chargingSessions),
            count = chargingCount,
            onClick = { onSelect(DataRepairTab.Charging) },
        )
        TabPill(
            selected = tab == DataRepairTab.Drives,
            icon = DataRepairGlyphs.Route,
            label = stringResource(R.string.translation_dataRepair_drives),
            count = drivesCount,
            onClick = { onSelect(DataRepairTab.Drives) },
        )
    }
}

@Composable
private fun TabPill(
    selected: Boolean,
    icon: ImageVector,
    label: String,
    count: Int,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        variant = if (selected) ButtonVariant.Secondary else ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Sm)
        ButtonGap()
        BodyText(label)
        if (count > 0) {
            ButtonGap()
            Badge(text = count.toString(), variant = BadgeVariant.Warning)
        }
    }
}

// ── Records list / per-tab empty state ────────────────────────────────────────────────────────────────────────

/** The selected tab's list of stale records (each a clickable row + its inline form), or the empty state. */
@Composable
private fun DataRepairRecords(
    data: DataRepairStaleData,
    interaction: DataRepairInteraction,
    updating: Boolean,
    actions: DataRepairActions,
) {
    val nowMillis = System.currentTimeMillis()
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    when (interaction.tab) {
        DataRepairTab.Charging ->
            if (data.staleCharging.isEmpty()) {
                DataRepairEmptyState(message = stringResource(R.string.translation_dataRepair_noStaleCharging))
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    data.staleCharging.forEach { session ->
                        ChargingRow(
                            session = session,
                            expanded = interaction.expandedId == session.id,
                            updating = updating,
                            nowMillis = nowMillis,
                            locale = locale,
                            actions = actions,
                        )
                    }
                }
            }

        DataRepairTab.Drives ->
            if (data.staleDrives.isEmpty()) {
                DataRepairEmptyState(message = stringResource(R.string.translation_dataRepair_noStaleDrives))
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    data.staleDrives.forEach { drive ->
                        DriveRow(
                            drive = drive,
                            expanded = interaction.expandedId == drive.id,
                            updating = updating,
                            nowMillis = nowMillis,
                            locale = locale,
                            actions = actions,
                        )
                    }
                }
            }
    }
}

/** "All sessions are complete" empty state (web `<EmptyState icon={CheckCircle} ...>`). */
@Composable
private fun DataRepairEmptyState(message: String) {
    EmptyState(
        message = message,
        icon = DataRepairGlyphs.CheckCircle,
        title = stringResource(R.string.translation_dataRepair_allComplete),
    )
}

// ── Charging row (GlassPanel7) + inline edit form (GlassPanel1) ────────────────────────────────────────────────

@Composable
private fun ChargingRow(
    session: DataRepairChargingSession,
    expanded: Boolean,
    updating: Boolean,
    nowMillis: Long,
    locale: Locale,
    actions: DataRepairActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        // GlassPanel7 — the charging-session summary row.
        StaleRecordRowPanel(
            id = session.id,
            startTs = session.startTs,
            vehicleId = session.vehicleId,
            startBatteryPct = session.startBatteryPct,
            expanded = expanded,
            nowMillis = nowMillis,
            locale = locale,
            onClick = { actions.onToggleExpand(session.id) },
        )
        if (expanded) {
            ChargingEditForm(session = session, updating = updating, actions = actions)
        }
    }
}

/** GlassPanel1 — the charging repair form (web `ChargingEditForm`). */
@Composable
private fun ChargingEditForm(
    session: DataRepairChargingSession,
    updating: Boolean,
    actions: DataRepairActions,
) {
    var form by remember(session.id) { mutableStateOf(DataRepairChargingForm.from(session)) }
    GlassPanel(padding = PanelPadding.Md, accent = PanelAccent.Warning) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            FieldRow {
                Input(
                    value = form.endTs,
                    onValueChange = { form = form.copy(endTs = it) },
                    label = stringResource(R.string.translation_dataRepair_endDateIso),
                    hint = ISO_HINT,
                    modifier = Modifier.weight(1f),
                )
                Input(
                    value = form.totalEnergyAddedWh,
                    onValueChange = { form = form.copy(totalEnergyAddedWh = it) },
                    label = stringResource(R.string.translation_dataRepair_energyAddedKwh),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
            }
            FieldRow {
                Input(
                    value = form.endBatteryPct,
                    onValueChange = { form = form.copy(endBatteryPct = it) },
                    label = stringResource(R.string.translation_dataRepair_endBatteryPct),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
                Input(
                    value = form.peakPowerW,
                    onValueChange = { form = form.copy(peakPowerW = it) },
                    label = stringResource(R.string.translation_dataRepair_chargerPowerKw),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
            }
            FieldRow {
                Input(
                    value = form.durationMin,
                    onValueChange = { form = form.copy(durationMin = it) },
                    label = stringResource(R.string.translation_dataRepair_durationMin),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
                Input(
                    value = form.cost,
                    onValueChange = { form = form.copy(cost = it) },
                    label = stringResource(R.string.translation_dataRepair_costUsd),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
            }
            RepairActionBar(
                updating = updating,
                closeLabel = stringResource(R.string.translation_dataRepair_closeSession),
                onSave = { actions.onUpdateCharging(session.id, form) },
                onClose = { actions.onCloseCharging(session.id) },
                onDiscard = { actions.onDiscardCharging(session.id) },
                onCancel = { actions.onToggleExpand(session.id) },
            )
        }
    }
}

// ── Drive row (GlassPanel8) + inline edit form (GlassPanel2) ──────────────────────────────────────────────────

@Composable
private fun DriveRow(
    drive: DataRepairDrive,
    expanded: Boolean,
    updating: Boolean,
    nowMillis: Long,
    locale: Locale,
    actions: DataRepairActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        // GlassPanel8 — the drive summary row.
        StaleRecordRowPanel(
            id = drive.id,
            startTs = drive.startTs,
            vehicleId = drive.vehicleId,
            startBatteryPct = drive.startBatteryPct,
            expanded = expanded,
            nowMillis = nowMillis,
            locale = locale,
            onClick = { actions.onToggleExpand(drive.id) },
        )
        if (expanded) {
            DriveEditForm(drive = drive, updating = updating, actions = actions)
        }
    }
}

/** GlassPanel2 — the drive repair form (web `DriveEditForm`). */
@Composable
private fun DriveEditForm(
    drive: DataRepairDrive,
    updating: Boolean,
    actions: DataRepairActions,
) {
    var form by remember(drive.id) { mutableStateOf(DataRepairDriveForm.from(drive)) }
    GlassPanel(padding = PanelPadding.Md, accent = PanelAccent.Warning) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            FieldRow {
                Input(
                    value = form.endTs,
                    onValueChange = { form = form.copy(endTs = it) },
                    label = stringResource(R.string.translation_dataRepair_endDateIso),
                    hint = ISO_HINT,
                    modifier = Modifier.weight(1f),
                )
                Input(
                    value = form.distanceM,
                    onValueChange = { form = form.copy(distanceM = it) },
                    label = stringResource(R.string.translation_dataRepair_distanceM),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
            }
            FieldRow {
                Input(
                    value = form.durationS,
                    onValueChange = { form = form.copy(durationS = it) },
                    label = stringResource(R.string.translation_dataRepair_durationS),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
                Input(
                    value = form.endBatteryPct,
                    onValueChange = { form = form.copy(endBatteryPct = it) },
                    label = stringResource(R.string.translation_dataRepair_endBatteryPct),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
            }
            FieldRow {
                Input(
                    value = form.maxSpeedMps,
                    onValueChange = { form = form.copy(maxSpeedMps = it) },
                    label = stringResource(R.string.translation_dataRepair_maxSpeedMps),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.weight(1f),
                )
                FieldSpacer()
            }
            RepairActionBar(
                updating = updating,
                closeLabel = stringResource(R.string.translation_dataRepair_closeDrive),
                onSave = { actions.onUpdateDrive(drive.id, form) },
                onClose = { actions.onCloseDrive(drive.id) },
                onDiscard = { actions.onDiscardDrive(drive.id) },
                onCancel = { actions.onToggleExpand(drive.id) },
            )
        }
    }
}

// ── Shared row + form pieces ──────────────────────────────────────────────────────────────────────────────────

/** The clickable summary panel shared by both record kinds (web list-row `GlassPanel`). */
@Composable
private fun StaleRecordRowPanel(
    id: Long,
    startTs: String,
    vehicleId: Long,
    startBatteryPct: Double?,
    expanded: Boolean,
    nowMillis: Long,
    locale: Locale,
    onClick: () -> Unit,
) {
    GlassPanel(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        padding = PanelPadding.Md,
        accent = if (expanded) PanelAccent.Warning else PanelAccent.None,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CodeText(recordIdLabel(id))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(formatStartTs(startTs, locale))
                Caption(
                    "${stringResource(R.string.translation_dataRepair_vehicle)} $vehicleId" +
                        " \u00B7 ${batteryPercentLabel(startBatteryPct)}" +
                        " \u00B7 ${hoursOpenLabel(startTs, nowMillis)}",
                )
            }
            Badge(
                text = stringResource(R.string.translation_dataRepair_open),
                variant = BadgeVariant.Warning,
            )
        }
    }
}

/** The save / close / discard / cancel action bar shared by both repair forms (web button row). */
@Composable
private fun RepairActionBar(
    updating: Boolean,
    closeLabel: String,
    onSave: () -> Unit,
    onClose: () -> Unit,
    onDiscard: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Button(
            label = stringResource(R.string.translation_dataRepair_save),
            onClick = onSave,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            enabled = !updating,
            leadingIcon = DataRepairGlyphs.Save,
        )
        Button(
            label = closeLabel,
            onClick = onClose,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            enabled = !updating,
            leadingIcon = DataRepairGlyphs.Clock,
        )
        Button(
            label = stringResource(R.string.translation_dataRepair_discard),
            onClick = onDiscard,
            variant = ButtonVariant.Danger,
            size = ButtonSize.Sm,
            enabled = !updating,
            leadingIcon = DataRepairGlyphs.Trash,
        )
        Button(
            label = stringResource(R.string.translation_dataRepair_cancel),
            onClick = onCancel,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.Close,
        )
    }
}

/** Two-up field row (web `grid sm:grid-cols-2`). */
@Composable
private fun FieldRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        content = content,
    )
}

/** A blank half-width cell so an odd trailing field keeps the two-up rhythm. */
@Composable
private fun RowScope.FieldSpacer() {
    Box(modifier = Modifier.weight(1f))
}

/** Fixed gap between a button's icon and its trailing chip. */
@Composable
private fun RowScope.ButtonGap() {
    Box(modifier = Modifier.padding(end = Spacing.xs))
}

// ── i18n + format helpers (render boundary) ───────────────────────────────────────────────────────────────────

/** All repair-outcome toast strings resolved at composition (web `toast.success`/`toast.error`), keyed by event. */
@Composable
private fun dataRepairToastMessages(): Map<String, String> =
    mapOf(
        MSG_SESSION_UPDATED to stringResource(R.string.translation_dataRepair_sessionUpdated),
        MSG_SESSION_CLOSED to stringResource(R.string.translation_dataRepair_sessionClosed),
        MSG_SESSION_DISCARDED to stringResource(R.string.translation_dataRepair_sessionDiscarded),
        MSG_FAILED_UPDATE_SESSION to stringResource(R.string.translation_dataRepair_failedUpdateSession),
        MSG_FAILED_CLOSE_SESSION to stringResource(R.string.translation_dataRepair_failedCloseSession),
        MSG_FAILED_DISCARD_SESSION to stringResource(R.string.translation_dataRepair_failedDiscardSession),
        MSG_DRIVE_UPDATED to stringResource(R.string.translation_dataRepair_driveUpdated),
        MSG_DRIVE_CLOSED to stringResource(R.string.translation_dataRepair_driveClosed),
        MSG_DRIVE_DISCARDED to stringResource(R.string.translation_dataRepair_driveDiscarded),
        MSG_FAILED_UPDATE_DRIVE to stringResource(R.string.translation_dataRepair_failedUpdateDrive),
        MSG_FAILED_CLOSE_DRIVE to stringResource(R.string.translation_dataRepair_failedCloseDrive),
        MSG_FAILED_DISCARD_DRIVE to stringResource(R.string.translation_dataRepair_failedDiscardDrive),
    )

/** Maps the one-shot event severity onto the toast tone. */
private fun UiEvent.Severity.toTone(): Tone =
    when (this) {
        UiEvent.Severity.Success -> Tone.Success
        UiEvent.Severity.Warning -> Tone.Warning
        UiEvent.Severity.Error -> Tone.Danger
        UiEvent.Severity.Info -> Tone.Info
    }

/** Formats an ISO-8601 start timestamp at the render boundary (web `formatDateTime`); falls back to the raw text. */
private fun formatStartTs(
    startTs: String,
    locale: Locale,
): String =
    try {
        OffsetDateTime
            .parse(startTs)
            .format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale))
    } catch (_: DateTimeParseException) {
        startTs
    }
