// UI-thread-free state holder backing the DevToolsPage feature view (P1/S8) — the native counterpart of the
// web page's local tab state (web/src/features/admin/pages/DevToolsPage.tsx `useUrlEnum('tab', …)`). The web
// page binds no data feed (its sections own their own hooks), so this holder owns no `UiState` and no refresh
// action: it carries the single piece of page-local interaction state (the selected tab) as an immutable
// [StateFlow] the composable collects, plus the cross-cutting `view.opened` diagnostic every surface owes
// (P1/S11). It extends [BaseFeedViewModel] for the single sanctioned redacting [logger] (ADR-016) and the
// lifecycle scope, keeping the surface consistent with its data-bound siblings.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DevToolsPage) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.devtoolspage

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives only `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class DevToolsPageViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    private val mutableActiveTab = MutableStateFlow(DevToolsTab.DEFAULT)

    /** The selected dev-tools tab (web `useUrlEnum('tab', …)` controlled selection). */
    val activeTab: StateFlow<DevToolsTab> = mutableActiveTab.asStateFlow()

    /** Select a tab (web `setTab`). */
    fun selectTab(tab: DevToolsTab) {
        mutableActiveTab.update { tab }
    }

    /** Select a tab by its persisted key, clamping unknown/null keys to the default (web `setTab(k as TabKey)`). */
    fun selectTabByKey(key: String) {
        selectTab(DevToolsTab.fromKey(key))
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDevToolsOpened(logger)
    }
}
