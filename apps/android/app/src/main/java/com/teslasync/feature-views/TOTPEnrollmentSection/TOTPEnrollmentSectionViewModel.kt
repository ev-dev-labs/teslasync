// Lifecycle-aware state holder backing the Compose [TOTPEnrollmentSection] — the native port of the local
// state + handler composition the web component owns (web/src/features/settings/components/
// TOTPEnrollmentSection.tsx). It binds the shared `useTOTP` domain through [TOTPEnrollmentSectionSource]
// (P1/S8), projects the status read onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error — where "empty" is the open-mode "requires forward-auth" notice), owns the modal/dialog
// flow the web keeps in component state (the enroll modal, the one-time backup-codes reveal, and the
// typed-confirmation disable dialog), runs the four non-throwing mutations raising the matching localized
// toasts, and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects
// state and calls these intent methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TOTPEnrollmentSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.totpenrollmentsection

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.totp.TOTPEnrollment
import io.teslasync.shared.core.presentation.totp.TOTPStatus
import io.teslasync.shared.core.presentation.totp.TOTPStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/** Which dialog the surface is showing — the native analogue of the web `DialogStep` union. */
enum class TOTPDialogStep {
    /** No dialog is open. */
    Closed,

    /** The enroll modal (QR + manual secret + 6-digit verify) is open (web `'enroll'`). */
    Enroll,

    /** The one-time backup-codes reveal modal is open (web `'backupCodes'`). */
    BackupCodes,
}

/**
 * The transient toasts the surface raises (web `useToast`), localized + toned at the Compose boundary (P1/S10).
 * Verify failures are intentionally surfaced inline (the dedicated `ErrorText` the web renders) rather than as
 * a toast, so the dialog's error is never duplicated by a transient toast.
 */
enum class TOTPToast {
    /** Verify success (web `toast.success('TOTP enabled. Save your backup codes!')`). */
    Verified,

    /** Revoke success (web `toast.success('TOTP disabled.')`). */
    Disabled,

    /** Regenerate success (web `toast.success('Backup codes regenerated.')`). */
    BackupRegenerated,

    /** Enroll failure (web `useTOTPEnroll` `onError` → 'Failed to start TOTP enrollment'). */
    EnrollFailed,

    /** Revoke failure (web `useTOTPRevoke` `onError` → 'Failed to disable TOTP'). */
    RevokeFailed,

    /** Regenerate failure (web `useTOTPRegenerateBackupCodes` `onError` → 'Failed to regenerate backup codes'). */
    RegenerateFailed,
}

/**
 * The modal/dialog flow state the web keeps in component `useState` — surfaced here so the screen stays a
 * stateless Composable that only renders + dispatches intents.
 *
 * @property step which dialog (if any) is open.
 * @property enrollment the fresh enrollment payload (secret/QR/codes) backing the enroll modal, or `null`.
 * @property revealedCodes the one-time backup codes backing the reveal modal, or `null`.
 * @property verifyCode the sanitised 6-digit code typed into the verify field (web `verifyCode`).
 * @property verifyError the inline verify failure to localize, or `null` (web `verifyError`).
 * @property enrollPending whether an enroll request is in flight (web `enrollMut.isPending`).
 * @property verifyPending whether a verify request is in flight (web `verifyMut.isPending`).
 * @property regeneratePending whether a regenerate request is in flight (web `regenMut.isPending`).
 * @property showDisableConfirm whether the disable confirmation dialog is open (web `showDisableConfirm`).
 * @property revokePending whether a revoke request is in flight (web `revokeMut.isPending`).
 */
data class TOTPDialogUiState(
    val step: TOTPDialogStep = TOTPDialogStep.Closed,
    val enrollment: TOTPEnrollment? = null,
    val revealedCodes: List<String>? = null,
    val verifyCode: String = "",
    val verifyError: TOTPVerifyError? = null,
    val enrollPending: Boolean = false,
    val verifyPending: Boolean = false,
    val regeneratePending: Boolean = false,
    val showDisableConfirm: Boolean = false,
    val revokePending: Boolean = false,
)

/**
 * Lifecycle-aware state holder backing the Compose [TOTPEnrollmentSection]. It consumes the cache-then-network
 * status feed (projected to [status], where the open-mode sentinel maps to the empty phase) and owns the
 * [dialog] flow + the four mutations. It owns no networking — [refresh]/[retry] re-collect the status feed and
 * each mutation delegates to [source], refreshing the feed on success exactly as the web hooks invalidate
 * `totpKeys.status`. [onViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the TOTP data seam (a shared-store/repository adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + mutation events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TOTPEnrollmentSectionViewModel(
    private val source: TOTPEnrollmentSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the status feed (the manual retry + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val dialogState = MutableStateFlow(TOTPDialogUiState())
    private val toastChannel = Channel<TOTPToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    private val statusFeed: Flow<Resource<TOTPStatus>> =
        refreshTrigger.flatMapLatest { source.status() }

    /**
     * The TOTP status as cache-then-network UI state: loading / content (a session, enrolled or not) /
     * empty (the open-mode "requires forward-auth" notice) / stale / offline / error, carrying the
     * freshness stamp + error kind. Drives the whole section.
     */
    val status: StateFlow<UiState<TOTPStatus>> =
        statusFeed.asUiState { TOTPEnrollmentSectionProjection.isOpenMode(it) }

    /** The modal/dialog flow state (web component `useState`). */
    val dialog: StateFlow<TOTPDialogUiState> = dialogState.asStateFlow()

    /** Typed toasts the composable maps to localized surfaces (web `useToast`). */
    val toasts: Flow<TOTPToast> = toastChannel.receiveAsFlow()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no secret / backup code / subject, so a diagnostics line can never leak credential state.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTOTPEnrollmentSectionOpened(logger)
    }

    /** Re-runs the cache-then-network status load (web `refetch()`); backs the retry affordance. */
    fun refresh() {
        logger.info("totpEnrollment.refresh")
        source.refresh()
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surface's retry affordance. */
    fun retry(): Unit = refresh()

    /**
     * Starts a fresh enrollment and, on success, opens the enroll modal seeded with the secret/QR/codes
     * (web `handleEnroll`). A failure raises [TOTPToast.EnrollFailed] and leaves the section unchanged.
     */
    fun beginEnroll() {
        if (dialogState.value.enrollPending) return
        dialogState.update { it.copy(enrollPending = true) }
        launch {
            source
                .enroll()
                .onSuccess { enrollment ->
                    dialogState.update {
                        it.copy(
                            step = TOTPDialogStep.Enroll,
                            enrollment = enrollment,
                            verifyCode = "",
                            verifyError = null,
                            enrollPending = false,
                        )
                    }
                }.onFailure {
                    logger.warn("totpEnrollment.enrollFailed")
                    dialogState.update { it.copy(enrollPending = false) }
                    toastChannel.trySend(TOTPToast.EnrollFailed)
                }
        }
    }

    /** Updates the verify field with the sanitised [raw] input (web verify field `onChange`). */
    fun verifyCodeChanged(raw: String) {
        dialogState.update { it.copy(verifyCode = TOTPEnrollmentSectionProjection.sanitizeCode(raw)) }
    }

    /**
     * Verifies the typed code (web `handleVerify`): a short code sets the inline [TOTPVerifyError.CodeIncomplete]
     * without a network call; otherwise it submits, and on success flips to the backup-codes reveal seeded with
     * the enrollment's codes + raises [TOTPToast.Verified], while a failure sets the classified inline error.
     */
    fun submitVerify() {
        val current = dialogState.value
        if (current.verifyPending) return
        if (!TOTPEnrollmentSectionProjection.isVerifyCodeComplete(current.verifyCode)) {
            dialogState.update { it.copy(verifyError = TOTPVerifyError.CodeIncomplete) }
            return
        }
        dialogState.update { it.copy(verifyPending = true, verifyError = null) }
        launch {
            source
                .verify(current.verifyCode)
                .onSuccess {
                    dialogState.update {
                        it.copy(
                            step = TOTPDialogStep.BackupCodes,
                            revealedCodes = it.enrollment?.backupCodes ?: emptyList(),
                            verifyPending = false,
                            verifyError = null,
                        )
                    }
                    toastChannel.trySend(TOTPToast.Verified)
                }.onFailure { error ->
                    dialogState.update {
                        it.copy(
                            verifyPending = false,
                            verifyError = TOTPEnrollmentSectionProjection.classifyVerifyError(error),
                        )
                    }
                }
        }
    }

    /** Closes whichever dialog is open and clears its transient state (web `closeDialog`). */
    fun closeDialog() {
        dialogState.update {
            it.copy(
                step = TOTPDialogStep.Closed,
                enrollment = null,
                revealedCodes = null,
                verifyCode = "",
                verifyError = null,
            )
        }
    }

    /**
     * Rotates the backup codes and, on success, reveals the fresh set in the backup-codes modal + raises
     * [TOTPToast.BackupRegenerated] (web `handleRegenerate`). A failure raises [TOTPToast.RegenerateFailed].
     */
    fun beginRegenerate() {
        if (dialogState.value.regeneratePending) return
        dialogState.update { it.copy(regeneratePending = true) }
        launch {
            source
                .regenerateBackupCodes()
                .onSuccess { result ->
                    dialogState.update {
                        it.copy(
                            step = TOTPDialogStep.BackupCodes,
                            revealedCodes = result.backupCodes,
                            enrollment = null,
                            regeneratePending = false,
                        )
                    }
                    toastChannel.trySend(TOTPToast.BackupRegenerated)
                }.onFailure {
                    logger.warn("totpEnrollment.regenerateFailed")
                    dialogState.update { it.copy(regeneratePending = false) }
                    toastChannel.trySend(TOTPToast.RegenerateFailed)
                }
        }
    }

    /** Opens the disable confirmation dialog (web `setShowDisableConfirm(true)`). */
    fun requestDisable() {
        dialogState.update { it.copy(showDisableConfirm = true) }
    }

    /** Dismisses the disable confirmation without revoking (web `onCancel`). */
    fun cancelDisable() {
        dialogState.update { it.copy(showDisableConfirm = false) }
    }

    /**
     * Confirms disabling TOTP (web `handleConfirmDisable`): revokes, raising [TOTPToast.Disabled] on success or
     * [TOTPToast.RevokeFailed] on failure, then always closes the confirmation dialog (web `finally`).
     */
    fun confirmDisable() {
        if (dialogState.value.revokePending) return
        dialogState.update { it.copy(revokePending = true) }
        launch {
            source
                .revoke()
                .onSuccess { toastChannel.trySend(TOTPToast.Disabled) }
                .onFailure {
                    logger.warn("totpEnrollment.revokeFailed")
                    toastChannel.trySend(TOTPToast.RevokeFailed)
                }
            dialogState.update { it.copy(revokePending = false, showDisableConfirm = false) }
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: TOTPEnrollmentSectionSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TOTPEnrollmentSectionViewModel(source, logger) }
            }

        /** Wire the surface from the shared **S8** [TOTPStore]. */
        fun create(
            store: TOTPStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): TOTPEnrollmentSectionViewModel = TOTPEnrollmentSectionViewModel(bindTOTPEnrollmentSectionSource(store), logger, scope)
    }
}
