// The native Jetpack Compose + Material 3 AlertRulesPage surface — a parity port of
// web/src/features/notifications/pages/AlertRulesPage.tsx, the streamlined "manage many at once" alert-rule list.
// It reproduces the page header (title + subtitle), the edit-conflict banner (web `useEditLease('alert-rules/
// list')` + `EditConflictBanner`), the bulk-action toolbar (enable / disable / delete-with-confirm over the
// selected rows), the single GlassPanel1 rules table (master select-all + per-row select, the inline-rename name
// cell, the signal name, the severity chip, and the enabled/disabled status badge), every data state (loading
// skeleton / empty-with-CTA / error-retry / success, plus the cache-then-network stale tier the bound state
// holder carries), the "Open Alert Studio" footer affordance, and every visible string (resolved from the
// generated res/values catalog, ADR-014).
//
// Composition: [AlertRulesPage] is the stateful entry (constructs the view-model over the host-wired source,
// resolves the Studio deep-link navigation, records the one-shot `view.opened` diagnostic, collects the rules
// feed + the selection snapshot + the mutation-busy flag); [AlertRulesPageContent] is the stateless render layer.
// No SI conversion happens here — the Notifications domain carries no unit-bearing fields.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the
// parity-complete surface.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.notifications.alertrules

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.BulkAction
import io.teslasync.android.components.datadisplay.BulkActionToolbar
import io.teslasync.android.components.datadisplay.SeverityBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.EditableText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destinations
import io.teslasync.android.navigation.RouteTable
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.sharedsurfaces.editconflictbanner.EditConflictBanner
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule

/** Column weights for the rules table — the relative widths of name / signal / severity / status (web `<table>`). */
private const val NAME_WEIGHT = 2.4f
private const val SIGNAL_WEIGHT = 1.6f
private const val SEVERITY_WEIGHT = 1.2f
private const val STATUS_WEIGHT = 1.2f

/** The loading-skeleton bar height — the web `Skeleton className="h-10"` (40 dp). */
private val SKELETON_BAR_HEIGHT = 40.dp

/** Number of skeleton rows shown while the rules feed first loads (web renders three `h-10` bars). */
private const val SKELETON_ROWS = 3

/** The page's interaction callbacks, wired to the [AlertRulesPageViewModel] (web event handlers). */
data class AlertRulesActions(
    val onToggleSelected: (Long, Boolean) -> Unit,
    val onToggleAll: (List<Long>) -> Unit,
    val onClearSelection: () -> Unit,
    val onRetainSelection: (Set<Long>) -> Unit,
    val onBulkEnable: () -> Unit,
    val onBulkDisable: () -> Unit,
    val onBulkDelete: () -> Unit,
    val onRename: (Long, String) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AlertRulesPageViewModel] over the supplied [source] (the host wires the shared
 * notifications repository via [alertRulesPageSourceOf]) and resolves the "Open Alert Studio" navigation through
 * the ambient [LocalDeepLinkRouter] + the [Destinations] registry — the sanctioned cross-route seam for page
 * hosts (web `<Link to="/notifications/studio">`). [logger] defaults to the app's redacting logger.
 */
@Composable
fun AlertRulesPage(
    source: AlertRulesPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: AlertRulesPageViewModel =
        viewModel(
            key = AlertRulesPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AlertRulesPageViewModel(source, logger) } },
        )

    val router = LocalDeepLinkRouter.current
    val studioPath = remember { Destinations.find(AlertRulesPageRegistration.STUDIO_ROUTE_ID)?.webPath }
    val onOpenStudio: () -> Unit =
        remember(router, studioPath) {
            { studioPath?.let { path -> router?.request("${RouteTable.APP_SCHEME}://app$path") } ?: Unit }
        }

    AlertRulesPage(viewModel = vm, onOpenStudio = onOpenStudio, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] rules feed + selection snapshot + busy flag to the stateless content. */
@Composable
fun AlertRulesPage(
    viewModel: AlertRulesPageViewModel,
    onOpenStudio: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val rulesState by viewModel.rulesState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val mutating by viewModel.mutating.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            AlertRulesActions(
                onToggleSelected = viewModel::toggleSelected,
                onToggleAll = viewModel::toggleAll,
                onClearSelection = viewModel::clearSelection,
                onRetainSelection = viewModel::retainSelection,
                onBulkEnable = viewModel::bulkEnable,
                onBulkDisable = viewModel::bulkDisable,
                onBulkDelete = viewModel::bulkDelete,
                onRename = viewModel::renameRule,
                onRetry = viewModel::retry,
            )
        }

    AlertRulesPageContent(
        rulesState = rulesState,
        interaction = interaction,
        mutating = mutating,
        actions = actions,
        onOpenStudio = onOpenStudio,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body — the header, the edit-conflict banner, the bulk toolbar (with the delete-confirm
 * dialog), the GlassPanel1 rules table (which renders the loading / empty / error / success surfaces inline so no
 * region ever blanks), and the "Open Alert Studio" footer. The selection is pruned to the visible rows whenever
 * the rules change (web `useBulkSelection` clamps to the visible set).
 */
@Composable
fun AlertRulesPageContent(
    rulesState: UiState<List<AlertRule>>,
    interaction: AlertRulesInteraction,
    mutating: Boolean,
    actions: AlertRulesActions,
    onOpenStudio: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rules = rulesState.data.orEmpty()
    val visibleIds = remember(rules) { visibleRuleIds(rules) }
    val title = stringResource(R.string.translation_alertRules_title)

    LaunchedEffect(visibleIds) { actions.onRetainSelection(visibleIds.toSet()) }

    var showDeleteConfirm by remember { mutableStateOf(false) }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg)
                .semantics { paneTitle = title },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        AlertRulesHeader()

        FadeIn {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                EditConflictBanner(
                    resourceKey = AlertRulesPageRegistration.EDIT_LEASE_KEY,
                    resourceLabel = stringResource(R.string.translation_editConflict_resource_alertRules),
                )

                AlertRulesToolbar(
                    selectedCount = interaction.selectedIds.size,
                    total = visibleIds.size,
                    mutating = mutating,
                    onClear = actions.onClearSelection,
                    onEnable = actions.onBulkEnable,
                    onDisable = actions.onBulkDisable,
                    onDelete = { showDeleteConfirm = true },
                )

                AlertRulesPanel(
                    rulesState = rulesState,
                    interaction = interaction,
                    actions = actions,
                    onOpenStudio = onOpenStudio,
                )

                AlertRulesFooter(onOpenStudio = onOpenStudio)
            }
        }
    }

    if (showDeleteConfirm) {
        ConfirmDialog(
            title = stringResource(R.string.translation_alertRules_bulk_deleteConfirm_title),
            message = stringResource(R.string.translation_alertRules_bulk_deleteConfirm_body),
            confirmLabel = stringResource(R.string.translation_common_delete),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            onConfirm = {
                showDeleteConfirm = false
                actions.onBulkDelete()
            },
            onCancel = { showDeleteConfirm = false },
            severity = ConfirmSeverity.Danger,
            loading = mutating,
            closeLabel = stringResource(R.string.translation_common_close),
        )
    }
}

/** The page header — the `<h1>` title + the muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun AlertRulesHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_alertRules_title))
        BodyText(
            stringResource(R.string.translation_alertRules_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The bulk-action toolbar above the table (web `BulkActionToolbar`). Renders nothing until a row is selected; the
 * count pill pluralizes via the `alertRules.noun.*` keys, and the three actions (enable / disable / delete) drive
 * the view-model mutations — delete first raising the confirm dialog owned by the page.
 */
@Composable
private fun AlertRulesToolbar(
    selectedCount: Int,
    total: Int,
    mutating: Boolean,
    onClear: () -> Unit,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
    onDelete: () -> Unit,
) {
    val nounOne = stringResource(R.string.translation_alertRules_noun_one)
    val nounOther = stringResource(R.string.translation_alertRules_noun_other)
    BulkActionToolbar(
        selectedCount = selectedCount,
        total = total,
        onClear = onClear,
        clearLabel = stringResource(R.string.translation_bulk_clear),
        countText = { count -> "$count ${if (count == 1) nounOne else nounOther}" },
        actions =
            listOf(
                BulkAction(
                    id = "enable",
                    label = stringResource(R.string.translation_alertRules_bulk_enable),
                    onClick = onEnable,
                    enabled = !mutating,
                    loading = mutating,
                ),
                BulkAction(
                    id = "disable",
                    label = stringResource(R.string.translation_alertRules_bulk_disable),
                    onClick = onDisable,
                    enabled = !mutating,
                    loading = mutating,
                ),
                BulkAction(
                    id = "delete",
                    label = stringResource(R.string.translation_alertRules_bulk_delete),
                    onClick = onDelete,
                    danger = true,
                    enabled = !mutating,
                    loading = mutating,
                ),
            ),
    )
}

/**
 * GlassPanel1 — the rules table panel (web `GlassPanel className="overflow-hidden"`). Switches the four
 * mutually-exclusive data surfaces off the bound [rulesState]: the loading skeleton, the hard-error retry surface,
 * the empty state (with the Open-Studio CTA), or the rules table — so the panel is never a blank box.
 */
@Composable
private fun AlertRulesPanel(
    rulesState: UiState<List<AlertRule>>,
    interaction: AlertRulesInteraction,
    actions: AlertRulesActions,
    onOpenStudio: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
        when {
            rulesState.isLoading -> AlertRulesLoading()
            rulesState.isError -> AlertRulesError(onRetry = actions.onRetry)
            rulesState.isEmpty -> AlertRulesEmpty(onOpenStudio = onOpenStudio)
            else -> AlertRulesTable(rules = rulesState.data.orEmpty(), interaction = interaction, actions = actions)
        }
    }
}

/** The loading surface — three shimmering rows (web's three `Skeleton h-10` bars). */
@Composable
private fun AlertRulesLoading() {
    Column(
        modifier = Modifier.padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) { Skeleton(height = SKELETON_BAR_HEIGHT) }
    }
}

/** The hard-error surface for the rules feed (no cached fallback) — a retry-able error panel (web `ErrorDisplay`). */
@Composable
private fun AlertRulesError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The empty surface — the no-rules-yet state with the "Open Alert Studio" CTA (web `EmptyState`). */
@Composable
private fun AlertRulesEmpty(onOpenStudio: () -> Unit) {
    EmptyState(
        title = stringResource(R.string.translation_alertRules_empty_title),
        message = stringResource(R.string.translation_alertRules_empty_body),
        action = EmptyStateAction(stringResource(R.string.translation_alertRules_empty_cta), onOpenStudio),
    )
}

// ── The rules table ─────────────────────────────────────────────────────────────────────────────────────────

/** The loaded table — the column header row + one row per rule, divided by hairlines (web `<table>` body). */
@Composable
private fun AlertRulesTable(
    rules: List<AlertRule>,
    interaction: AlertRulesInteraction,
    actions: AlertRulesActions,
) {
    val visibleIds = remember(rules) { visibleRuleIds(rules) }
    Column(modifier = Modifier.fillMaxWidth()) {
        AlertRulesTableHeader(
            masterState = interaction.masterState(visibleIds),
            onMasterToggle = { actions.onToggleAll(visibleIds) },
        )
        rules.forEach { rule ->
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            AlertRulesRow(
                rule = rule,
                selected = interaction.isSelected(rule.id),
                onToggle = { on -> actions.onToggleSelected(rule.id, on) },
                onRename = { name -> actions.onRename(rule.id, name) },
            )
        }
    }
}

/** The table header — the master select-all checkbox + the four localized column labels (web `<thead>`). */
@Composable
private fun AlertRulesTableHeader(
    masterState: MasterSelection,
    onMasterToggle: () -> Unit,
) {
    val selectAll = stringResource(R.string.translation_bulk_selectAll)
    val toggleState =
        when (masterState) {
            MasterSelection.All -> ToggleableState.On
            MasterSelection.Some -> ToggleableState.Indeterminate
            MasterSelection.None -> ToggleableState.Off
        }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        TriStateCheckbox(
            state = toggleState,
            onClick = onMasterToggle,
            modifier = Modifier.semantics { contentDescription = selectAll },
        )
        Caption(stringResource(R.string.translation_alertRules_col_name), modifier = Modifier.weight(NAME_WEIGHT))
        Caption(stringResource(R.string.translation_alertRules_col_signal), modifier = Modifier.weight(SIGNAL_WEIGHT))
        Caption(stringResource(R.string.translation_alertRules_col_severity), modifier = Modifier.weight(SEVERITY_WEIGHT))
        Caption(stringResource(R.string.translation_alertRules_col_status), modifier = Modifier.weight(STATUS_WEIGHT))
    }
}

/**
 * One rule row — the per-row select checkbox, the inline-rename name cell (web `EditableText` with the 120-char
 * guard + the `alertRules.error.nameTooLong` message), the signal name, the severity chip, and the
 * enabled/disabled status badge (web `Badge` success/neutral).
 */
@Composable
private fun AlertRulesRow(
    rule: AlertRule,
    selected: Boolean,
    onToggle: (Boolean) -> Unit,
    onRename: (String) -> Unit,
) {
    val rowSelectLabel =
        if (rule.name.isBlank()) {
            stringResource(R.string.translation_bulk_selectRow)
        } else {
            stringResource(R.string.translation_alertRules_selectRule, rule.name)
        }
    val renameLabel = stringResource(R.string.translation_editableText_rename_alertRule, rule.name)
    val tooLongMessage = stringResource(R.string.translation_alertRules_error_nameTooLong)

    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Checkbox(
            checked = selected,
            onCheckedChange = onToggle,
            modifier = Modifier.semantics { contentDescription = rowSelectLabel },
        )
        Box(modifier = Modifier.weight(NAME_WEIGHT)) {
            EditableText(
                value = rule.name,
                onSave = onRename,
                editActionLabel = renameLabel,
                saveLabel = stringResource(R.string.translation_common_save),
                cancelLabel = stringResource(R.string.translation_common_cancel),
                validate = { next -> validateRuleName(next, tooLongMessage) },
            )
        }
        BodyText(
            rule.signalName,
            modifier = Modifier.weight(SIGNAL_WEIGHT),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        Box(modifier = Modifier.weight(SEVERITY_WEIGHT)) {
            SeverityBadge(severity = rule.severity)
        }
        Box(modifier = Modifier.weight(STATUS_WEIGHT)) {
            AlertRuleStatusBadge(enabled = rule.enabled)
        }
    }
}

/** The enabled/disabled status badge (web `Badge variant="success" | "neutral"`). */
@Composable
private fun AlertRuleStatusBadge(enabled: Boolean) {
    if (enabled) {
        Badge(stringResource(R.string.translation_common_enabled), variant = BadgeVariant.Success)
    } else {
        Badge(stringResource(R.string.translation_common_disabled), variant = BadgeVariant.Neutral)
    }
}

/** The footer affordance — the right-aligned "Open Alert Studio" button (web bottom `<Link to="/notifications/studio">`). */
@Composable
private fun AlertRulesFooter(onOpenStudio: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        Button(
            label = stringResource(R.string.translation_alertRules_openStudio),
            onClick = onOpenStudio,
            variant = ButtonVariant.Secondary,
            leadingIcon = TeslaGlyphs.Plus,
        )
    }
}
