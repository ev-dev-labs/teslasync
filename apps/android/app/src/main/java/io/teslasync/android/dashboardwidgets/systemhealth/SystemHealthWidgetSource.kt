// File hosts the SystemHealth data seam, its shared-store / repository bindings and the
// cache-then-network adapter that combines the system-health, db-stats and runtime-info feeds; named
// after the surface bundle (SystemHealthWidget*) rather than the single interface it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.systemhealth

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.serialization.json.JsonElement

/**
 * The data port the [SystemHealthWidgetViewModel] binds to — the Android analogue of the web
 * `SystemHealthWidget`'s hook composition (`useSystemHealth` + `useDBStats` + `useConnectionPool`) and
 * the P1/S8 state-holder boundary. The view never performs HTTP itself; a test fake stands in for the
 * whole domain.
 *
 * [systemHealth] is the `/system/health` feed that drives the overall status, the per-service grid and
 * the panel's loading / freshness / error envelope (web `useSystemHealth` — the only feed the web
 * `WidgetShell` wires its `loading`/`error`/`isStale`/`dataUpdatedAt` from); [dbStats] is the
 * `/dev-tools/db-stats` feed that fills the DB Size fallback (web `useDBStats`); and [connectionPool]
 * is the `/dev-tools/runtime-info` feed that fills Active Conns / Memory / Goroutines (web
 * `useConnectionPool`). Each call returns a fresh cache-then-network [Resource] flow so the ViewModel's
 * refresh / retry restart a real upstream collection.
 */
interface SystemHealthSource {
    /** Stream the cache-then-network `/system/health` payload (web `useSystemHealth`). */
    fun systemHealth(): Flow<Resource<JsonElement>>

    /** Stream the cache-then-network `/dev-tools/db-stats` payload (web `useDBStats`). */
    fun dbStats(): Flow<Resource<JsonElement>>

    /** Stream the cache-then-network `/dev-tools/runtime-info` payload (web `useConnectionPool`). */
    fun connectionPool(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared S8 [AdminStore] — the holder these Admin feeds already share
 * app-wide (the KMP port of the `useAdmin` hook domain). Each read uses the store's shared feeds, so
 * every observer of the same feed folds into one upstream collection. Use this when a host shares one
 * app-wide Admin feed across surfaces.
 */
fun systemHealthSource(store: AdminStore): SystemHealthSource =
    object : SystemHealthSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = store.systemHealth()

        override fun dbStats(): Flow<Resource<JsonElement>> = store.dbStats()

        override fun connectionPool(): Flow<Resource<JsonElement>> = store.connectionPool()
    }

/**
 * Binds the surface to the shared S7 [AdminRepository] — the same cache-then-network data port the
 * [AdminStore] wraps. Each [SystemHealthSource.systemHealth] / [SystemHealthSource.dbStats] /
 * [SystemHealthSource.connectionPool] call starts a new repository collection, so the ViewModel's
 * refresh / retry trigger a real re-fetch (mirroring the web hooks' `refetch`).
 */
fun systemHealthSource(repository: AdminRepository): SystemHealthSource =
    object : SystemHealthSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = repository.systemHealth()

        override fun dbStats(): Flow<Resource<JsonElement>> = repository.dbStats()

        override fun connectionPool(): Flow<Resource<JsonElement>> = repository.connectionPool()
    }

/**
 * Combines the system-health, db-stats and runtime-info feeds into one cache-then-network [Resource]
 * stream of the projected [SystemHealthData] — the native port of the web widget's three-hook
 * composition. The loading / freshness / error envelope follows the system-health feed (web wires the
 * shell from `useSystemHealth`); db-stats + runtime-info only fill stat values.
 */
internal fun systemHealthResource(source: SystemHealthSource): Flow<Resource<SystemHealthData>> =
    combine(
        source.systemHealth(),
        source.dbStats(),
        source.connectionPool(),
    ) { health, db, pool ->
        foldEnvelope(health, db, pool)
    }

/**
 * Folds the three resources into a single cache-then-network [Resource] of the projected analysis. The
 * loading / freshness / error envelope follows the SYSTEM-HEALTH feed (web wires `loading`/`isStale`/
 * `isError`/`dataUpdatedAt` of the shell from `useSystemHealth`), gated to a first-load skeleton only
 * while system-health is still loading with nothing cached. A hard system-health failure keeps the
 * cached/partial analysis visible (offline / last-known) whenever it had resolved — the web `hasData =
 * health.data != null` truthiness — and only blanks to an error surface when nothing has resolved.
 */
private fun foldEnvelope(
    health: Resource<JsonElement>,
    dbStats: Resource<JsonElement>,
    pool: Resource<JsonElement>,
): Resource<SystemHealthData> {
    if (health is Resource.Loading && health.cached == null) {
        return Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
    val data =
        SystemHealthProjection.build(
            health = health.cached,
            dbStats = dbStats.cached,
            pool = pool.cached,
        )
    return when (health) {
        is Resource.Loading -> Resource.Loading(cached = data, fetchedAt = health.fetchedAt, stale = health.stale)
        is Resource.Success -> Resource.Success(data, fetchedAt = health.fetchedAt, stale = health.stale)
        is Resource.Error ->
            if (data.hasData) {
                Resource.Error(cached = data, fetchedAt = health.fetchedAt, stale = true, error = health.error)
            } else {
                Resource.Error(cached = null, fetchedAt = health.fetchedAt, stale = health.stale, error = health.error)
            }
    }
}
