package io.teslasync.shared.core.presentation.commands

import io.teslasync.shared.core.data.repo.CommandsRepository
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
 * UI-free shared state holder for the per-vehicle command audit read-model — the cross-platform port
 * of the web `useCommands` hook domain (web/src/api/hooks/useCommands.ts). Every native Commands
 * screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoints, query keys, refetch rules, or the disabled-query gates.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 * [commandHistory] mirrors the web `useCommandHistory` (the recent command log) and [commandLatest]
 * mirrors `useCommandLatest` (the latest entry per command-name). Each feed is lazily created on
 * first access, shared so every observer of the same vehicle folds into one upstream collection, and
 * refreshable via [refreshCommandHistory] / [refreshCommandLatest]. There are no mutations — the web
 * hook file contains only two `useQuery`s — so there is no invalidation surface here.
 *
 * The web hooks gate each query with `enabled: !!vehicleId`. The holder reproduces that gate: when
 * [vehicleId] is null (or blank — the web `!!vehicleId` falsy test also rejects the empty string) the
 * returned feed never fetches and stays at the initial Loading slot (the analogue of a TanStack
 * query with `enabled: false`), so a screen can bind before a vehicle is selected. All such disabled
 * feeds collapse to one stable instance per read, so the UI binds once and the repository is never
 * touched.
 *
 * The holder makes no network calls itself; it delegates entirely to the injected
 * [CommandsRepository] (S7). Values round-trip verbatim; any display formatting is the render
 * boundary's job (S5).
 *
 * This holder mirrors the web hooks' single-threaded usage and is not internally synchronised; create
 * and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feeds are routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class CommandsStore(
    private val repo: CommandsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<JsonElement>>>()

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/commands/history?limit=200` feed (web
     * `useCommandHistory`). When [vehicleId] is null or blank the returned feed never fetches and
     * stays at the initial Loading slot — the analogue of `enabled: !!vehicleId`.
     */
    public fun commandHistory(vehicleId: String?): StateFlow<Resource<JsonElement>> {
        if (vehicleId.isNullOrEmpty()) return DISABLED_HISTORY
        return feed(historyKey(vehicleId)) { repo.commandHistory(vehicleId) }
    }

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/commands/latest` feed (web `useCommandLatest`).
     * When [vehicleId] is null or blank the returned feed never fetches and stays at the initial
     * Loading slot — the analogue of `enabled: !!vehicleId`.
     */
    public fun commandLatest(vehicleId: String?): StateFlow<Resource<JsonElement>> {
        if (vehicleId.isNullOrEmpty()) return DISABLED_LATEST
        return feed(latestKey(vehicleId)) { repo.commandLatest(vehicleId) }
    }

    /**
     * Re-fetches the [commandHistory] feed for [vehicleId] if it is being observed. A no-op for a
     * null/blank [vehicleId] (whose feed never fetches) or a feed nobody has opened.
     */
    public fun refreshCommandHistory(vehicleId: String?) {
        if (vehicleId.isNullOrEmpty()) return
        refresh(historyKey(vehicleId))
    }

    /**
     * Re-fetches the [commandLatest] feed for [vehicleId] if it is being observed. A no-op for a
     * null/blank [vehicleId] (whose feed never fetches) or a feed nobody has opened.
     */
    public fun refreshCommandLatest(vehicleId: String?) {
        if (vehicleId.isNullOrEmpty()) return
        refresh(latestKey(vehicleId))
    }

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

        // One stable disabled slot per read, so a screen bound before a vehicle is selected never
        // fetches and always sees the same instance (web `enabled: !!vehicleId`).
        val DISABLED_HISTORY: StateFlow<Resource<JsonElement>> = MutableStateFlow(INITIAL)
        val DISABLED_LATEST: StateFlow<Resource<JsonElement>> = MutableStateFlow(INITIAL)

        fun historyKey(vehicleId: String): String = "history:$vehicleId"

        fun latestKey(vehicleId: String): String = "latest:$vehicleId"
    }
}
