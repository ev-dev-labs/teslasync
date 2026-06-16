// The state holder backing the GDPRExportPage admin surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hook (web/src/features/admin/pages/GDPRExportPage.tsx). It owns the
// page's local interaction state (the artifact-id text field + the looked-up active id, the web
// `idInput`/`activeId` `useState` pair, plus the `?id=` URL param the web seeds from) as a single immutable
// [GdprExportInteraction] snapshot, and projects the cache-then-network read (`GET /admin/gdpr/exports/{id}`)
// onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState]. The feed is opened
// only once an id is looked up — the native mirror of the web hook's `enabled: Boolean(id)` lazy gate — so an
// empty id never fires a request. All derivation logic lives in the framework-free model
// (GDPRExportPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.gdpr

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.GDPRExportArtifact
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * The page's local interaction snapshot — the union of the web component's `idInput` text-field state and
 * the `activeId` (set on lookup, seeded from the `?id=` URL param), folded into one immutable value so the
 * composable reads a single source. [activeId] is the projection the cache-then-network read consumes (web
 * `useGDPRExport(activeId)` with its `enabled: Boolean(id)` gate).
 */
data class GdprExportInteraction(
    val idInput: String = "",
    val activeId: String = "",
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GDPRExportPageViewModel(
    private val source: GdprExportSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(GdprExportInteraction())
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `idInput`/`activeId` `useState` group). */
    val interaction: StateFlow<GdprExportInteraction> = mutableInteraction.asStateFlow()

    /**
     * The artifact feed as cache-then-network UI state (loading / content / stale / offline / error).
     * Re-collected whenever the looked-up id changes (a new `GET /admin/gdpr/exports/{id}`) or the refresh
     * trigger bumps. A blank id opens no feed (web `enabled: Boolean(id)`) — the page shows its
     * "no artifact selected" empty surface instead. A present artifact is never treated as structurally empty.
     */
    val state: StateFlow<UiState<GDPRExportArtifact>> =
        combine(
            mutableInteraction.map { it.activeId }.distinctUntilChanged(),
            refreshTrigger,
        ) { activeId, _ -> activeId }
            .flatMapLatest { activeId -> feedFor(activeId) }
            .asUiState(isEmpty = { false })

    private fun feedFor(activeId: String): Flow<Resource<GDPRExportArtifact>> =
        if (activeId.isBlank()) flowOf(IDLE) else source.gdprExport(activeId)

    // ── Lookup interaction (web `setIdInput` / `handleLookup`) ───────────────────────────────────────────────

    /** Update the artifact-id text field (web `setIdInput(e.target.value)`). */
    fun setIdInput(value: String): Unit = mutableInteraction.update { it.copy(idInput = value) }

    /** Look up the typed id, trimming it (web `setActiveId(idInput.trim())`); keeps the URL in sync. */
    fun lookup(): Unit = mutableInteraction.update { it.copy(activeId = it.idInput.trim()) }

    // ── Refresh / retry (web `refetchInterval` FAST poll + the error-state retry) ────────────────────────────

    /** Re-fetch the artifact feed for the active id (the web FAST poll / error retry affordance). */
    fun refresh() {
        val id = mutableInteraction.value.activeId
        if (id.isNotBlank()) {
            logger.info("gdprExport.refresh")
            source.refresh(id)
        }
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGdprExportPageOpened(logger)
    }

    private companion object {
        /** The blank-id idle emission: a first load with nothing cached (the page ignores it pre-lookup). */
        val IDLE: Resource<GDPRExportArtifact> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
