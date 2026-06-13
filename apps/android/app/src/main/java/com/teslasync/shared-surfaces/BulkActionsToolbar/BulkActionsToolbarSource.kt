// The single interaction port the BulkActionsToolbar shared surface binds to — the native analogue of the web
// component's `useConfirm()` hook (web/src/components/data-display/BulkActionsToolbar.tsx, which destructures
// `{ confirm, dialogProps }`). The toolbar performs NO data fetch, so unlike the AI surfaces there is no store
// or SSE seam here; the only abstracted dependency is the confirmation interaction, which is what makes the
// view-model's destructive-action gating fully unit-testable off-device (a fake confirmer stands in for the
// dialog round-trip). The view-model depends on this abstraction, never on a concrete dialog or Android UI, so
// the view performs no business logic (P1/S8 boundary, ADR-002).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory (com/teslasync/shared-
// surfaces) cannot form a valid Kotlin package; `ktlint:standard:filename` / `MatchingDeclarationName` are
// suppressed for the port interface + its production state holder co-located in one file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.bulkactionstoolbar

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The already-localized confirmation request the toolbar hands to the confirmer before a destructive mutation —
 * the native analogue of the web `confirm({ title, message, confirmLabel, variant })` argument. Strings are
 * resolved at the render boundary (P1/S10) before reaching the [BulkConfirmer].
 *
 * @property title the dialog title.
 * @property message the dialog body.
 * @property confirmLabel the confirm-button label (already defaulted).
 * @property severity the confirm styling, derived from the action intent (see [confirmSeverityFor]).
 */
data class BulkConfirmRequest(
    val title: String,
    val message: String,
    val confirmLabel: String,
    val severity: BulkConfirmSeverity,
)

/**
 * The confirmation interaction seam the [BulkActionsToolbarViewModel] binds to — the native `useConfirm`.
 * [dialog] is the observable request the view renders (web `dialogProps`); [confirm] opens the dialog and
 * suspends until the user responds (web `await confirm(...)`); [respond] settles the in-flight request from the
 * dialog's confirm/cancel/dismiss affordances. A real dialog-backed [DialogBulkConfirmer] is used in
 * production; a fake implements this interface directly in tests so the gating logic runs without a UI.
 */
interface BulkConfirmer {
    /** The confirmation request to render, or `null` when no dialog is open (web `dialogProps`). */
    val dialog: StateFlow<BulkConfirmRequest?>

    /**
     * Opens a confirmation for [request] and suspends until the user responds, returning `true` when confirmed
     * and `false` when cancelled or dismissed — web `const ok = await confirm(...)`.
     */
    suspend fun confirm(request: BulkConfirmRequest): Boolean

    /** Settles the in-flight confirmation with the user's [confirmed] choice and closes the dialog. */
    fun respond(confirmed: Boolean)
}

/**
 * The production [BulkConfirmer]: a small, self-contained state holder backing the web `useConfirm` round-trip.
 * [confirm] publishes the [request] to [dialog] and awaits a [CompletableDeferred] the view completes through
 * [respond], so the suspending call resolves exactly when the user acts. Starting a new confirmation settles any
 * still-open one as cancelled, so a stale dialog can never strand a suspended caller.
 *
 * Instances are scoped to a single toolbar placement (created in the composable and remembered), so no
 * cross-instance synchronization is required; [confirm] is invoked from the view-model coroutine and [respond]
 * from the dialog callbacks, both on the main dispatcher.
 */
class DialogBulkConfirmer : BulkConfirmer {
    private val dialogState = MutableStateFlow<BulkConfirmRequest?>(null)
    private var awaiting: CompletableDeferred<Boolean>? = null

    override val dialog: StateFlow<BulkConfirmRequest?> = dialogState.asStateFlow()

    override suspend fun confirm(request: BulkConfirmRequest): Boolean {
        awaiting?.complete(false)
        val deferred = CompletableDeferred<Boolean>()
        awaiting = deferred
        dialogState.value = request
        return deferred.await()
    }

    override fun respond(confirmed: Boolean) {
        dialogState.value = null
        awaiting?.complete(confirmed)
        awaiting = null
    }
}

/** Builds the production [BulkConfirmer] for a toolbar placement. A test fake implements [BulkConfirmer] directly. */
fun bulkConfirmer(): BulkConfirmer = DialogBulkConfirmer()
