package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.watch.WatchCommandResult
import io.teslasync.shared.core.presentation.watch.WatchComplication
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The S7 data port for the Watch surface — the cross-platform analogue of the web `useWatch` hook
 * domain (web/src/api/hooks/useWatch.ts). Every native Watch screen (Android/Apple via KMP, Windows via
 * the C# port) reaches the backend exclusively through this interface, so a single fake stands in for
 * the whole domain in the S8 state-holder tests.
 *
 * Two reads and one command, mirroring the three web primitives:
 *  - [watchSummary] — `GET /watch/summary` (optionally `?vehicle_id=`), the full watch-glance payload
 *    (web `useWatchSummary`). Streams a cache-then-network [Resource] (ADR-013) cached under
 *    [watchSummaryCacheKey], honouring the web `staleTime` (`STALE_TIMES.MODERATE` = 15s,
 *    [WATCH_SUMMARY_TTL_MILLIS]).
 *  - [watchComplication] — `GET /watch/complication` (optionally `?vehicle_id=`), the minimal
 *    pre-rendered complication payload (web `useWatchComplication`). Cached under
 *    [watchComplicationCacheKey], honouring the web `staleTime` (`STALE_TIMES.FAST` = 30s,
 *    [WATCH_COMPLICATION_TTL_MILLIS]).
 *  - [sendWatchCommand] — `POST /watch/command` with `{ vehicle_id, command }`, the watch-issued
 *    command (web `useWatchCommand`). The web mutation invalidates NOTHING on success (its `onSuccess`
 *    only raises a toast), so this command evicts no cache key and triggers no feed refresh; the
 *    backend reports acceptance in-band via [WatchCommandResult.success].
 *
 * The web `useWatch` file authenticates these calls with an `X-API-Key` header and `skipAuthRefresh`
 * instead of the cookie/OAuth flow; that transport/auth detail is a networking-layer (S4/S6) concern
 * wired at the platform boundary, NOT a state-holder behaviour, so it is not reproduced here. None of
 * the Watch payloads are re-derived client-side (the backend renders them), so they round-trip verbatim
 * with no SI conversion at this layer.
 */
public interface WatchRepository {
    /**
     * `GET /watch/summary` (with `?vehicle_id=` when [vehicleId] is non-null) — the full watch-glance
     * payload for the vehicle (web `useWatchSummary`). The cache key is built by [watchSummaryCacheKey],
     * mirroring the web `watchKeys.summary` tuple. Cached/refreshed on the web `STALE_TIMES.MODERATE`
     * (15s) window ([WATCH_SUMMARY_TTL_MILLIS]).
     */
    public fun watchSummary(vehicleId: Long?): Flow<Resource<WatchSummary>>

    /**
     * `GET /watch/complication` (with `?vehicle_id=` when [vehicleId] is non-null) — the minimal
     * pre-rendered complication payload (web `useWatchComplication`). The cache key is built by
     * [watchComplicationCacheKey], mirroring the web `watchKeys.complication` tuple. Cached/refreshed on
     * the web `STALE_TIMES.FAST` (30s) window ([WATCH_COMPLICATION_TTL_MILLIS]).
     */
    public fun watchComplication(vehicleId: Long?): Flow<Resource<WatchComplication>>

    /**
     * `POST /watch/command` `{ vehicle_id, command }` — dispatches a watch-issued command (web
     * `useWatchCommand`). [vehicleId] defaults to `0` on the wire when null (the web `vehicleId ?? 0`).
     * Returns a non-throwing [Result]; the backend may still answer `2xx` with
     * [WatchCommandResult.success] = `false` for a rejected command. The web mutation invalidates no
     * cache on success, so neither does this call.
     */
    public suspend fun sendWatchCommand(
        vehicleId: Long?,
        command: String,
    ): Result<WatchCommandResult>
}

/**
 * Builds the stable cache/feed key for the watch summary read, mirroring the web `watchKeys.summary`
 * tuple `['watch-summary', vehicleId]`. Prefixed with `watch-summary:` so it partitions per vehicle
 * within the one Watch cache domain; a null [vehicleId] (the web `undefined`, the "primary vehicle"
 * case) interpolates to the literal `null` suffix, mirroring the existing string-key convention. Locked
 * by golden vectors shared with the C# port.
 */
public fun watchSummaryCacheKey(vehicleId: Long?): String = "watch-summary:$vehicleId"

/**
 * Builds the stable cache/feed key for the watch complication read, mirroring the web
 * `watchKeys.complication` tuple `['watch-complication', vehicleId]`. Prefixed with
 * `watch-complication:` so it partitions per vehicle within the one Watch cache domain; a null
 * [vehicleId] interpolates to the literal `null` suffix. Locked by golden vectors shared with the C#
 * port.
 */
public fun watchComplicationCacheKey(vehicleId: Long?): String = "watch-complication:$vehicleId"

/**
 * Builds the `POST /watch/command` body, mirroring the web `JSON.stringify({ vehicle_id, command })`:
 * `vehicle_id` first (defaulting to `0` when [vehicleId] is null, the web `vehicleId ?? 0`) then
 * `command`, in that exact insertion order so the compact JSON is byte-identical. Locked by golden
 * vectors shared with the C# port.
 */
public fun watchCommandBody(
    vehicleId: Long?,
    command: String,
): JsonObject =
    buildJsonObject {
        put("vehicle_id", vehicleId ?: 0L)
        put("command", command)
    }

/**
 * Per-read staleness threshold for the watch-summary feed — the web `useWatchSummary` `staleTime`
 * (`STALE_TIMES.MODERATE` = `15_000`). Applied as a per-entry override so the summary flags staleness on
 * its own web-faithful window even though it shares the Watch domain with the slower complication read.
 */
public const val WATCH_SUMMARY_TTL_MILLIS: Long = 15_000L

/**
 * Per-read staleness threshold for the watch-complication feed — the web `useWatchComplication`
 * `staleTime` (`STALE_TIMES.FAST` = `30_000`). Applied as a per-entry override (it is slower than the
 * summary read it shares the Watch domain with).
 */
public const val WATCH_COMPLICATION_TTL_MILLIS: Long = 30_000L
