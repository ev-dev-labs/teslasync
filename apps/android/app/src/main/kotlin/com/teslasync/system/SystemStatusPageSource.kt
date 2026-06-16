// The data seam the SystemStatusPage surface binds to (P1/S8), plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this
// seam, reproducing the web page's seven reads (web/src/features/system/pages/SystemStatusPage.tsx):
// `useSystemHealth`, `useMaintenanceState`, `useBackupRuns`, `useBackupConfigs` (the shared Admin holder),
// `useAuthStatus` (the Settings holder), `useNotificationStats` (the Notifications holder), and `useVehicles`
// (the Vehicles holder).
//
// Each member is a cache-then-network [Resource] flow the shared holder already memoizes + shares app-wide; the
// live values flow through unchanged so the view-model renders the full state matrix (loading / content / empty /
// error / stale / offline). A narrow seam so the view-model depends on an abstraction (the real holders in
// production, a fake in tests), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located production-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.systemstatus

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import io.teslasync.shared.core.presentation.settings.AuthStatus
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [SystemStatusPageViewModel] depends on so it binds to an abstraction (the shared holders in
 * production, a fake in tests), never to a concrete store or the network. Every member is a cache-then-network
 * `Resource` flow (one of the web read hooks). No HTTP touches the view.
 */
interface SystemStatusSource {
    /** The raw-JSON `GET /system/health` feed (web `useSystemHealth`) — the page's phase spine. */
    fun systemHealth(): Flow<Resource<JsonElement>>

    /** The raw-JSON `GET /admin/maintenance` feed (web `useMaintenanceState`). */
    fun maintenanceState(): Flow<Resource<JsonElement>>

    /** The raw-JSON `GET /backup/runs` feed (web `useBackupRuns`). */
    fun backupRuns(): Flow<Resource<JsonElement>>

    /** The raw-JSON `GET /backup/configs` feed (web `useBackupConfigs`). */
    fun backupConfigs(): Flow<Resource<JsonElement>>

    /** The typed `GET /auth/status` feed (web `useAuthStatus`). */
    fun authStatus(): Flow<Resource<AuthStatus>>

    /** The typed `GET /notifications/stats` feed (web `useNotificationStats`). */
    fun notificationStats(): Flow<Resource<NotificationStats>>

    /** The typed `GET /vehicles` list feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer feeds every surface shares app-wide
 * (incl. their standard-cadence background refresh). The four Admin reads come from the one [adminStore]; auth,
 * notification stats, and the vehicle list from [settingsStore], [notificationsStore], and [vehiclesStore]
 * respectively. The live values flow through unchanged so the view-model renders the full state matrix. No HTTP
 * touches the view.
 */
fun systemStatusSourceOf(
    adminStore: AdminStore,
    settingsStore: SettingsStore,
    notificationsStore: NotificationsStore,
    vehiclesStore: VehiclesStore,
): SystemStatusSource =
    object : SystemStatusSource {
        override fun systemHealth(): Flow<Resource<JsonElement>> = adminStore.systemHealth()

        override fun maintenanceState(): Flow<Resource<JsonElement>> = adminStore.maintenanceState()

        override fun backupRuns(): Flow<Resource<JsonElement>> = adminStore.backupRuns()

        override fun backupConfigs(): Flow<Resource<JsonElement>> = adminStore.backupConfigs()

        override fun authStatus(): Flow<Resource<AuthStatus>> = settingsStore.authStatus()

        override fun notificationStats(): Flow<Resource<NotificationStats>> = notificationsStore.notificationStats()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()
    }
