// The native Jetpack Compose + Material 3 DLQInspectorPage admin surface — a parity port of
// web/src/features/admin/pages/DLQInspectorPage.tsx, the dead-letter-queue inspector. It reproduces the page's
// composition (the page-chrome header with title + subtitle, the env-gate replay-blocked banner, the
// StatusHeader summary, the two GlassPanels — dead-letter entries + recent replay activity — the slide-in entry
// drawer, and the replay ConfirmDialog), every data state (loading / error / success at the page level via the
// list query, plus each panel's own loading/empty/error), and every visible string (resolved from the generated
// res/values catalog, ADR-014).
//
// Composition: [DLQInspectorPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the three feeds + the interaction snapshot);
// [DLQInspectorPageContent] is the stateless render layer driven entirely by the [UiState]s + [DlqInteraction] +
// [DLQInspectorActions]. The four DLQ feature views (StatusHeader / EntriesTable / AuditPanel / EntryDrawer, the
// A6 component parity units) are composed verbatim — each owns its panel chrome, loading/empty/error states, and
// i18n — so this page only assembles them, resolves the page-level i18n, and orchestrates the replay flow. All
// parsing/derivation lives in the framework-free model (DLQInspectorPageModel.kt).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin.dlq

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.auditpanel.AuditPanel
import io.teslasync.android.featureviews.entriestable.EntriesTable
import io.teslasync.android.featureviews.statusheader.StatusHeader
import io.teslasync.android.modalsdialogs.entrydrawer.EntryDrawer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.featureviews.entriestable.DLQEntrySummary as EntriesSummary

/** The page's interaction callbacks, wired to the [DLQInspectorPageViewModel] (web event handlers). */
data class DLQInspectorActions(
    val onInspect: (EntriesSummary) -> Unit,
    val onCloseDrawer: () -> Unit,
    val onAskReplay: () -> Unit,
    val onConfirmReplay: () -> Unit,
    val onCancelReplay: () -> Unit,
    val onDismissBlocked: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DLQInspectorPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.dlq.DlqStore] via [asDLQInspectorSource]). [logger] defaults to
 * the app's redacting logger.
 */
@Composable
fun DLQInspectorPage(
    source: DLQInspectorSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DLQInspectorPageViewModel =
        viewModel(
            key = DLQInspectorPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DLQInspectorPageViewModel(source, logger) } },
        )
    DLQInspectorPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the stateless content. */
@Composable
fun DLQInspectorPage(
    viewModel: DLQInspectorPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val listState by viewModel.listState.collectAsStateWithLifecycle()
    val auditState by viewModel.auditState.collectAsStateWithLifecycle()
    val entryState by viewModel.entryState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            DLQInspectorActions(
                onInspect = viewModel::inspect,
                onCloseDrawer = viewModel::closeDrawer,
                onAskReplay = viewModel::askReplay,
                onConfirmReplay = viewModel::confirmReplay,
                onCancelReplay = viewModel::cancelReplay,
                onDismissBlocked = viewModel::dismissBlockedBanner,
                onRetry = viewModel::retry,
            )
        }

    DLQInspectorPageContent(
        listState = listState,
        auditState = auditState,
        entryState = entryState,
        interaction = interaction,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the page header (title + subtitle), the env-gate replay-blocked banner, a page-level
 * load-failure banner, the StatusHeader summary, the two GlassPanels, and the entry drawer + replay confirm
 * dialog overlays. The list/audit feeds drive each section's own loading / empty / error / content surface, so the
 * page renders the full data-state matrix without ever blanking a region.
 */
@Composable
fun DLQInspectorPageContent(
    listState: UiState<DlqListView>,
    auditState: UiState<List<io.teslasync.android.featureviews.auditpanel.DLQReplayAuditRecord>>,
    entryState: UiState<io.teslasync.android.modalsdialogs.entrydrawer.DlqEntryFull?>,
    interaction: DlqInteraction,
    actions: DLQInspectorActions,
    modifier: Modifier = Modifier,
) {
    val listView = listState.data ?: DlqListView.EMPTY

    Box(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            DlqHeader()

            if (interaction.replayBlocked) {
                AlertBanner(
                    message = stringResource(R.string.translation_admin_dlq_banners_replayBlockedMessage),
                    tone = Tone.Warning,
                    title = stringResource(R.string.translation_admin_dlq_banners_replayBlockedTitle),
                    onClose = actions.onDismissBlocked,
                    closeLabel = stringResource(R.string.translation_common_close),
                )
            }

            if (listState.hasError) {
                AlertBanner(
                    message = stringResource(R.string.translation_error_loadFailed),
                    tone = Tone.Danger,
                    action = BannerAction(stringResource(R.string.translation_error_retry), actions.onRetry),
                )
            }

            FadeIn {
                StatusHeader(data = listState.data?.status, loading = listState.isLoading)
            }

            FadeIn {
                DlqEntriesPanel(
                    state = listState.toEntriesState(),
                    onInspect = actions.onInspect,
                    onRetry = actions.onRetry,
                )
            }

            FadeIn {
                DlqAuditPanel(state = auditState, onRetry = actions.onRetry)
            }
        }

        EntryDrawer(
            open = interaction.selected != null,
            summary = interaction.selected?.toDrawerSummary(),
            full = entryState.data,
            loading = entryState.isLoading,
            replayEnabled = listView.replayEnabled,
            replayInFlight = interaction.replayInFlight,
            onClose = actions.onCloseDrawer,
            onReplay = actions.onAskReplay,
        )

        val pendingReplay = interaction.pendingReplay
        if (pendingReplay != null) {
            ConfirmDialog(
                title = stringResource(R.string.translation_admin_dlq_confirm_title),
                message =
                    stringResource(
                        R.string.translation_admin_dlq_confirm_message,
                        pendingReplay.id.toString(),
                    ),
                confirmLabel = stringResource(R.string.translation_admin_dlq_confirm_confirm),
                cancelLabel = stringResource(R.string.translation_common_cancel),
                onConfirm = actions.onConfirmReplay,
                onCancel = actions.onCancelReplay,
                severity = ConfirmSeverity.Warning,
                loading = interaction.replayInFlight,
                closeLabel = stringResource(R.string.translation_common_close),
            )
        }
    }
}

/** The page header — the title `<h1>` + muted subtitle, the web `<PageContainer title subtitle>` chrome. */
@Composable
private fun DlqHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_dlq_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_dlq_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Panels (the two page-level GlassPanels — web `<GlassPanel className="p-6">`) ─────────────────────────────────

/**
 * GlassPanel 1 — "Dead-letter entries". The web wraps an AlertOctagon + PanelTitle header above the
 * [EntriesTable] inside a `<GlassPanel>`; the native EntriesTable owns its Material 3 panel surface (it
 * self-wraps in a [io.teslasync.android.components.ui.GlassPanel]), so the section header sits above it and the
 * table renders the panel + all of its loading / empty / error / content states from the threaded [state].
 */
@Composable
private fun DlqEntriesPanel(
    state: UiState<List<EntriesSummary>>,
    onInspect: (EntriesSummary) -> Unit,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DlqPanelHeader(title = stringResource(R.string.translation_admin_dlq_panels_entries), icon = DataDisplayGlyphs.AlertOctagon)
        EntriesTable(state = state, onInspect = onInspect, onRetry = onRetry)
    }
}

/**
 * GlassPanel 2 — "Recent replay activity". Mirrors the web's History + PanelTitle header above the global
 * [AuditPanel]; the AuditPanel owns its Material 3 panel surface and renders the audit feed's loading / empty /
 * error / content states. `scopedDlqId = null` selects the global replay feed (web `<AuditPanel rows={audit…} />`).
 */
@Composable
private fun DlqAuditPanel(
    state: UiState<List<io.teslasync.android.featureviews.auditpanel.DLQReplayAuditRecord>>,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DlqPanelHeader(title = stringResource(R.string.translation_admin_dlq_panels_audit), icon = DataDisplayGlyphs.History)
        AuditPanel(state = state, scopedDlqId = null, onRetry = onRetry)
    }
}

/** A panel section header — a muted leading glyph + [PanelTitle], the web `<div className="mb-4 flex …">`. */
@Composable
private fun DlqPanelHeader(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            icon,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PanelTitle(title)
    }
}

/**
 * Narrows the page's list [UiState] to the row list the [EntriesTable] binds to, preserving the phase + freshness
 * flags so the table renders the same loading / empty / content / stale surface the list feed carries (web
 * `rows={list.data?.entries ?? []}`).
 */
private fun UiState<DlqListView>.toEntriesState(): UiState<List<EntriesSummary>> =
    UiState(
        phase = phase,
        data = data?.entries,
        fetchedAt = fetchedAt,
        stale = stale,
        refreshing = refreshing,
        errorKind = errorKind,
        httpStatus = httpStatus,
    )
