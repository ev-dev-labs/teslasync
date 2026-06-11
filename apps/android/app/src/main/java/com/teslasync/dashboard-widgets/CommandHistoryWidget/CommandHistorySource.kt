// The data port the Command History widget binds to — the native analogue of the web `useVehicles` +
// `useCommandHistory` hook composition (web/src/features/dashboard/widgets/CommandHistoryWidget.tsx,
// web/src/api/hooks/useCommands.ts), vehicle resolution included. The view never performs HTTP; a
// concrete adapter over the shared S8 state holders (or a test fake) drives this seam. Cache-then-network
// freshness is preserved end to end (ADR-013): the parsed projection carries every cached/stale/error
// flag from the upstream `/commands/history` feed so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CommandHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.commandhistory

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.commands.CommandsStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the cache-then-network sequence of parsed command-history snapshots the widget renders. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store or the network.
 */
fun interface CommandHistorySource {
    /** The cache-then-network command-log feed (cached rows first for an instant cold start, then refreshed). */
    fun history(): Flow<Resource<List<CommandLogEntry>>>
}

/**
 * Parse a raw [Resource] of `/commands/history` JSON into a [Resource] of [CommandLogEntry] rows,
 * preserving every freshness flag (cached / refreshing / stale / offline) so the view-model can render
 * the full state matrix. Pure, so the parse-and-preserve contract is unit-tested without a network or
 * cache. A non-array (or absent) body parses to an empty list — the web `select: (data) => data ?? []`
 * null-guard, which then drives the "No commands sent" empty surface.
 */
internal fun Resource<JsonElement>.toCommandEntries(): Resource<List<CommandLogEntry>> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let { CommandLogEntry.parseList(it) },
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = CommandLogEntry.parseList(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let { CommandLogEntry.parseList(it) },
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * The shared-state-holder-backed [CommandHistorySource]. It resolves the scoped vehicle (the native
 * analogue of the web `vehicleId ?? vehicles?.[0]?.id`: an explicit [explicitVehicleId] wins, otherwise
 * the app-wide active vehicle from [activeVehicleId], which self-heals to the first enrolled vehicle via
 * `SelectedVehicleStore`), then maps the shared [CommandsStore.commandHistory] cache-then-network feed
 * (web `useCommandHistory`) into parsed [CommandLogEntry] rows. With no vehicle the stream emits a
 * resolved-empty success so the surface shows the "No commands sent" empty state, mirroring the web
 * hook's disabled query (`enabled: !!vehicleId`). No HTTP touches the view — the [CommandsStore]
 * (S7/S8) owns it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StoreCommandHistorySource(
    private val commandsStore: CommandsStore,
    private val activeVehicleId: StateFlow<Long?>,
    private val explicitVehicleId: Long? = null,
) : CommandHistorySource {
    override fun history(): Flow<Resource<List<CommandLogEntry>>> =
        activeVehicleId.flatMapLatest { active ->
            when (val vehicleId = explicitVehicleId ?: active) {
                null -> flowOf(Resource.Success(data = emptyList(), fetchedAt = NO_FETCH, stale = false))
                else -> commandsStore.commandHistory(vehicleId.toString()).map { it.toCommandEntries() }
            }
        }

    private companion object {
        /** Sentinel "never fetched" stamp for the synthetic no-vehicle empty emission. */
        const val NO_FETCH = 0L
    }
}
