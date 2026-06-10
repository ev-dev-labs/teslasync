package io.teslasync.shared.core.presentation.dashboardlayouts

import io.teslasync.shared.core.data.repo.DashboardLayoutRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.dashboardLayoutCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the named dashboard-layout library — the cross-platform port of
 * the web `useDashboardLayouts` hook domain (web/src/api/hooks/useDashboardLayouts.ts). Every native
 * LayoutSwitcher screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, query keys, or the invalidate-all rule.
 *
 * The read ([namedLayouts]) is exposed as a hot [StateFlow] of a cache-then-network [Resource]
 * (ADR-013): the cached rows first for an instant cold start, then the refreshed rows. Each
 * `(vehicle | global)` scope is a distinct, lazily-created shared feed (mirroring the web's distinct
 * TanStack query keys), so every observer of the same scope folds into one upstream collection. The
 * web hook applies no `select`/derivation, so neither does this holder; values stay verbatim
 * (`layout` is an opaque blob, not unit-bearing), conversion would be display-only (S5).
 *
 * Mutations are non-throwing suspend [Result]s; on success each refreshes EVERY observed feed via
 * [refreshAll], because the web hooks invalidate `dashboardLayoutLibraryKeys.all` (a write can
 * affect any scope — toggling a default re-scopes which row is default across the whole library).
 * The repository (S7) clears the whole cache partition on the same success, so each refresh
 * re-fetches rather than replaying a stale entry. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class DashboardLayoutsStore(
    private val repo: DashboardLayoutRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<List<NamedDashboardLayout>>>>()

    // ---- Read ---------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /dashboard/layouts` feed for [vehicleId] (web
     * `useNamedDashboardLayouts`). A non-null id lists the vehicle-pinned rows PLUS user-global
     * rows; null lists the user-global library. The same `vehicleId` always returns the same feed.
     */
    public fun namedLayouts(vehicleId: Long? = null): StateFlow<Resource<List<NamedDashboardLayout>>> {
        val key = dashboardLayoutCacheKey(vehicleId)
        return feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.namedLayouts(vehicleId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /** Saves a new layout, then refreshes every observed feed (web `useCreateDashboardLayout`). */
    public suspend fun createLayout(input: CreateDashboardLayoutInput): Result<NamedDashboardLayout> =
        repo.createLayout(input).onSuccess { refreshAll() }

    /** Updates a layout, then refreshes every observed feed (web `useUpdateDashboardLayout`). */
    public suspend fun updateLayout(input: UpdateDashboardLayoutInput): Result<NamedDashboardLayout> =
        repo.updateLayout(input).onSuccess { refreshAll() }

    /** Deletes a layout, then refreshes every observed feed (web `useDeleteDashboardLayout`). */
    public suspend fun deleteLayout(id: Long): Result<Unit> = repo.deleteLayout(id).onSuccess { refreshAll() }

    /** Applies (defaults) a layout, then refreshes every observed feed (web `useApplyDashboardLayout`). */
    public suspend fun applyLayout(id: Long): Result<NamedDashboardLayout> = repo.applyLayout(id).onSuccess { refreshAll() }

    /**
     * Re-fetches every observed feed — the holder-side analogue of invalidating
     * `dashboardLayoutLibraryKeys.all`. Bumping a feed's trigger restarts its cache-then-network
     * collection. A feed nobody is observing is a no-op.
     */
    public fun refreshAll() {
        triggers.values.forEach { it.update { n -> n + 1 } }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<List<NamedDashboardLayout>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
