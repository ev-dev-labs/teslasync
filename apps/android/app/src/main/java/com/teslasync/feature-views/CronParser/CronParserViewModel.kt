// UI-thread-free state holder backing the Cron Parser feature view — the native counterpart to the web
// component's composition (web/src/features/admin/components/devtools/tools/CronParser.tsx). The web source
// binds no data feed and performs no HTTP (its only hook is `useTranslation`; the cron expression is local
// `useState`), so this holder owns no `UiState` and no refresh action — the expression state lives in the
// composable, exactly as it does in the web component. The holder exists solely to carry the cross-cutting
// concern every surface owes the diagnostics contract (P1/S11): the one-shot, PII-safe `view.opened` event.
// It extends [BaseFeedViewModel] for the single sanctioned redacting [logger] (ADR-016) and the lifecycle
// scope, keeping the surface consistent with its data-bound siblings.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CronParser) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.cronparser

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope

/**
 * @param logger the single sanctioned redacting logger (ADR-016); receives only `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class CronParserViewModel(
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. The event carries no payload beyond the slug — this surface reads no vehicle or activity data
     * (it only parses a locally typed cron string), so a diagnostics line can never leak anything. Call from
     * the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to CronParserRegistration.SLUG))
    }
}
