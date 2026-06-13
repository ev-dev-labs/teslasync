// UI-thread-free state holder backing the DataFreshness chip — the native port of the web component's
// query-result derivation (web/src/components/data-display/DataFreshness.tsx + its `DataFreshnessAuto`
// wrapper). It binds the shared Charging history feed (P1/S8) through [DataFreshnessSource], projects each
// cache-then-network emission onto the shared [io.teslasync.android.data.UiState] (loading / content / empty
// / stale / offline / error), and folds that into the PII-free [FreshnessSnapshot] the composable renders.
// It exposes the single refresh action (web `query.refetch()`) plus the one-shot PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [snapshot] and calls [refresh] /
// [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DataFreshness) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datafreshness

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose `DataFreshness` chip — the Android port of the web `DataFreshness` over a
 * `useQuery()` result (its worked example, the charging history feed).
 *
 * It re-collects the injected [source]'s cache-then-network charging feed for [vehicleId] (the P1/S8
 * boundary), projects each emission onto the shared [io.teslasync.android.data.UiState], and re-shares the
 * folded [FreshnessSnapshot] as a lifecycle-aware [snapshot] flow — so the chip reflects the latest freshness
 * without owning any state itself. The snapshot is PII-free: it carries the fetched-at stamp and the
 * loading / stale / error / offline signals, never the charging rows.
 *
 * [refresh] re-runs the cache-then-network load (web `query.refetch()`) and emits the PII-safe refresh
 * diagnostic; [recordViewOpened] emits the P1/S11 `view.opened` event exactly once per surface open.
 *
 * @param source the cache-then-network Charging seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only projects the feed's freshness.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the vehicle whose charging history freshness is surfaced (web `useChargingHistory(id)`).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DataFreshnessViewModel(
    private val source: DataFreshnessSource,
    logger: Logger,
    private val vehicleId: Long,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The feed's freshness as a lifecycle-aware [FreshnessSnapshot]: loading / content / empty / stale /
     * offline / error, carrying the freshness stamp without any rows. Collected only while the chip is
     * on-screen ([SharingStarted.WhileSubscribed]); the initial value is the loading snapshot so the first
     * frame is never an artificial blank.
     */
    val snapshot: StateFlow<FreshnessSnapshot> =
        refreshTrigger
            .flatMapLatest { source.chargingHistory(vehicleId) }
            .map { it.toUiState().toFreshnessSnapshot() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = FreshnessSnapshot.loading(),
            )

    /** Re-runs the cache-then-network load (the web `refetch()` affordance) and logs the PII-safe diagnostic. */
    fun refresh() {
        recordDataFreshnessRefresh(logger)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id / fetched-at / freshness payload, so a diagnostics line can never leak
     * which feed the user was viewing. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDataFreshnessOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel for [vehicleId]. */
        fun factory(
            source: DataFreshnessSource,
            logger: Logger,
            vehicleId: Long,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DataFreshnessViewModel(source, logger, vehicleId) }
            }
    }
}
