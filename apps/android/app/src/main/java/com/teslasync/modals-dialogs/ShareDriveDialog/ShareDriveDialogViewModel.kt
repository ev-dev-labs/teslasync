// UI-thread-free state holder backing the ShareDriveDialog surface — the native port of the hook composition the web
// component owns (web/src/features/driving/components/ShareDriveDialog.tsx): `useShareLinks`, `useCreateShareLink` and
// `useRevokeShareLink`, pre-scoped to one drive. It binds the shared [ShareDriveDialogSource] (bound from the S8
// SharingStore) and re-shares the share-link feed as a single [UiState] stream (loading / content / empty / stale /
// offline / error), exposing the create + revoke orchestration the web mutations owned: the in-flight create flag (web
// `createShare.isPending`), the per-token in-flight revoke set, and the freshly created token that flips the dialog to
// its result panel (web `setShareUrl`). It also emits the PII-safe `view.opened` diagnostic. The view never performs
// HTTP — it only collects state and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/ShareDriveDialog) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sharedrivedialog

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.ShareToken
import io.teslasync.shared.core.presentation.sharing.SharingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [ShareDriveDialog]. It keeps the screen a stateless surface that
 * only renders + gathers input: the create-form fields live in the composable (web `useState`), while this holder owns
 * the parts the web hooks owned — the share-link feed projection, the create/revoke orchestration, their in-flight
 * flags, and the freshly created token.
 *
 * It owns no networking. [shares] mirrors `useShareLinks(driveId)`: an empty list maps to the empty surface, a non-empty
 * list to content, with the freshness stamp + error kind carried for the stale/offline/error surfaces. [create]
 * mirrors `useCreateShareLink` — a create while one is in flight is ignored (web disabled button); on success it stores
 * the new token ([createdToken]) so the dialog swaps to its result panel, on failure it re-enables the button (the web
 * toast is a render concern the store deliberately drops). [revoke] mirrors `useRevokeShareLink`, tracking the in-flight
 * token in [revoking] so only that row's affordance disables; the store refreshes the feed on success so the row
 * disappears. [createAnother] clears [createdToken] to return to the form (web `setShareUrl(null)`), and [reset] clears
 * it on re-open (web `handleClose`). [refresh] re-runs the feed (the error-surface retry).
 *
 * @param source the per-drive data + write seam (a shared-data-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only projects this feed and delegates the mutations.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ShareDriveDialogViewModel(
    private val source: ShareDriveDialogSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The drive's share links as cache-then-network UI state: loading / content / empty (no links) / stale / offline /
     * error, carrying the freshness stamp + error kind. Empty mirrors the web `shares.length` gate (the list resolves to
     * no rows).
     */
    val shares: StateFlow<UiState<List<ShareToken>>> =
        source.shareLinks().asUiState(isEmpty = { it.isEmpty() })

    private val creatingState = MutableStateFlow(false)

    /** Whether a create is in flight — drives the Generate button's busy state (web `createShare.isPending`). */
    val creating: StateFlow<Boolean> = creatingState.asStateFlow()

    private val createdTokenState = MutableStateFlow<String?>(null)

    /** The freshly created share token, or `null` while the create form is shown (web `shareUrl` presence gate). */
    val createdToken: StateFlow<String?> = createdTokenState.asStateFlow()

    private val revokingState = MutableStateFlow<Set<String>>(emptySet())

    /** The tokens whose revoke is in flight — each disables only its own row's revoke affordance. */
    val revoking: StateFlow<Set<String>> = revokingState.asStateFlow()

    /**
     * Creates a share link from [request] (web `handleCreate`). A create while one is in flight is ignored (web disabled
     * button). On success the new token is stored so the dialog swaps to its result panel (web `setShareUrl`); on failure
     * the button re-enables and the warning is logged (the web error toast is a render concern the store drops).
     */
    fun create(request: CreateShareRequest) {
        if (creatingState.value) return
        launch {
            creatingState.update { true }
            source
                .createShareLink(request)
                .onSuccess { response ->
                    createdTokenState.update { response.token }
                    logger.info(EVENT_CREATED)
                }.onFailure { logger.warn(EVENT_CREATE_FAILED) }
            creatingState.update { false }
        }
    }

    /**
     * Revokes the share link [token] (web `handleRevoke`). A revoke already in flight for the same token is ignored. On
     * success the store refreshes this drive's feed so the row disappears; on failure the row re-enables and the warning
     * is logged. The token is tracked in [revoking] for the duration so only its own row's affordance disables.
     */
    fun revoke(token: String) {
        if (token.isBlank() || token in revokingState.value) return
        launch {
            revokingState.update { it + token }
            source
                .revokeShareLink(token)
                .onSuccess { logger.info(EVENT_REVOKED) }
                .onFailure { logger.warn(EVENT_REVOKE_FAILED) }
            revokingState.update { it - token }
        }
    }

    /** Returns to the create form, keeping the prior field values (web "Create another link" → `setShareUrl(null)`). */
    fun createAnother() {
        createdTokenState.update { null }
    }

    /** Clears the created token when the dialog re-opens so a reused holder shows the form (web `handleClose` reset). */
    fun reset() {
        createdTokenState.update { null }
    }

    /** Re-runs the cache-then-network feed (the web `refetch` affordance + the error-surface retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        source.refresh()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries no
     * drive id / token / URL, so a diagnostics line can never leak what is being shared. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordShareDriveDialogOpened(logger)
    }

    companion object {
        private const val EVENT_CREATED = "shareDriveDialog.created"
        private const val EVENT_CREATE_FAILED = "shareDriveDialog.createFailed"
        private const val EVENT_REVOKED = "shareDriveDialog.revoked"
        private const val EVENT_REVOKE_FAILED = "shareDriveDialog.revokeFailed"
        private const val EVENT_REFRESH = "shareDriveDialog.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: ShareDriveDialogSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ShareDriveDialogViewModel(source, logger) }
            }

        /**
         * Wire the surface from the shared **S8** [SharingStore] for one [driveId] (web `useSharing` hooks). The holder
         * runs on `viewModelScope`; a custom scope is a test-only concern handled via the constructor.
         */
        fun create(
            store: SharingStore,
            driveId: String,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): ShareDriveDialogViewModel = ShareDriveDialogViewModel(bindShareDriveDialogSource(store, driveId), logger, scope)
    }
}
