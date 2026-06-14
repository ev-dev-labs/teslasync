// UI-thread-free state holder backing the StickyCompactHero shared surface — the native port of the reads behind
// the web bar (web/src/components/status/StickyCompactHero.tsx). It binds the host's instance-health feed through
// [StickyCompactHeroSource] and exposes [state] — the status as cache-then-network [UiState] (loading / content /
// empty / stale / offline / error) — the single leg that drives the bar's chrome. It exposes the refresh action
// plus the one-shot PII-safe `view.opened` diagnostic (P1/S11). The view never performs HTTP and never touches
// persistence — it only collects the flow and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StickyCompactHero) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose `StickyCompactHero` surface — the Android port of the web bar's `status` prop
 * + `onRefresh` handler composition.
 *
 * The host's instance-health feed is projected onto a lifecycle-aware [state] (collected only while the surface
 * is on-screen). [refresh] re-collects the feed (the web `onRefresh` re-check / the error-retry + stale
 * auto-refresh affordance) and logs a slug-only PII-safe event, and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open. The view-model owns no networking and no persistence — it
 * only projects the source's feed and forwards the surface's actions.
 *
 * @param source the status feed seam (a host adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StickyCompactHeroViewModel(
    private val source: StickyCompactHeroSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network status feed (the manual re-check affordance, web
    // `onRefresh`), and re-drives the stale/offline retry.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val statusFeed: Flow<Resource<HeroStatus>> = refreshTrigger.flatMapLatest { source.status() }

    /**
     * The instance health as cache-then-network UI state (loading / content / empty / stale / offline / error) —
     * the single leg that drives the bar's chrome. A decoded status is always one of the five [HeroStatus]
     * values, so the feed never reports empty (`isEmpty = { false }`); the stateless renderer still honours a
     * defensive empty branch, which collapses to the same "status unknown" face.
     */
    val state: StateFlow<UiState<HeroStatus>> = statusFeed.asUiState(isEmpty = { false })

    /**
     * Re-runs the cache-then-network status load — the web `onRefresh` re-check plus the error-surface retry /
     * stale auto-refresh. Logs a PII-safe, slug-only event.
     */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to StickyCompactHeroRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no health value or timestamp, so a diagnostics line can never leak the instance state. Call from
     * the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordStickyCompactHeroOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "stickyCompactHero.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: StickyCompactHeroSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { StickyCompactHeroViewModel(source, logger) }
            }
    }
}
