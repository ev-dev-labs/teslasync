// UI-thread-free state holder backing the BottomTabBar surface — the native port of the web `useLocation()`
// read (web/src/components/layout/BottomTabBar.tsx derives the active tab from `location.pathname`). It binds
// the current-route feed through [BottomTabBarSource] and performs no HTTP itself (ADR-002): the view collects
// [currentPath] and folds it through the pure [BottomTabBarProjection]. The current route is the genuine live
// dependency a navigation bar tracks, so its stream drives which tab the bar highlights.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BottomTabBar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.bottomtabbar

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.navigation.RouteTable
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose `BottomTabBar` — the Android port of the web `BottomTabBar` over a
 * `useLocation()` result.
 *
 * It re-collects the injected [source]'s current-route feed (the P1/S8 router boundary) and re-shares the
 * normalized current path as a lifecycle-aware [currentPath] flow — so the bar reflects the latest route
 * without owning any navigation state itself. The path is normalized once here so the composable's per-tab
 * active checks share a single canonical input. [recordViewOpened] emits the P1/S11 `view.opened` event
 * exactly once per surface open, carrying only the surface slug — never the route the user is on.
 *
 * @param source the current-route seam (a router-state-holder adapter in production, a fake in tests). The
 *   view-model owns no networking and no navigation controller — it only projects the route feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class BottomTabBarViewModel(
    source: BottomTabBarSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The current route path as a lifecycle-aware [StateFlow], normalized via [RouteTable.normalize] so a
     * trailing slash or query string never flips a tab's active state. Collected only while the bar is
     * on-screen ([SharingStarted.WhileSubscribed]); the initial value is the root path so the first frame
     * highlights the Dashboard tab rather than nothing.
     */
    val currentPath: StateFlow<String> =
        source
            .currentPath()
            .map { RouteTable.normalize(it) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = BottomTabBarProjection.ROOT_PATH,
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no route path or active tab, so a diagnostics line can never leak which screen the user is on.
     * Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        BottomTabBarDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: BottomTabBarSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BottomTabBarViewModel(source, logger) }
            }
    }
}
