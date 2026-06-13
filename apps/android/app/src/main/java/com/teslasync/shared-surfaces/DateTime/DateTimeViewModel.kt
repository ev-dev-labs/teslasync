// UI-thread-free state holder backing the DateTime shared surface's timezone-aware path — the native port of
// the provider subscription the web `DateTimeWithTz` takes on when given an `in` / `showTz` prop
// (web/src/components/data-display/format/DateTime.tsx). It binds the [DateTimeSource] seam (P1/S8), combines
// the `/settings` document feed, the enrolled-vehicle feed, and the persisted selection so the resolved zone +
// locale re-derive whenever settings change OR the user picks a vehicle, projects each combination onto the
// shared [UiState] surface (loading / content / stale / offline / error) via [combineZoneResources], and emits
// the PII-safe one-shot `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and
// calls [refresh] / [retry] / [onViewOpened]; the actual timestamp `value` and the per-call `in` / `showTz`
// stay render-boundary inputs (the zone config is what is fetched, never the value).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DateTime) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datetime

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
 * State holder backing the Compose tz-aware [DateTime] surface — the Android port of the web `DateTimeWithTz`
 * provider subscription.
 *
 * It binds the injected [DateTimeSource] (the P1/S8 seam) to a lifecycle-aware [UiState] of the projected
 * [DateTimeSettings]: the settings document feed, the enrolled-vehicle feed, and the persisted [selectedId]
 * are combined through [combineZoneResources] so the resolved zone + locale re-derive whenever any input
 * changes. The result covers every freshness state the P3 checklist mandates — loading (first fetch),
 * content (the resolved config), and — through the ADR-013 contract — stale, offline (the cached config kept
 * visible with the staleness + error flags), and hard error (no cached config). The zone config is never
 * "empty" (each absent input degrades to its web default), so the surface's empty state is the value-level
 * em-dash marker the view renders, not a phase here. The view stays a thin renderer; it performs no HTTP
 * (ADR-002).
 *
 * [refresh] / [retry] restart the feeds; [onViewOpened] emits the P1/S11 `view.opened` diagnostics event
 * exactly once per surface open.
 *
 * @param source the shared settings + fleet + selection seam (the real holders in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DateTimeViewModel(
    private val source: DateTimeSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    /** The resolved zone-config inputs as cache-then-network UI state (settings + active-vehicle zone + locale). */
    val state: StateFlow<UiState<DateTimeSettings>> =
        combine(
            restart.flatMapLatest { source.settings() },
            restart.flatMapLatest { source.vehicles() },
            source.selectedId,
        ) { settings, vehicles, selectedId -> combineZoneResources(settings, vehicles, selectedId) }
            .asUiState { false }

    /** Re-fetches the settings + vehicle feeds (web `useSettings` / `useVehicles` refetch). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("surface" to DateTimeRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the offline / hard-error retry affordance. */
    fun retry() = refresh()

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDateTimeOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "dateTime.refresh"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: DateTimeSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DateTimeViewModel(source, logger) }
            }
    }
}
