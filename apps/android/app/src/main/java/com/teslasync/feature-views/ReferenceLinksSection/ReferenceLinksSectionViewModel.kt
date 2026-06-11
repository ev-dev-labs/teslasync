// UI-thread-free state holder backing the Reference Links feature view — the native counterpart to the web
// component's (state-free) composition (web/src/features/admin/components/devtools/ReferenceLinksSection.tsx).
// The web source binds no data feed and performs no HTTP (its only hook is `useTranslation`), so this holder
// owns no `UiState` and no refresh action. It exists solely to carry the cross-cutting concern every surface
// owes the diagnostics contract (P1/S11): the one-shot, PII-safe `view.opened` event. It extends
// [BaseFeedViewModel] for the single sanctioned redacting [logger] (ADR-016) and the lifecycle scope, keeping
// the surface consistent with its data-bound siblings.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ReferenceLinksSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.referencelinks

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives only `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ReferenceLinksSectionViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. The event carries no payload beyond the slug — this surface reads no vehicle or activity data,
     * so a diagnostics line can never leak anything. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to ReferenceLinksRegistration.SLUG))
    }
}
