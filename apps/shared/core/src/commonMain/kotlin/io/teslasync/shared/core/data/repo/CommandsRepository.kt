package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The S7 data port for the per-vehicle command audit read-model — the cross-platform analogue of
 * the web `useCommands` hook domain (web/src/api/hooks/useCommands.ts). Every native Commands
 * surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through
 * this interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The domain is two reads and no mutations — `useCommands.ts` contains exactly two `useQuery`s and
 * no `useMutation` — so each read streams a cache-then-network [Resource] (ADR-013): the cached
 * rows first for an instant cold start, then the refreshed rows. There is nothing to invalidate
 * here. [commandHistory] mirrors the web `useCommandHistory` (the recent command log); [commandLatest]
 * mirrors `useCommandLatest` (the latest entry per command-name).
 *
 * The payload (command audit rows carrying `id`, `vehicle_id`, `command`, `params`, `status`,
 * `error`, `created_at`) is carried as raw [JsonElement] (the same verbatim strategy as
 * [AnomaliesRepository]): the rows are plain ids/strings/timestamps, not display-unit-bearing, so
 * they round-trip through the cache unchanged — no conversion at this layer (S5 owns display). The
 * web hooks apply only `select: (data) => data ?? []`, a null-guard that is a presentation concern;
 * the backend returns a JSON array, which this port forwards verbatim.
 *
 * The web hooks gate each query with `enabled: !!vehicleId`. That gate is a presentation concern and
 * lives in the S8 `CommandsStore`; this port takes a non-null [vehicleId] and is only ever called
 * once a vehicle is selected.
 */
public interface CommandsRepository {
    /**
     * `GET /vehicles/{vehicleId}/commands/history?limit=200` — the recent command log for one
     * vehicle (web `useCommandHistory`). The `limit` query is snake-case-free (a plain numeric cap)
     * and carries the web template literal's fixed `200` verbatim.
     */
    public fun commandHistory(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /vehicles/{vehicleId}/commands/latest` — the latest entry per command-name for one
     * vehicle (web `useCommandLatest`). No query parameters, matching the web template literal.
     */
    public fun commandLatest(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Builds the stable cache/feed key for [vehicleId]'s command history, mirroring the web
 * `commandKeys.history(vehicleId)` tuple `['command-history', vehicleId]`. Prefixed so it can never
 * collide with [commandLatestKey] in the shared [io.teslasync.shared.core.cache.CacheDomain.Commands]
 * partition.
 */
public fun commandHistoryKey(vehicleId: String): String = "history:$vehicleId"

/**
 * Builds the stable cache/feed key for [vehicleId]'s latest-per-command feed, mirroring the web
 * `commandKeys.latest(vehicleId)` tuple `['command-latest', vehicleId]`. Prefixed so it can never
 * collide with [commandHistoryKey] in the shared partition.
 */
public fun commandLatestKey(vehicleId: String): String = "latest:$vehicleId"

/**
 * The fixed `commands/history` query map — the port of the web
 * `request('/vehicles/${vehicleId}/commands/history?limit=200')` call: a single `limit` parameter
 * pinned to `200`, matching the web template literal exactly.
 */
public fun commandHistoryQuery(): Map<String, String> = mapOf("limit" to "200")
