// The state holder backing the IncidentTimelinePage surface (P1/S8) — the native counterpart of the web page's
// React state + three TanStack hooks (web/src/features/system/pages/IncidentTimelinePage.tsx): `useIncident(id)`,
// `useAppendIncidentUpdate`, and `usePatchIncident`. It projects the detail read onto the shared lifecycle-aware
// [UiState] surface (loading → content → error, plus stale/offline) and owns the parts the web hooks owned — the
// append + resolve orchestration, the per-action in-flight flags (web `appendUpdate.isPending` /
// `patch.isPending`), the one-shot toasts (web `useToast`), and the field/dialog reset signals. All decode/
// derivation logic lives in the framework-free model (IncidentTimelinePageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// keep-previous-data (web React-Query parity): a successful append/resolve evicts the S7 incident cache partition,
// so the re-read briefly emits `Loading(cached = null)`. [mergeKeepingIncidentData] carries the last-loaded
// incident into that slot so the page keeps rendering the timeline (flagged refreshing) instead of flashing the
// first-load spinner — `isLoading` is true only on the genuine first load (web `if (isLoading)`). A `null` /
// non-positive route id (web invalid-id branch) resolves straight to the error surface (the not-found view).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.incidenttimeline

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.AppendIncidentUpdateInput
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.PatchIncidentInput
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.runningFold
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the shared S7 IncidentRepository binding in production ↔ a test fake); the
 *   view never performs HTTP.
 * @param incidentId the parsed, positive incident id from the route (web `useParams().id` → `numericId`); `null`
 *   when the route id is missing/non-positive, which resolves to the not-found surface.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class IncidentTimelinePageViewModel(
    private val source: IncidentTimelinePageSource,
    private val incidentId: Long?,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val submittingState = MutableStateFlow(false)
    private val resolvingState = MutableStateFlow(false)
    private val toastChannel = Channel<IncidentTimelineToast>(Channel.BUFFERED)
    private val appendSucceededChannel = Channel<Unit>(Channel.BUFFERED)
    private val resolveSucceededChannel = Channel<Unit>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The incident detail as lifecycle-aware [UiState] (web `useIncident`). Re-collected when the refresh trigger
     * bumps (after a successful write, or the not-found retry). The keep-previous-data fold preserves the loaded
     * incident across a post-write refetch; a `null` route id emits a hard error → the not-found surface. The empty
     * predicate is `false` because a decoded incident is never "empty" (the page has no empty branch — a missing
     * incident is the error/not-found surface, matching the web `error || !incident`).
     */
    val uiState: StateFlow<UiState<Incident>> =
        refreshTrigger
            .flatMapLatest { incidentFeed() }
            .runningFold(INITIAL_LOADING) { prev, cur -> mergeKeepingIncidentData(prev, cur) }
            .map { resource -> resource.toUiState(isEmpty = { false }) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** Whether an append is in flight — disables the form + flips the submit label (web `appendUpdate.isPending`). */
    val submitting: StateFlow<Boolean> = submittingState

    /** Whether a resolve is in flight — disables the resolve control + spins the confirm button (web `patch.isPending`). */
    val resolving: StateFlow<Boolean> = resolvingState

    /** One-shot toasts the composable maps to localized + toned surfaces (web `useToast`); never replayed. */
    val toasts: Flow<IncidentTimelineToast> = toastChannel.receiveAsFlow()

    /** One-shot signal raised after a successful append so the composable clears its draft (web `setMessage('')`). */
    val appendSucceeded: Flow<Unit> = appendSucceededChannel.receiveAsFlow()

    /** One-shot signal raised after a successful resolve so the composable closes the confirm dialog (web `setConfirmResolve(false)`). */
    val resolveSucceeded: Flow<Unit> = resolveSucceededChannel.receiveAsFlow()

    private fun incidentFeed(): Flow<Resource<Incident>> =
        if (incidentId == null) {
            flowOf(Resource.Error<Incident>(cached = null, fetchedAt = null, stale = false, error = IncidentNotFoundException()))
        } else {
            source.incident(incidentId)
        }

    /**
     * Append a timeline update (web `handleAppend`). An empty trimmed message raises [IncidentTimelineToast.UpdateRequired]
     * and sends no request (web `if (!m) toast.error(...)`); otherwise the append runs and the result raises the
     * success toast + [appendSucceeded] reset signal + a detail refresh, or an [IncidentTimelineToast.AppendFailed]
     * carrying the server message. A submit while one is in flight (or with no id) is ignored.
     *
     * @param message the draft message (web textarea value); trimmed before validation + send.
     * @param nextStatusWire the optional transition wire token (web select value); blank ⇒ no status change.
     */
    fun appendUpdate(
        message: String,
        nextStatusWire: String?,
    ) {
        val id = incidentId ?: return
        if (submittingState.value) return
        val trimmed = message.trim()
        if (trimmed.isEmpty()) {
            toastChannel.trySend(IncidentTimelineToast.UpdateRequired)
            return
        }
        val input = AppendIncidentUpdateInput(id = id, message = trimmed, status = nextStatusWire?.ifBlank { null })
        launch {
            submittingState.update { true }
            source
                .appendIncidentUpdate(input)
                .onSuccess {
                    logger.info("incidentTimeline.updateAppended")
                    toastChannel.trySend(IncidentTimelineToast.UpdateAdded)
                    appendSucceededChannel.trySend(Unit)
                    refresh()
                }.onFailure { error ->
                    logger.warn("incidentTimeline.appendFailed")
                    toastChannel.trySend(IncidentTimelineToast.AppendFailed(error.message))
                }
            submittingState.update { false }
        }
    }

    /**
     * Resolve the incident (web `handleResolve` → `patch.mutateAsync({ resolved: true })`). On success it raises
     * the success toast + [resolveSucceeded] (the composable closes the confirm dialog) + a detail refresh; on
     * failure it raises an [IncidentTimelineToast.ResolveFailed] and leaves the dialog open. A resolve while one is
     * in flight (or with no id) is ignored.
     */
    fun resolve() {
        val id = incidentId ?: return
        if (resolvingState.value) return
        launch {
            resolvingState.update { true }
            source
                .patchIncident(PatchIncidentInput(id = id, resolved = true))
                .onSuccess {
                    logger.info("incidentTimeline.resolved")
                    toastChannel.trySend(IncidentTimelineToast.Resolved)
                    resolveSucceededChannel.trySend(Unit)
                    refresh()
                }.onFailure { error ->
                    logger.warn("incidentTimeline.resolveFailed")
                    toastChannel.trySend(IncidentTimelineToast.ResolveFailed(error.message))
                }
            resolvingState.update { false }
        }
    }

    /** Re-collect the detail feed — the web query refetch after a write + the not-found-surface retry affordance. */
    fun refresh() {
        logger.info("incidentTimeline.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the not-found / error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordIncidentTimelinePageOpened(logger)
    }

    private companion object {
        /** The seed of the keep-previous-data fold: a first load with nothing cached. */
        val INITIAL_LOADING: Resource<Incident> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
