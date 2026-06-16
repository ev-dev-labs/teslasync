// The state holder backing the DataRepairPage system surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook + mutations (web/src/features/system/pages/DataRepairPage.tsx). It owns the
// page's local interaction state (the selected tab + the expanded-row id) as a single immutable
// [DataRepairInteraction] snapshot, projects the one cache-then-network stale-sessions read onto the shared
// lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], and orchestrates the six repair mutations
// (update / close / discard, per kind) off the UI thread — each emitting a one-shot localized toast (web
// `toast.success` / `toast.error`) and, on success, collapsing the row and re-fetching the feed (web
// `qc.invalidateQueries(['stale-sessions'])`). All derivation lives in the framework-free model
// (DataRepairPageModel.kt); this holder performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.datarepair

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/** The two record kinds the repair surface switches between (web `type Tab = 'charging' | 'drives'`). */
enum class DataRepairTab { Charging, Drives }

/**
 * The page's local interaction snapshot — the union of the web component's `tab` + `expandedId` `useState` pair,
 * folded into one immutable value so the composable reads a single source. Switching tabs always collapses the
 * open row (web `setTab(...); setExpandedId(null)`).
 */
data class DataRepairInteraction(
    val tab: DataRepairTab = DataRepairTab.Charging,
    val expandedId: Long? = null,
)

/**
 * @param source the data seam (real [dataRepairPageSourceOf] adapter ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`, refresh, and the
 *   repair-mutation outcomes.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DataRepairPageViewModel(
    private val source: DataRepairSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableInteraction = MutableStateFlow(DataRepairInteraction())
    private val updatingState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `tab` + `expandedId` `useState`). */
    val interaction: StateFlow<DataRepairInteraction> = mutableInteraction.asStateFlow()

    /** Whether a repair mutation is in flight — disables the row's edit controls (web `*.isPending`). */
    val updating: StateFlow<Boolean> = updatingState.asStateFlow()

    /**
     * The stale-sessions feed as cache-then-network UI state (loading / content / empty / stale / offline /
     * error). Re-collected whenever the refresh trigger bumps (web `useQuery` refetch / a successful repair's
     * `invalidateQueries`). The empty predicate is the web "nothing needs repair" guard, so a fetch with zero
     * stale records resolves to the Empty phase while the page still draws the (all-zero) stat cards + tabs.
     */
    val state: StateFlow<UiState<DataRepairStaleData>> =
        refreshTrigger
            .flatMapLatest { source.staleSessions() }
            .asUiState(isEmpty = { it.isClean })

    // ── Tab + row expansion (web `setTab` / row click) ────────────────────────────────────────────────────────

    /** Select a record-kind tab, collapsing the open row (web `setTab(t); setExpandedId(null)`). */
    fun selectTab(tab: DataRepairTab): Unit =
        mutableInteraction.update { it.copy(tab = tab, expandedId = null) }

    /** Toggle the inline edit form for [id] (web `setExpandedId(expandedId === id ? null : id)`). */
    fun toggleExpanded(id: Long): Unit =
        mutableInteraction.update { it.copy(expandedId = if (it.expandedId == id) null else id) }

    // ── Charging repair mutations (web `ChargingEditForm` updateMut / closeMut / discardMut) ──────────────────

    /** Save the charging session's repair fields (web charging `updateMut`). */
    fun updateCharging(
        id: Long,
        form: DataRepairChargingForm,
    ): Unit = runRepair(MSG_SESSION_UPDATED, MSG_FAILED_UPDATE_SESSION) { source.updateCharging(id, form.toRequestBody()) }

    /** Close the charging session (web charging `closeMut`). */
    fun closeCharging(id: Long): Unit =
        runRepair(MSG_SESSION_CLOSED, MSG_FAILED_CLOSE_SESSION) { source.closeCharging(id) }

    /** Discard the charging session (web charging `discardMut`). */
    fun discardCharging(id: Long): Unit =
        runRepair(MSG_SESSION_DISCARDED, MSG_FAILED_DISCARD_SESSION) { source.discardCharging(id) }

    // ── Drive repair mutations (web `DriveEditForm` updateMut / closeMut / discardMut) ────────────────────────

    /** Save the drive's repair fields (web drive `updateMut`). */
    fun updateDrive(
        id: Long,
        form: DataRepairDriveForm,
    ): Unit = runRepair(MSG_DRIVE_UPDATED, MSG_FAILED_UPDATE_DRIVE) { source.updateDrive(id, form.toRequestBody()) }

    /** Close the drive (web drive `closeMut`). */
    fun closeDrive(id: Long): Unit =
        runRepair(MSG_DRIVE_CLOSED, MSG_FAILED_CLOSE_DRIVE) { source.closeDrive(id) }

    /** Discard the drive (web drive `discardMut`). */
    fun discardDrive(id: Long): Unit =
        runRepair(MSG_DRIVE_DISCARDED, MSG_FAILED_DISCARD_DRIVE) { source.discardDrive(id) }

    // ── Refresh / retry (web `useQuery` refetchInterval + the error-state retry) ──────────────────────────────

    /** Re-fetch the stale-sessions feed (the web query refetch / error retry affordance). */
    fun refresh() {
        logger.info("dataRepair.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDataRepairPageOpened(logger)
    }

    /**
     * Runs a single repair off the UI thread (web `*.mutate`). A repair while one is already in flight is ignored
     * (web disabled controls). On success it emits the localized confirmation toast, collapses the open row (web
     * `onClose`), and bumps the refresh trigger so the feed re-fetches (web
     * `invalidateQueries(['stale-sessions'])`); on failure it emits the localized error toast and leaves the row
     * open so the operator can retry.
     */
    private fun runRepair(
        successKey: String,
        failureKey: String,
        action: suspend () -> Result<Unit>,
    ) {
        if (updatingState.value) return
        launch {
            updatingState.update { true }
            action()
                .onSuccess {
                    logger.info("dataRepair.repaired")
                    emitEvent(UiEvent.Message(messageKey = successKey, severity = UiEvent.Severity.Success))
                    mutableInteraction.update { it.copy(expandedId = null) }
                    refreshTrigger.update { it + 1 }
                }.onFailure {
                    logger.warn("dataRepair.repairFailed")
                    emitEvent(UiEvent.Message(messageKey = failureKey, severity = UiEvent.Severity.Error))
                }
            updatingState.update { false }
        }
    }
}

// ── Repair-outcome toast keys (web `toast.success` / `toast.error` messages) ──────────────────────────────────
// Stable tokens emitted as [UiEvent.Message.messageKey]; the render boundary maps each to its R.string (ADR-014).

internal const val MSG_SESSION_UPDATED: String = "dataRepair.sessionUpdated"
internal const val MSG_SESSION_CLOSED: String = "dataRepair.sessionClosed"
internal const val MSG_SESSION_DISCARDED: String = "dataRepair.sessionDiscarded"
internal const val MSG_FAILED_UPDATE_SESSION: String = "dataRepair.failedUpdateSession"
internal const val MSG_FAILED_CLOSE_SESSION: String = "dataRepair.failedCloseSession"
internal const val MSG_FAILED_DISCARD_SESSION: String = "dataRepair.failedDiscardSession"
internal const val MSG_DRIVE_UPDATED: String = "dataRepair.driveUpdated"
internal const val MSG_DRIVE_CLOSED: String = "dataRepair.driveClosed"
internal const val MSG_DRIVE_DISCARDED: String = "dataRepair.driveDiscarded"
internal const val MSG_FAILED_UPDATE_DRIVE: String = "dataRepair.failedUpdateDrive"
internal const val MSG_FAILED_CLOSE_DRIVE: String = "dataRepair.failedCloseDrive"
internal const val MSG_FAILED_DISCARD_DRIVE: String = "dataRepair.failedDiscardDrive"
