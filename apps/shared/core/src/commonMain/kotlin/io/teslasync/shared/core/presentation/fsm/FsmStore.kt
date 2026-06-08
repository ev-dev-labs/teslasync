package io.teslasync.shared.core.presentation.fsm

import io.teslasync.shared.core.data.repo.FsmRepository
import io.teslasync.shared.core.data.repo.FsmType
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.fsmTransitionsKey
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
 * UI-free shared state holder for the FSM shadow-mode debugger — the cross-platform port of the web
 * `useFSM` hook domain (web/src/api/hooks/useFSM.ts). Every native FSM screen (Android/Apple via
 * KMP, Windows via the C# port) binds to this single holder rather than re-implementing the
 * endpoints, query keys, the `enabled: !!entityId` gate, the `fsm_name`/instant-window derivations,
 * or the `INTERVALS.FAST` refetch intent.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each
 * is lazily created on first access, shared so every observer of the same feed (or the same
 * `(filter, window, page)` tuple) folds into one upstream collection, and refreshable via
 * [refreshStats]/[refreshTransitions]. There are no mutations — the web hook file contains only
 * `useQuery`s — so there is no invalidation surface here.
 *
 * The web hooks gate both queries with `enabled: !!entityId`. The holder reproduces that gate: when
 * [entityId] is null or blank the returned feed never fetches and stays at the initial Loading slot
 * (the analogue of a TanStack query with `enabled: false`), so a screen can bind before a vehicle
 * is selected. Disabled feeds collapse to one stable instance per distinct parameter set, so the UI
 * binds once and the repository is never touched.
 *
 * The holder makes no network calls itself; it delegates entirely to the injected [FsmRepository]
 * (S7). Values stay SI; conversion is display-only (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class FsmStore(
    private val repo: FsmRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()
    private val disabledFeeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    // ---- Reads (2) ----------------------------------------------------------------

    /**
     * Shared, refreshable `GET /fsm/stats?vehicle_id={entityId}` feed (web `useFSMStats`). When
     * [entityId] is null or blank the returned feed never fetches and stays at the initial Loading
     * slot — the analogue of `enabled: !!entityId`.
     */
    public fun stats(entityId: String?): StateFlow<Resource<JsonElement>> {
        if (entityId.isNullOrBlank()) return disabledFeeds.getOrPut(DISABLED_STATS) { MutableStateFlow(INITIAL) }
        return feed("$KEY_STATS:$entityId") { repo.stats(entityId) }
    }

    /**
     * Shared, refreshable `GET /fsm/transitions` feed (web `useFSMTransitions`). When [entityId] is
     * null or blank the returned feed never fetches and stays at the initial Loading slot — the
     * analogue of `enabled: !!entityId`. The `fsm_name` param and the optional `start`/`end` instant
     * window are the [io.teslasync.shared.core.data.repo.buildFsmTransitionsQuery] derivations,
     * applied inside the repository; the holder only forwards the parameters and keys the feed by
     * the same tuple the web `fsmKeys.transitions` query key uses.
     */
    public fun transitions(
        entityId: String?,
        fsmType: FsmType,
        hours: Int,
        page: Int,
        perPage: Int,
        startInstant: String? = null,
        endInstantExclusive: String? = null,
    ): StateFlow<Resource<JsonElement>> {
        val tuple = fsmTransitionsKey(entityId ?: "", fsmType, hours, page, perPage, startInstant, endInstantExclusive)
        if (entityId.isNullOrBlank()) {
            return disabledFeeds.getOrPut("$DISABLED_TRANSITIONS:$tuple") { MutableStateFlow(INITIAL) }
        }
        return feed("$KEY_TRANSITIONS:$tuple") {
            repo.transitions(entityId, fsmType, hours, page, perPage, startInstant, endInstantExclusive)
        }
    }

    // ---- Refresh ------------------------------------------------------------------

    /** Re-fetches the [stats] feed for [entityId] if it is being observed. A no-op otherwise. */
    public fun refreshStats(entityId: String?) {
        if (entityId.isNullOrBlank()) return
        refresh("$KEY_STATS:$entityId")
    }

    /**
     * Re-fetches the [transitions] feed for the given parameter tuple if it is being observed. A
     * no-op for a null/blank [entityId] (whose feed never fetches) or a feed nobody has opened.
     */
    public fun refreshTransitions(
        entityId: String?,
        fsmType: FsmType,
        hours: Int,
        page: Int,
        perPage: Int,
        startInstant: String? = null,
        endInstantExclusive: String? = null,
    ) {
        if (entityId.isNullOrBlank()) return
        val tuple = fsmTransitionsKey(entityId, fsmType, hours, page, perPage, startInstant, endInstantExclusive)
        refresh("$KEY_TRANSITIONS:$tuple")
    }

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

        const val KEY_STATS = "stats"
        const val KEY_TRANSITIONS = "transitions"
        const val DISABLED_STATS = "disabled-stats"
        const val DISABLED_TRANSITIONS = "disabled-transitions"
    }
}
