package io.teslasync.shared.core.presentation.driving

import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.api.generated.DriveTelemetryReading
import io.teslasync.shared.core.data.repo.DRIVES_FAMILY
import io.teslasync.shared.core.data.repo.DRIVE_FAMILY
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.accelerationDistributionKey
import io.teslasync.shared.core.data.repo.driveDetailKey
import io.teslasync.shared.core.data.repo.drivePositionsKey
import io.teslasync.shared.core.data.repo.driveScoreKey
import io.teslasync.shared.core.data.repo.driveTelemetryKey
import io.teslasync.shared.core.data.repo.driveWhyEndedKey
import io.teslasync.shared.core.data.repo.drivesKey
import io.teslasync.shared.core.data.repo.drivetrainHealthKey
import io.teslasync.shared.core.data.repo.drivingCoachKey
import io.teslasync.shared.core.data.repo.drivingDynamicsKey
import io.teslasync.shared.core.data.repo.drivingKeyInFamily
import io.teslasync.shared.core.data.repo.drivingStatsKey
import io.teslasync.shared.core.data.repo.geocodeSearchKey
import io.teslasync.shared.core.data.repo.regenEfficiencyKey
import io.teslasync.shared.core.data.repo.routeEfficiencyKey
import io.teslasync.shared.core.data.repo.speedProfileKey
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

/**
 * UI-free shared state holder for the Driving domain — the cross-platform port of the web
 * `useDriving` hook domain (web/src/api/hooks/useDriving.ts). Every native Driving screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the `safeArray` guards, or the invalidation families.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same `(feed, params)` folds into
 * one upstream collection, and refreshable. The two mutations are non-throwing suspend [Result]s;
 * on success each refreshes EXACTLY the feed family the matching web hook invalidates via
 * `invalidateQueries`:
 *  - [bulkDeleteDrives] → the `drives` family (the per-vehicle lists) AND the `drive` family (the
 *    per-drive detail + the why-ended diagnostic, which the web keys as `['drive', id,
 *    'why-ended', window]` under the same `['drive']` prefix). The `|` separator boundary keeps
 *    the singular `drive` family from touching the `drive-score`/`drive-positions`/
 *    `drive-telemetry` siblings or the plural `drives` lists;
 *  - [planTrip] → nothing (the web hook only toasts; the computed plan is returned).
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached rows first (the web behaviour of keeping prior data during a refetch). The holder
 * makes no network calls itself — it delegates entirely to the injected [DrivingRepository] (S7).
 * A feed nobody is observing is a no-op to refresh.
 *
 * The web `useDrive`/`useDriveWhyEnded` `refetchInterval`, the `useDriveWhyEnded`/`useGeocodeSearch`
 * `enabled` lazy gates, and the mutation toasts are render-layer concerns and are intentionally NOT
 * reproduced here; a platform pull-to-refresh / live-poll cadence drives re-collection. Values
 * stay SI; conversion is display-only (S5). This holder mirrors the web hook's single-threaded
 * usage and is not internally synchronised; create and drive it from one confinement (the platform
 * main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class DrivingStore(
    private val repo: DrivingRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val driveListFeeds = mutableMapOf<String, StateFlow<Resource<List<Drive>>>>()
    private val telemetryFeeds = mutableMapOf<String, StateFlow<Resource<List<DriveTelemetryReading>>>>()
    private val jsonFeeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /drives/?vehicle_id=` feed (web `useDrives`). */
    public fun drives(vehicleId: String): StateFlow<Resource<List<Drive>>> =
        feed(drivesKey(vehicleId), driveListFeeds) { repo.drives(vehicleId) }

    /** Shared, refreshable `GET /drives/{id}/` detail feed (web `useDrive`). */
    public fun drive(id: String): StateFlow<Resource<JsonElement>> = feed(driveDetailKey(id), jsonFeeds) { repo.drive(id) }

    /** Shared, refreshable `GET /drives/score` feed (web `useDriveScore`). */
    public fun driveScore(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(driveScoreKey(vehicleId), jsonFeeds) { repo.driveScore(vehicleId) }

    /** Shared, refreshable `GET /drives/stats` feed (web `useDrivingStats`). */
    public fun drivingStats(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(drivingStatsKey(vehicleId), jsonFeeds) { repo.drivingStats(vehicleId) }

    /** Shared, refreshable `GET /drives/dynamics` feed (web `useDrivingDynamics`). */
    public fun drivingDynamics(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(drivingDynamicsKey(vehicleId), jsonFeeds) { repo.drivingDynamics(vehicleId) }

    /** Shared, refreshable `GET /drives/acceleration-distribution` feed (web `useAccelerationDistribution`). */
    public fun accelerationDistribution(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(accelerationDistributionKey(vehicleId), jsonFeeds) { repo.accelerationDistribution(vehicleId) }

    /** Shared, refreshable `GET /drivetrain/health` feed (web `useDrivetrainHealth`). */
    public fun drivetrainHealth(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed(drivetrainHealthKey(vehicleId), jsonFeeds) { repo.drivetrainHealth(vehicleId) }

    /** Shared, refreshable `GET /analytics/speed-profile` feed (web `useSpeedProfile`). */
    public fun speedProfile(
        vehicleId: String,
        start: String? = null,
        end: String? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(speedProfileKey(vehicleId, start, end), jsonFeeds) { repo.speedProfile(vehicleId, start, end) }

    /** Shared, refreshable `GET /analytics/regen` feed (web `useRegenEfficiency`). */
    public fun regenEfficiency(
        vehicleId: String,
        start: String? = null,
        end: String? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(regenEfficiencyKey(vehicleId, start, end), jsonFeeds) { repo.regenEfficiency(vehicleId, start, end) }

    /** Shared, refreshable `GET /analytics/route-efficiency` feed (web `useRouteEfficiency`). */
    public fun routeEfficiency(
        vehicleId: String,
        start: String? = null,
        end: String? = null,
    ): StateFlow<Resource<JsonElement>> =
        feed(routeEfficiencyKey(vehicleId, start, end), jsonFeeds) { repo.routeEfficiency(vehicleId, start, end) }

    /** Shared, refreshable `GET /drives/{driveID}/positions` feed (web `useDrivePositions`). */
    public fun drivePositions(driveId: String): StateFlow<Resource<JsonElement>> =
        feed(drivePositionsKey(driveId), jsonFeeds) { repo.drivePositions(driveId) }

    /** Shared, refreshable `GET /drives/{driveID}/telemetry` feed (web `useDriveTelemetry`). */
    public fun driveTelemetry(driveId: String): StateFlow<Resource<List<DriveTelemetryReading>>> =
        feed(driveTelemetryKey(driveId), telemetryFeeds) { repo.driveTelemetry(driveId) }

    /** Shared, refreshable `GET /analytics/driving-coach` feed (web `useDrivingCoach`). */
    public fun drivingCoach(
        vehicleId: String,
        days: Int = DrivingRepository.DEFAULT_COACH_DAYS,
    ): StateFlow<Resource<JsonElement>> = feed(drivingCoachKey(vehicleId, days), jsonFeeds) { repo.drivingCoach(vehicleId, days) }

    /** Shared, refreshable `GET /geocode/search` feed (web `useGeocodeSearch`). */
    public fun geocodeSearch(query: String): StateFlow<Resource<JsonElement>> =
        feed(geocodeSearchKey(query), jsonFeeds) { repo.geocodeSearch(query) }

    /** Shared, refreshable `GET /drives/{driveID}/why-ended` feed (web `useDriveWhyEnded`). */
    public fun driveWhyEnded(
        driveId: String,
        window: String = DrivingRepository.DEFAULT_WHY_ENDED_WINDOW,
    ): StateFlow<Resource<JsonElement>> = feed(driveWhyEndedKey(driveId, window), jsonFeeds) { repo.driveWhyEnded(driveId, window) }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Plans a trip and returns the computed plan (web `usePlanTrip`). The web hook invalidates
     * nothing — it only toasts — so no feed is refreshed here.
     */
    public suspend fun planTrip(input: TripPlanRequest): Result<JsonElement> = repo.planTrip(input)

    /**
     * Bulk-deletes drives, then re-fetches the `drives` AND `drive` families (web
     * `useBulkDeleteDrives` invalidates both `['drives']` and `['drive']`). The `drive` family
     * fan-out also refreshes any observed why-ended feed (keyed under `['drive', …]`), while the
     * `drive-score`/`drive-positions`/`drive-telemetry` siblings are left untouched.
     */
    public suspend fun bulkDeleteDrives(ids: List<Long>): Result<JsonElement> =
        repo.bulkDeleteDrives(ids).onSuccess {
            refreshFamily(DRIVES_FAMILY)
            refreshFamily(DRIVE_FAMILY)
        }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection (via [refreshFamily]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at
     * least one is active.
     */
    private fun <T> feed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
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
     * prefix-invalidation semantics ([drivingKeyInFamily]) — the holder-side analogue of
     * `invalidateQueries({ queryKey: [family] })`. The keys are snapshotted before iterating so a
     * concurrent feed creation cannot disturb the walk; a family nobody observes is a no-op.
     */
    private fun refreshFamily(family: String) {
        triggers.keys
            .filter { drivingKeyInFamily(it, family) }
            .toList()
            .forEach { triggers[it]?.update { n -> n + 1 } }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
