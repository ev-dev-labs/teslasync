// UI-thread-free state holder backing the VisuallyHidden surface's announcer region — the native port
// of the web `AnnouncerRegion` subscription (web/src/components/a11y/AnnouncerRegion.tsx) over the
// `useAnnouncer` global announcer. It binds the [Announcer] seam (P1/S8), folds every fanned-out
// announcement into the two-region [AnnouncerState] (via [routeAnnouncement]) for the ViewModel's
// lifetime, exposes [announce] for app-wide callers, and emits the PII-safe one-shot `view.opened`
// diagnostic. The view never performs work of its own — it only collects [state] and calls [announce]
// / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VisuallyHidden) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.visuallyhidden

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
 * State holder backing the Compose [AnnouncerRegion] — the Android port of the web `AnnouncerRegion`
 * over the `useAnnouncer` global announcer.
 *
 * It subscribes to the injected [Announcer] seam (the P1/S8 boundary) for its whole lifetime and routes
 * each fanned-out [Announcement] into the matching half of [AnnouncerState] (web `setPolite` /
 * `setAssertive`), so the two visually-hidden live regions always reflect the latest message at each
 * urgency. The announcer is an imperative event channel, not a cache-then-network feed, so there is no
 * loading / empty / error / stale / offline lifecycle to project (the same rationale the accepted
 * globalShortcuts / QuickNav ports document); the surface's states are the idle and announcing regions
 * the routed [state] already expresses. The view stays a thin renderer (ADR-002).
 *
 * [announce] fans a message out to every mounted region (web `announce`); [onViewOpened] emits the
 * P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param announcer the shared announcer seam (the process singleton in production, a fresh instance in
 *   tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
class VisuallyHiddenViewModel(
    private val announcer: Announcer,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val mutableState = MutableStateFlow(AnnouncerState.EMPTY)

    /** The two live regions' latest padded messages (web `AnnouncerRegion` `polite` / `assertive`). */
    val state: StateFlow<AnnouncerState> = mutableState.asStateFlow()

    init {
        // Subscribe for the ViewModel's lifetime so every fanned-out announcement is routed into the
        // matching region (web `subscribeAnnouncer` on mount). A message fired while no surface is
        // active is dropped, exactly as the web announcer drops it with no listener.
        launch {
            announcer.announcements.collect { announcement ->
                mutableState.update { current -> routeAnnouncement(current, announcement) }
            }
        }
    }

    /**
     * Fans [message] out to every mounted live region at [priority] (web `announce`). Logs only the
     * surface slug and the urgency — never the message text, so a diagnostics line cannot leak what a
     * screen-reader user was told.
     */
    fun announce(
        message: String,
        priority: AnnouncePriority = AnnouncePriority.Polite,
    ) {
        announcer.announce(message, priority)
        logger.info(
            EVENT_ANNOUNCE,
            mapOf(FIELD_SURFACE to VisuallyHiddenRegistration.SLUG, FIELD_PRIORITY to priority.name.lowercase()),
        )
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVisuallyHiddenOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            announcer: Announcer,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VisuallyHiddenViewModel(announcer, logger) }
            }
    }
}
