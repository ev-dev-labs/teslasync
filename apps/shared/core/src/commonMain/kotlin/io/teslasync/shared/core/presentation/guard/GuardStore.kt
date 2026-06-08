package io.teslasync.shared.core.presentation.guard

import io.teslasync.shared.core.data.repo.GuardRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.guardConfigKey
import io.teslasync.shared.core.data.repo.guardEventsKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Sentry-Guard control plane — the cross-platform port of the
 * web `useGuard` hook domain (web/src/api/hooks/useGuard.ts). Every native Guard screen (Android/
 * Apple via KMP, Windows via the C# port) binds to this single holder rather than re-implementing
 * the endpoints, query keys, the `enabled: vehicleId > 0` gate, the `safeArray(data?.events)`
 * unwrap, or the per-mutation invalidation rules.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013), each
 * lazily created on first access and shared so every observer of the same vehicle folds into one
 * upstream collection:
 *  - [config] mirrors the web `useGuardConfig` — the per-vehicle guard config;
 *  - [events] mirrors `useGuardEvents` — the per-vehicle events feed, with the envelope unwrapped to
 *    a plain `List<GuardEvent>` through [guardEventsOf] (the web `select: safeArray(data?.events)`
 *    analogue), re-projected off the SAME shared upstream so the unwrap never triggers a second
 *    fetch.
 *
 * Both reads gate on [guardVehicleEnabled] (the web `enabled: vehicleId > 0`): a null/blank/
 * non-positive id returns a feed that never fetches and stays at the initial Loading slot, so a
 * screen can bind before a vehicle is selected. All such disabled feeds collapse to one stable
 * instance per read.
 *
 * The three mutations are non-throwing suspend [Result]s; on success each refreshes EXACTLY the
 * feeds the matching web hook invalidates via `invalidateQueries`:
 *  - [setGuardConfig] (`useSetGuardConfig`) → the config + events feeds;
 *  - [triggerPanic] (`useGuardPanic`)       → the events feed;
 *  - [acknowledgeEvent] (`useAcknowledgeGuardEvent`) → the events feed.
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached value first (the web behaviour of keeping prior data during a refetch). The holder
 * makes no network calls itself — it delegates entirely to the injected [GuardRepository] (S7).
 * Values stay SI; conversion is display-only (S5). Toasts and optimistic UI are render-layer
 * concerns and are intentionally NOT reproduced here. This holder mirrors the web hook's
 * single-threaded usage and is not internally synchronised; create and drive it from one
 * confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class GuardStore(
    private val repo: GuardRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val configFeeds = mutableMapOf<String, StateFlow<Resource<GuardConfig>>>()
    private val eventsFeeds = mutableMapOf<String, StateFlow<Resource<List<GuardEvent>>>>()

    // ---- Reads --------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/guard` feed (web `useGuardConfig`). When
     * [vehicleId] is not a strictly-positive id the returned feed never fetches and stays at the
     * initial Loading slot — the analogue of `enabled: vehicleId > 0`.
     */
    public fun config(vehicleId: String?): StateFlow<Resource<GuardConfig>> {
        if (!guardVehicleEnabled(vehicleId)) return DISABLED_CONFIG
        val id = vehicleId!!
        return configFeeds.getOrPut(guardConfigKey(id)) {
            trigger(guardConfigKey(id))
                .flatMapLatest { repo.guardConfig(id) }
                .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_CONFIG)
        }
    }

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/guard/events` feed (web `useGuardEvents`), with
     * the `{ vehicle_id, events }` envelope unwrapped to a plain `List<GuardEvent>` via
     * [guardEventsOf] (the web `select: safeArray(data?.events)`). When [vehicleId] is not a
     * strictly-positive id the returned feed never fetches and stays at the initial Loading slot —
     * the analogue of `enabled: vehicleId > 0`.
     */
    public fun events(vehicleId: String?): StateFlow<Resource<List<GuardEvent>>> {
        if (!guardVehicleEnabled(vehicleId)) return DISABLED_EVENTS
        val id = vehicleId!!
        return eventsFeeds.getOrPut(guardEventsKey(id)) {
            trigger(guardEventsKey(id))
                .flatMapLatest { repo.guardEvents(id) }
                .map { resource -> resource.mapData { envelope -> guardEventsOf(envelope) } }
                .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), INITIAL_EVENTS)
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Sets the guard config, then refreshes the config + events feeds (web `useSetGuardConfig`,
     * which invalidates both `guardKeys.config` and `guardKeys.events`).
     */
    public suspend fun setGuardConfig(input: SetGuardConfigInput): Result<SetConfigResponse> =
        repo.setGuardConfig(input).onSuccess {
            refresh(guardConfigKey(input.vehicleId))
            refresh(guardEventsKey(input.vehicleId))
        }

    /**
     * Triggers a panic alert, then refreshes the events feed (web `useGuardPanic`, which invalidates
     * `guardKeys.events`). A no-op gate for a non-positive [vehicleId] mirrors the read gate, so a
     * panic is never fired against an unselected vehicle.
     */
    public suspend fun triggerPanic(vehicleId: String): Result<PanicResponse> =
        repo.triggerPanic(vehicleId).onSuccess { refresh(guardEventsKey(vehicleId)) }

    /**
     * Acknowledges a guard event, then refreshes the events feed (web `useAcknowledgeGuardEvent`,
     * which invalidates `guardKeys.events`).
     */
    public suspend fun acknowledgeEvent(
        vehicleId: String,
        eventId: Long,
    ): Result<AcknowledgeResponse> = repo.acknowledgeGuardEvent(vehicleId, eventId).onSuccess { refresh(guardEventsKey(vehicleId)) }

    /** Re-fetches [vehicleId]'s config feed if it is being observed; a no-op otherwise. */
    public fun refreshConfig(vehicleId: String) {
        refresh(guardConfigKey(vehicleId))
    }

    /** Re-fetches [vehicleId]'s events feed if it is being observed; a no-op otherwise. */
    public fun refreshEvents(vehicleId: String) {
        refresh(guardEventsKey(vehicleId))
    }

    // ---- Internals ----------------------------------------------------------------

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    /** Transforms a [Resource]'s payload (cached + data) through [transform], preserving its state. */
    private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
            is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
        }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL_CONFIG: Resource<GuardConfig> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_EVENTS: Resource<List<GuardEvent>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        // One stable disabled slot per read, so a screen bound before a vehicle is selected never
        // fetches and always sees the same instance (web `enabled: vehicleId > 0`).
        val DISABLED_CONFIG: StateFlow<Resource<GuardConfig>> = MutableStateFlow(INITIAL_CONFIG)
        val DISABLED_EVENTS: StateFlow<Resource<List<GuardEvent>>> = MutableStateFlow(INITIAL_EVENTS)
    }
}
