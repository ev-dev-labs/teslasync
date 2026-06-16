// The state holder backing the RbacMatrixPage admin surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/admin/pages/RbacMatrixPage.tsx). It owns the
// page's local interaction state (edit toggle, the in-progress [MatrixDraft], the save-in-flight flag, the
// last save error) and projects the shared cache-then-network matrix read
// (`GET /admin/rbac/matrix` via the S8 RbacMatrixStore) onto the lifecycle-aware [UiState] surface, plus the
// open-mode predicate (web `isRbacOpenMode`) and the dirty-cell count (web `diffMatrices(...).length`). The
// save (web `useUpsertRbacCells`) runs off the UI thread. All derivation lives in the framework-free model
// (RbacMatrixPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located state types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.rbac

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixResponse
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/** Keep the matrix feed's upstream alive briefly across config changes / fast re-subscribes. */
private const val STOP_TIMEOUT_MS = 5_000L

/**
 * The data-derived render state for the surface, projected atomically from the single shared matrix read so
 * the open-mode branch and the [UiState] phase can never disagree across a frame.
 *
 * @property ui the cache-then-network phase of the session document (loading / empty / error / content).
 * @property openMode `true` once the read resolves to open (no-forward-auth) mode (web `isRbacOpenMode`).
 * @property loadErrorCode the structured backend error `code` of a hard load failure, or `null` — the page
 *   shows it in place of the generic copy (web `code ?? t('rbac.errors.loadGeneric')`).
 */
data class RbacDataState(
    val ui: UiState<RbacMatrixSession>,
    val openMode: Boolean,
    val loadErrorCode: String?,
)

/**
 * The page's local interaction snapshot — the union of the web component's `editing` / `draft` /
 * `submitError` `useState` group plus the in-flight save flag and the derived dirty-cell count, folded into
 * one immutable value so the composable reads a single source.
 *
 * @property editing whether the matrix is in edit mode (web `editing`).
 * @property draft the operator's in-progress grant edits (web `draft`).
 * @property saving whether a save is in flight — disables the controls (web `upsert.isPending`).
 * @property dirtyCount the number of changed cells the next save would PUT (web `dirtyCount`).
 * @property submitError the last save failure, or `null` (web `submitError`).
 */
data class RbacInteractionState(
    val editing: Boolean,
    val draft: MatrixDraft,
    val saving: Boolean,
    val dirtyCount: Int,
    val submitError: RbacSubmitError?,
)

/** A failed save, carrying the backend `code` when one was returned (web `code ?? saveGeneric`). */
data class RbacSubmitError(
    val code: String?,
)

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixStore]
 *   adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the save outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class RbacMatrixPageViewModel(
    private val source: RbacMatrixSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val editingState = MutableStateFlow(false)
    private val draftState = MutableStateFlow(MatrixDraft())
    private val savingState = MutableStateFlow(false)
    private val submitErrorState = MutableStateFlow<RbacSubmitError?>(null)
    private var viewOpenedRecorded = false

    /**
     * The matrix document projected to the data-render state. Re-collected from the shared S8 feed, so the
     * grid renders the full state matrix (loading / open-mode / empty / error / content) without the view
     * touching the network.
     */
    val data: StateFlow<RbacDataState> =
        source
            .useRbacMatrix()
            .map { it.toDataState() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), source.useRbacMatrix().value.toDataState())

    /** The page's local interaction snapshot (web `useState` group + the derived dirty count). */
    val interaction: StateFlow<RbacInteractionState> =
        combine(
            editingState,
            draftState,
            savingState,
            submitErrorState,
            source.useRbacMatrix(),
        ) { editing, draft, saving, submitError, res ->
            val session = res.cached as? RbacMatrixSession
            val dirty = if (session != null) source.diffMatrices(session.matrix, draft.cells).size else 0
            RbacInteractionState(editing = editing, draft = draft, saving = saving, dirtyCount = dirty, submitError = submitError)
        }.stateIn(
            stateScope,
            SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS),
            RbacInteractionState(editing = false, draft = MatrixDraft(), saving = false, dirtyCount = 0, submitError = null),
        )

    init {
        // Resync the draft whenever a fresh snapshot lands and the operator is NOT mid-edit — the web
        // `useEffect`, so checkbox toggles are not clobbered on a refetch unless edit mode is cancelled.
        launch {
            source.useRbacMatrix().collect { res ->
                val session = res.cached as? RbacMatrixSession ?: return@collect
                if (!editingState.value) {
                    draftState.value = snapshotToDraft(session.matrix)
                }
            }
        }
    }

    // ── Edit lifecycle (web handleEnterEdit / handleCancelEdit) ───────────────────────────────────────────

    /** Enter edit mode, seeding the draft from the loaded snapshot (web `handleEnterEdit`). */
    fun enterEdit() {
        val session = currentSession() ?: return
        submitErrorState.value = null
        draftState.value = snapshotToDraft(session.matrix)
        editingState.value = true
    }

    /** Leave edit mode, discarding draft edits back to the snapshot (web `handleCancelEdit`). */
    fun cancelEdit() {
        editingState.value = false
        draftState.value = snapshotToDraft(currentSession()?.matrix ?: emptyMap())
        submitErrorState.value = null
    }

    /** Toggle a single `(role, permission)` cell in the draft (web `handleToggle`). */
    fun toggle(
        roleId: String,
        permId: String,
        next: Boolean,
    ) {
        draftState.update { it.toggled(roleId, permId, next) }
    }

    // ── Save (web handleSave → useUpsertRbacCells) ────────────────────────────────────────────────────────

    /**
     * Diff the draft against the snapshot and PUT only the changed cells (web `handleSave`). An empty diff
     * just leaves edit mode (a no-op save); a save already in flight is ignored. On success it leaves edit
     * mode and the shared store refreshes the feed; on failure it surfaces the backend code.
     */
    fun save() {
        if (savingState.value) return
        val session = currentSession() ?: return
        submitErrorState.value = null
        val cells = source.diffMatrices(session.matrix, draftState.value.cells)
        if (cells.isEmpty()) {
            editingState.value = false
        } else {
            launch {
                savingState.value = true
                source
                    .useUpsertRbacCells(cells)
                    .onSuccess {
                        logger.info("rbacMatrix.saved")
                        editingState.value = false
                    }.onFailure { err ->
                        logger.warn("rbacMatrix.saveFailed")
                        submitErrorState.value = RbacSubmitError(code = rbacErrorCode(err))
                    }
                savingState.value = false
            }
        }
    }

    // ── Refresh / retry (web query refetch + the error-state retry) ───────────────────────────────────────

    /** Re-fetch the matrix feed (the web error-state Retry affordance). */
    fun refresh() {
        logger.info("rbacMatrix.refresh")
        source.refresh()
    }

    /** Retry affordance for the hard-error surface (web `matrixQuery.refetch()`). */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordRbacMatrixOpened(logger)
    }

    private fun currentSession(): RbacMatrixSession? = source.useRbacMatrix().value.cached as? RbacMatrixSession

    private fun Resource<RbacMatrixResponse>.toDataState(): RbacDataState =
        RbacDataState(
            ui = toSessionResource().toUiState { it.hasNoRoles },
            openMode = isRbacOpenMode(cached),
            loadErrorCode = (this as? Resource.Error)?.error?.let(::rbacErrorCode),
        )
}

/** Narrows a [Resource] over the RBAC union to a session-only resource (Open / null ⇒ empty session). */
private fun Resource<RbacMatrixResponse>.toSessionResource(): Resource<RbacMatrixSession> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.asSession(), fetchedAt, stale)
        is Resource.Success -> Resource.Success(data.asSession(), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.asSession(), fetchedAt, stale, error)
    }

/** The structured backend error `code` of a transport failure, or `null` (web `isApiError(err) ? err.code`). */
private fun rbacErrorCode(error: Throwable): String? = (error as? ApiError.Http)?.code
