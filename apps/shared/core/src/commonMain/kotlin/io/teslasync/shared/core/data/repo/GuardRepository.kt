package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.guard.AcknowledgeResponse
import io.teslasync.shared.core.presentation.guard.GuardConfig
import io.teslasync.shared.core.presentation.guard.GuardEventsResponse
import io.teslasync.shared.core.presentation.guard.PanicResponse
import io.teslasync.shared.core.presentation.guard.SetConfigResponse
import io.teslasync.shared.core.presentation.guard.SetGuardConfigInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the Sentry-Guard control plane — the cross-platform analogue of the web
 * `useGuard` hook domain (web/src/api/hooks/useGuard.ts). Every native Guard screen (Android/Apple
 * via KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a
 * single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The two reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. [guardConfig] mirrors the web `useGuardConfig`
 * (`GET /vehicles/{id}/guard`); [guardEvents] mirrors the web `useGuardEvents`
 * (`GET /vehicles/{id}/guard/events`) and caches the raw `{ vehicle_id, events }` envelope exactly
 * as the web query cache holds it — the `safeArray(data?.events)` unwrap is a presentation concern
 * applied in the S8 [io.teslasync.shared.core.presentation.guard.GuardStore].
 *
 * The three mutations are non-throwing suspend [Result]s and have NO cache interaction here: like
 * the web hooks, invalidation is expressed as a targeted refresh in the S8 store (the
 * `invalidateQueries` analogue), and the durable cache is intentionally left intact so a refresh
 * shows the last-known value while the network reload runs (TanStack keeps previous data on
 * invalidate). [setGuardConfig] mirrors `useSetGuardConfig` (`POST /vehicles/{id}/guard`);
 * [triggerPanic] mirrors `useGuardPanic` (`POST /vehicles/{id}/guard/panic`); [acknowledgeGuardEvent]
 * mirrors `useAcknowledgeGuardEvent` (`POST /vehicles/{id}/guard/events/{eventID}/acknowledge`).
 *
 * Guard fields are plain (ids, enums, timestamps, opaque detail maps) — not unit-bearing — so they
 * round-trip verbatim with no SI conversion; display formatting is the render boundary's job (S5).
 * The web hooks gate each read with `enabled: vehicleId > 0`; that gate is a presentation concern
 * (the S8 store's [io.teslasync.shared.core.presentation.guard.guardVehicleEnabled]), so this port
 * takes a non-null [vehicleId] and is only ever called for an enabled vehicle.
 */
public interface GuardRepository {
    /**
     * `GET /vehicles/{vehicleId}/guard` — the guard config for one vehicle (web `useGuardConfig`).
     * Cached under [guardConfigKey], mirroring the web `guardKeys.config(vehicleId)` query key.
     */
    public fun guardConfig(vehicleId: String): Flow<Resource<GuardConfig>>

    /**
     * `GET /vehicles/{vehicleId}/guard/events` — the guard events envelope for one vehicle (web
     * `useGuardEvents`). Cached under [guardEventsKey], mirroring the web
     * `guardKeys.events(vehicleId)` query key. The envelope is cached verbatim; the
     * `safeArray(data?.events)` unwrap happens in the S8 store.
     */
    public fun guardEvents(vehicleId: String): Flow<Resource<GuardEventsResponse>>

    /**
     * `POST /vehicles/{vehicleId}/guard` with `{ enabled, home_geofence_id, sensitivity, auto_panic }`
     * — sets the guard config (web `useSetGuardConfig`). No cache interaction; the S8 store refreshes
     * the config + events feeds on success (the web `invalidateQueries` of both keys).
     */
    public suspend fun setGuardConfig(input: SetGuardConfigInput): Result<SetConfigResponse>

    /**
     * `POST /vehicles/{vehicleId}/guard/panic` — triggers a panic alert (web `useGuardPanic`). No
     * body and no cache interaction; the S8 store refreshes the events feed on success (the web
     * `invalidateQueries` of the events key).
     */
    public suspend fun triggerPanic(vehicleId: String): Result<PanicResponse>

    /**
     * `POST /vehicles/{vehicleId}/guard/events/{eventId}/acknowledge` — marks a guard event read
     * (web `useAcknowledgeGuardEvent`). No body and no cache interaction; the S8 store refreshes the
     * events feed on success (the web `invalidateQueries` of the events key).
     */
    public suspend fun acknowledgeGuardEvent(
        vehicleId: String,
        eventId: Long,
    ): Result<AcknowledgeResponse>
}

/**
 * Builds the stable cache/feed key for [vehicleId]'s guard config, mirroring the web
 * `guardKeys.config(vehicleId)` tuple `['guard-config', vehicleId]`. Prefixed so it can never
 * collide with [guardEventsKey] in the shared [io.teslasync.shared.core.cache.CacheDomain.Guard]
 * partition. Locked by golden vectors shared with the C# port.
 */
public fun guardConfigKey(vehicleId: String): String = "config:$vehicleId"

/**
 * Builds the stable cache/feed key for [vehicleId]'s guard events, mirroring the web
 * `guardKeys.events(vehicleId)` tuple `['guard-events', vehicleId]`. Prefixed so it can never
 * collide with [guardConfigKey] in the shared partition. Locked by golden vectors shared with the
 * C# port.
 */
public fun guardEventsKey(vehicleId: String): String = "events:$vehicleId"
