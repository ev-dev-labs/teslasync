package io.teslasync.shared.core.presentation.admin

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
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
 * UI-free shared state holder for the Admin/operational control plane — the cross-platform
 * port of the web `useAdmin` hook domain (web/src/api/hooks/useAdmin.ts). Every native Admin
 * screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, query keys, or invalidation rules.
 *
 * Reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each
 * is lazily created on first access, shared so every observer of the same feed (or the same
 * `(feed, params)`) folds into one upstream collection, and refreshable. Mutations are
 * non-throwing suspend functions returning a [Result]; on success each refreshes exactly the
 * feeds the matching web hook invalidates via `invalidateQueries`. The holder makes no
 * network calls itself — it delegates entirely to the injected [AdminRepository] (S7), which
 * also evicts the affected cache keys so a refresh re-fetches rather than replaying a stale
 * entry.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally
 * synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class AdminStore(
    private val repo: AdminRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Reads (16) ---------------------------------------------------------------

    /** Shared, refreshable `GET /api-keys` feed. */
    public fun apiKeys(): StateFlow<Resource<JsonElement>> = feed(KEY_API_KEYS) { repo.apiKeys() }

    /** Shared, refreshable `GET /api-logs` feed for [page]. */
    public fun apiLogs(page: Int): StateFlow<Resource<JsonElement>> = feed("$KEY_API_LOGS:$page") { repo.apiLogs(page) }

    /** Shared, refreshable `GET /api-logs/stats` feed. */
    public fun apiLogStats(): StateFlow<Resource<JsonElement>> = feed(KEY_API_LOG_STATS) { repo.apiLogStats() }

    /** Shared, refreshable `GET /backup/configs` feed. */
    public fun backupConfigs(): StateFlow<Resource<JsonElement>> = feed(KEY_BACKUP_CONFIGS) { repo.backupConfigs() }

    /** Shared, refreshable `GET /backup/runs` feed. */
    public fun backupRuns(): StateFlow<Resource<JsonElement>> = feed(KEY_BACKUP_RUNS) { repo.backupRuns() }

    /** Shared, refreshable `GET /system/health` feed. */
    public fun systemHealth(): StateFlow<Resource<JsonElement>> = feed(KEY_SYSTEM_HEALTH) { repo.systemHealth() }

    /** Shared, refreshable `GET /admin/maintenance` feed. */
    public fun maintenanceState(): StateFlow<Resource<JsonElement>> = feed(KEY_MAINTENANCE) { repo.maintenanceState() }

    /** Shared, refreshable `GET /system/audit` feed. */
    public fun auditLogs(): StateFlow<Resource<JsonElement>> = feed(KEY_AUDIT_LOGS) { repo.auditLogs() }

    /** Shared, refreshable `GET /admin/web-errors/summary` feed. */
    public fun webErrorsSummary(): StateFlow<Resource<JsonElement>> = feed(KEY_WEB_ERRORS) { repo.webErrorsSummary() }

    /** Shared, refreshable `GET /security` feed for [vehicleId]. */
    public fun securityEvents(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed("$KEY_SECURITY_EVENTS:$vehicleId") { repo.securityEvents(vehicleId) }

    /** Shared, refreshable `GET /dev-tools/db-stats` feed. */
    public fun dbStats(): StateFlow<Resource<JsonElement>> = feed(KEY_DB_STATS) { repo.dbStats() }

    /** Shared, refreshable `GET /dev-tools/migration-status` feed. */
    public fun migrations(): StateFlow<Resource<JsonElement>> = feed(KEY_MIGRATIONS) { repo.migrations() }

    /** Shared, refreshable `GET /dev-tools/runtime-info` feed. */
    public fun connectionPool(): StateFlow<Resource<JsonElement>> = feed(KEY_CONNECTION_POOL) { repo.connectionPool() }

    /** Shared, refreshable `GET /system/compression-stats` feed (web devtools `getCompressionStats`). */
    public fun compressionStats(): StateFlow<Resource<JsonElement>> = feed(KEY_COMPRESSION_STATS) { repo.compressionStats() }

    /** Shared, refreshable `GET /export/jobs` feed. */
    public fun exportJobs(): StateFlow<Resource<JsonElement>> = feed(KEY_EXPORT_JOBS) { repo.exportJobs() }

    /** Shared, refreshable `GET /vehicles/{vehicleId}/state` feed. */
    public fun vehicleStateMachine(vehicleId: String): StateFlow<Resource<JsonElement>> =
        feed("$KEY_VEHICLE_STATE:$vehicleId") { repo.vehicleStateMachine(vehicleId) }

    /** Shared, refreshable `GET /vehicle-states/timeline` feed for [vehicleId]/[days]. */
    public fun stateTimeline(
        vehicleId: String,
        days: Int = 7,
    ): StateFlow<Resource<JsonElement>> = feed("$KEY_STATE_TIMELINE:$vehicleId:$days") { repo.stateTimeline(vehicleId, days) }

    // ---- Mutations (6) ------------------------------------------------------------

    /** Creates an API key, then refreshes the [apiKeys] feed (mirrors `invalidateQueries(apiKeys)`). */
    public suspend fun createApiKey(
        name: String,
        permissions: String,
    ): Result<JsonElement> = repo.createApiKey(name, permissions).onSuccess { refresh(KEY_API_KEYS) }

    /** Deletes an API key, then refreshes the [apiKeys] feed. */
    public suspend fun deleteApiKey(id: String): Result<Unit> = repo.deleteApiKey(id).onSuccess { refresh(KEY_API_KEYS) }

    /** Revokes an API key, then refreshes the [apiKeys] feed. */
    public suspend fun revokeApiKey(id: String): Result<Unit> = repo.revokeApiKey(id).onSuccess { refresh(KEY_API_KEYS) }

    /**
     * Updates maintenance state, then refreshes BOTH the [maintenanceState] and [systemHealth]
     * feeds so the resolved banner updates within one cycle (mirrors the web hook invalidating
     * both query keys).
     */
    public suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<JsonElement> =
        repo.updateMaintenance(input).onSuccess {
            refresh(KEY_MAINTENANCE)
            refresh(KEY_SYSTEM_HEALTH)
        }

    /** Creates an export job, then refreshes the [exportJobs] feed. */
    public suspend fun createExport(
        type: String,
        format: String,
        vehicleId: String? = null,
    ): Result<JsonElement> = repo.createExport(type, format, vehicleId).onSuccess { refresh(KEY_EXPORT_JOBS) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active.
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
                    initialValue = INITIAL,
                )
        }

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        const val KEY_API_KEYS = "api-keys"
        const val KEY_API_LOGS = "api-logs"
        const val KEY_API_LOG_STATS = "api-log-stats"
        const val KEY_BACKUP_CONFIGS = "backup-configs"
        const val KEY_BACKUP_RUNS = "backup-runs"
        const val KEY_SYSTEM_HEALTH = "system-health"
        const val KEY_MAINTENANCE = "maintenance"
        const val KEY_AUDIT_LOGS = "audit-logs"
        const val KEY_WEB_ERRORS = "web-errors-summary"
        const val KEY_SECURITY_EVENTS = "security-events"
        const val KEY_DB_STATS = "db-stats"
        const val KEY_MIGRATIONS = "migrations"
        const val KEY_CONNECTION_POOL = "connection-pool"
        const val KEY_COMPRESSION_STATS = "compression-stats"
        const val KEY_EXPORT_JOBS = "export-jobs"
        const val KEY_VEHICLE_STATE = "vehicle-state"
        const val KEY_STATE_TIMELINE = "state-timeline"
    }
}
