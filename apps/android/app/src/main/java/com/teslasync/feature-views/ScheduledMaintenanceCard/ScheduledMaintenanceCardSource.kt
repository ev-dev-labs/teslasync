// The data port the [ScheduledMaintenanceCardViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web component's maintenance hook composition
// (web/src/api/hooks/useAdmin.ts → web/src/features/system/components/status/ScheduledMaintenanceCard.tsx).
// The view never performs HTTP itself; a shared adapter (the S8 AdminStore) or a test fake drives this.
// Cache-then-network freshness is preserved end to end (ADR-013): the maintenance-state emission's
// cached/stale/error flags flow through unchanged so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/ScheduledMaintenanceCard) cannot form a valid Kotlin package and the
// file hosts the seam plus its store binding, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.scheduledmaintenancecard

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.admin.MaintenanceUpdateInput
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [ScheduledMaintenanceCardViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store or the network. [maintenanceState] is the cache-then-network
 * feed the web `useMaintenanceState` hook serves; [updateMaintenance] mirrors the web `useUpdateMaintenance`
 * non-throwing mutation. No HTTP touches the view.
 */
interface ScheduledMaintenanceSource {
    /** Stream the cache-then-network maintenance state (web `useMaintenanceState`, `GET /admin/maintenance`). */
    fun maintenanceState(): Flow<Resource<JsonElement>>

    /**
     * Write the maintenance override (web `useUpdateMaintenance`, `POST /admin/maintenance`). The shared store
     * refreshes both the maintenance and system-health feeds on success, exactly as the web hook invalidates
     * both query keys; the [Result] is reduced to [Unit] because the surface only needs success/failure, not
     * the echoed document.
     */
    suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [AdminStore] — the memoized, multi-observer maintenance feed every
 * admin surface shares app-wide (web `useMaintenanceState`). The write routes through the store so it
 * refreshes exactly the feeds the matching web hook invalidates (maintenance + system-health); the view-model
 * additionally restarts its own collection after a successful write so a host refreshes uniformly. No HTTP
 * touches the view — the store (S7/S8) owns it.
 */
fun scheduledMaintenanceSource(store: AdminStore): ScheduledMaintenanceSource =
    object : ScheduledMaintenanceSource {
        override fun maintenanceState(): Flow<Resource<JsonElement>> = store.maintenanceState()

        override suspend fun updateMaintenance(input: MaintenanceUpdateInput): Result<Unit> = store.updateMaintenance(input).map { }
    }
