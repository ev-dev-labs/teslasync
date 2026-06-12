// UI-thread-free state holder backing the Compose [BackupActionsCard] surface — the native port of the web
// component's hook composition (web/src/features/system/components/status/BackupActionsCard.tsx). The web
// component owns one bit of interaction state (the `useMutation` in-flight flag) and, on settle, raises a
// success / permission / generic toast and invalidates the backup-runs + backup-stats queries. Its parent owns
// the backup feed; here that feed is folded in (the sibling UserImpersonateButton pattern) so the surface can
// honestly render loading / content / empty / error / stale / offline.
//
// This becomes a small feed + mutation holder over the injected [BackupActionsCardSource] (P1/S8): the
// backup-status [status] as a cache-then-network [UiState], a [running] flag for the quick-backup mutation, and
// a one-shot [BaseFeedViewModel.events] stream carrying the toast as a localized i18n key (ADR-014), never a
// pre-formatted sentence. The view-model performs no HTTP (ADR-002) and logs only the PII-safe surface slug
// (ADR-016) — never a file name, size, or run id. On a successful run it re-collects the feed, the data-layer
// analogue of the web hook's `invalidateQueries(['backup-runs'])` + `invalidateQueries(['system-status',
// 'backup-stats'])`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackupActionsCard) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backupactionscard

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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

/**
 * State holder backing the Compose [BackupActionsCard].
 *
 * It projects the injected [source]'s backup-status feed onto [status] and routes the quick-backup mutation
 * through the same seam. The first [onAppear] records the one-shot `view.opened` diagnostic; [runQuickBackup]
 * runs the mutation (guarding a double-tap via [running]), raises the success / permission / generic toast, and
 * re-collects the feed on success; [retry] re-runs the load (the error/stale retry affordance). It owns no
 * networking and never logs anything but the surface slug.
 *
 * @param source the backup feed + quick-backup mutation seam (P1/S8) — a shared-store adapter in production, a
 *   fake in tests.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackupActionsCardViewModel(
    private val source: BackupActionsCardSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch + post-mutation refresh).
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableRunning = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /**
     * The combined backup status as a lifecycle-aware [UiState]: loading / content / empty (no schedules and no
     * runs) / stale / offline / error, carrying the freshness stamp + error kind. Empty is a friendly
     * affordance, never a blank box (web parent's "Not configured" branch).
     */
    val status: StateFlow<UiState<BackupStatus>> =
        refreshTrigger
            .flatMapLatest { source.status() }
            .asUiState { BackupActionsCardProjection.isEmpty(it) }

    /** Whether the quick-backup mutation is in flight (web `mutation.isPending`) — disables the run button. */
    val running: StateFlow<Boolean> = mutableRunning.asStateFlow()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Call from the composable's first-composition effect.
     */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        BackupActionsCardDiagnostics.recordViewOpened(logger)
    }

    /** Re-runs the cache-then-network load — backs the error/stale retry affordance + the post-run refresh. */
    fun retry() {
        refreshTrigger.update { it + 1 }
    }

    /**
     * Runs a quick backup (web `mutation.mutate()`): a no-op while one is already in flight (the double-tap
     * guard the web enforces with `if (mutation.isPending) return`). On success it raises the "Quick backup
     * started" toast and re-collects the feed (web `invalidateQueries`); on failure it raises the permission
     * toast for a 401/403 or the generic backup-failure toast otherwise. The PII-safe run diagnostic is logged
     * regardless of outcome.
     */
    fun runQuickBackup() {
        if (mutableRunning.value) return
        mutableRunning.value = true
        BackupActionsCardDiagnostics.recordRunQuickBackup(logger)
        launch {
            source.runQuickBackup().fold(
                onSuccess = {
                    emitEvent(UiEvent.Message(messageKey = BACKUP_STARTED_KEY, severity = UiEvent.Severity.Success))
                    retry()
                },
                onFailure = { error ->
                    emitEvent(
                        UiEvent.Message(
                            messageKey = BackupActionsCardProjection.errorMessageKey(error),
                            severity = UiEvent.Severity.Error,
                        ),
                    )
                },
            )
            mutableRunning.value = false
        }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a bound [source]. */
        fun factory(
            source: BackupActionsCardSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BackupActionsCardViewModel(source, logger) }
            }
    }
}
