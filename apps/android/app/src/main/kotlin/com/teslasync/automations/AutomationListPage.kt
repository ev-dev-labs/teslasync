// The native Jetpack Compose + Material 3 AutomationListPage surface — a parity port of
// web/src/features/automations/pages/AutomationListPage.tsx, the focused bulk-manage list of every automation.
// It reproduces the page's single panel (GlassPanel1 — the automations table with its master + per-row
// selection checkboxes and the name / description / runs / status columns), the bulk-action toolbar (web
// BulkActionToolbar: enable / disable / delete, with delete gated behind a confirmation dialog), every data
// state (loading / empty / error / success), and every visible string (resolved from the generated res/values
// catalog, ADR-014).
//
// Composition: [AutomationListPage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the list feed + selection + bulk-pending
// snapshots); [AutomationListPageContent] is the stateless render layer driven entirely by [UiState] + the
// selection set + the in-flight [AutomationBulkOp] + [AutomationListActions]. All derivation lives in the
// framework-free model (AutomationListPageModel.kt); this file only resolves i18n + draws. No column is
// unit-bearing (a name, a description, an execution count, an enabled flag), so there is no SI conversion —
// locale number formatting is applied here at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations)
// diverges from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations.list

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.SectionErrorBoundary
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
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
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.DataTableBulkBar
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationBulkOp
import java.text.NumberFormat
import java.util.Locale

/** Stagger between the body sections' entrance fades (web `FadeIn`). */
private const val FADE_STEP_MS = 40

/** HTTP status the API returns when the caller's session has expired / lacks RBAC (web 401 / 403). */
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403

/** First server-error status — the web `status >= 500` branch. */
private const val HTTP_SERVER_ERROR = 500

/** Width of the leading selection-checkbox column. */
private val CHECKBOX_COL_WIDTH: Dp = 48.dp

/** Width of the name column (the link cell). */
private val NAME_COL_WIDTH: Dp = 168.dp

/** Width of the description column. */
private val DESC_COL_WIDTH: Dp = 200.dp

/** Width of the runs (execution-count) column. */
private val RUNS_COL_WIDTH: Dp = 80.dp

/** Width of the status column (the enabled / disabled badge). */
private val STATUS_COL_WIDTH: Dp = 116.dp

/** Full intrinsic width of the table — the horizontal-scroll content width. */
private val TABLE_WIDTH: Dp =
    CHECKBOX_COL_WIDTH + NAME_COL_WIDTH + DESC_COL_WIDTH + RUNS_COL_WIDTH + STATUS_COL_WIDTH

/** Number of skeleton rows in the first-load shimmer (web renders three skeleton bars). */
private const val SKELETON_ROWS = 3

/** The page's interaction callbacks, wired to the [AutomationListPageViewModel] (web event handlers). */
data class AutomationListActions(
    val onToggle: (Long) -> Unit,
    val onToggleAll: (List<Long>) -> Unit,
    val onClear: () -> Unit,
    val onBulk: (AutomationBulkOp) -> Unit,
    val onOpenAutomation: (Long) -> Unit = {},
    val onOpenBuilder: () -> Unit = {},
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AutomationListPageViewModel] over the supplied [source] (the host wires the
 * shared Automations holder via [asAutomationListSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun AutomationListPage(
    source: AutomationListSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: AutomationListPageViewModel =
        viewModel(
            key = AutomationListPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AutomationListPageViewModel(source, logger) } },
        )
    AutomationListPage(viewModel = vm, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic and binds the list feed + selection +
 * bulk-pending snapshots to the stateless content.
 */
@Composable
fun AutomationListPage(
    viewModel: AutomationListPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val selectedIds by viewModel.selectedIds.collectAsStateWithLifecycle()
    val bulkPending by viewModel.bulkPending.collectAsStateWithLifecycle()
    val actions =
        remember(viewModel) {
            AutomationListActions(
                onToggle = viewModel::toggle,
                onToggleAll = viewModel::toggleAll,
                onClear = viewModel::clearSelection,
                onBulk = viewModel::runBulk,
            )
        }

    AutomationListPageContent(
        state = state,
        selectedIds = selectedIds,
        bulkPending = bulkPending,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header, the bulk-action toolbar (shown once a selection exists),
 * then the single panel — the automations table with its loading / error / empty / success surface. The
 * destructive delete action is routed through a confirmation dialog (web `BulkActionToolbar` `confirm`).
 */
@Composable
fun AutomationListPageContent(
    state: UiState<List<Automation>>,
    selectedIds: Set<Long>,
    bulkPending: AutomationBulkOp?,
    actions: AutomationListActions,
    modifier: Modifier = Modifier,
) {
    val rows = state.data.orEmpty()
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val numberFormat = remember(locale) { NumberFormat.getIntegerInstance(locale) }
    var deleteConfirmOpen by remember { mutableStateOf(false) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        AutomationListHeader()

        FadeIn(delayMs = FADE_STEP_MS) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                AutomationListBulkToolbar(
                    rows = rows,
                    selectedIds = selectedIds,
                    bulkPending = bulkPending,
                    actions = actions,
                    onDeleteRequest = { deleteConfirmOpen = true },
                )
                AutomationListPanel(
                    state = state,
                    selectedIds = selectedIds,
                    actions = actions,
                    numberFormat = numberFormat,
                )
            }
        }
    }

    if (deleteConfirmOpen) {
        ConfirmDialog(
            title = stringResource(R.string.translation_automationList_bulk_deleteConfirm_title),
            message = stringResource(R.string.translation_automationList_bulk_deleteConfirm_body),
            confirmLabel = stringResource(R.string.translation_common_delete),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            closeLabel = stringResource(R.string.translation_common_close),
            severity = ConfirmSeverity.Danger,
            loading = bulkPending == AutomationBulkOp.DELETE,
            onConfirm = {
                actions.onBulk(AutomationBulkOp.DELETE)
                deleteConfirmOpen = false
            },
            onCancel = { deleteConfirmOpen = false },
        )
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun AutomationListHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_automationList_title))
        BodyText(
            stringResource(R.string.translation_automationList_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Bulk-action toolbar (web BulkActionToolbar) ───────────────────────────────────────────────────────────────

/**
 * The selection toolbar shown above the table once at least one row is selected (web `BulkActionToolbar`): the
 * live "{n} selected {noun} of {total}" label, the enable / disable / delete actions (each with its in-flight
 * spinner), and a clear-selection control. Renders nothing while the selection is empty (the shared
 * [DataTableBulkBar] self-hides at count 0).
 */
@Composable
private fun AutomationListBulkToolbar(
    rows: List<Automation>,
    selectedIds: Set<Long>,
    bulkPending: AutomationBulkOp?,
    actions: AutomationListActions,
    onDeleteRequest: () -> Unit,
) {
    val count = selectedIds.size
    val noun =
        if (count == 1) {
            stringResource(R.string.translation_automationList_noun_one)
        } else {
            stringResource(R.string.translation_automationList_noun_other)
        }
    val selectedLabel = pluralStringResource(R.plurals.translation_bulk_selected, count, count)
    val ofTotal = stringResource(R.string.translation_bulk_ofTotal, rows.size)
    val toolbarLabel = stringResource(R.string.translation_bulk_toolbarLabel)
    val running = bulkPending != null

    // Mirrors the web action's optional `confirm` payload: a destructive op routes through the confirmation
    // dialog first, an immediate op applies straight away (web `actions: [enable, disable, delete{ confirm }]`).
    val onAction: (AutomationBulkOp) -> Unit = { op ->
        if (op.requiresConfirmation) onDeleteRequest() else actions.onBulk(op)
    }

    DataTableBulkBar(
        count = count,
        onClear = actions.onClear,
        selectedText = { "$selectedLabel $noun $ofTotal" },
        clearLabel = stringResource(R.string.translation_bulk_clear),
        modifier = Modifier.semantics { contentDescription = toolbarLabel },
    ) {
        Button(
            label = stringResource(R.string.translation_automationList_bulk_enable),
            onClick = { onAction(AutomationBulkOp.ENABLE) },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            enabled = !running,
            loading = bulkPending == AutomationBulkOp.ENABLE,
            leadingIcon = AutomationListGlyphs.Play,
        )
        Button(
            label = stringResource(R.string.translation_automationList_bulk_disable),
            onClick = { onAction(AutomationBulkOp.DISABLE) },
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            enabled = !running,
            loading = bulkPending == AutomationBulkOp.DISABLE,
            leadingIcon = AutomationListGlyphs.Pause,
        )
        Button(
            label = stringResource(R.string.translation_automationList_bulk_delete),
            onClick = { onAction(AutomationBulkOp.DELETE) },
            variant = ButtonVariant.Danger,
            size = ButtonSize.Sm,
            enabled = !running,
            loading = bulkPending == AutomationBulkOp.DELETE,
            leadingIcon = AutomationListGlyphs.Trash,
        )
    }
}

// ── GlassPanel1 — the automations table ───────────────────────────────────────────────────────────────────────

/**
 * The single panel (web `<GlassPanel className="overflow-hidden">`): the automations table surface that
 * switches across loading / hard-error / empty / content. Wrapped in a [SectionErrorBoundary] so a render fault
 * degrades to an inline error rather than tearing down the page.
 */
@Composable
private fun AutomationListPanel(
    state: UiState<List<Automation>>,
    selectedIds: Set<Long>,
    actions: AutomationListActions,
    numberFormat: NumberFormat,
) {
    val rows = state.data.orEmpty()
    GlassPanel(padding = PanelPadding.None) {
        val boundary = rememberErrorBoundaryState()
        SectionErrorBoundary(state = boundary) {
            when {
                state.isLoading -> AutomationListLoadingState()
                state.isError -> AutomationListErrorState(state)
                state.isEmpty -> AutomationListEmptyState(onOpenBuilder = actions.onOpenBuilder)
                else ->
                    AutomationListTable(
                        rows = rows,
                        selectedIds = selectedIds,
                        actions = actions,
                        numberFormat = numberFormat,
                    )
            }
        }
    }
}

/** The scrolling automations table — the master-select header plus one row per automation (web `<table>`). */
@Composable
private fun AutomationListTable(
    rows: List<Automation>,
    selectedIds: Set<Long>,
    actions: AutomationListActions,
    numberFormat: NumberFormat,
) {
    val visibleIds = remember(rows) { rows.map { it.id } }
    val master = masterSelection(selectedIds, visibleIds)

    Column(modifier = Modifier.horizontalScroll(rememberScrollState())) {
        AutomationListTableHeader(master = master, onToggleAll = { actions.onToggleAll(visibleIds) })
        HorizontalDivider(modifier = Modifier.width(TABLE_WIDTH), color = MaterialTheme.colorScheme.outlineVariant)
        rows.forEachIndexed { index, automation ->
            if (index > 0) {
                HorizontalDivider(
                    modifier = Modifier.width(TABLE_WIDTH),
                    color = MaterialTheme.colorScheme.outlineVariant,
                )
            }
            AutomationListRow(
                automation = automation,
                checked = automation.id in selectedIds,
                onToggle = { actions.onToggle(automation.id) },
                onOpen = { actions.onOpenAutomation(automation.id) },
                numberFormat = numberFormat,
            )
        }
    }
}

/** The table header row — the master select-all checkbox plus the four localized column labels. */
@Composable
private fun AutomationListTableHeader(
    master: MasterSelection,
    onToggleAll: () -> Unit,
) {
    val selectAll = stringResource(R.string.translation_bulk_selectAll)
    Row(
        modifier = Modifier.width(TABLE_WIDTH).padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(CHECKBOX_COL_WIDTH), contentAlignment = Alignment.CenterStart) {
            TriStateCheckbox(
                state = master.toToggleableState(),
                onClick = onToggleAll,
                modifier = Modifier.semantics { contentDescription = selectAll },
            )
        }
        HeaderCell(stringResource(R.string.translation_automationList_col_name), NAME_COL_WIDTH)
        HeaderCell(stringResource(R.string.translation_automationList_col_desc), DESC_COL_WIDTH)
        HeaderCell(stringResource(R.string.translation_automationList_col_runs), RUNS_COL_WIDTH)
        HeaderCell(stringResource(R.string.translation_automationList_col_status), STATUS_COL_WIDTH)
    }
}

/** One automation row — the selection checkbox, the name link, the description, the run count, the status badge. */
@Composable
private fun AutomationListRow(
    automation: Automation,
    checked: Boolean,
    onToggle: () -> Unit,
    onOpen: () -> Unit,
    numberFormat: NumberFormat,
) {
    val rowLabel =
        if (automation.name.isNotBlank()) {
            stringResource(R.string.translation_automationList_selectAutomation, automation.name)
        } else {
            stringResource(R.string.translation_bulk_selectRow)
        }
    Row(
        modifier = Modifier.width(TABLE_WIDTH).padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(CHECKBOX_COL_WIDTH), contentAlignment = Alignment.CenterStart) {
            Checkbox(
                checked = checked,
                onCheckedChange = { onToggle() },
                modifier = Modifier.semantics { contentDescription = rowLabel },
            )
        }
        Box(modifier = Modifier.width(NAME_COL_WIDTH).padding(end = Spacing.sm)) {
            BodyText(
                automation.name,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 2,
                modifier = Modifier.clickable { onOpen() },
            )
        }
        Box(modifier = Modifier.width(DESC_COL_WIDTH).padding(end = Spacing.sm)) {
            BodyText(
                automation.descriptionOrDash(),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
            )
        }
        Box(modifier = Modifier.width(RUNS_COL_WIDTH).padding(end = Spacing.sm)) {
            BodyText(
                numberFormat.format(automation.executionCount),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        Box(modifier = Modifier.width(STATUS_COL_WIDTH), contentAlignment = Alignment.CenterStart) {
            AutomationStatusBadge(enabled = automation.enabled)
        }
    }
}

/** The enabled / disabled status chip (web `<Badge variant="success|neutral">`). */
@Composable
private fun AutomationStatusBadge(enabled: Boolean) {
    if (enabled) {
        Badge(text = stringResource(R.string.translation_common_enabled), variant = BadgeVariant.Success)
    } else {
        Badge(text = stringResource(R.string.translation_common_disabled), variant = BadgeVariant.Neutral)
    }
}

@Composable
private fun HeaderCell(
    text: String,
    width: Dp,
) {
    Box(modifier = Modifier.width(width).padding(horizontal = Spacing.xs), contentAlignment = Alignment.CenterStart) {
        Caption(text)
    }
}

// ── Data states ───────────────────────────────────────────────────────────────────────────────────────────────

/** First-load surface — a shimmering table skeleton so the region is never blank (web three `<Skeleton>` bars). */
@Composable
private fun AutomationListLoadingState() {
    TableSkeleton(
        modifier = Modifier.padding(Spacing.lg),
        rows = SKELETON_ROWS,
        columns = 4,
    )
}

/**
 * No-automations empty state (web `<EmptyState title message actionTo />`): the user has not created any
 * automation yet, with a CTA into the builder.
 */
@Composable
private fun AutomationListEmptyState(onOpenBuilder: () -> Unit) {
    EmptyState(
        message = stringResource(R.string.translation_automationList_empty_body),
        title = stringResource(R.string.translation_automationList_empty_title),
        action =
            EmptyStateAction(
                label = stringResource(R.string.translation_automationList_empty_cta),
                onClick = onOpenBuilder,
            ),
    )
}

/**
 * Hard-error surface (web `<ErrorDisplay error={error} />`): a status-aware title + message mapped from the
 * [UiState] freshness contract. No manual retry affordance is offered — the web page passes no `onRetry`, the
 * cache-then-network read auto-retries, and any bulk mutation refreshes the shared list feed on success.
 */
@Composable
private fun AutomationListErrorState(state: UiState<List<Automation>>) {
    val status = state.httpStatus
    val (titleRes, messageRes) =
        when {
            status == HTTP_UNAUTHORIZED || status == HTTP_FORBIDDEN ->
                R.string.translation_error_unauthorized_title to R.string.translation_error_unauthorized_message
            status != null && status >= HTTP_SERVER_ERROR ->
                R.string.translation_error_serverError_title to R.string.translation_error_serverError_message
            else ->
                R.string.translation_error_network_title to R.string.translation_error_network_message
        }
    ErrorDisplay(
        message = stringResource(messageRes),
        title = stringResource(titleRes),
        onRetry = null,
    )
}

/** Maps the framework-free [MasterSelection] onto the Material tri-state used by the header checkbox. */
private fun MasterSelection.toToggleableState(): ToggleableState =
    when (this) {
        MasterSelection.None -> ToggleableState.Off
        MasterSelection.Some -> ToggleableState.Indeterminate
        MasterSelection.All -> ToggleableState.On
    }
