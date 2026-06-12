// The data port the NotificationChannelsView feature view binds to (P1/S8 state-holder seam) — the native
// analogue of the web component's notifications hook composition
// (web/src/api/hooks/useNotifications.ts → web/src/features/notifications/components/NotificationChannelsView.tsx).
// The view never performs HTTP itself; a shared adapter (the S8 NotificationsStore or the S7 repository) or a
// test fake drives this. Cache-then-network freshness is preserved end to end (ADR-013): every read emission's
// cached/stale/error flags flow through unchanged so the view-model can render the full state matrix.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationChannelsView) cannot form a valid Kotlin package and the file hosts
// the seam plus its bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.notificationchannelsview

import io.teslasync.shared.core.data.repo.NotificationsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.ChannelTestResult
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [NotificationChannelsViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store or the network. The reads ([channels], [stats]) are the
 * cache-then-network feeds the web `useNotificationChannels` / `useNotificationStats` hooks serve; the four
 * mutations mirror the web `useSaveChannel` / `useDeleteChannel` / `useToggleChannel` / `useTestChannel`
 * non-throwing results. No HTTP touches the view.
 */
interface NotificationChannelsViewSource {
    /** Stream the cache-then-network channel list (web `useNotificationChannels`, `GET /notifications`). */
    fun channels(): Flow<Resource<List<NotificationChannel>>>

    /** Stream the cache-then-network delivery stats (web `useNotificationStats`, `GET /notifications/stats`). */
    fun stats(): Flow<Resource<NotificationStats>>

    /** Create or update a channel (web `useSaveChannel`); invalidates the channel list on success. */
    suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel>

    /** Delete a channel (web `useDeleteChannel`); invalidates the channel list + stats on success. */
    suspend fun deleteChannel(id: Long): Result<Unit>

    /** Toggle a channel's enabled state (web `useToggleChannel`); invalidates the channel list + stats. */
    suspend fun toggleChannel(id: Long): Result<NotificationChannel>

    /** Fire a channel test (web `useTestChannel`); invalidates nothing — the result is rendered inline. */
    suspend fun testChannel(id: Long): Result<ChannelTestResult>
}

/**
 * Binds the surface to the shared **S8** [NotificationsStore] — the memoized, multi-observer notifications feed
 * every Notifications surface shares app-wide (web `useNotifications`). Mutations route through the store so it
 * invalidates exactly the feeds the matching web hook does (channel list, and stats for delete/toggle); the
 * view-model additionally restarts its own collection after a successful mutation so a host using either binding
 * refreshes uniformly. No HTTP touches the view — the store (S7/S8) owns it.
 */
fun notificationChannelsViewSource(store: NotificationsStore): NotificationChannelsViewSource =
    object : NotificationChannelsViewSource {
        override fun channels(): Flow<Resource<List<NotificationChannel>>> = store.notificationChannels()

        override fun stats(): Flow<Resource<NotificationStats>> = store.notificationStats()

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> = store.saveChannel(input)

        override suspend fun deleteChannel(id: Long): Result<Unit> = store.deleteChannel(id)

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> = store.toggleChannel(id)

        override suspend fun testChannel(id: Long): Result<ChannelTestResult> = store.testChannel(id)
    }

/**
 * Binds the surface directly to the shared **S7** [NotificationsRepository]. Each [channels]/[stats] call starts
 * a NEW cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the web
 * `refetch()` behaviour) — the binding to use when a host does not share a single app-wide store. The
 * view-model restarts its read collection after a successful mutation to reflect the write.
 */
fun notificationChannelsViewSource(repository: NotificationsRepository): NotificationChannelsViewSource =
    object : NotificationChannelsViewSource {
        override fun channels(): Flow<Resource<List<NotificationChannel>>> = repository.notificationChannels()

        override fun stats(): Flow<Resource<NotificationStats>> = repository.notificationStats()

        override suspend fun saveChannel(input: NotificationChannelInput): Result<NotificationChannel> = repository.saveChannel(input)

        override suspend fun deleteChannel(id: Long): Result<Unit> = repository.deleteChannel(id)

        override suspend fun toggleChannel(id: Long): Result<NotificationChannel> = repository.toggleChannel(id)

        override suspend fun testChannel(id: Long): Result<ChannelTestResult> = repository.testChannel(id)
    }
