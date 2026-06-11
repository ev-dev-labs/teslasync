package io.teslasync.android.widgets

import android.content.Context
import android.icu.util.Calendar
import io.teslasync.android.R
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.notifications.SharedPreferencesNotificationSettingsStore
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.HttpChargingRepository
import io.teslasync.shared.core.data.repo.HttpDashboardRepository
import io.teslasync.shared.core.data.repo.HttpNotificationsRepository
import io.teslasync.shared.core.data.repo.HttpVehiclesRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import kotlinx.coroutines.flow.StateFlow

private const val MINUTES_PER_HOUR = 60

/**
 * Manual DI graph for the home-screen widgets (P3/A8), the analogue of the [io.teslasync.android.data.DataContainer].
 * Built once per process by the auth graph and reached from the widget receivers / refresh worker via
 * the [io.teslasync.android.TeslaSyncApplication].
 *
 * It assembles the shared cache-then-network repositories over the SAME single resilient
 * [ApiHttpClient] (so the widget refresh carries the bearer + 401 refresh) and the SAME offline
 * [CacheStore] the app writes (so widgets show exactly what the app last cached). It adds NO networking
 * or business logic of its own — only the [reader] (cache/freshness adapter) and the [refresher]
 * (WorkManager-driven cache-then-network), plus the live unit formatter and selected-vehicle seams.
 *
 * @param api the shared resilient client (auth token provider already installed).
 * @param cacheStore the shared offline cache store (cleared on sign-out by the auth graph).
 * @param selectedVehicleStore the app-scoped active-vehicle selection.
 * @param unitFormatter the live SI→display formatter derived from the user's settings.
 * @param logger the single sanctioned redacting logger (ADR-016).
 */
class WidgetContainer(
    context: Context,
    api: ApiHttpClient,
    cacheStore: CacheStore,
    selectedVehicleStore: SelectedVehicleStore,
    unitFormatter: StateFlow<UnitFormatter>,
    val logger: Logger,
) {
    /** Wall-clock seam for widget freshness math (matches the app's cache clock). */
    val clock: Clock = SystemClock

    private val appContext = context.applicationContext

    private val repositories =
        WidgetRepositories(
            vehicles = HttpVehiclesRepository(api, cacheStore, clock),
            charging = HttpChargingRepository(api, cacheStore, clock),
            dashboard = HttpDashboardRepository(api, cacheStore, clock),
            notifications = HttpNotificationsRepository(api, cacheStore, clock),
        )

    private val environment =
        WidgetEnvironment(
            clock = clock,
            fallbackVehicleName = { appContext.getString(R.string.widget_vehicle_default_name) },
            nowMinuteOfDay = ::currentMinuteOfDay,
        )

    /** The cache/freshness adapter the widget `provideGlance` reads its snapshots from. */
    val reader: WidgetDataReader =
        WidgetDataReader(
            repositories = repositories,
            selectedVehicleStore = selectedVehicleStore,
            unitFormatter = unitFormatter,
            notificationSettingsStore = SharedPreferencesNotificationSettingsStore(appContext),
            environment = environment,
        )

    /** The cache-then-network refresher the WorkManager worker drives. */
    val refresher: WidgetRefresher = WidgetRefresher(repositories, selectedVehicleStore, logger)
}

/** The current local time as minutes-of-day (0..1439), for evaluating the quiet-hours window. */
private fun currentMinuteOfDay(): Int {
    val now = Calendar.getInstance()
    return now.get(Calendar.HOUR_OF_DAY) * MINUTES_PER_HOUR + now.get(Calendar.MINUTE)
}
