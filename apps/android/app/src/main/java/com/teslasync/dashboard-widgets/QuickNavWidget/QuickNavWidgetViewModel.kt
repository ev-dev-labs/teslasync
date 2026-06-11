// UI-thread-free state holder backing the Quick Navigation widget — the native counterpart to the web
// component's (state-free) composition (web/src/features/dashboard/widgets/QuickNavWidget.tsx). QuickNav
// is purely presentational: it binds no shared feed and performs no HTTP, so this holder owns no
// `UiState` and no refresh action. It exists solely to carry the cross-cutting page concern every
// surface owes the diagnostics contract (P1/S11): the one-shot, PII-safe `view.opened` event. It extends
// [BaseFeedViewModel] for the single sanctioned redacting [logger] (ADR-016) and the lifecycle scope,
// keeping the surface consistent with its data-bound siblings.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/QuickNavWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.quicknav

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives only `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class QuickNavWidgetViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. The event carries no payload beyond the slug — QuickNav reads no vehicle or activity data,
     * so a diagnostics line can never leak anything. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to QuickNavRegistration.SLUG))
    }
}
