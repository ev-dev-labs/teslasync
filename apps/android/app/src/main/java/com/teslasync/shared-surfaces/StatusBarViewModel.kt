// UI-thread-free state holder backing the StatusBar surface — the native port of the web container's single
// local read (web/src/components/layout/StatusBar.tsx binds `useStatusBarPrefs`). It binds the preference
// feed through [StatusBarSource] and performs no HTTP or persistence itself (ADR-002): the view collects
// [state] and folds it through the pure [StatusBarProjection]. The persisted preferences are the surface's
// primary (and only) async dependency, so their cache-then-network lifecycle drives the shell's
// loading / content / empty (disabled) / error / stale / offline states. The five status segments the bar
// composes are each their own shared surface (A-0178…), wired into slots by the host, so this holder owns
// none of their data.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StatusBar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.statusbar

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder for the StatusBar surface.
 *
 * The preference feed is re-shared as a lifecycle-aware [UiState] so the composable can switch the bar's
 * surface — loading (first hydrate), content (the enabled bar with its segment slots), the empty/disabled
 * branch (a friendly restore affordance instead of the web's blank `return null`), a hard error with retry,
 * and the stale/offline freshness envelope — without re-deriving the cache-then-network contract.
 * [setEnabled]/[setIconOnly] persist + broadcast the user's preference (web `setStatusBarPrefs`),
 * [refresh]/[retry] re-read persistence, and [onViewOpened] emits the one PII-safe `view.opened` diagnostic
 * (P1/S11) — the surface slug only, never a VIN, route, or any segment content.
 *
 * @param source the preference seam (a shared-store adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StatusBarViewModel(
    private val source: StatusBarSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The persisted bar preferences as lifecycle-aware [UiState] — the surface's primary feed. A disabled
     * bar is treated as the structurally-empty phase (the bar's restore-affordance branch) via the
     * [StatusBarProjection.isHidden] predicate, so the empty state is honest rather than a blank footer.
     */
    val state: StateFlow<UiState<StatusBarPreferences>> =
        refreshTrigger
            .flatMapLatest { source.preferences() }
            .asUiState(isEmpty = { StatusBarProjection.isHidden(it) })

    init {
        // Trigger the first persistence read; `state` starts at loading and flips to content/empty/error.
        source.hydrate()
    }

    /** Persists + broadcasts the show/hide preference (web `setStatusBarPrefs({ enabled })`). */
    fun setEnabled(enabled: Boolean) {
        logger.info(EVENT_PREFS, surfaceField)
        source.setEnabled(enabled)
    }

    /** Persists + broadcasts the icon-only preference (web `setStatusBarPrefs({ iconOnly })`). */
    fun setIconOnly(iconOnly: Boolean) {
        logger.info(EVENT_PREFS, surfaceField)
        source.setIconOnly(iconOnly)
    }

    /** Re-reads persistence after a hard error (web has no equivalent — this backs the bar's retry). */
    fun retry() {
        logger.info(EVENT_REFRESH, surfaceField)
        source.hydrate()
        refreshTrigger.update { it + 1 }
    }

    /** Re-reads persistence; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no VIN, route, or segment content. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, surfaceField)
    }

    private val surfaceField: Map<String, String> get() = mapOf(SURFACE_KEY to StatusBarRegistration.SLUG)

    companion object {
        private const val SURFACE_KEY = "surface"
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "statusBar.refresh"
        private const val EVENT_PREFS = "statusBar.prefs"

        /** Wires the surface from the shared [StatusBarPrefsStore] (web `useStatusBarPrefs`). */
        fun create(
            store: StatusBarPrefsStore,
            logger: Logger,
        ): StatusBarViewModel = StatusBarViewModel(StoreStatusBarSource(store), logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: StatusBarSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { StatusBarViewModel(source, logger) }
            }
    }
}
