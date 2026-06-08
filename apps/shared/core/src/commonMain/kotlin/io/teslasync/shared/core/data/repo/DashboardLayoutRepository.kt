package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.dashboardlayouts.CreateDashboardLayoutInput
import io.teslasync.shared.core.presentation.dashboardlayouts.NamedDashboardLayout
import io.teslasync.shared.core.presentation.dashboardlayouts.UpdateDashboardLayoutInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the named dashboard-layout library — the cross-platform analogue of the web
 * `useDashboardLayouts` hook domain (web/src/api/hooks/useDashboardLayouts.ts). Every native
 * LayoutSwitcher surface (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * The single read ([namedLayouts]) streams a cache-then-network [Resource] (ADR-013): the cached
 * rows first for an instant cold start, then the refreshed rows. The four mutations are
 * non-throwing suspend [Result]s; on success each invalidates the WHOLE layout cache partition —
 * the data-layer analogue of the web hooks invalidating `dashboardLayoutLibraryKeys.all`
 * (`['dashboard-layouts-library']`), which drops every per-scope query at once because a write can
 * affect any list (toggling a default re-scopes which row is default across the whole library).
 *
 * The `layout` payload is an opaque SavedDashboard JSON blob round-tripped verbatim — not
 * display-unit-bearing — so there is no SI conversion at this layer; display formatting is the
 * render boundary's job (S5).
 */
public interface DashboardLayoutRepository {
    /**
     * `GET /dashboard/layouts` (optionally `?vehicle_id=`) — the saved-layout library for
     * [vehicleId] (web `useNamedDashboardLayouts`). When an id is given the backend returns the
     * vehicle-pinned rows PLUS the user-global (`vehicle_id IS NULL`) rows so the switcher shows
     * both in one list. The query is built by [dashboardLayoutListQuery] (the web `?vehicle_id=`
     * guard) and the cache key by [dashboardLayoutCacheKey] (the web `dashboardLayoutLibraryKeys.list`
     * tuple).
     */
    public fun namedLayouts(vehicleId: Long? = null): Flow<Resource<List<NamedDashboardLayout>>>

    /**
     * `POST /dashboard/layouts` — saves a new named layout (web `useCreateDashboardLayout`). On
     * success the whole layout partition is evicted so the next list read re-fetches.
     */
    public suspend fun createLayout(input: CreateDashboardLayoutInput): Result<NamedDashboardLayout>

    /**
     * `PUT /dashboard/layouts/{id}` — updates a layout (web `useUpdateDashboardLayout`). On success
     * the whole layout partition is evicted.
     */
    public suspend fun updateLayout(input: UpdateDashboardLayoutInput): Result<NamedDashboardLayout>

    /**
     * `DELETE /dashboard/layouts/{id}` — removes a layout (web `useDeleteDashboardLayout`). On
     * success the whole layout partition is evicted.
     */
    public suspend fun deleteLayout(id: Long): Result<Unit>

    /**
     * `POST /dashboard/layouts/{id}/apply` — marks a layout the default for its (user, vehicle)
     * scope (web `useApplyDashboardLayout`). On success the whole layout partition is evicted so
     * the new default is reflected across every scoped list.
     */
    public suspend fun applyLayout(id: Long): Result<NamedDashboardLayout>
}

/**
 * Builds the `/dashboard/layouts` query map with the web hook's semantics
 * (web/src/api/hooks/useDashboardLayouts.ts): `vehicle_id` is sent whenever an id is present
 * (mirroring `vehicleId != null ? '?vehicle_id=' + vehicleId : ''`); a null scope sends no params
 * (the user-global + everything list). The key is snake_case, matching the Go handler. Locked by
 * the repository contract test shared with the C# port.
 */
public fun dashboardLayoutListQuery(vehicleId: Long?): Map<String, String> {
    val query = linkedMapOf<String, String>()
    vehicleId?.let { query["vehicle_id"] = it.toString() }
    return query
}

/**
 * Builds the stable cache/feed key for [vehicleId], mirroring the web `dashboardLayoutLibraryKeys.list`
 * tuple `['dashboard-layouts-library', vehicleId ?? 'global']`: a present id is its decimal string,
 * a null id is the literal `global`, so two scopes collide in the cache exactly when their web query
 * keys do. Locked by the repository contract test shared with the C# port.
 */
public fun dashboardLayoutCacheKey(vehicleId: Long?): String = vehicleId?.toString() ?: "global"
