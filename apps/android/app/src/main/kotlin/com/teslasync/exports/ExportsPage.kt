// The native Jetpack Compose + Material 3 ExportsPage system surface — a parity port of
// web/src/features/exports/pages/ExportsPage.tsx, the past-export-jobs list with bulk delete. It reproduces the
// page's header (title + subtitle), the bulk-selection toolbar (count + noun + clear + delete-with-confirm), and
// the single GlassPanel that hosts every data state: loading skeletons, the hard-error retry surface, the
// no-exports empty state, and the selectable job table (Type / Format / Size / Created / Status / Download). Every
// visible string resolves from the generated res/values catalog (ADR-014); file sizes + timestamps are formatted
// only here at the render boundary (the framework-free model's formatExportBytes / formatExportDateTime).
//
// Composition: [ExportsPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the jobs feed + the bulk-selection snapshot); [ExportsPageContent]
// is the stateless render layer. The single `useExportJobs` feed + the selection are projected onto the panels
// exactly as the web page threads its `jobs` array + `useBulkSelection` through the table. The download link is the
// browser-facing `exportDownloadUrl(jobId)` (shared-core helper) prefixed with the API origin, opened via the
// platform URI handler — the native analogue of the web `<a href download>`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/exports) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete
// table set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.exports.exports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.BulkAction
import io.teslasync.android.components.datadisplay.BulkActionToolbar
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.exportDownloadUrl
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import java.time.ZoneId
import java.util.Locale

/** The page's interaction callbacks, wired to the [ExportsPageViewModel] (web event handlers). */
data class ExportsActions(
    val onToggleSelected: (String, Boolean) -> Unit,
    val onToggleMaster: (List<String>) -> Unit,
    val onClearSelection: () -> Unit,
    val onRetainSelection: (Set<String>) -> Unit,
    val onDeleteSelected: () -> Unit,
    val onRetry: () -> Unit,
)

// Fixed width of the leading select-column cell (fits the ≥48 dp checkbox touch target).
private val CHECKBOX_COL = 48.dp

// Weighted widths of the data columns (web table column proportions).
private const val TYPE_W = 1.4f
private const val FORMAT_W = 1.0f
private const val SIZE_W = 1.0f
private const val CREATED_W = 1.9f
private const val STATUS_W = 1.2f
private const val DOWNLOAD_W = 1.1f

private const val LOADING_ROWS = 3
private val LOADING_ROW_HEIGHT = 40.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ExportsPageViewModel] over the supplied [source] (the host wires the shared
 * exports repository via [exportsPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun ExportsPage(
    source: ExportsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ExportsPageViewModel =
        viewModel(
            key = ExportsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { ExportsPageViewModel(source, logger) } },
        )
    ExportsPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] jobs feed + bulk-selection snapshot to the content. */
@Composable
fun ExportsPage(
    viewModel: ExportsPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val exportsState by viewModel.exportsState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val deleting by viewModel.deleting.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            ExportsActions(
                onToggleSelected = viewModel::toggleSelected,
                onToggleMaster = viewModel::toggleMaster,
                onClearSelection = viewModel::clearSelection,
                onRetainSelection = viewModel::retainSelection,
                onDeleteSelected = viewModel::deleteSelected,
                onRetry = viewModel::retry,
            )
        }

    ExportsPageContent(
        exportsState = exportsState,
        selectedIds = interaction.selectedIds,
        deleting = deleting,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. The header (title + subtitle + freshness) is always drawn; the bulk toolbar renders
 * itself only when a selection exists; and the single GlassPanel hosts every data state inline (loading skeleton
 * / hard-error retry / no-exports empty / the selectable job table) so no region ever blanks.
 */
@Composable
fun ExportsPageContent(
    exportsState: UiState<List<ExportJobSummary>>,
    selectedIds: Set<String>,
    deleting: Boolean,
    actions: ExportsActions,
    modifier: Modifier = Modifier,
) {
    val jobs = exportsState.data.orEmpty()
    val visibleIds = remember(jobs) { jobs.map { it.id } }

    // Prune the bulk selection to the visible set (web `useBulkSelection` self-healing).
    LaunchedEffect(visibleIds) { actions.onRetainSelection(visibleIds.toSet()) }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        ExportsHeader(exportsState = exportsState)

        FadeIn {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                ExportsBulkToolbar(
                    selectedIds = selectedIds,
                    total = visibleIds.size,
                    deleting = deleting,
                    actions = actions,
                )

                GlassPanel(padding = PanelPadding.None) {
                    when {
                        exportsState.isLoading -> ExportsLoadingRows()
                        exportsState.isError -> ExportsError(onRetry = actions.onRetry)
                        jobs.isEmpty() -> ExportsEmpty()
                        else ->
                            ExportsTable(
                                jobs = jobs,
                                selectedIds = selectedIds,
                                visibleIds = visibleIds,
                                actions = actions,
                            )
                    }
                }
            }
        }
    }
}

/** The page header — the title + muted subtitle + the query-freshness chip (web `PageContainer`). */
@Composable
private fun ExportsHeader(exportsState: UiState<List<ExportJobSummary>>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_exportsList_title))
            BodyText(
                stringResource(R.string.translation_exportsList_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DataFreshness(
            updatedAtMillis = exportsState.fetchedAt?.takeIf { it > 0L },
            isFetching = exportsState.refreshing,
            isStale = exportsState.stale,
            isError = exportsState.hasError,
            compact = true,
        )
    }
}

// ── Bulk toolbar + confirm (web `BulkActionToolbar` + `ConfirmDialog`) ────────────────────────────────────────

@Composable
private fun ExportsBulkToolbar(
    selectedIds: Set<String>,
    total: Int,
    deleting: Boolean,
    actions: ExportsActions,
) {
    var showConfirm by remember { mutableStateOf(false) }
    val selectedCount = selectedIds.size

    val nounOne = stringResource(R.string.translation_exportsList_noun_one)
    val nounOther = stringResource(R.string.translation_exportsList_noun_other)
    val noun = if (selectedCount == 1) nounOne else nounOther
    val ofTemplate = stringResource(R.string.translation_bulk_ofTotal)
    val selectedLabel = pluralStringResource(R.plurals.translation_bulk_selected, selectedCount, selectedCount)
    val deleteLabel = stringResource(R.string.translation_exportsList_bulk_delete)
    val clearLabel = stringResource(R.string.translation_bulk_clear)

    BulkActionToolbar(
        selectedCount = selectedCount,
        onClear = actions.onClearSelection,
        actions =
            listOf(
                BulkAction(
                    id = "delete",
                    label = deleteLabel,
                    onClick = { showConfirm = true },
                    danger = true,
                    loading = deleting,
                ),
            ),
        total = total,
        countText = { selectedLabel },
        ofTotalText = { tot -> "$noun ${String.format(ofTemplate, tot)}" },
        clearLabel = clearLabel,
    )

    if (showConfirm) {
        ConfirmDialog(
            title = stringResource(R.string.translation_exportsList_bulk_deleteConfirm_title),
            message = stringResource(R.string.translation_exportsList_bulk_deleteConfirm_body),
            confirmLabel = stringResource(R.string.translation_common_delete),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            onConfirm = {
                actions.onDeleteSelected()
                showConfirm = false
            },
            onCancel = { showConfirm = false },
            loading = deleting,
            closeLabel = stringResource(R.string.translation_common_close),
        )
    }
}

// ── Data states (web loading skeleton / ErrorDisplay / EmptyState) ────────────────────────────────────────────

/** Loading state: three shimmering skeleton rows (web `<Skeleton className="h-10" />` × 3). */
@Composable
private fun ExportsLoadingRows() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROWS) { Skeleton(height = LOADING_ROW_HEIGHT) }
    }
}

/** Hard-error state: a retry-able error panel (web `<ErrorDisplay error={error} />`). */
@Composable
private fun ExportsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** Empty state: the no-exports empty surface (web `<EmptyState title message />`). */
@Composable
private fun ExportsEmpty() {
    EmptyState(
        title = stringResource(R.string.translation_exportsList_empty_title),
        message = stringResource(R.string.translation_exportsList_empty_body),
    )
}

// ── The job table (web `<table>` with bulk-selectable rows) ───────────────────────────────────────────────────

@Composable
private fun ExportsTable(
    jobs: List<ExportJobSummary>,
    selectedIds: Set<String>,
    visibleIds: List<String>,
    actions: ExportsActions,
) {
    val zone = remember { ZoneId.systemDefault() }
    val locale = LocalConfiguration.current.locales[0]
    val masterState =
        when (masterSelection(selectedIds, visibleIds)) {
            MasterSelection.All -> ToggleableState.On
            MasterSelection.Some -> ToggleableState.Indeterminate
            MasterSelection.None -> ToggleableState.Off
        }

    Column(modifier = Modifier.fillMaxWidth()) {
        ExportsTableHeader(masterState = masterState, onMasterToggle = { actions.onToggleMaster(visibleIds) })
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        jobs.forEach { job ->
            ExportsTableRow(
                job = job,
                selected = job.id in selectedIds,
                zone = zone,
                locale = locale,
                onToggle = actions.onToggleSelected,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/** The table header — the select-all master checkbox + the five column labels. */
@Composable
private fun ExportsTableHeader(
    masterState: ToggleableState,
    onMasterToggle: () -> Unit,
) {
    val selectAll = stringResource(R.string.translation_bulk_selectAll)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(CHECKBOX_COL)) {
            TriStateCheckbox(
                state = masterState,
                onClick = onMasterToggle,
                modifier = Modifier.semantics { contentDescription = selectAll },
            )
        }
        FieldLabelText(stringResource(R.string.translation_exportsList_col_type), modifier = Modifier.weight(TYPE_W))
        FieldLabelText(stringResource(R.string.translation_exportsList_col_format), modifier = Modifier.weight(FORMAT_W))
        FieldLabelText(stringResource(R.string.translation_exportsList_col_size), modifier = Modifier.weight(SIZE_W))
        FieldLabelText(stringResource(R.string.translation_exportsList_col_created), modifier = Modifier.weight(CREATED_W))
        FieldLabelText(stringResource(R.string.translation_exportsList_col_status), modifier = Modifier.weight(STATUS_W))
        Box(modifier = Modifier.weight(DOWNLOAD_W))
    }
}

/** One export-job row — the bulk checkbox, the five cells, and the conditional download link. */
@Composable
private fun ExportsTableRow(
    job: ExportJobSummary,
    selected: Boolean,
    zone: ZoneId,
    locale: Locale,
    onToggle: (String, Boolean) -> Unit,
) {
    val selectExportAria = stringResource(R.string.translation_exportsList_selectExport, job.id)
    val selectRow = stringResource(R.string.translation_bulk_selectRow)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(CHECKBOX_COL)) {
            Checkbox(
                checked = selected,
                onCheckedChange = { onToggle(job.id, it) },
                modifier = Modifier.semantics { contentDescription = selectExportAria },
            )
            // Faithful port of the web VisuallyHidden <label> ("Select row") — present for a11y, not painted.
            Box(modifier = Modifier.size(1.dp).semantics { contentDescription = selectRow })
        }
        BodyText(
            job.type.ifBlank { EXPORT_EMPTY_VALUE },
            modifier = Modifier.weight(TYPE_W),
        )
        BodyText(
            job.format.uppercase(locale).ifBlank { EXPORT_EMPTY_VALUE },
            modifier = Modifier.weight(FORMAT_W),
            color = muted,
        )
        BodyText(
            formatExportBytes(job.fileSize),
            modifier = Modifier.weight(SIZE_W),
            color = muted,
        )
        BodyText(
            formatExportDateTime(job.createdAt, zone, locale),
            modifier = Modifier.weight(CREATED_W),
            color = muted,
        )
        Box(modifier = Modifier.weight(STATUS_W)) {
            ExportStatusBadge(status = job.status)
        }
        Box(modifier = Modifier.weight(DOWNLOAD_W), contentAlignment = Alignment.CenterEnd) {
            if (job.status == "ready") {
                ExportDownloadLink(jobId = job.id)
            }
        }
    }
}

/** The status chip — the web `<Badge variant={statusVariant(status)}>` (tone derived in the framework-free model). */
@Composable
private fun ExportStatusBadge(status: String) {
    val variant =
        when (exportStatusTone(status)) {
            ExportStatusTone.Success -> BadgeVariant.Success
            ExportStatusTone.Danger -> BadgeVariant.Danger
            ExportStatusTone.Info -> BadgeVariant.Info
            ExportStatusTone.Neutral -> BadgeVariant.Neutral
        }
    Badge(text = status.ifBlank { EXPORT_EMPTY_VALUE }, variant = variant)
}

/**
 * The per-row download affordance — opens the browser-facing `exportDownloadUrl(jobId)` (shared-core helper,
 * carrying the `/api/v1` prefix) under the configured API origin, the native analogue of the web `<a download>`.
 */
@Composable
private fun ExportDownloadLink(jobId: String) {
    val uriHandler = LocalUriHandler.current
    val label = stringResource(R.string.translation_exportsList_download)
    Button(
        label = label,
        onClick = { uriHandler.openUri("${BuildConfig.API_BASE_URL}${exportDownloadUrl(jobId)}") },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    )
}
