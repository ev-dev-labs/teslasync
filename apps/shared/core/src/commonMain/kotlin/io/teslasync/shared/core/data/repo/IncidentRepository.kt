package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.incidents.AppendIncidentUpdateInput
import io.teslasync.shared.core.presentation.incidents.CreateIncidentInput
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentListResponse
import io.teslasync.shared.core.presentation.incidents.ListIncidentsParams
import io.teslasync.shared.core.presentation.incidents.PatchIncidentInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the status-page incident store — the cross-platform analogue of the web
 * `useIncidents` hook domain (web/src/api/hooks/useIncidents.ts). Every native Incidents screen
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The two reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. [incidents] mirrors the web `useIncidents`
 * (`GET /status/incidents`, optionally `?active=1&limit=`); [incident] mirrors the web
 * `useIncident` (`GET /status/incidents/{id}`) and is only ever called for a selected id (the web
 * `enabled: id != null` gate is reproduced in the S8 store).
 *
 * The four mutations are non-throwing suspend [Result]s; on success each invalidates the WHOLE
 * incident cache partition — the data-layer analogue of the web hooks invalidating
 * `['status-incidents']`, which drops every list AND detail query at once (a write can change the
 * list ordering, the active set, or any cached detail). [createIncident] mirrors
 * `useCreateIncident` (`POST /status/incidents`); [patchIncident] mirrors `usePatchIncident`
 * (`PATCH /status/incidents/{id}`); [appendIncidentUpdate] mirrors `useAppendIncidentUpdate`
 * (`POST /status/incidents/{id}/updates`); [deleteIncident] mirrors `useDeleteIncident`
 * (`DELETE /status/incidents/{id}`).
 *
 * Incident fields are plain (ids, enum strings, timestamps, free text) — not unit-bearing — so
 * they round-trip verbatim with no SI conversion; display formatting is the render boundary's job
 * (S5), never this layer's.
 */
public interface IncidentRepository {
    /**
     * `GET /status/incidents` (optionally `?active=1&limit=`) — the incident list for [params]
     * (web `useIncidents`). The query is built by [incidentListQuery] with the web truthy-guard
     * semantics, and the cache key by [incidentListCacheKey] mirroring the web `KEY_LIST` tuple.
     */
    public fun incidents(params: ListIncidentsParams = ListIncidentsParams()): Flow<Resource<IncidentListResponse>>

    /**
     * `GET /status/incidents/{id}` — one incident (web `useIncident`). Cached under
     * [incidentDetailCacheKey], mirroring the web `KEY_DETAIL(id)` tuple.
     */
    public fun incident(id: Long): Flow<Resource<Incident>>

    /**
     * `POST /status/incidents` — creates an incident (web `useCreateIncident`). On success the
     * whole incident partition is evicted so the next list/detail read re-fetches.
     */
    public suspend fun createIncident(input: CreateIncidentInput): Result<Incident>

    /**
     * `PATCH /status/incidents/{id}` — patches an incident (web `usePatchIncident`). On success
     * the whole incident partition is evicted.
     */
    public suspend fun patchIncident(input: PatchIncidentInput): Result<Incident>

    /**
     * `POST /status/incidents/{id}/updates` — appends a timeline entry (web
     * `useAppendIncidentUpdate`). On success the whole incident partition is evicted.
     */
    public suspend fun appendIncidentUpdate(input: AppendIncidentUpdateInput): Result<Incident>

    /**
     * `DELETE /status/incidents/{id}` — removes an incident (web `useDeleteIncident`). On success
     * the whole incident partition is evicted.
     */
    public suspend fun deleteIncident(id: Long): Result<Unit>
}

/**
 * Builds the `/status/incidents` query map with the web `listIncidents` semantics
 * (web/src/api/hooks/useIncidents.ts): `active=1` is sent only when [ListIncidentsParams.activeOnly]
 * is true (mirroring `if (p.activeOnly) q.set('active', '1')`); `limit` is sent only when the bound
 * is present and non-zero (mirroring JavaScript's truthy `if (p.limit)` guard, which drops a zero
 * limit). Keys are snake_case, matching the Go handler. Locked by golden vectors shared with the
 * C# port.
 */
public fun incidentListQuery(params: ListIncidentsParams): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (params.activeOnly) query["active"] = "1"
    params.limit?.takeIf { it != 0 }?.let { query["limit"] = it.toString() }
    return query
}

/**
 * Builds the stable cache/feed key for an incident list read, mirroring the web `KEY_LIST(p)`
 * tuple `['status-incidents', 'list', p]` — two param sets collide in the cache exactly when their
 * `(activeOnly, limit)` pairs match. Prefixed `list:` so it can never collide with
 * [incidentDetailCacheKey] in the shared [io.teslasync.shared.core.cache.CacheDomain.Incidents]
 * partition. Locked by golden vectors shared with the C# port.
 */
public fun incidentListCacheKey(params: ListIncidentsParams): String = "list:${params.activeOnly}:${params.limit?.toString() ?: ""}"

/**
 * Builds the stable cache/feed key for an incident detail read, mirroring the web `KEY_DETAIL(id)`
 * tuple `['status-incidents', 'detail', id]`. Prefixed `detail:` so it can never collide with
 * [incidentListCacheKey] in the shared partition. Locked by golden vectors shared with the C# port.
 */
public fun incidentDetailCacheKey(id: Long): String = "detail:$id"
