// The data port the QuietHoursPanel feature view binds to (P1/S8 state-holder seam) — the native analogue of
// the web component's quiet-hours hook composition
// (web/src/api/hooks/useNotifications.ts → web/src/features/settings/components/QuietHoursPanel.tsx). The view
// never performs HTTP itself; a shared adapter (the S8 NotificationsStore or the S7 repository) or a test fake
// drives this. Cache-then-network freshness is preserved end to end (ADR-013): every read emission's
// cached/stale/error flags flow through unchanged so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/QuietHoursPanel) cannot form a valid Kotlin package and the file hosts the seam
// plus its bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.quiethourspanel

import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [QuietHoursPanelViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store or the network. [windows] is the cache-then-network feed the web `useQuietHours`
 * hook serves; the two mutations mirror the web `useSaveQuietHours` / `useDeleteQuietHours` non-throwing results.
 * No HTTP touches the view.
 */
interface QuietHoursPanelSource {
    /** Stream the cache-then-network quiet-hours windows (web `useQuietHours`, `GET /notifications/quiet-hours`). */
    fun windows(): Flow<Resource<List<QuietHoursWindow>>>

    /**
     * Create ([id] null) or update ([id] set) a window (web `useSaveQuietHours`); invalidates the list on success.
     */
    suspend fun saveWindow(
        input: QuietHoursWindowInput,
        id: Long?,
    ): Result<QuietHoursWindow>

    /** Delete a window (web `useDeleteQuietHours`); invalidates the list on success. */
    suspend fun deleteWindow(id: Long): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [NotificationsStore] — the memoized, multi-observer notifications feed
 * every Notifications/Settings surface shares app-wide. Mutations route through the store so it invalidates the
 * quiet-hours feed exactly as the matching web hook does; no HTTP touches the view — the store (S7/S8) owns it.
 */
fun quietHoursPanelSource(store: NotificationsStore): QuietHoursPanelSource =
    object : QuietHoursPanelSource {
        override fun windows(): Flow<Resource<List<QuietHoursWindow>>> = store.quietHours()

        override suspend fun saveWindow(
            input: QuietHoursWindowInput,
            id: Long?,
        ): Result<QuietHoursWindow> = store.saveQuietHours(input, id)

        override suspend fun deleteWindow(id: Long): Result<Unit> = store.deleteQuietHours(id)
    }

/**
 * Binds the surface directly to the shared **S7** [NotificationsRepository]. Each [windows] call starts a NEW
 * cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the web `refetch()`
 * behaviour) — the binding to use when a host does not share a single app-wide store.
 */
fun quietHoursPanelSource(repository: NotificationsRepository): QuietHoursPanelSource =
    object : QuietHoursPanelSource {
        override fun windows(): Flow<Resource<List<QuietHoursWindow>>> = repository.quietHours()

        override suspend fun saveWindow(
            input: QuietHoursWindowInput,
            id: Long?,
        ): Result<QuietHoursWindow> = repository.saveQuietHours(input, id)

        override suspend fun deleteWindow(id: Long): Result<Unit> = repository.deleteQuietHours(id)
    }
