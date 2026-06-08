package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixResponse
import io.teslasync.shared.core.presentation.rbacmatrix.RbacUpsertCell
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the RBAC admin matrix — the cross-platform analogue of the web
 * `useRbacMatrix` hook domain (web/src/api/hooks/useRbacMatrix.ts). Every native RBAC surface
 * (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through this
 * interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The single read ([matrix]) streams a cache-then-network [Resource] (ADR-013): the cached document
 * first for an instant cold start, then the refreshed document. An open-mode `501 AUTH_MODE_OPEN`
 * is normalised into [RbacMatrixResponse.Open] (an open sentinel that reads as a successful no-op),
 * exactly as the web `queryFn` does — it is "feature unavailable", never an error.
 *
 * The single mutation ([upsertCells]) is a non-throwing suspend [Result] and has NO cache
 * interaction here: invalidation is expressed as a targeted refresh in the S8 store (the web
 * `invalidateQueries(rbacMatrixKeys.matrix())` analogue), and the durable cache is left intact so a
 * refresh shows the last-known matrix while the network reload runs.
 *
 * No RBAC field is display-unit-bearing, so payloads round-trip verbatim with no SI conversion (S5);
 * display formatting is the render boundary's job.
 */
public interface RbacRepository {
    /**
     * `GET /admin/rbac/matrix` — the RBAC matrix document (web `useRbacMatrix`). An open-mode
     * `501 AUTH_MODE_OPEN` yields [RbacMatrixResponse.Open]; otherwise the parsed
     * [io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixSession]. Any other transport
     * failure surfaces through [Resource.Error]. The web hook polls nothing (the matrix changes only
     * through an explicit edit), so the only refresh is the S8 store's post-mutation invalidation.
     */
    public fun matrix(): Flow<Resource<RbacMatrixResponse>>

    /**
     * `PUT /admin/rbac/matrix` with `{ cells }` — persists the changed `(role, permission, allowed)`
     * bindings (web `useUpsertRbacCells`). The route is sudo-gated upstream; the resilient client
     * handles reauth. An empty batch is a backend no-op. On success the S8 store refreshes the matrix
     * feed (the web `invalidateQueries(rbacMatrixKeys.matrix())`); this call does NOT touch the cache.
     */
    public suspend fun upsertCells(cells: List<RbacUpsertCell>): Result<Unit>
}
