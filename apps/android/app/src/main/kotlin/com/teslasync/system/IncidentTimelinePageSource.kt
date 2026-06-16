// The data ports the IncidentTimelinePage surface binds to (P1/S8), plus their production binding over the shared
// S7 IncidentRepository. The view (composable) performs NO HTTP — it only collects state from the view-model and
// dispatches the two writes through this seam, reproducing the web page's three data hooks
// (web/src/features/system/pages/IncidentTimelinePage.tsx): `useIncident(id)` (GET /status/incidents/{id}),
// `useAppendIncidentUpdate` (POST …/updates), and `usePatchIncident` (PATCH …).
//
// The detail read is the shared-core cache-then-network `Resource` stream the S7 [IncidentRepository] exposes; the
// two writes are its non-throwing suspend `Result`s, each of which evicts the whole incident cache partition on
// success (the data-layer analogue of the web hooks invalidating `['status-incidents']`). The view-model re-reads
// the detail feed on a successful write, so the timeline + header reflect the change with no extra wiring. Narrow
// the seam to these three operations so the view-model + page depend on an abstraction (the real repository ↔ a
// test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.incidenttimeline

import io.teslasync.shared.core.data.repo.IncidentRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.incidents.AppendIncidentUpdateInput
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.PatchIncidentInput
import kotlinx.coroutines.flow.Flow

/**
 * The seam the IncidentTimelinePage surface depends on so it binds to an abstraction (the shared S7
 * [IncidentRepository] in production, a fake in tests), never to a concrete repository or the network. The detail
 * read is a cache-then-network `Resource` flow (web `useIncident`); the two writes are non-throwing `Result`s that
 * evict the incident cache partition on success (web `useAppendIncidentUpdate` / `usePatchIncident`). No HTTP
 * touches the view.
 */
interface IncidentTimelinePageSource {
    /** The cache-then-network `GET /status/incidents/{id}` feed for [id] (web `useIncident`). */
    fun incident(id: Long): Flow<Resource<Incident>>

    /** Append a timeline entry (web `useAppendIncidentUpdate`); on success the incident partition is evicted. */
    suspend fun appendIncidentUpdate(input: AppendIncidentUpdateInput): Result<Incident>

    /** Patch the incident — used here only to resolve (web `usePatchIncident`); on success the partition is evicted. */
    suspend fun patchIncident(input: PatchIncidentInput): Result<Incident>
}

/**
 * Binds the surface to the shared **S7** [IncidentRepository] — the HTTP-backed, cache-then-network repository the
 * host constructs over the shared resilient client + offline cache (exactly as the sibling CommandsRoute builds
 * its page-local `HttpCommandsRepository`). The detail feed flows through unchanged so the view-model renders the
 * full data-state matrix (loading / content / error / stale / offline); the two writes delegate verbatim. No HTTP
 * touches the view.
 */
fun incidentTimelinePageSourceOf(repository: IncidentRepository): IncidentTimelinePageSource =
    object : IncidentTimelinePageSource {
        override fun incident(id: Long): Flow<Resource<Incident>> = repository.incident(id)

        override suspend fun appendIncidentUpdate(input: AppendIncidentUpdateInput): Result<Incident> =
            repository.appendIncidentUpdate(input)

        override suspend fun patchIncident(input: PatchIncidentInput): Result<Incident> = repository.patchIncident(input)
    }
