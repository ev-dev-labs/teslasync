// The native Jetpack Compose + Material 3 ScheduledExportsPanel system page — a parity port of
// web/src/features/system/pages/ScheduledExportsPanel.tsx, the recurring-export control plane the web app mounts on
// its /data-export surface. The web "page" is a single self-contained GlassPanel: a header (title + subtitle + "New
// schedule"), an inline create/edit form (name, cron, export type, format, range window, delivery kind, and a
// delivery-target field shown only for email/webhook), and the schedules table whose `<thead>` names every column
// (Name, Type, Cron, Delivery, Next run, Last run, Status, Actions) and whose rows expose the per-row Run-now /
// Enable-Disable / Edit / Delete actions plus a delete confirmation.
//
// This page reproduces that surface natively as a mobile-first card layout: every web table column header is rendered
// as a field label — `table.name` labels each schedule's name, the six middle columns label its meta rows, and
// `table.actions` labels its action group — so all 36 web strings resolve from the generated res/values catalog
// (ADR-014) with zero hardcoded literals, while the layout stays touch-friendly instead of a wide horizontal-scroll
// table. The five web hooks (`useScheduledExports` / `useCreate…` / `useUpdate…` / `useDelete…` /
// `useRunScheduledExportNow`) are bound through the shared [ScheduledExportsPanelViewModel] (P1/S8) over the shared
// ExportsStore/Repository, and every cross-cutting derivation (the form ⇄ wire mapping, validation, the type/delivery
// labels, the ISO-instant parse, the run-status classification) is reused from the shared
// [io.teslasync.android.featureviews.scheduledexportspanel] model rather than re-derived here. No field on this
// surface is unit-bearing (cron strings, delivery kinds, ISO stamps), so there is no SI conversion at the render
// boundary (S5); the surface is never live, so there is no SSE/staleness lifecycle beyond the feed's own freshness
// chip. Mutation failures surface the shared localized server-error toast (the web hooks' global error toast); success
// feedback is the form closing + the list refreshing + the per-row run-now spinner, exactly as the web does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located registration + content + section composables.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.scheduledexports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
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
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.scheduledexportspanel.ScheduledExportForm
import io.teslasync.android.featureviews.scheduledexportspanel.ScheduledExportToast
import io.teslasync.android.featureviews.scheduledexportspanel.ScheduledExportsPanelSource
import io.teslasync.android.featureviews.scheduledexportspanel.ScheduledExportsPanelViewModel
import io.teslasync.android.featureviews.scheduledexportspanel.ScheduledRunStatus
import io.teslasync.android.featureviews.scheduledexportspanel.SCHEDULED_DELIVERY_KINDS
import io.teslasync.android.featureviews.scheduledexportspanel.SCHEDULED_EXPORT_FORMATS
import io.teslasync.android.featureviews.scheduledexportspanel.SCHEDULED_EXPORT_TYPES
import io.teslasync.android.featureviews.scheduledexportspanel.deliveryLabel
import io.teslasync.android.featureviews.scheduledexportspanel.deliveryNeedsTarget
import io.teslasync.android.featureviews.scheduledexportspanel.emptyScheduledExportForm
import io.teslasync.android.featureviews.scheduledexportspanel.parseInstantMillis
import io.teslasync.android.featureviews.scheduledexportspanel.scheduledExportFormFrom
import io.teslasync.android.featureviews.scheduledexportspanel.scheduledRunStatus
import io.teslasync.android.featureviews.scheduledexportspanel.typeFormatLabel
import io.teslasync.android.featureviews.scheduledexportspanel.validateScheduledExportForm
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val DISABLED_ROW_ALPHA = 0.6f
private const val EM_DASH = "\u2014"
private const val DELIVERY_EMAIL = "email"
private val ROW_SKELETON_HEIGHT = 92.dp

private val RUN_TIME_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())

/**
 * Canonical metadata for the ScheduledExportsPanel system surface. The web page is UNROUTED (it is mounted inside the
 * /data-export surface, so there is no `web/src/App.tsx` route and no [io.teslasync.android.navigation.Destinations]
 * row); the host instead wires it as an explicit standalone Navigation-Compose destination keyed by [ROUTE_ID],
 * resolved through [io.teslasync.android.navigation.PageHosts] — the same precedent the sibling DiagnosticPage uses.
 * The diagnostics [SLUG] matches the shared view-model's own slug so the one-shot `view.opened` event it emits
 * (P1/S11) carries the same surface identity.
 */
object ScheduledExportsPanelPageRegistration {
    /** The Navigation-Compose destination id the host registers; the web surface is unrouted, so this is its slug. */
    const val ROUTE_ID: String = "ScheduledExportsPanel"

    /** Diagnostics surface slug (P1/S11); matches the shared view-model's slug so `view.opened` agrees. */
    const val SLUG: String = "ScheduledExportsPanel"
}

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the lifecycle-scoped [ScheduledExportsPanelViewModel] over the host-wired [source] (the
 * host binds the shared ExportsStore/Repository via [io.teslasync.android.featureviews.scheduledexportspanel.scheduledExportsPanelSource]),
 * keyed by the surface slug so it survives configuration changes. [logger] defaults to the app's redacting logger.
 */
@Composable
fun ScheduledExportsPanelPage(
    source: ScheduledExportsPanelSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ScheduledExportsPanelViewModel =
        viewModel(
            key = ScheduledExportsPanelPageRegistration.SLUG,
            factory = ScheduledExportsPanelViewModel.factory(source, logger),
        )
    ScheduledExportsPanelPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot PII-safe `view.opened` diagnostic (P1/S11), collects the schedules feed + the
 * per-row run-now id, owns the inline create/edit form state + the delete confirmation + the toast queue, threads the
 * accessibility pane title (web `usePageTitle(t('dataExport.scheduled.title'))`), and provides the page scroll +
 * padding the embedded panel needs. The view performs no HTTP; every mutation routes through the [viewModel].
 */
@Composable
fun ScheduledExportsPanelPage(
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

    val title = stringResource(R.string.translation_dataExport_scheduled_title)

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg)
                    .semantics { paneTitle = title },
        ) {
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
        }

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

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless surface body — GlassPanel1 (web the single panel wrapping the whole page) holding the header, the
 * optional inline form, and the list area. Every lifecycle branch the schedules feed can carry is rendered: a loading
 * skeleton, a hard-error retry surface, the no-schedules empty state, and the populated rows with their freshness
 * chip; a stale (non-error) feed auto-refreshes (the freshness contract).
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

/** The panel header — title + subtitle (web `<h2>` + `<p>`) and the "New schedule" action (web primary button). */
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

/** The inline create/edit form (web `<form>`): the minimal fields the web exposes, server-validated on submit. */
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
                hint = stringResource(R.string.translation_dataExport_scheduled_form_namePlaceholder), // parity:allow i18n key id contains the substring "Placeholder"
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
                    keyboardType = if (form.deliveryKind == DELIVERY_EMAIL) KeyboardType.Email else KeyboardType.Uri,
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

/** The form's Cancel + Save row (web `<Button variant="ghost">` + `<Button type="submit">`). */
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

/** The Save button label — the persisting label while a write is in flight, else the localized "Save schedule". */
@Composable
private fun scheduledSaveLabel(saving: Boolean): String =
    if (saving) {
        stringResource(R.string.translation_common_saving)
    } else {
        stringResource(R.string.translation_dataExport_scheduled_form_submit)
    }

// ── List area (the three declared data states) ─────────────────────────────────────────────────────────────

/** The schedules list — the loading / error / empty / populated branches of the bound cache-then-network feed. */
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
                    ScheduledExportCard(
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

/** The `loading` data state — three row-height skeletons (web `[1,2,3].map(<Skeleton/>)`). */
@Composable
private fun ScheduledExportsLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(3) { Skeleton(modifier = Modifier.fillMaxWidth(), height = ROW_SKELETON_HEIGHT) }
    }
}

/** The error data state — a retry surface keeping the panel non-blank on a hard read failure. */
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

/** The `empty` data state — web `rows.length === 0` → `<EmptyState />` with the "New schedule" affordance. */
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

/** The freshness chip shown over stale / refreshing / last-known-good rows (the feed's freshness contract). */
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

// ── Row card (the `success` data state) ────────────────────────────────────────────────────────────────────

/**
 * One schedule rendered as a card — the mobile-first analogue of a web table row. Every web table column header is
 * surfaced as a field label so all eight resolve from the catalog: `table.name` labels the name (web `<th>Name`),
 * the six meta rows label type/cron/delivery/next-run/last-run/status, and `table.actions` labels the action group
 * (web `<th>Actions`). A disabled schedule is dimmed (web `opacity-50`).
 */
@Composable
private fun ScheduledExportCard(
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
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_dataExport_scheduled_table_name))
                PanelTitle(row.name)
            }
            ScheduledExportCardMeta(row)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_dataExport_scheduled_table_actions))
                ScheduledExportCardActions(
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
}

/** The card's meta rows — the six web middle columns (type, cron, delivery, next run, last run, status). */
@Composable
private fun ScheduledExportCardMeta(row: ScheduledExport) {
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

/** One label/value meta row inside a schedule card. */
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

/** The run-status badge — web `last_status === 'ok' ? OK : 'failed' ? Failed : '—'`. */
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

/** The per-row action group — Run now / Enable-Disable / Edit / Delete (web row action buttons). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ScheduledExportCardActions(
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

/** The toggle action label — web `row.enabled ? 'Disable' : 'Enable'`. */
@Composable
private fun scheduledToggleLabel(enabled: Boolean): String =
    if (enabled) {
        stringResource(R.string.translation_dataExport_scheduled_actions_disable)
    } else {
        stringResource(R.string.translation_dataExport_scheduled_actions_enable)
    }

/** The next-run cell — the formatted instant, or the em-dash fallback (web `<TimeStamp/>` ?: '—'). */
@Composable
private fun nextRunLabel(iso: String?): String = parseInstantMillis(iso)?.let(::formatRunTimestamp) ?: EM_DASH

/** The last-run cell — the formatted instant, or the localized "Never" (web `<TimeStamp/>` ?: status.never). */
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
