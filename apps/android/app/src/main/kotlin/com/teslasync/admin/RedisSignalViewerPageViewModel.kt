// The state holder backing the RedisSignalViewerPage admin surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query reads (web/src/features/admin/pages/RedisSignalViewerPage.tsx). It owns the
// page's local interaction state (the selected vehicle + the search/category filters + the auto-refresh toggle +
// the two-mode purge dialog) as a single immutable [RedisInteraction] snapshot, and projects the reads onto the
// shared lifecycle-aware [UiState] surface: `useVehicles` for the picker, the per-vehicle cached-signal snapshot
// (re-collected on vehicle change / refresh / the 5s auto-refresh tick), and the cluster-wide key roster for the
// diagnostic's "other vehicles" chips. The redis snapshot feed is folded into a single [RedisFeed] carrying both
// the projected [UiState] AND the upstream [DiagnosticError] from ONE collection, so the diagnostic banner never
// triggers a second fetch. The two destructive purges (web `purgeRedisSignals` / `purgeAllRedisSignals`) run off
// the UI thread and surface a one-shot localized toast; on success they re-collect the snapshot + key feeds (the
// web `invalidateQueries`). All derivation lives in the framework-free model (RedisSignalViewerPageModel.kt);
// this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling admin pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.redissignals

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.featureviews.redisdiagnosticemptystate.DiagnosticError
import io.teslasync.android.featureviews.redisdiagnosticemptystate.RedisSignalKeyEntry
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * The folded redis-snapshot surface: the projected [state] the table/stat panels render AND the [error] the
 * structured diagnostic banner consumes, both derived from ONE collection of the per-vehicle feed so the banner
 * never forces a second fetch. The web parent owns the same single `useQuery` and passes both `signalData` and
 * `errorBannerProps` derived from it.
 */
data class RedisFeed(
    val state: UiState<RedisSignalsData>,
    val error: DiagnosticError,
) {
    companion object {
        /** The pre-resolution / no-vehicle sentinel: a first load with no upstream error. */
        val LOADING: RedisFeed = RedisFeed(UiState.loading(), DiagnosticError.None)
    }
}

/**
 * @param source the P1/S8 data seam (real [redisSignalViewerSource] over the shared VehiclesStore + the resilient
 *   client ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh + the purge
 *   outcomes — never a VIN, signal name, or value.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RedisSignalViewerPageViewModel(
    private val source: RedisSignalViewerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(RedisInteraction())
    private val vehiclesRefresh = MutableStateFlow(0)
    private val signalsRefresh = MutableStateFlow(0)
    private val keysRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val vehicleIdFlow = mutableInteraction.map { it.vehicleId }.distinctUntilChanged()

    /** The page's local interaction snapshot (web `useState` group). */
    val interaction: StateFlow<RedisInteraction> = mutableInteraction.asStateFlow()

    /**
     * The fleet picker list as cache-then-network UI state (web `useVehicles`). The `Vehicle → RedisVehicleOption`
     * projection happens here so the controls bind a ready slice; re-collected when the controls' retry bumps.
     */
    val vehiclesState: StateFlow<UiState<List<RedisVehicleOption>>> =
        vehiclesRefresh
            .flatMapLatest { source.vehicles() }
            .map { resource -> resource.mapData { list -> list.map { it.toRedisOption() } } }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The per-vehicle cached-signal snapshot folded into a [RedisFeed]. Re-collected whenever the selected vehicle
     * changes or a refresh/auto-refresh trigger bumps. Gated on a selected vehicle (web `enabled: id !== null`):
     * with no vehicle it parks on the loading sentinel that the page never shows (it renders the select-prompt
     * panel instead). Both the table/stat [UiState] and the diagnostic [DiagnosticError] come from this one feed.
     */
    val redisFeed: StateFlow<RedisFeed> =
        combine(vehicleIdFlow, signalsRefresh) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null) {
                    flowOf(RedisFeed.LOADING)
                } else {
                    source.redisSignals(id).map { resource -> resource.toRedisFeed(id) }
                }
            }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), RedisFeed.LOADING)

    /**
     * The cluster-wide cached-key roster as UI state (web `getRedisSignalKeys`), feeding the diagnostic's
     * "other vehicles with cached signals" chips. Gated on a selected vehicle (the chips only show inside the
     * diagnostic) and re-collected on the same refresh as the snapshot.
     */
    val keysState: StateFlow<UiState<List<RedisSignalKeyEntry>>> =
        combine(vehicleIdFlow, keysRefresh) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null) {
                    flowOf<Resource<JsonElement>>(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                } else {
                    source.redisSignalKeys()
                }
            }
            .map { resource -> resource.mapData { RedisSignalsProjection.parseKeys(it) } }
            .asUiState(isEmpty = { it.isEmpty() })

    init {
        // Web `refetchInterval: autoRefresh ? INTERVALS.REALTIME : false`: while the toggle is on and a vehicle is
        // selected, re-collect the snapshot every 5s; flipping the toggle off (or clearing the vehicle) cancels
        // the loop via collectLatest. The keys roster intentionally does not auto-poll (the web query is static).
        launch {
            mutableInteraction
                .map { it.autoRefresh && it.vehicleId != null }
                .distinctUntilChanged()
                .collectLatest { active ->
                    while (active) {
                        delay(RedisSignalViewerPageRegistration.AUTO_REFRESH_INTERVAL_MS)
                        signalsRefresh.update { it + 1 }
                    }
                }
        }
    }

    // ── Interaction setters (web `setSelectedVehicleId` / `setSearch` / `setCategoryFilter` / `setAutoRefresh`) ──

    /** Select (or clear, with `null`) the vehicle to inspect (web `setSelectedVehicleId`). */
    fun setVehicle(id: Long?): Unit = mutableInteraction.update { it.copy(vehicleId = id) }

    /** Update the signal-name search filter (web `setSearch`). */
    fun setSearch(value: String): Unit = mutableInteraction.update { it.copy(search = value) }

    /** Update the category filter ("all" or a category label) (web `setCategoryFilter`). */
    fun setCategoryFilter(value: String): Unit = mutableInteraction.update { it.copy(categoryFilter = value) }

    /** Toggle the 5s auto-refresh poll (web `setAutoRefresh`). */
    fun setAutoRefresh(value: Boolean): Unit = mutableInteraction.update { it.copy(autoRefresh = value) }

    // ── Purge dialog (web openPurgeOne / openPurgeAll / onCancel / handlePurgeConfirm) ────────────────────────

    /**
     * Open the per-vehicle purge confirm, pinning the current vehicle as the target + its [label] at open time so
     * a mid-confirmation picker change can't retarget the destructive call (web `openPurgeOne`).
     */
    fun openPurgeOne(label: String) {
        val id = mutableInteraction.value.vehicleId ?: return
        mutableInteraction.update {
            it.copy(purgeMode = PurgeMode.One, purgeTargetId = id, purgeTargetLabel = label)
        }
    }

    /** Open the cluster-wide purge-all confirm (web `openPurgeAll`); requires a typed "PURGE ALL" to confirm. */
    fun openPurgeAll(): Unit =
        mutableInteraction.update { it.copy(purgeMode = PurgeMode.All, purgeTargetId = null, purgeTargetLabel = "") }

    /** Dismiss the purge dialog without acting; ignored mid-flight so a running DELETE keeps the dialog (web). */
    fun cancelPurge() {
        if (mutableInteraction.value.isPurging) return
        mutableInteraction.update { it.copy(purgeMode = null, purgeTargetId = null, purgeTargetLabel = "") }
    }

    /**
     * Run the pinned destructive purge off the UI thread (web `handlePurgeConfirm`). A confirm while one is in
     * flight is ignored. On success the snapshot + key feeds re-collect (web `invalidateQueries`) and the dialog
     * closes; on failure the dialog stays open (so the operator can retry) and an error toast is emitted.
     */
    fun confirmPurge() {
        val snapshot = mutableInteraction.value
        val mode = snapshot.purgeMode ?: return
        if (snapshot.isPurging) return
        launch {
            mutableInteraction.update { it.copy(isPurging = true) }
            val succeeded =
                when (mode) {
                    PurgeMode.One -> purgeOne(snapshot.purgeTargetId, snapshot.purgeTargetLabel)
                    PurgeMode.All -> purgeAll()
                }
            mutableInteraction.update {
                if (succeeded) {
                    it.copy(purgeMode = null, purgeTargetId = null, purgeTargetLabel = "", isPurging = false)
                } else {
                    it.copy(isPurging = false)
                }
            }
        }
    }

    private suspend fun purgeOne(
        targetId: Long?,
        label: String,
    ): Boolean {
        val id = targetId ?: return true
        return source
            .purge(id)
            .fold(
                onSuccess = { json ->
                    if (json.purgedFlag()) {
                        logger.info("redisSignals.purged")
                        emitToast(RedisToastKeys.PURGE_SUCCESS, listOf(label), UiEvent.Severity.Success)
                    } else {
                        emitToast(RedisToastKeys.PURGE_NOOP, listOf(label), UiEvent.Severity.Info)
                    }
                    invalidate()
                    true
                },
                onFailure = { error ->
                    logger.warn("redisSignals.purgeFailed")
                    emitToast(RedisToastKeys.PURGE_ERROR, listOf(error.message.orEmpty()), UiEvent.Severity.Error)
                    false
                },
            )
    }

    private suspend fun purgeAll(): Boolean =
        source
            .purgeAll()
            .fold(
                onSuccess = { json ->
                    if (json.hasMoreFlag()) {
                        emitToast(
                            RedisToastKeys.PURGE_ALL_PARTIAL,
                            listOf(json.purgedCount().toString(), json.purgeLimit().toString()),
                            UiEvent.Severity.Warning,
                        )
                    } else {
                        logger.info("redisSignals.purgedAll")
                        emitToast(
                            RedisToastKeys.PURGE_ALL_SUCCESS,
                            listOf(json.purgedCount().toString()),
                            UiEvent.Severity.Success,
                        )
                    }
                    invalidate()
                    true
                },
                onFailure = { error ->
                    logger.warn("redisSignals.purgeAllFailed")
                    emitToast(RedisToastKeys.PURGE_ERROR, listOf(error.message.orEmpty()), UiEvent.Severity.Error)
                    false
                },
            )

    // ── Refresh / retry (web query `refetch` + the diagnostic/error retry) ────────────────────────────────────

    /** Re-collect the snapshot feed — the web Refresh button / error retry affordance. */
    fun refresh() {
        logger.info("redisSignals.refresh")
        signalsRefresh.update { it + 1 }
    }

    /** Re-collect the fleet list — the controls' hard-error retry affordance. */
    fun refreshVehicles() {
        logger.info("redisSignals.refreshVehicles")
        vehiclesRefresh.update { it + 1 }
    }

    /** Re-collect both the snapshot + key feeds (the post-purge `invalidateQueries` analogue). */
    private fun invalidate() {
        signalsRefresh.update { it + 1 }
        keysRefresh.update { it + 1 }
    }

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordRedisSignalViewerPageOpened(logger)
    }

    private fun emitToast(
        key: String,
        args: List<String>,
        severity: UiEvent.Severity,
    ): Unit = emitEvent(UiEvent.Message(messageKey = key, args = args, severity = severity))
}

/** Folds a redis-snapshot [Resource] into the [RedisFeed] the page renders — the table/stat state + the banner error. */
private fun Resource<JsonElement>.toRedisFeed(vehicleId: Long): RedisFeed =
    RedisFeed(
        state = mapData { RedisSignalsProjection.parseSignals(vehicleId, it) }.toUiState { it.isEmpty },
        error = toDiagnosticError(),
    )
