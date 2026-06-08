package io.teslasync.shared.core.presentation.incidents

import io.teslasync.shared.core.data.repo.IncidentRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.incidentDetailCacheKey
import io.teslasync.shared.core.data.repo.incidentListCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the status-page incident store — the cross-platform port of the
 * web `useIncidents` hook domain (web/src/api/hooks/useIncidents.ts). Every native Incidents screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the detail `enabled` gate, or the invalidate-all rule.
 *
 * The two reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each
 * is lazily created on first access, shared so every observer of the same feed (or the same list
 * `params` / detail `id`) folds into one upstream collection, and refreshable. [incidents] mirrors
 * the web `useIncidents` (list, optionally active-only/limited); [incident] mirrors the web
 * `useIncident` with its `enabled: id != null` gate — a `null` id returns a stable disabled feed
 * that never fetches and stays at the initial Loading slot (the analogue of a TanStack query with
 * `enabled: false`), so a post-mortem drawer can bind before an incident is selected.
 *
 * The four mutations are non-throwing suspend [Result]s; on success each refreshes EVERY observed
 * feed via [refreshAll], because the web hooks invalidate `['status-incidents']` — the whole prefix
 * (list AND detail) — since a write can change the list ordering, the active set, or any cached
 * detail. The repository (S7) clears the whole cache partition on the same success, so each refresh
 * re-fetches rather than replaying a stale entry. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class IncidentsStore(
    private val repo: IncidentRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val listFeeds = mutableMapOf<String, StateFlow<Resource<IncidentListResponse>>>()
    private val detailFeeds = mutableMapOf<String, StateFlow<Resource<Incident>>>()
    private val disabledDetailFeed: StateFlow<Resource<Incident>> = MutableStateFlow(INITIAL_DETAIL)

    // ---- Reads (2) ----------------------------------------------------------------

    /** Shared, refreshable `GET /status/incidents` feed for [params] (web `useIncidents`). */
    public fun incidents(params: ListIncidentsParams = ListIncidentsParams()): StateFlow<Resource<IncidentListResponse>> =
        sharedFeed(incidentListCacheKey(params), listFeeds, INITIAL_LIST) { repo.incidents(params) }

    /**
     * Shared, refreshable `GET /status/incidents/{id}` feed (web `useIncident`). When [id] is
     * `null` the returned feed never fetches and stays at the initial Loading slot — the analogue
     * of the web `enabled: id != null` gate — collapsing to one stable disabled instance so a
     * drawer can bind before an incident is selected.
     */
    public fun incident(id: Long?): StateFlow<Resource<Incident>> {
        if (id == null) return disabledDetailFeed
        return sharedFeed(incidentDetailCacheKey(id), detailFeeds, INITIAL_DETAIL) { repo.incident(id) }
    }

    // ---- Mutations (4) ------------------------------------------------------------

    /** Creates an incident, then refreshes every observed feed (web `useCreateIncident`). */
    public suspend fun createIncident(input: CreateIncidentInput): Result<Incident> = repo.createIncident(input).onSuccess { refreshAll() }

    /** Patches an incident, then refreshes every observed feed (web `usePatchIncident`). */
    public suspend fun patchIncident(input: PatchIncidentInput): Result<Incident> = repo.patchIncident(input).onSuccess { refreshAll() }

    /** Appends a timeline entry, then refreshes every observed feed (web `useAppendIncidentUpdate`). */
    public suspend fun appendIncidentUpdate(input: AppendIncidentUpdateInput): Result<Incident> =
        repo.appendIncidentUpdate(input).onSuccess { refreshAll() }

    /** Deletes an incident, then refreshes every observed feed (web `useDeleteIncident`). */
    public suspend fun deleteIncident(id: Long): Result<Unit> = repo.deleteIncident(id).onSuccess { refreshAll() }

    /**
     * Re-fetches every observed feed — the holder-side analogue of invalidating
     * `['status-incidents']`. Bumping a feed's trigger restarts its cache-then-network collection.
     * A feed nobody is observing is a no-op.
     */
    public fun refreshAll() {
        triggers.values.forEach { t -> t.update { n -> n + 1 } }
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access into [feeds]. The feed
     * is a `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refreshAll]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at
     * least one is active.
     */
    private fun <T> sharedFeed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        initial: Resource<T>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = initial,
                )
        }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL_LIST: Resource<IncidentListResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val INITIAL_DETAIL: Resource<Incident> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
