package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import io.teslasync.shared.core.presentation.vehiclecommand.SendVehicleCommandInput
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [VehicleCommandRepository] over the resilient [ApiHttpClient] (ADR-013). The single
 * mutation has no read cache of its own, so this repository does not extend [CachingRepository] and
 * holds no [CacheDomain]; instead it reaches the shared [CacheStore] directly to invalidate the
 * surfaces a command can change.
 *
 * On a 2xx reply it evicts exactly the four query keys the web `useVehicleCommand` `onSuccess`
 * invalidates (web/src/api/hooks/useVehicleCommand.ts):
 *  - `vehicleKeys.state(vehicleId)` → [CacheDomain.VehicleState] keyed by the vehicle id (the
 *    [VehicleStateRepository] key shape);
 *  - `['command-latest', vehicleId]` → [CacheDomain.Commands] under [commandLatestKey];
 *  - `['command-history', vehicleId]` → [CacheDomain.Commands] under [commandHistoryKey];
 *  - `vehicleKeys.all` (`['vehicles']`) → the whole [CacheDomain.Vehicles] partition (the broad
 *    prefix the web invalidates, which drops the list read).
 *
 * Evicting (rather than write-through) is the data-layer analogue of `invalidateQueries`: the next
 * cache-then-network read of each surface misses the cache and re-fetches the post-command truth. A
 * failed command leaves every cache surface untouched, exactly as the web hook only invalidates in
 * `onSuccess`.
 */
public class HttpVehicleCommandRepository(
    private val api: ApiHttpClient,
    private val store: CacheStore,
) : VehicleCommandRepository {
    override suspend fun sendCommand(input: SendVehicleCommandInput): Result<CommandResult> {
        val body =
            buildJsonObject {
                put("command", input.command)
                // A null params is dropped entirely, mirroring `JSON.stringify` omitting an
                // `undefined` key; a present-but-empty object is still sent.
                input.params?.let { put("params", it) }
            }
        return api
            .safeRequest<CommandResult>(
                method = HttpMethodKind.POST,
                path = "/vehicles/${input.vehicleId}/command",
                body = jsonBody(body),
            ).onSuccess { invalidate(input.vehicleId) }
    }

    /**
     * Evicts the four cache surfaces a successful command can change, mirroring the web hook's
     * `onSuccess` `invalidateQueries` set.
     */
    private suspend fun invalidate(vehicleId: Long) {
        store.delete(CacheDomain.VehicleState, vehicleId.toString())
        store.delete(CacheDomain.Commands, commandLatestKey(vehicleId.toString()))
        store.delete(CacheDomain.Commands, commandHistoryKey(vehicleId.toString()))
        store.clear(CacheDomain.Vehicles)
    }

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` body.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
