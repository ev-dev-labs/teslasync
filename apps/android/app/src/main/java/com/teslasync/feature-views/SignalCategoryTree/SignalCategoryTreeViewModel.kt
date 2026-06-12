// UI-thread-free state holder + data seam backing the SignalCategoryTree feature view — the native port of
// the single `useAvailableSignals` query the web component owns plus the per-leaf `useSignalHistory`
// sparkline feed its SignalSparklinePreview child opens lazily
// (web/src/features/telemetry/components/SignalCategoryTree.tsx + SignalSparklinePreview.tsx +
// web/src/api/hooks/useSignals.ts). It binds the shared S8 [SignalsStore] through
// [SignalCategoryTreeSource]: the catalog feed is projected onto a single [UiState] of the grouped
// [SignalCatalog], and the history feed is handed to the view as a per-signal cold flow the leaf row
// subscribes to only while its category is expanded (web's `enabled` gate). The view never performs HTTP —
// it only collects [state] and calls [refresh] / [recordViewOpened]. A non-positive vehicle id holds the
// neutral empty state (web disabled query).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalCategoryTree) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcategorytree

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.signals.AvailableSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalHistoryRange
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * The data port the surface binds to — the native analogue of the web `useAvailableSignals` +
 * `useSignalHistory` hook composition and the P1/S8 state-holder boundary. A concrete adapter over the
 * shared [SignalsStore] (or a test fake) drives this seam; the view never performs HTTP.
 *
 * [availableSignals] is the catalog the tree groups (web `useAvailableSignals` → `/signals/{id}/available`);
 * [signalHistory] is one signal's trailing-hour series backing its lazy sparkline (web
 * `useSignalHistory(id, signal, { hours: 1, limit: 30 })`); [refresh] re-fetches the catalog (the web
 * query's refetch / the surface's retry affordance).
 */
interface SignalCategoryTreeSource {
    /** Stream a vehicle's available-signal catalog (web `useAvailableSignals`). */
    fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>>

    /** Stream one signal's trailing-hour history for its sparkline (web `useSignalHistory`). */
    fun signalHistory(
        vehicleId: Long,
        signalName: String,
    ): Flow<Resource<SignalHistoryResponse>>

    /** Re-fetch the catalog feed for [vehicleId] (web query refetch / retry affordance). */
    suspend fun refresh(vehicleId: Long)
}

/**
 * Binds the surface to the shared S8 [SignalsStore] — the holder these feeds already share app-wide. The
 * history feed pins the [SPARKLINE_HOURS]/[SPARKLINE_LIMIT] trailing window (web's sparkline range), and
 * [SignalCategoryTreeSource.refresh] bumps the shared catalog feed so every observer re-collects.
 */
fun SignalsStore.asSignalCategoryTreeSource(): SignalCategoryTreeSource {
    val store = this
    return object : SignalCategoryTreeSource {
        override fun availableSignals(vehicleId: Long): Flow<Resource<AvailableSignalsResponse>> = store.availableSignals(vehicleId)

        override fun signalHistory(
            vehicleId: Long,
            signalName: String,
        ): Flow<Resource<SignalHistoryResponse>> = store.signalHistory(vehicleId, signalName, SPARKLINE_RANGE)

        override suspend fun refresh(vehicleId: Long) {
            store.refreshAvailableSignals(vehicleId)
        }
    }
}

/** The trailing-hour, 30-sample sparkline window every leaf pulls (web sparkline `useSignalHistory`). */
private val SPARKLINE_RANGE = SignalHistoryRange(hours = SPARKLINE_HOURS, limit = SPARKLINE_LIMIT)

/**
 * @param source the cache-then-network signals seam (a shared-store adapter in production, a fake in
 *   tests). The view-model owns no networking — it only collects + projects the catalog feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the host-selected vehicle (web parent's vehicle picker). A non-positive id holds the
 *   empty catalog so the tree shows its friendly empty state rather than spinning (web `enabled:false`).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class SignalCategoryTreeViewModel(
    private val source: SignalCategoryTreeSource,
    logger: Logger,
    private val vehicleId: Long,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The grouped catalog as cache-then-network UI state — the projection of the single
     * `useAvailableSignals` feed. No available signals (or no vehicle) ⇒ [UiState] Empty; a hard failure
     * with cached groups keeps them visible (stale/offline) per the ADR-013 freshness contract.
     */
    val state: StateFlow<UiState<SignalCatalog>> = catalogFeed().asUiState { it.isEmpty }

    /** Records the one-shot, PII-safe `view.opened` diagnostics event (P1/S11) — slug only. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSignalCategoryTreeOpened(logger)
    }

    /** Re-fetches the catalog feed (web query refetch); backs the error-surface retry + stale auto-refresh. */
    fun refresh() {
        logger.info("signalCategoryTree.refresh")
        if (vehicleId > 0L) {
            launch { source.refresh(vehicleId) }
        }
    }

    /**
     * The rendered feed: the configured vehicle's catalog projected onto [SignalCatalog], or a resolved
     * empty catalog when no vehicle is selected (web disabled-query branch), all without issuing HTTP.
     */
    private fun catalogFeed(): Flow<Resource<SignalCatalog>> =
        if (vehicleId > 0L) {
            source.availableSignals(vehicleId).map { it.toCatalogResource() }
        } else {
            flowOf(Resource.Success(SignalCatalog.EMPTY, fetchedAt = 0L, stale = false))
        }

    /** Project the catalog [Resource] onto a [SignalCatalog] [Resource], retaining the cache across states. */
    private fun Resource<AvailableSignalsResponse>.toCatalogResource(): Resource<SignalCatalog> =
        when (this) {
            is Resource.Loading ->
                Resource.Loading(
                    cached = cached?.let { SignalCategoryTreeProjection.buildCatalog(it.signals) },
                    fetchedAt = fetchedAt,
                    stale = stale,
                )

            is Resource.Success ->
                Resource.Success(
                    data = SignalCategoryTreeProjection.buildCatalog(data.signals),
                    fetchedAt = fetchedAt,
                    stale = stale,
                )

            is Resource.Error ->
                Resource.Error(
                    cached = cached?.let { SignalCategoryTreeProjection.buildCatalog(it.signals) },
                    fetchedAt = fetchedAt,
                    stale = stale,
                    error = error,
                )
        }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: SignalCategoryTreeSource,
            logger: Logger,
            vehicleId: Long,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SignalCategoryTreeViewModel(source, logger, vehicleId) }
            }
    }
}
