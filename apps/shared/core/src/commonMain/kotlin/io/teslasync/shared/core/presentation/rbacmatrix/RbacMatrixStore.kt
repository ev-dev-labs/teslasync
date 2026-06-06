package io.teslasync.shared.core.presentation.rbacmatrix

import io.teslasync.shared.core.data.repo.RbacRepository
import io.teslasync.shared.core.data.repo.Resource
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
 * UI-free shared state holder for the RBAC admin matrix — the cross-platform port of the web
 * `useRbacMatrix` hook domain (web/src/api/hooks/useRbacMatrix.ts). Every native RBAC surface
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing the endpoints, the query key, the open-mode normalisation, the
 * invalidate-on-save rule, or the snapshot diff.
 *
 * The single read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013):
 *  - [matrix] mirrors the web `useRbacMatrix` — the cached document first for an instant cold start,
 *    then the refreshed value, refreshable via [refresh]. The web hook does not poll (the matrix
 *    changes only through an explicit edit), so the only refresh is the post-save invalidation.
 *
 * A derived predicate flow folds the current best-known matrix through [RbacMatrixDerivations],
 * mirroring the web `isRbacOpenMode` helper:
 *  - [isOpenMode] is `true` only once the read resolves to open mode, `false` while loading/errored
 *    (it reads [Resource.cached], the current best-known value, exactly as the web predicate reads
 *    the query's `data`).
 *
 * The single mutation is a non-throwing suspend [Result]; on success it refreshes the matrix feed at
 * the SAME granularity the web hook invalidates at:
 *  - [upsertCells] mirrors `useUpsertRbacCells` — PUTs the changed cells; on success it calls
 *    [refresh] because the web invalidates `rbacMatrixKeys.matrix()`. A failed mutation is propagated
 *    and refreshes nothing (the web `onError` skips invalidation).
 *
 * [diffMatrices] re-exposes the web `diffMatrices` snapshot-diff so a screen can compute the minimal
 * upsert batch from its edited draft against the loaded baseline without re-implementing the union /
 * default-false semantics. It is a pure delegation to [RbacMatrixDerivations.diffMatrices].
 *
 * The holder makes no network calls itself. It mirrors the web hook's single-threaded usage and is
 * not internally synchronised; create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the read and the mutation are routed through.
 * @property scope the coroutine scope the shared flows run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class RbacMatrixStore(
    private val repo: RbacRepository,
    private val scope: CoroutineScope,
) {
    private val trigger = MutableStateFlow(0)

    /**
     * The live RBAC matrix document (web `useRbacMatrix`). Cold until first collected; then emits the
     * cached value (if any) followed by the network refresh, and re-fetches whenever [refresh] is
     * called (directly or after a successful [upsertCells]) while it is being observed.
     */
    public val matrix: StateFlow<Resource<RbacMatrixResponse>> =
        trigger
            .flatMapLatest { repo.matrix() }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = INITIAL,
            )

    /**
     * `true` only once the read resolves to open mode — the web `isRbacOpenMode`. Derived from
     * [matrix]'s current best-known value, so it is `false` while loading/errored.
     */
    public val isOpenMode: StateFlow<Boolean> =
        matrix
            .map { RbacMatrixDerivations.isOpenMode(it.cached) }
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = false,
            )

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Persists the changed `(role, permission, allowed)` [cells] (web `useUpsertRbacCells`). On
     * success it refreshes the matrix feed ([refresh]) because the web invalidates
     * `rbacMatrixKeys.matrix()`; a failed save is propagated and refreshes nothing. An empty batch is
     * a backend no-op that still succeeds and refreshes, exactly as the web mutation runs `onSuccess`
     * regardless of batch size.
     */
    public suspend fun upsertCells(cells: List<RbacUpsertCell>): Result<Unit> = repo.upsertCells(cells).onSuccess { refresh() }

    /** Re-fetches the matrix if it is being observed; a no-op when nobody is subscribed. */
    public fun refresh() {
        trigger.update { it + 1 }
    }

    /**
     * Computes the minimal upsert batch from a baseline [base] matrix to an edited [draft] — the web
     * `diffMatrices`. Pure: no network, no state. Pass the result to [upsertCells].
     */
    public fun diffMatrices(
        base: Map<String, Map<String, Boolean>>,
        draft: Map<String, Map<String, Boolean>>,
    ): List<RbacUpsertCell> = RbacMatrixDerivations.diffMatrices(base, draft)

    private companion object {
        // Keep the matrix's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<RbacMatrixResponse> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
