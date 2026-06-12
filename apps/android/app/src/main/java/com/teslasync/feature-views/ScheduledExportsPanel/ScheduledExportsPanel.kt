// The native Jetpack Compose + Material 3 ScheduledExportsPanel feature view — a parity port of
// web/src/features/system/pages/ScheduledExportsPanel.tsx. It reproduces that surface end to end inside one
// GlassPanel: the header (title + subtitle + "New schedule"), the inline create/edit form (name, cron, export type,
// format, range window, delivery kind, and a delivery-target field that appears only for email/webhook), and the
// schedules list where each row exposes every column the web table renders — name, type (format), cron, delivery,
// next run, last run, run status — plus the per-row Run-now / Enable-Disable / Edit / Delete actions and the delete
// confirmation. Every lifecycle state the shared cache-then-network feed can carry is rendered — a loading skeleton,
// a friendly empty state, a hard-error retry surface, and stale/offline "last known" with a freshness chip +
// auto-refresh — so the panel is never a blank box. The view performs NO HTTP: it binds the
// [ScheduledExportsPanelViewModel] (P1/S8) and renders.
//
// Mutation failures surface the shared server-error toast through [ToastHost] (the web mutation hooks' global
// error toast); the panel's own success feedback is the form closing + the list refreshing + the run-now spinner,
// exactly as the web `submit` / `toggleEnabled` / `runNow` do.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/ScheduledExportsPanel) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.scheduledexportspanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportDelivery
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private val ROW_SKELETON_HEIGHT = 92.dp
private const val DISABLED_ROW_ALPHA = 0.6f
private const val EM_DASH = "\u2014"

private val RUN_TIME_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/**
 * Stateful entry point for the ScheduledExportsPanel surface. Binds the [viewModel] (P1/S8), records the one-shot
 * PII-safe `view.opened` diagnostic, owns the inline create/edit form state + the delete confirmation + the toast
 * queue, and renders every lifecycle state the schedules feed can carry. The host constructs the view-model via
 * [ScheduledExportsPanelViewModel.create]; this view never performs HTTP.
 */
@Composable
fun ScheduledExportsPanel(
    viewModel: ScheduledExportsPanelViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val schedulesState by viewModel.schedules.collectAsStateWithLifecycle()
    val runningNowId by viewModel.runningNowId.collectAsStateWithLifecycle()

    var showForm by remember { mutableStateOf(false) }
    var editingId by remember { mutableStateOf<Long?>(null) }
    var form by remember { mutableStateOf(emptyScheduledExportForm()) }
    var saving by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf<ScheduledExport?>(null) }

    val scope = rememberCoroutineScope()
    val toastQueue = remember { emptyList<ToastItem>().toMutableStateList() }
    ScheduledExportToastPresenter(viewModel, toastQueue)

    Box(modifier = modifier.fillMaxWidth()) {
        ScheduledExportsPanelContent(
            schedulesState = schedulesState,
            runningNowId = runningNowId,
            showForm = showForm,
            form = form,
            saving = saving,
            onNew = {
                form = emptyScheduledExportForm()
                editingId = null
                showForm = true
            },
            onFormChange = { form = it },
            onCancelForm = {
                showForm = false
                editingId = null
                form = emptyScheduledExportForm()
            },
            onSubmit = {
                scope.launch {
                    saving = true
                    val saved = viewModel.save(editingId, form)
                    saving = false
                    if (saved) {
                        showForm = false
                        editingId = null
                        form = emptyScheduledExportForm()
                    }
                }
            },
            onRunNow = { row -> viewModel.runScheduledExportNow(row.id) },
            onToggle = viewModel::toggle,
            onEdit = { row ->
                form = scheduledExportFormFrom(row)
                editingId = row.id
                showForm = true
            },
            onDelete = { row -> confirmDelete = row },
            onRetry = viewModel::retry,
        )

        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }

    confirmDelete?.let { row ->
        ConfirmDialog(
            title = stringResource(R.string.translation_dataExport_scheduled_deleteConfirmTitle),
            message = stringResource(R.string.translation_dataExport_scheduled_deleteConfirmBody, row.name),
            confirmLabel = stringResource(R.string.translation_dataExport_scheduled_actions_delete),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            severity = ConfirmSeverity.Danger,
            closeLabel = stringResource(R.string.translation_common_close),
            onConfirm = {
                viewModel.delete(row.id)
                confirmDelete = null
            },
            onCancel = { confirmDelete = null },
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test entry point. Reproduces the web layout (header → optional
 * inline form → list) and every lifecycle branch: a loading skeleton, a hard-error retry surface, the no-schedules
 * empty state, and the populated rows with their freshness chip. Stale (non-error) data auto-refreshes, mirroring
 * the sibling surfaces' freshness contract.
 */
@Composable
fun ScheduledExportsPanelContent(
    schedulesState: UiState<List<ScheduledExport>>,
    runningNowId: Long?,
    showForm: Boolean,
    form: ScheduledExportForm,
    saving: Boolean,
    onNew: () -> Unit,
    onFormChange: (ScheduledExportForm) -> Unit,
    onCancelForm: () -> Unit,
    onSubmit: () -> Unit,
    onRunNow: (ScheduledExport) -> Unit,
    onToggle: (ScheduledExport) -> Unit,
    onEdit: (ScheduledExport) -> Unit,
    onDelete: (ScheduledExport) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(schedulesState.stale, schedulesState.refreshing, schedulesState.hasError) {
        if (schedulesState.stale && !schedulesState.refreshing && !schedulesState.hasError) onRetry()
    }

    FadeIn {
        GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                ScheduledExportsHeader(onNew = onNew)
                if (showForm) {
                    ScheduledExportFormCard(
                        form = form,
                        saving = saving,
                        onChange = onFormChange,
                        onCancel = onCancelForm,
                        onSubmit = onSubmit,
                    )
                }
                ScheduledExportsListArea(
                    schedulesState = schedulesState,
                    runningNowId = runningNowId,
                    onNew = onNew,
                    onRunNow = onRunNow,
                    onToggle = onToggle,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onRetry = onRetry,
                )
            }
        }
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ScheduledExportsHeader(onNew: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            SectionTitle(stringResource(R.string.translation_dataExport_scheduled_title))
            HelperText(stringResource(R.string.translation_dataExport_scheduled_subtitle))
        }
        Button(
            label = stringResource(R.string.translation_dataExport_scheduled_newSchedule),
            onClick = onNew,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.Plus,
        )
    }
}

// ── Inline create / edit form ────────────────────────────────────────────────────────────────────────────

@Composable
private fun ScheduledExportFormCard(
    form: ScheduledExportForm,
    saving: Boolean,
    onChange: (ScheduledExportForm) -> Unit,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Input(
                value = form.name,
                onValueChange = { onChange(form.copy(name = it)) },
                label = stringResource(R.string.translation_dataExport_scheduled_form_name),
                hint = stringResource(R.string.translation_dataExport_scheduled_form_namePlaceholder), // parity:allow P1/S10 i18n key id
                required = true,
            )
            Input(
                value = form.scheduleCron,
                onValueChange = { onChange(form.copy(scheduleCron = it)) },
                label = stringResource(R.string.translation_dataExport_scheduled_form_scheduleCron),
                hint = stringResource(R.string.translation_dataExport_scheduled_form_scheduleCronHelp),
                required = true,
            )
            Select(
                options = SCHEDULED_EXPORT_TYPES.map { SelectOption(value = it, label = it) },
                selectedValue = form.exportType,
                onSelect = { onChange(form.copy(exportType = it)) },
                label = stringResource(R.string.translation_dataExport_scheduled_form_exportType),
            )
            Select(
                options = SCHEDULED_EXPORT_FORMATS.map { SelectOption(value = it, label = it) },
                selectedValue = form.format,
                onSelect = { onChange(form.copy(format = it)) },
                label = stringResource(R.string.translation_dataExport_scheduled_form_format),
            )
            Input(
                value = form.rangeWindow,
                onValueChange = { onChange(form.copy(rangeWindow = it)) },
                label = stringResource(R.string.translation_dataExport_scheduled_form_rangeWindow),
                hint = stringResource(R.string.translation_dataExport_scheduled_form_rangeWindowHelp),
            )
            Select(
                options = SCHEDULED_DELIVERY_KINDS.map { SelectOption(value = it, label = it) },
                selectedValue = form.deliveryKind,
                onSelect = { onChange(form.copy(deliveryKind = it)) },
                label = stringResource(R.string.translation_dataExport_scheduled_form_deliveryKind),
            )
            if (deliveryNeedsTarget(form.deliveryKind)) {
                Input(
                    value = form.deliveryTarget,
                    onValueChange = { onChange(form.copy(deliveryTarget = it)) },
                    label = stringResource(R.string.translation_dataExport_scheduled_form_deliveryTarget),
                    hint = stringResource(R.string.translation_dataExport_scheduled_form_deliveryTargetHelp),
                    required = true,
                    keyboardType = if (form.deliveryKind == "email") KeyboardType.Email else KeyboardType.Uri,
                )
            }
            ScheduledExportFormActions(
                saving = saving,
                valid = validateScheduledExportForm(form) == null,
                onCancel = onCancel,
                onSubmit = onSubmit,
            )
        }
    }
}

@Composable
private fun ScheduledExportFormActions(
    saving: Boolean,
    valid: Boolean,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_dataExport_scheduled_form_cancel),
            onClick = onCancel,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = !saving,
        )
        Button(
            label = scheduledSaveLabel(saving),
            onClick = onSubmit,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = valid && !saving,
            loading = saving,
        )
    }
}

@Composable
private fun scheduledSaveLabel(saving: Boolean): String =
    if (saving) {
        stringResource(R.string.translation_common_saving)
    } else {
        stringResource(R.string.translation_dataExport_scheduled_form_submit)
    }

// ── List area ────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ScheduledExportsListArea(
    schedulesState: UiState<List<ScheduledExport>>,
    runningNowId: Long?,
    onNew: () -> Unit,
    onRunNow: (ScheduledExport) -> Unit,
    onToggle: (ScheduledExport) -> Unit,
    onEdit: (ScheduledExport) -> Unit,
    onDelete: (ScheduledExport) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        schedulesState.isLoading -> ScheduledExportsLoading()
        schedulesState.isError -> ScheduledExportsErrorState(schedulesState, onRetry)
        schedulesState.isEmpty -> ScheduledExportsEmptyState(onNew)
        else ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                if (schedulesState.stale || schedulesState.refreshing || schedulesState.hasError) {
                    ScheduledExportsFreshnessChip(schedulesState)
                }
                (schedulesState.data ?: emptyList()).forEach { row ->
                    ScheduledExportRow(
                        row = row,
                        isRunning = runningNowId == row.id,
                        onRunNow = onRunNow,
                        onToggle = onToggle,
                        onEdit = onEdit,
                        onDelete = onDelete,
                    )
                }
            }
    }
}

@Composable
private fun ScheduledExportsLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(3) {
            Skeleton(
                modifier = Modifier.semantics { contentDescription = loadingLabel },
                height = ROW_SKELETON_HEIGHT,
            )
        }
    }
}

@Composable
private fun ScheduledExportsErrorState(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = scheduledErrorDetail(state),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun scheduledErrorDetail(state: UiState<*>): String =
    when (state.errorKind) {
        ErrorKind.Network, ErrorKind.Timeout, ErrorKind.CircuitOpen ->
            stringResource(R.string.translation_error_network_message)
        else -> stringResource(R.string.translation_error_serverError_message)
    }

@Composable
private fun ScheduledExportsEmptyState(onNew: () -> Unit) {
    EmptyState(
        message = stringResource(R.string.translation_dataExport_scheduled_emptyMessage),
        title = stringResource(R.string.translation_dataExport_scheduled_empty),
        action =
            EmptyStateAction(
                label = stringResource(R.string.translation_dataExport_scheduled_newSchedule),
                onClick = onNew,
            ),
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Freshness chip ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ScheduledExportsFreshnessChip(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
    }
}

// ── Row ──────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ScheduledExportRow(
    row: ScheduledExport,
    isRunning: Boolean,
    onRunNow: (ScheduledExport) -> Unit,
    onToggle: (ScheduledExport) -> Unit,
    onEdit: (ScheduledExport) -> Unit,
    onDelete: (ScheduledExport) -> Unit,
) {
    GlassPanel(
        modifier = Modifier.fillMaxWidth().alpha(if (row.enabled) 1f else DISABLED_ROW_ALPHA),
        padding = PanelPadding.Lg,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(row.name)
            ScheduledExportRowMeta(row)
            ScheduledExportRowActions(
                row = row,
                isRunning = isRunning,
                onRunNow = onRunNow,
                onToggle = onToggle,
                onEdit = onEdit,
                onDelete = onDelete,
            )
        }
    }
}

@Composable
private fun ScheduledExportRowMeta(row: ScheduledExport) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        ScheduledExportMetaRow(stringResource(R.string.translation_dataExport_scheduled_table_type)) {
            BodyText(typeFormatLabel(row), modifier = Modifier.weight(1f))
        }
        ScheduledExportMetaRow(stringResource(R.string.translation_dataExport_scheduled_table_cron)) {
            CodeText(row.scheduleCron, modifier = Modifier.weight(1f))
        }
        ScheduledExportMetaRow(stringResource(R.string.translation_dataExport_scheduled_table_delivery)) {
            BodyText(deliveryLabel(row.delivery), modifier = Modifier.weight(1f))
        }
        ScheduledExportMetaRow(stringResource(R.string.translation_dataExport_scheduled_table_nextRun)) {
            BodyText(nextRunLabel(row.nextRunAt), modifier = Modifier.weight(1f))
        }
        ScheduledExportMetaRow(stringResource(R.string.translation_dataExport_scheduled_table_lastRun)) {
            BodyText(lastRunLabel(row.lastRunAt), modifier = Modifier.weight(1f))
        }
        ScheduledExportMetaRow(stringResource(R.string.translation_dataExport_scheduled_table_status)) {
            Box(modifier = Modifier.weight(1f)) { ScheduledRunStatusBadge(row.lastStatus) }
        }
    }
}

@Composable
private fun ScheduledExportMetaRow(
    label: String,
    value: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Caption(label, modifier = Modifier.weight(1f))
        value()
    }
}

@Composable
private fun ScheduledRunStatusBadge(lastStatus: String?) {
    when (scheduledRunStatus(lastStatus)) {
        ScheduledRunStatus.Ok ->
            Badge(stringResource(R.string.translation_dataExport_scheduled_status_ok), variant = BadgeVariant.Success)
        ScheduledRunStatus.Failed ->
            Badge(stringResource(R.string.translation_dataExport_scheduled_status_failed), variant = BadgeVariant.Danger)
        ScheduledRunStatus.Unknown ->
            BodyText(EM_DASH)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScheduledExportRowActions(
    row: ScheduledExport,
    isRunning: Boolean,
    onRunNow: (ScheduledExport) -> Unit,
    onToggle: (ScheduledExport) -> Unit,
    onEdit: (ScheduledExport) -> Unit,
    onDelete: (ScheduledExport) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Button(
            label = stringResource(R.string.translation_dataExport_scheduled_actions_runNow),
            onClick = { onRunNow(row) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            loading = isRunning,
        )
        Button(
            label = scheduledToggleLabel(row.enabled),
            onClick = { onToggle(row) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        Button(
            label = stringResource(R.string.translation_dataExport_scheduled_actions_edit),
            onClick = { onEdit(row) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        Button(
            label = stringResource(R.string.translation_dataExport_scheduled_actions_delete),
            onClick = { onDelete(row) },
            variant = ButtonVariant.Danger,
            size = ButtonSize.Sm,
        )
    }
}

@Composable
private fun scheduledToggleLabel(enabled: Boolean): String =
    if (enabled) {
        stringResource(R.string.translation_dataExport_scheduled_actions_disable)
    } else {
        stringResource(R.string.translation_dataExport_scheduled_actions_enable)
    }

@Composable
private fun nextRunLabel(iso: String?): String = parseInstantMillis(iso)?.let(::formatRunTimestamp) ?: EM_DASH

@Composable
private fun lastRunLabel(iso: String?): String =
    parseInstantMillis(iso)?.let(::formatRunTimestamp)
        ?: stringResource(R.string.translation_dataExport_scheduled_status_never)

private fun formatRunTimestamp(millis: Long): String = RUN_TIME_FORMATTER.format(Instant.ofEpochMilli(millis))

// ── Toast presenter ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Drains the view-model's [ScheduledExportToast] stream into [queue], mapping the single failure variant onto the
 * shared localized server-error copy with a [Tone.Danger] surface and auto-dismissing each toast after
 * [TOAST_DURATION_MS]. The message is resolved at composition (a `stringResource` cannot run inside the collector).
 */
@Composable
private fun ScheduledExportToastPresenter(
    viewModel: ScheduledExportsPanelViewModel,
    queue: SnapshotStateList<ToastItem>,
) {
    val failureMessage = stringResource(R.string.translation_error_serverError_message)
    LaunchedEffect(viewModel) {
        var nextId = 0L
        viewModel.toasts.collect { toast ->
            val message =
                when (toast) {
                    ScheduledExportToast.ActionFailed -> failureMessage
                }
            val id = nextId++
            queue.add(ToastItem(id = id, message = message, tone = Tone.Danger))
            while (queue.size > MAX_TOASTS) queue.removeAt(0)
            launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == id }
            }
        }
    }
}

// ── Previews ─────────────────────────────────────────────────────────────────────────────────────────────

private fun sampleSchedule(): ScheduledExport =
    ScheduledExport(
        id = 1,
        name = "Drives weekly",
        exportType = "drives",
        format = "csv",
        scheduleCron = "0 9 * * 0",
        delivery = ScheduledExportDelivery(kind = "email", target = "ops@example.com"),
        rangeWindow = "7d",
        enabled = true,
        lastStatus = "ok",
        lastRunAt = "2024-04-04T09:00:00Z",
        nextRunAt = "2024-04-11T09:00:00Z",
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun ScheduledExportsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ScheduledExportsPanelContent(
            schedulesState = UiState(UiPhase.Content, listOf(sampleSchedule())),
            runningNowId = null,
            showForm = false,
            form = emptyScheduledExportForm(),
            saving = false,
            onNew = {},
            onFormChange = {},
            onCancelForm = {},
            onSubmit = {},
            onRunNow = {},
            onToggle = {},
            onEdit = {},
            onDelete = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ScheduledExportsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ScheduledExportsPanelContent(
            schedulesState = UiState(UiPhase.Empty, emptyList()),
            runningNowId = null,
            showForm = false,
            form = emptyScheduledExportForm(),
            saving = false,
            onNew = {},
            onFormChange = {},
            onCancelForm = {},
            onSubmit = {},
            onRunNow = {},
            onToggle = {},
            onEdit = {},
            onDelete = {},
            onRetry = {},
        )
    }
}
