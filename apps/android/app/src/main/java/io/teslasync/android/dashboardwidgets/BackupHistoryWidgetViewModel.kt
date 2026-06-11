package io.teslasync.android.dashboardwidgets

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement
import java.time.LocalDate

/**
 * Static registry metadata for the BackupHistory surface — the canonical id, category and grid-size
 * constraints from web/src/features/dashboard/widgets/registry/energy.ts. A dashboard host registers
 * the surface with this id and honors these size bounds, mirroring the web registry exactly.
 */
object BackupHistoryWidgetDescriptor {
    /** Canonical registry id (web `backup-history`). */
    const val ID: String = "backup-history"

    /** Registry category (web `energy`). */
    const val CATEGORY: String = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SURFACE_SLUG: String = "BackupHistoryWidget"

    /** Registry default footprint (2×4). */
    val defaultSize: BackupHistorySize = BackupHistorySize(cols = 2, rows = 4)

    /** Registry minimum footprint (1×2). */
    val minSize: BackupHistorySize = BackupHistorySize(cols = 1, rows = 2)

    /** Registry maximum footprint (4×40). */
    val maxSize: BackupHistorySize = BackupHistorySize(cols = 4, rows = 40)
}

/**
 * Widget ViewModel for the BackupHistory surface. It binds the shared KMP [EnergyStore] (the P1/S8 port
 * of the web `useEnergy` domain) — composing `teslaEnergySites` (for the first site id) with
 * `teslaBackupHistory` over a trailing 30-day window, exactly as the web widget does — and projects the
 * combined cache-then-network [Resource] onto a lifecycle-aware [UiState].
 *
 * It owns NO networking: the store and its repository do (ADR-002). The view stays a stateless
 * Composable that collects [state] and calls [refresh] / [onAppear]. A host constructs this with the
 * shared store; nothing here reaches the network directly.
 *
 * @param energy the shared Energy state holder (S8) both feeds and refreshes route through.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses the ViewModel scope.
 * @param since the trailing-window start (ISO date); defaults to thirty days ago (web `thirtyDaysAgo`).
 */
class BackupHistoryWidgetViewModel(
    private val energy: EnergyStore,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val since: String = defaultBackupSince(),
) : BaseFeedViewModel(logger, scope) {
    /** The combined site + backup-history snapshot as cache-then-network UI state. */
    val state: StateFlow<UiState<BackupHistorySnapshot>> =
        backupHistoryResource(
            sites = energy.teslaEnergySites(),
            history = { siteId -> energy.teslaBackupHistory(siteId, since) },
        ).asUiState(isEmpty = { !it.hasEvents })

    /** Emits the P1/S11 `view.opened` diagnostics event for this surface (consent-gated, redacted). */
    fun onAppear() {
        logger.info("view.opened", mapOf("surface" to BackupHistoryWidgetDescriptor.SURFACE_SLUG))
    }

    /** Re-fetches the energy sites and (when one is linked) that site's backup history (web handleRefresh). */
    fun refresh() {
        logger.info("backupHistory.refresh")
        launch {
            energy.refreshTeslaEnergySites()
            state.value.data
                ?.siteId
                ?.let { energy.refreshTeslaBackupHistory(it) }
        }
    }
}

/** Thirty days ago as an ISO date (`YYYY-MM-DD`) — the web `thirtyDaysAgo()` window start. */
internal fun defaultBackupSince(today: LocalDate = LocalDate.now()): String = today.minusDays(BACKUP_HISTORY_WINDOW_DAYS).toString()

/**
 * Composes the energy-sites feed with the per-site backup-history feed into one cache-then-network
 * [Resource] of a [BackupHistorySnapshot]. When no site resolves the history feed is never started and
 * the sites resource is mapped to the no-site snapshot (web short-circuits on a missing `siteId`).
 * Otherwise the two resources are merged so the combined loading/error/stale freshness mirrors the web's
 * `isLoading`/`isError`/`isStale` OR-combination and `updatedAt = max(...)`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun backupHistoryResource(
    sites: Flow<Resource<JsonElement>>,
    history: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<BackupHistorySnapshot>> =
    sites.flatMapLatest { sitesRes ->
        when (val siteId = BackupHistorySnapshot.parseFirstSiteId(sitesRes.cached)) {
            null -> flowOf(sitesRes.toNoSiteSnapshot())
            else -> history(siteId).map { eventsRes -> mergeBackupHistory(sitesRes, eventsRes, siteId) }
        }
    }

private fun Resource<JsonElement>.toNoSiteSnapshot(): Resource<BackupHistorySnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { BackupHistorySnapshot.NO_SITES }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(BackupHistorySnapshot.NO_SITES, fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let { BackupHistorySnapshot.NO_SITES }, fetchedAt, stale, error)
    }

private fun mergeBackupHistory(
    sites: Resource<JsonElement>,
    events: Resource<JsonElement>,
    siteId: Long,
): Resource<BackupHistorySnapshot> {
    val snapshot = events.cached?.let { BackupHistorySnapshot.fromSiteAndEvents(siteId, it) }
    val fetchedAt = maxFetchedAt(sites.fetchedAtOrNull(), events.fetchedAtOrNull())
    val combinedStale = sites.stale || events.stale
    return when {
        sites is Resource.Error || events is Resource.Error ->
            Resource.Error(snapshot, fetchedAt, stale = true, error = mergeError(sites, events))
        sites is Resource.Loading || events is Resource.Loading ->
            Resource.Loading(snapshot, fetchedAt, combinedStale)
        else ->
            Resource.Success(
                snapshot ?: BackupHistorySnapshot.siteWithoutEvents(siteId),
                fetchedAt ?: 0L,
                stale = false,
            )
    }
}

private fun mergeError(
    sites: Resource<JsonElement>,
    events: Resource<JsonElement>,
): Throwable =
    (events as? Resource.Error)?.error
        ?: (sites as? Resource.Error)?.error
        ?: IllegalStateException("backup history unavailable")

private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

private fun maxFetchedAt(
    a: Long?,
    b: Long?,
): Long? = listOfNotNull(a, b).maxOrNull()

private const val BACKUP_HISTORY_WINDOW_DAYS: Long = 30L
