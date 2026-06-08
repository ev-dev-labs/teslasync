package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.admin.MaintenanceUpdateInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the Admin/operational control plane — the cross-platform
 * analogue of the web `useAdmin` hook domain (web/src/api/hooks/useAdmin.ts). Every
 * native Admin surface (Android/Apple via KMP, Windows via the C# port) reaches the
 * backend exclusively through this interface, so a single fake stands in for the whole
 * domain in the S8 state-holder tests.
 *
 * Reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. Mutations are non-throwing suspend
 * functions returning a [Result] and — mirroring the web `invalidateQueries` calls —
 * evicting the cache keys they affect so the next read of those feeds re-fetches.
 *
 * Payloads are carried as raw [JsonElement] (the same verbatim-SI strategy as
 * [NotificationRepository]): the Admin feeds are not unit-bearing, so there is no
 * display conversion to do here, and the exact server shape round-trips unchanged.
 * The only client-side derivation ported from the web is [safeArray] — the array guard
 * the web applies via `select: safeArray` to every list read.
 */
public interface AdminRepository {
    // ---- Reads (15) ---------------------------------------------------------------

    /** `GET /api-keys` — issued API keys (array-guarded). */
    public fun apiKeys(): Flow<Resource<JsonElement>>

    /** `GET /api-logs?page={page}&limit=25` — paged API call log (array-guarded). */
    public fun apiLogs(page: Int): Flow<Resource<JsonElement>>

    /** `GET /api-logs/stats` — rolling API-call statistics. */
    public fun apiLogStats(): Flow<Resource<JsonElement>>

    /** `GET /backup/configs` — configured backup schedules (array-guarded). */
    public fun backupConfigs(): Flow<Resource<JsonElement>>

    /** `GET /backup/runs` — recent backup runs (array-guarded). */
    public fun backupRuns(): Flow<Resource<JsonElement>>

    /** `GET /system/health` — resolved system health snapshot. */
    public fun systemHealth(): Flow<Resource<JsonElement>>

    /** `GET /admin/maintenance` — persisted maintenance/degraded-mode state. */
    public fun maintenanceState(): Flow<Resource<JsonElement>>

    /** `GET /system/audit` — administrative audit log (array-guarded). */
    public fun auditLogs(): Flow<Resource<JsonElement>>

    /** `GET /admin/web-errors/summary` — last-hour frontend error-report summary. */
    public fun webErrorsSummary(): Flow<Resource<JsonElement>>

    /** `GET /security?vehicle_id={vehicleId}` — security events for a vehicle (array-guarded). */
    public fun securityEvents(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /dev-tools/db-stats` — database size/row statistics. */
    public fun dbStats(): Flow<Resource<JsonElement>>

    /** `GET /dev-tools/migration-status` — applied/pending migration status. */
    public fun migrations(): Flow<Resource<JsonElement>>

    /** `GET /dev-tools/runtime-info` — connection-pool / runtime diagnostics. */
    public fun connectionPool(): Flow<Resource<JsonElement>>

    /** `GET /export/jobs` — data-export jobs (array-guarded). */
    public fun exportJobs(): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{vehicleId}/state` — live FSM state for a vehicle. */
    public fun vehicleStateMachine(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /vehicle-states/timeline?vehicle_id={vehicleId}&days={days}` — state-duration
     * timeline. Ported verbatim from the web hook (which is `@deprecated`: the route now
     * 404s after the Phase-42 `vehicle_states` drop); the error surfaces gracefully
     * through [Resource.Error], exactly as the web `useQuery` surfaces the 404.
     */
    public fun stateTimeline(
        vehicleId: String,
        days: Int = 7,
    ): Flow<Resource<JsonElement>>

    // ---- Mutations (6) ------------------------------------------------------------

    /** `POST /api-keys` `{name, permissions}` → the created key; invalidates [apiKeys]. */
    public suspend fun createApiKey(
        name: String,
        permissions: String,
    ): Result<JsonElement>

    /** `DELETE /api-keys/{id}` → invalidates [apiKeys]. */
    public suspend fun deleteApiKey(id: String): Result<Unit>

    /** `POST /api-keys/{id}/revoke` → invalidates [apiKeys]. */
    public suspend fun revokeApiKey(id: String): Result<Unit>

    /**
     * `POST /admin/maintenance` `{mode, message, until}` → the updated state; invalidates
     * BOTH [maintenanceState] and [systemHealth] so the resolved banner updates within one
     * cycle (mirrors the web hook invalidating both query keys).
     */
    public suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<JsonElement>

    /**
     * `POST /exports` `{type, format, vehicleId?}` → the created job; invalidates
     * [exportJobs]. The body key is `vehicleId` (camelCase) and is omitted when absent —
     * matching the web hook's `JSON.stringify({ type, format, vehicleId })` verbatim.
     */
    public suspend fun createExport(
        type: String,
        format: String,
        vehicleId: String? = null,
    ): Result<JsonElement>
}

/**
 * The array guard ported from the web `safeArray` (web/src/lib/safeArray.ts): a
 * [JsonArray] passes through unchanged; anything else — a `null`/JSON-null, an object,
 * or a scalar — collapses to an empty array. This reproduces the web `select: safeArray`
 * contract so every list-shaped Admin read yields a guaranteed array to the UI, never a
 * crash on `.map`/`.length`. Behaviour is locked by golden vectors shared with the C#
 * port so the three platforms cannot drift.
 */
public fun safeArray(value: JsonElement): JsonArray = value as? JsonArray ?: JsonArray(emptyList())
