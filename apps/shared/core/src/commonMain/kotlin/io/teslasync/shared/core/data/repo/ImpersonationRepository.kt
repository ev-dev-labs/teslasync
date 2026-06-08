package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidatesResponse
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStartRequest
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for admin impersonation — the cross-platform analogue of the web
 * `useImpersonation` hook domain (web/src/api/hooks/useImpersonation.ts). Every native
 * Impersonation surface (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * The two reads ([impersonationStatus], [impersonationCandidates]) stream a cache-then-network
 * [Resource] (ADR-013): the cached value first for an instant cold start, then the refreshed value.
 * Each open-mode `501 AUTH_MODE_OPEN` is normalised into the union's open value (an open sentinel
 * that reads as a successful no-op), exactly as the web `queryFn`s do — it is "feature
 * unavailable", never an error.
 *
 * The two mutations ([startImpersonation], [endImpersonation]) are non-throwing suspend [Result]s.
 * Because a start/end changes WHICH principal every other endpoint answers as, each mutation on
 * success invalidates the ENTIRE offline cache (the data-layer analogue of the web hooks'
 * argument-less `queryClient.invalidateQueries()` that drops every cached query — the same
 * principal-change reasoning as the clear-on-logout hook) and then primes the status partition with
 * the new state (the web `setQueryData(impersonationKeys.status, …)`) so the banner flips without an
 * intermediate flash.
 *
 * No impersonation field is display-unit-bearing, so payloads round-trip verbatim with no SI
 * conversion (S5); display formatting is the render boundary's job.
 */
public interface ImpersonationRepository {
    /**
     * `GET /admin/impersonate` — the current impersonation state (web `useImpersonationStatus`). An
     * `active` cookie yields [ImpersonationStatus.Active]; no cookie yields
     * [ImpersonationStatus.Inactive]; an open-mode `501 AUTH_MODE_OPEN` yields
     * [ImpersonationStatus.Open]. Any other transport failure surfaces through [Resource.Error].
     */
    public fun impersonationStatus(): Flow<Resource<ImpersonationStatus>>

    /**
     * `GET /admin/impersonate/candidates` — the impersonatable subjects, EXCLUDING the caller (web
     * `useImpersonationCandidates`). An open-mode `501 AUTH_MODE_OPEN` yields
     * [ImpersonationCandidatesResponse.Open]; otherwise [ImpersonationCandidatesResponse.Session]
     * with the parsed list (empty for a single-subject install).
     */
    public fun impersonationCandidates(): Flow<Resource<ImpersonationCandidatesResponse>>

    /**
     * `POST /admin/impersonate` — starts impersonating [request].subject (web
     * `useStartImpersonation`). The endpoint is sudo-gated upstream. On success the whole cache is
     * invalidated and the status partition is primed with the returned [ImpersonationStatus.Active].
     */
    public suspend fun startImpersonation(request: ImpersonationStartRequest): Result<ImpersonationStatus>

    /**
     * `POST /admin/impersonate/end` — ends the current session (web `useEndImpersonation`).
     * Idempotent: the backend answers `204` even when no claim is active. On success the whole cache
     * is invalidated and the status partition is primed with [ImpersonationStatus.Inactive].
     */
    public suspend fun endImpersonation(): Result<Unit>
}
