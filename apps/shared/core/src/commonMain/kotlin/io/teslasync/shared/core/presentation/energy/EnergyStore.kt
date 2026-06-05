package io.teslasync.shared.core.presentation.energy

import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TESLA_BACKUP_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_ENERGY_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_ENERGY_SITES_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_LIVE_STATUS_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_LIVE_STATUS_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.TESLA_WC_CHARGING_HISTORY_FAMILY
import io.teslasync.shared.core.data.repo.batteryCellsKey
import io.teslasync.shared.core.data.repo.batteryDegradationKey
import io.teslasync.shared.core.data.repo.batteryHealthAnalyticsKey
import io.teslasync.shared.core.data.repo.batteryHealthKey
import io.teslasync.shared.core.data.repo.energyFlowKey
import io.teslasync.shared.core.data.repo.energyKeyInFamily
import io.teslasync.shared.core.data.repo.energyStatsKey
import io.teslasync.shared.core.data.repo.projectedRangeKey
import io.teslasync.shared.core.data.repo.sleepEfficiencyKey
import io.teslasync.shared.core.data.repo.teslaBackupHistoryKey
import io.teslasync.shared.core.data.repo.teslaEnergyHistoryKey
import io.teslasync.shared.core.data.repo.teslaEnergySitesKey
import io.teslasync.shared.core.data.repo.teslaLiveStatusHistoryKey
import io.teslasync.shared.core.data.repo.teslaLiveStatusKey
import io.teslasync.shared.core.data.repo.teslaSiteInfoKey
import io.teslasync.shared.core.data.repo.teslaWcChargingHistoryKey
import io.teslasync.shared.core.data.repo.vampireDrainEventsKey
import io.teslasync.shared.core.data.repo.vampireDrainStatsKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * UI-free shared state holder for the Energy domain — the cross-platform port of the web
 * `useEnergy` hook domain (web/src/api/hooks/useEnergy.ts). Every native Energy / Battery /
 * Tesla-Energy-Site screen (Android/Apple via KMP, Windows via the C# port) binds to this single
 * holder rather than re-implementing endpoints, query keys, the `safeArray` guards, or the
 * invalidation families.
 *
 * The seventeen reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 * each is lazily created on first access, shared so every observer of the same `(feed, params)`
 * folds into one upstream collection, and refreshable. Every read carries a raw SI [JsonElement]
 * (none of the energy shapes has a generated DTO). The seven mutations are non-throwing suspend
 * [Result]s; on success each refreshes EXACTLY the feed family the matching web hook invalidates
 * via `invalidateQueries`:
 *  - [refreshTeslaEnergySites]        → the `tesla-energy-sites` family;
 *  - [refreshTeslaEnergySiteInfo]     → only the refreshed site's `tesla-site-info|{siteId}` key
 *                                       (web `['tesla-site-info', siteId]` — NOT other sites);
 *  - [updateTouSettings]              → the same per-site `tesla-site-info|{siteId}` key;
 *  - [refreshTeslaEnergyHistory]      → the `tesla-energy-history` family;
 *  - [refreshTeslaBackupHistory]      → the `tesla-backup-history` family;
 *  - [refreshTeslaWcChargingHistory]  → the `tesla-wc-charging-history` family;
 *  - [refreshTeslaEnergyLiveStatus]   → BOTH the `tesla-live-status` AND `tesla-live-status-history`
 *                                       families (web invalidates both).
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached rows first (the web behaviour of keeping prior data during a refetch). The holder
 * makes no network calls itself — it delegates entirely to the injected [EnergyRepository] (S7).
 * A feed nobody is observing is a no-op to refresh.
 *
 * The web `useEnergyFlow`/`useTeslaEnergyLiveStatus` `refetchInterval`, the per-read `staleTime`
 * tiers, the `enabled` lazy gates and the mutation toasts are render-layer concerns and are
 * intentionally NOT reproduced here; a platform pull-to-refresh / live-poll cadence drives
 * re-collection. Values stay SI; conversion is display-only (S5). This holder mirrors the web
 * hook's single-threaded usage and is not internally synchronised; create and drive it from one
 * confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class EnergyStore(
    private val repo: EnergyRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /vehicles/{id}/energy?days=` feed (web `useEnergyStats`). */
    public fun energyStats(
        vehicleId: String,
        days: Int = EnergyRepository.DEFAULT_DAYS,
    ): StateFlow<Resource<JsonElement>> = feed(energyStatsKey(vehicleId, days)) { repo.energyStats(vehicleId, days) }

    /** Shared, refreshable `GET /vehicles/{id}/battery[?as_of=]` feed (web `useBatteryHealth`). */
    public fun batteryHealth(
        vehicleId: String,
        asOf: String? = null,
    ): StateFlow<Resource<JsonElement>> = feed(batteryHealthKey(vehicleId, asOf)) { repo.batteryHealth(vehicleId, asOf) }

    /** Shared, refreshable `GET /vehicles/{id}/battery/cells` feed (web `useBatteryCells`). */
    public fun batteryCells(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(batteryCellsKey(vehicleId)) { repo.batteryCells(vehicleId) }

    /** Shared, refreshable `GET /analytics/battery-health` feed (web `useBatteryHealthAnalytics`). */
    public fun batteryHealthAnalytics(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(batteryHealthAnalyticsKey(vehicleId)) { repo.batteryHealthAnalytics(vehicleId) }

    /** Shared, refreshable `GET /analytics/battery-degradation` feed (web `useBatteryDegradation`). */
    public fun batteryDegradation(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(batteryDegradationKey(vehicleId)) { repo.batteryDegradation(vehicleId) }

    /** Shared, refreshable `GET /vehicles/{id}/energy/flow` feed (web `useEnergyFlow`). */
    public fun energyFlow(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(energyFlowKey(vehicleId)) { repo.energyFlow(vehicleId) }

    /** Shared, refreshable `GET /vampire-drain/stats` feed (web `useVampireDrainStats`, deprecated 404). */
    public fun vampireDrainStats(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(vampireDrainStatsKey(vehicleId)) { repo.vampireDrainStats(vehicleId) }

    /** Shared, refreshable `GET /vampire-drain` feed (web `useVampireDrainEvents`, deprecated 404). */
    public fun vampireDrainEvents(
        vehicleId: String,
        limit: Int = EnergyRepository.DEFAULT_VAMPIRE_LIMIT,
    ): StateFlow<Resource<JsonElement>> = feed(vampireDrainEventsKey(vehicleId, limit)) { repo.vampireDrainEvents(vehicleId, limit) }

    /** Shared, refreshable `GET /vehicles/{id}/battery/projected-range` feed (web `useProjectedRange`). */
    public fun projectedRange(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(projectedRangeKey(vehicleId)) { repo.projectedRange(vehicleId) }

    /** Shared, refreshable `GET /analytics/sleep` feed (web `useSleepEfficiency`). */
    public fun sleepEfficiency(
        vehicleId: String,
        days: Int = EnergyRepository.DEFAULT_DAYS,
        startDate: String? = null,
        endDate: String? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(sleepEfficiencyKey(vehicleId, days, startDate, endDate)) {
            repo.sleepEfficiency(vehicleId, days, startDate, endDate)
        }

    /** Shared, refreshable `GET /tesla/energy-sites` feed (web `useTeslaEnergySites`). */
    public fun teslaEnergySites(): StateFlow<Resource<JsonElement>> = feed(teslaEnergySitesKey()) { repo.teslaEnergySites() }

    /** Shared, refreshable `GET /tesla/energy-sites/{id}/site-info` feed (web `useTeslaEnergySiteInfo`). */
    public fun teslaEnergySiteInfo(siteId: Long): StateFlow<Resource<JsonElement>> =
        feed(teslaSiteInfoKey(siteId)) { repo.teslaEnergySiteInfo(siteId) }

    /** Shared, refreshable `GET /tesla/energy-sites/{id}/energy-history` feed (web `useTeslaEnergyHistory`). */
    public fun teslaEnergyHistory(
        siteId: Long,
        period: String = EnergyRepository.DEFAULT_PERIOD,
        since: String? = null,
        until: String? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(teslaEnergyHistoryKey(siteId, period, since, until)) {
            repo.teslaEnergyHistory(siteId, period, since, until)
        }

    /** Shared, refreshable `GET /tesla/energy-sites/{id}/backup-history` feed (web `useTeslaBackupHistory`). */
    public fun teslaBackupHistory(
        siteId: Long,
        since: String? = null,
        until: String? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(teslaBackupHistoryKey(siteId, since, until)) { repo.teslaBackupHistory(siteId, since, until) }

    /** Shared, refreshable `GET /tesla/energy-sites/{id}/charging-history` feed (web `useTeslaWCChargingHistory`). */
    public fun teslaWcChargingHistory(
        siteId: Long,
        since: String? = null,
        until: String? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(teslaWcChargingHistoryKey(siteId, since, until)) { repo.teslaWcChargingHistory(siteId, since, until) }

    /** Shared, refreshable `GET /tesla/energy-sites/{id}/live-status` feed (web `useTeslaEnergyLiveStatus`). */
    public fun teslaEnergyLiveStatus(siteId: Long): StateFlow<Resource<JsonElement>> =
        feed(teslaLiveStatusKey(siteId)) { repo.teslaEnergyLiveStatus(siteId) }

    /** Shared, refreshable `GET /tesla/energy-sites/{id}/live-status/history` feed (web `useTeslaEnergyLiveStatusHistory`). */
    public fun teslaEnergyLiveStatusHistory(
        siteId: Long,
        since: String? = null,
        until: String? = null,
        limit: Int? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(teslaLiveStatusHistoryKey(siteId, since, until, limit)) {
            repo.teslaEnergyLiveStatusHistory(siteId, since, until, limit)
        }

    // ---- Mutations ----------------------------------------------------------------

    /** Refreshes the Tesla energy-site catalog, then re-fetches the sites family (web `useRefreshTeslaEnergySites`). */
    public suspend fun refreshTeslaEnergySites(): Result<JsonElement> =
        repo.refreshTeslaEnergySites().onSuccess { refreshFamily(TESLA_ENERGY_SITES_FAMILY) }

    /**
     * Refreshes one site's detailed config, then re-fetches that site's info key only (web
     * `useRefreshTeslaEnergySiteInfo` invalidates `['tesla-site-info', siteId]`, not other sites).
     */
    public suspend fun refreshTeslaEnergySiteInfo(siteId: Long): Result<JsonElement> =
        repo.refreshTeslaEnergySiteInfo(siteId).onSuccess { refreshFamily(teslaSiteInfoKey(siteId)) }

    /**
     * Saves a site's time-of-use settings, then re-fetches that site's info key (web
     * `useUpdateTOUSettings` invalidates `['tesla-site-info', siteId]` via invalidateAndBroadcast).
     */
    public suspend fun updateTouSettings(
        siteId: Long,
        settings: JsonObject,
    ): Result<JsonElement> = repo.updateTouSettings(siteId, settings).onSuccess { refreshFamily(teslaSiteInfoKey(siteId)) }

    /** Refreshes site energy history, then re-fetches the history family (web `useRefreshTeslaEnergyHistory`). */
    public suspend fun refreshTeslaEnergyHistory(
        siteId: Long,
        period: String = EnergyRepository.DEFAULT_PERIOD,
        startDate: String? = null,
        endDate: String? = null,
        timeZone: String? = null,
    ): Result<JsonElement> =
        repo
            .refreshTeslaEnergyHistory(siteId, period, startDate, endDate, timeZone)
            .onSuccess { refreshFamily(TESLA_ENERGY_HISTORY_FAMILY) }

    /** Refreshes site backup history, then re-fetches the backup family (web `useRefreshTeslaBackupHistory`). */
    public suspend fun refreshTeslaBackupHistory(
        siteId: Long,
        period: String = EnergyRepository.DEFAULT_PERIOD,
        startDate: String? = null,
        endDate: String? = null,
        timeZone: String? = null,
    ): Result<JsonElement> =
        repo
            .refreshTeslaBackupHistory(siteId, period, startDate, endDate, timeZone)
            .onSuccess { refreshFamily(TESLA_BACKUP_HISTORY_FAMILY) }

    /** Refreshes Wall Connector charging history, then re-fetches the WC family (web `useRefreshTeslaWCChargingHistory`). */
    public suspend fun refreshTeslaWcChargingHistory(
        siteId: Long,
        startDate: String? = null,
        endDate: String? = null,
        timeZone: String? = null,
    ): Result<JsonElement> =
        repo
            .refreshTeslaWcChargingHistory(siteId, startDate, endDate, timeZone)
            .onSuccess { refreshFamily(TESLA_WC_CHARGING_HISTORY_FAMILY) }

    /**
     * Refreshes a site's live power-flow status, then re-fetches BOTH the live-status and the
     * live-status-history families (web `useRefreshTeslaEnergyLiveStatus` invalidates both).
     */
    public suspend fun refreshTeslaEnergyLiveStatus(siteId: Long): Result<JsonElement> =
        repo.refreshTeslaEnergyLiveStatus(siteId).onSuccess {
            refreshFamily(TESLA_LIVE_STATUS_FAMILY)
            refreshFamily(TESLA_LIVE_STATUS_HISTORY_FAMILY)
        }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection (via [refreshFamily]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at
     * least one is active.
     */
    private fun feed(
        key: String,
        source: () -> Flow<Resource<JsonElement>>,
    ): StateFlow<Resource<JsonElement>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        }

    /**
     * Re-fetches every observed feed whose key belongs to [family] under TanStack
     * prefix-invalidation semantics ([energyKeyInFamily]) — the holder-side analogue of
     * `invalidateQueries({ queryKey: [family] })`. The keys are snapshotted before iterating so a
     * concurrent feed creation cannot disturb the walk; a family nobody observes is a no-op.
     */
    private fun refreshFamily(family: String) {
        triggers.keys
            .filter { energyKeyInFamily(it, family) }
            .toList()
            .forEach { triggers[it]?.update { n -> n + 1 } }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
