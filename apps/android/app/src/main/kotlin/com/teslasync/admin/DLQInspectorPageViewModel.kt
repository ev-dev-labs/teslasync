// The state holder backing the DLQInspectorPage admin surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/admin/pages/DLQInspectorPage.tsx). It owns the
// page's local interaction state (the selected row that drives the drawer + the scoped entry fetch, the
// pending-replay confirmation, the replay-blocked banner, and the in-flight replay flag) as a single immutable
// [DlqInteraction] snapshot, and projects the three cache-then-network reads (`/system/dlq` list,
// `/system/dlq/audit`, `/system/dlq/{id}`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState]. All parsing/derivation lives in the framework-free model
// (DLQInspectorPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The list feed is the spine that drives the page-level loading/error phase (web `<PageContainer query={list}>`)
// and feeds both the StatusHeader summary and the EntriesTable rows; the audit feed drives the global
// replay-activity panel; the entry feed is gated on the selected row (the web `useDLQEntry(id, !!selected)`
// `enabled` rule, forwarded to the store). The replay mutation reproduces the web confirm flow:
// on `result === 'ok'` it closes the drawer; on `result === 'disabled'` or an HTTP 403 it raises the
// replay-blocked banner (the env-gate `DLQ_REPLAY_ENABLED=false`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.dlq

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import io.teslasync.android.featureviews.auditpanel.DLQReplayAuditRecord as AuditRecord
import io.teslasync.android.featureviews.entriestable.DLQEntrySummary as EntriesSummary
import io.teslasync.android.modalsdialogs.entrydrawer.DlqEntryFull as DrawerFull

/**
 * The page's local interaction snapshot — the union of the web component's four `useState` values
 * (`selected`, `pendingReplay`, `replayDisabledBanner`) plus the mutation's `isPending`, folded into one
 * immutable value so the composable reads a single source.
 *
 * @property selected the inspected row (web `selected`): drives the drawer's open state AND the scoped entry
 *   fetch (its id is the web `useDLQEntry(selected?.id, !!selected)` argument).
 * @property pendingReplay the row awaiting replay confirmation (web `pendingReplay`): drives the ConfirmDialog.
 * @property replayBlocked whether the env-gate replay-blocked banner shows (web `replayDisabledBanner`).
 * @property replayInFlight whether a replay mutation is running (web `replay.isPending`): disables the drawer's
 *   Replay CTA and spins the ConfirmDialog's confirm button.
 */
data class DlqInteraction(
    val selected: EntriesSummary? = null,
    val pendingReplay: EntriesSummary? = null,
    val replayBlocked: Boolean = false,
    val replayInFlight: Boolean = false,
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.dlq.DlqStore] adapter ↔ test
 *   fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DLQInspectorPageViewModel(
    private val source: DLQInspectorSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(DlqInteraction())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `useState` group). */
    val interaction: StateFlow<DlqInteraction> = mutableInteraction.asStateFlow()

    /**
     * The DLQ list as cache-then-network UI state (loading / content / empty / stale / offline / error) — the
     * spine the page-level [io.teslasync.android.sharedsurfaces.pagecontainer.PageContainer] gates on (web
     * `query={list}`) and the source the StatusHeader summary + EntriesTable rows are derived from. Empty when
     * the dead-letter queue has no rows (web `list.data?.entries ?? []`).
     */
    val listState: StateFlow<UiState<DlqListView>> =
        refreshTrigger
            .flatMapLatest { source.list().mapParsed(DlqInspectorParsing::listView) }
            .asUiState { it.isEmpty }

    /**
     * The global replay-audit feed as cache-then-network UI state (web `useDLQAudit(null, 50)`), driving the
     * "Recent replay activity" panel. Empty when no replay has been attempted yet.
     */
    val auditState: StateFlow<UiState<List<AuditRecord>>> =
        refreshTrigger
            .flatMapLatest {
                source.audit(null, DLQInspectorPageRegistration.AUDIT_LIMIT).mapParsed(DlqInspectorParsing::auditRows)
            }.asUiState { it.isEmpty() }

    /**
     * The selected entry's full row as cache-then-network UI state (web `useDLQEntry(selected?.id, !!selected)`).
     * Re-collected whenever the selection changes; the store gates a null/unselected id as a disabled query, so
     * this stays at Loading until a row is inspected. A detail surface is never "empty".
     */
    val entryState: StateFlow<UiState<DrawerFull?>> =
        mutableInteraction
            .map { it.selected?.id }
            .distinctUntilChanged()
            .flatMapLatest { id ->
                source.entry(id, enabled = id != null).mapParsed(DlqInspectorParsing::entryFull)
            }.asUiState { false }

    // ── Selection / drawer (web `setSelected` / `handleInspect`) ────────────────────────────────────────────

    /** Inspect [row] — opens the drawer and triggers the scoped entry fetch (web `handleInspect`). */
    fun inspect(row: EntriesSummary): Unit = mutableInteraction.update { it.copy(selected = row) }

    /** Close the drawer (web `onClose={() => setSelected(null)}`). */
    fun closeDrawer(): Unit = mutableInteraction.update { it.copy(selected = null) }

    // ── Replay confirm flow (web `handleAskReplay` / `handleConfirmReplay`) ──────────────────────────────────

    /** Ask to replay the selected row — opens the ConfirmDialog (web `handleAskReplay`). */
    fun askReplay(): Unit = mutableInteraction.update { it.copy(pendingReplay = it.selected) }

    /** Cancel the pending replay (web `onCancel={() => setPendingReplay(null)}`). */
    fun cancelReplay(): Unit = mutableInteraction.update { it.copy(pendingReplay = null) }

    /** Dismiss the replay-blocked banner (web `onClose={() => setReplayDisabledBanner(false)}`). */
    fun dismissBlockedBanner(): Unit = mutableInteraction.update { it.copy(replayBlocked = false) }

    /**
     * Confirm + run the replay mutation (web `handleConfirmReplay`). Mirrors the web branch ladder: on a
     * `result === 'ok'` it clears the pending state and closes the drawer so the new audit row is the first
     * thing the operator sees; on `result === 'disabled'` it raises the replay-blocked banner; on an HTTP 403
     * env-gate failure it raises the banner and clears the pending state. Any other failure leaves the dialog
     * dismissed but the banner untouched (the web mutation's own toast surface handles it).
     */
    fun confirmReplay() {
        val target = mutableInteraction.value.pendingReplay ?: return
        mutableInteraction.update { it.copy(replayInFlight = true) }
        launch {
            source
                .replay(target.id)
                .onSuccess { result ->
                    val code = DlqInspectorParsing.replayResult(result)
                    mutableInteraction.update {
                        it.copy(
                            replayInFlight = false,
                            pendingReplay = null,
                            replayBlocked = code == DLQInspectorPageRegistration.RESULT_DISABLED,
                            selected = if (code == DLQInspectorPageRegistration.RESULT_OK) null else it.selected,
                        )
                    }
                }.onFailure { error ->
                    val blocked = httpStatusOf(error) == DLQInspectorPageRegistration.STATUS_REPLAY_DISABLED
                    mutableInteraction.update {
                        it.copy(
                            replayInFlight = false,
                            pendingReplay = if (blocked) null else it.pendingReplay,
                            replayBlocked = blocked || it.replayBlocked,
                        )
                    }
                }
        }
    }

    // ── Refresh / retry (web query `refetchInterval` + the error-state retry) ────────────────────────────────

    /** Re-collect the cache-then-network feeds (the web `refetch` / error retry affordance). */
    fun refresh() {
        logger.info("dlq.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDLQInspectorPageOpened(logger)
    }

    /**
     * Maps a raw-JSON cache-then-network [Resource] feed onto a typed one, parsing only the present cached/data
     * value so a no-cache Loading/Error stays no-cache (preserving the loading / hard-error phases). Pure plumbing
     * — the parse itself lives in the framework-free model.
     */
    private fun <T> Flow<Resource<JsonElement>>.mapParsed(parse: (JsonElement) -> T): Flow<Resource<T>> =
        map { resource ->
            when (resource) {
                is Resource.Loading ->
                    Resource.Loading(resource.cached?.let(parse), resource.fetchedAt, resource.stale)
                is Resource.Success ->
                    Resource.Success(parse(resource.data), resource.fetchedAt, resource.stale)
                is Resource.Error ->
                    Resource.Error(resource.cached?.let(parse), resource.fetchedAt, resource.stale, resource.error)
            }
        }
}
