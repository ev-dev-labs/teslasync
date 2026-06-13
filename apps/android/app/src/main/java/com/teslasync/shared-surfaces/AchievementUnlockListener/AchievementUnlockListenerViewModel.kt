// UI-thread-free state holder backing the AchievementUnlockListener shared surface — the native port of the web
// component's `useAchievementUnlocks` + `useAchievementCelebrationPrefs` composition
// (web/src/components/feedback/AchievementUnlockListener.tsx). It binds the realtime unlock stream + the live
// celebration prefs (P1/S8) through [AchievementUnlockListenerSource], folds each frame onto the immutable
// [AchievementListenerState] (the de-dup/bound/dismiss queue + the live prefs), raises the opt-in chime signal
// when a NEW unlock arrives while sound is enabled, and emits the PII-safe `view.opened` diagnostic. The view
// never performs HTTP — it only collects [state] + [chimeNonce] and calls [dismiss] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AchievementUnlockListener) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.achievementunlocklistener

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param source the unlock-stream + celebration-prefs seam (a shared-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only folds this port's frames into [state].
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` + `dismiss` events
 *   carrying only the non-PII surface slug (never an achievement id, vehicle id, or any payload text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AchievementUnlockListenerViewModel(
    private val source: AchievementUnlockListenerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AchievementListenerState())
    private val mutableChimeNonce = MutableStateFlow(0L)
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the celebration prefs (web `useAchievementCelebrationPrefs`) and the newest-first
     * unlock queue (web `useAchievementUnlocks.recent`). The render boundary classifies this into a
     * [ListenerSurface]; the queue keeps draining even when toasts are disabled (web parity).
     */
    val state: StateFlow<AchievementListenerState> = mutableState.asStateFlow()

    /**
     * A monotonically increasing chime ticket — incremented once each time a NEW unlock arrives while
     * `playSound` is enabled (web's `recent.length`-keyed chime effect). The view fires the procedural tone in a
     * `LaunchedEffect(chimeNonce)`, so a de-duped re-broadcast or an unrelated re-render never re-chimes. Starts
     * at `0` (no chime yet).
     */
    val chimeNonce: StateFlow<Long> = mutableChimeNonce.asStateFlow()

    init {
        // Bind the live celebration prefs (web `useAchievementCelebrationPrefs`); toggles take effect live.
        launch { source.celebrationPrefs().collect { prefs -> mutableState.update { it.copy(prefs = prefs) } } }
        // Drain the realtime unlock stream (web `useAchievementUnlocks`) into the de-dup/bound queue.
        launch { source.unlocks().collect { event -> onUnlock(event) } }
    }

    /**
     * Folds one realtime unlock into [state] (web `setRecent`): de-dup by id, prepend, bound. Raises the chime
     * ticket when the queue actually grew and sound is enabled. The prefs/unlocks collectors both run on the
     * single state scope, so the read-modify-write of the two flows is free of cross-collector races.
     */
    private fun onUnlock(event: AchievementUnlock) {
        val current = mutableState.value
        val next = enqueueUnlock(current.queue, event)
        if (next === current.queue) return
        if (shouldChime(current.prefs, current.queue.size, next.size)) {
            mutableChimeNonce.update { it + 1L }
        }
        mutableState.value = current.copy(queue = next)
    }

    /**
     * Removes the toast for [achievementId] once shown/dismissed (web `dismiss(id)`), so re-renders never re-show
     * an acknowledged celebration. Emits a PII-safe diagnostic with the surface slug only — never the id.
     */
    fun dismiss(achievementId: String) {
        val current = mutableState.value
        val next = dismissUnlock(current.queue, achievementId)
        if (next.size == current.queue.size) return
        logger.info("achievementUnlockListener.dismiss", mapOf("slug" to ACHIEVEMENT_UNLOCK_LISTENER_SLUG))
        mutableState.value = current.copy(queue = next)
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no achievement id, vehicle id, or payload text, so a diagnostics line can never leak fleet state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to ACHIEVEMENT_UNLOCK_LISTENER_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AchievementUnlockListenerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AchievementUnlockListenerViewModel(source, logger) }
            }
    }
}
