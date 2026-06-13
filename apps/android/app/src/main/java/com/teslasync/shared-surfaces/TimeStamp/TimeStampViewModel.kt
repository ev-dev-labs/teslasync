// UI-thread-free state holder backing the TimeStamp shared surface — the native port of the provider
// subscription the web `TimeStamp` takes on through `useTimeFormatPreference` + `useDateFormat`
// (web/src/components/data-display/TimeStamp.tsx). It binds the [TimeStampSource] seam (P1/S8), combines the
// `/settings` document feed, the enrolled-vehicle feed, and the persisted selection so the resolved format +
// zone + locale re-derive whenever settings change OR the user picks a vehicle, projects each combination
// onto the shared [UiState] surface (loading / content / stale / offline / error) via [combineSettings], and
// emits the PII-safe one-shot `view.opened` diagnostic. The view never performs HTTP — it only collects
// [state] and calls [refresh] / [retry] / [onViewOpened]; the actual timestamp `value` and the per-call
// `format` / `in` stay render-boundary inputs (the format + zone config is what is fetched, never the value).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TimeStamp) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timestamp

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
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [TimeStamp] surface — the Android port of the web `TimeStamp`'s
 * `useTimeFormatPreference` + `useDateFormat` provider subscription.
 *
 * It binds the injected [TimeStampSource] (the P1/S8 seam) to a lifecycle-aware [UiState] of the projected
 * [TimeStampSettings]: the settings document feed, the enrolled-vehicle feed, and the persisted [selectedId]
 * are combined through [combineSettings] so the resolved format + zone + locale re-derive whenever any input
 * changes. The result covers every freshness state the P3 checklist mandates — loading (first fetch), content
 * (the resolved config), and — through the ADR-013 contract — stale, offline (the cached config kept visible
 * with the staleness + error flags), and hard error (no cached config). The config is never "empty" (each
 * absent input degrades to its web default), so the surface's empty state is the value-level em-dash marker
 * the view renders, not a phase here. The view stays a thin renderer; it performs no HTTP (ADR-002).
 *
 * [refresh] / [retry] restart the feeds; [onViewOpened] emits the P1/S11 `view.opened` diagnostics event
 * exactly once per surface open.
 *
 * @param source the shared settings + fleet + selection seam (the real holders in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TimeStampViewModel(
    private val source: TimeStampSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    /** The resolved format + zone + locale inputs as cache-then-network UI state (settings + active-vehicle zone). */
    val state: StateFlow<UiState<TimeStampSettings>> =
        combine(
            restart.flatMapLatest { source.settings() },
            restart.flatMapLatest { source.vehicles() },
            source.selectedId,
        ) { settings, vehicles, selectedId -> combineSettings(settings, vehicles, selectedId) }
            .asUiState { false }

    /** Re-fetches the settings + vehicle feeds (web `useSettings` / `useVehicles` refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("surface" to TimeStampRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the offline / hard-error retry affordance. */
    fun retry() = refresh()

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTimeStampOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "timeStamp.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: TimeStampSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TimeStampViewModel(source, logger) }
            }
    }
}
