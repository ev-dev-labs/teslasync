package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.api.generated.EnergyStatsRow
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Cache-then-network access to the daily energy/efficiency summary
 * (`GET /analytics/energy`). Efficiency is stored in SI (Wh per meter) verbatim.
 *
 * This is the dashboard daily-summary feed, NOT part of the `useEnergy` hook domain (whose 24
 * hooks are ported by [EnergyRepository] / [io.teslasync.shared.core.presentation.energy.EnergyStore]).
 * It keeps the dedicated name so the hook-domain port can own the canonical [EnergyRepository]
 * name, exactly as [DriveRepository] coexists with the [DrivingRepository] domain interface.
 */
public class EnergySummaryRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<List<EnergyStatsRow>>(
        store,
        clock,
        json,
        ListSerializer(EnergyStatsRow.serializer()),
    ) {
    override val domain: CacheDomain = CacheDomain.Energy

    /** Streams the cached energy summary immediately, then the refreshed rows. */
    public fun summary(): Flow<Resource<List<EnergyStatsRow>>> =
        observe(KEY) { api.request<List<EnergyStatsRow>>(path = "/analytics/energy") }

    private companion object {
        const val KEY = "summary"
    }
}
