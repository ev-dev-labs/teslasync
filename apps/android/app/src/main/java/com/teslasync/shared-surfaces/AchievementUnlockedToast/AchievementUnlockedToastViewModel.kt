// UI-thread-free state holder backing the AchievementUnlockedToast surface — the native port of the state the
// web source owns across its hook composition (web/src/components/feedback/AchievementUnlockedToast.tsx, where
// the stack owns `useAchievementUnlocks` and each toast owns its `setTimeout` auto-dismiss). It binds the
// unlock queue + wire health through the shared [AchievementUnlockedToastSource] (no HTTP touches the view,
// ADR-002), folds them through the pure [AchievementUnlockedToastProjection], runs the per-toast auto-dismiss
// timer (the native `setTimeout(onDismiss, durationMs)`), routes dismiss/view/retry to the shared holders, and
// emits the one PII-safe `view.opened` diagnostic (P1/S11). The view never performs HTTP or timing — it only
// collects [state] and forwards the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AchievementUnlockedToast) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlockedtoast

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * State holder for the achievement-unlocked toast stack.
 *
 * The unlock queue + wire health are folded from the shared [AchievementUnlockedToastSource] through the pure
 * [AchievementUnlockedToastProjection], so the surface renders the real loading / empty / content / error /
 * stale / offline lifecycle. On top of it the holder runs the per-toast auto-dismiss clock — each newly-seen
 * toast schedules a [durationMs] timer that re-acks the unlock (the web per-toast `setTimeout(onDismiss, …)`),
 * and a toast that leaves the queue (manual dismiss, or another surface acking it) cancels its timer.
 * [dismiss] re-acks immediately, [view] re-acks then hands the id to the host deep link (web `handleView`:
 * `onDismiss()` then `navigate('/lifetime?achievement=…')`), and [retry] forces a fresh wire.
 * [recordViewOpened] emits the single PII-safe `view.opened` diagnostic.
 *
 * @param source the unlock-queue + wire-health seam (a shared-holder adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param durationMs the per-toast auto-dismiss lifetime (web `durationMs`, default 6s); `0` disables it.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AchievementUnlockedToastViewModel(
    private val source: AchievementUnlockedToastSource,
    logger: Logger,
    private val durationMs: Long = AchievementUnlockedToastRegistration.DEFAULT_DURATION_MS,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AchievementUnlockedToastProjection.loading())

    /** The live toast-stack state the view collects; `.value` is always the latest folded snapshot. */
    val state: StateFlow<AchievementToastFeed> = mutableState.asStateFlow()

    private val dismissJobs = mutableMapOf<String, Job>()
    private var viewOpenedRecorded = false

    init {
        stateScope.launch {
            source.feed().collect { snapshot ->
                val feed =
                    AchievementUnlockedToastProjection.project(
                        unlocks = snapshot.unlocks,
                        connection = snapshot.connection,
                        stale = snapshot.stale,
                        lastMessageAtMillis = snapshot.lastMessageAtMillis,
                    )
                mutableState.value = feed
                reconcileAutoDismiss(feed.toasts)
            }
        }
    }

    /**
     * Re-acks the unlock for [achievementId] now (web manual `onDismiss`) — cancels its pending auto-dismiss
     * and removes it from the shared queue so the celebration is not replayed.
     */
    fun dismiss(achievementId: String) {
        dismissJobs.remove(achievementId)?.cancel()
        source.dismiss(achievementId)
    }

    /**
     * The "View →" affordance — the web `handleView`: dismiss the toast, then hand the achievement id to the
     * host deep link (`navigate('/lifetime?achievement=…')`). The native nav is host-routed via [onOpen] (the
     * `useNavigate` seam), so the surface never owns navigation.
     */
    fun view(
        achievementId: String,
        onOpen: (String) -> Unit,
    ) {
        dismiss(achievementId)
        onOpen(achievementId)
    }

    /** Forces a fresh live connection — backs the error-surface reconnect and the stale auto-refresh. */
    fun retry() {
        source.reconnect()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no achievement name / id / unlock timestamp, so a diagnostics line can never leak the owner's
     * progress. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAchievementUnlockedToastOpened(logger)
    }

    /**
     * Schedules a [durationMs] auto-dismiss for every newly-seen toast and cancels the timer for any toast no
     * longer in the queue — the native port of the web per-toast `setTimeout` (mount → schedule, unmount →
     * `clearTimeout`). Idempotent per id, so a re-projection of the same queue never double-schedules.
     */
    private fun reconcileAutoDismiss(toasts: List<AchievementToast>) {
        val present = toasts.mapTo(mutableSetOf()) { it.id }
        dismissJobs.keys
            .filterNot { it in present }
            .forEach { dismissJobs.remove(it)?.cancel() }
        if (durationMs <= 0L) return
        present
            .filterNot { it in dismissJobs }
            .forEach { id ->
                dismissJobs[id] =
                    stateScope.launch {
                        delay(durationMs)
                        dismissJobs.remove(id)
                        source.dismiss(id)
                    }
            }
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AchievementUnlockedToastSource,
            logger: Logger,
            durationMs: Long = AchievementUnlockedToastRegistration.DEFAULT_DURATION_MS,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AchievementUnlockedToastViewModel(source, logger, durationMs) }
            }
    }
}
