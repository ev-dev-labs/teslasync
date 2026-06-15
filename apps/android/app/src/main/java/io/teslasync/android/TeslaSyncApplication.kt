package io.teslasync.android

import android.app.Application
import androidx.lifecycle.ProcessLifecycleOwner
import io.teslasync.android.admin.apilogs.ApiLogsPageHost
import io.teslasync.android.admin.feedback.FeedbackQueuePageHost
import io.teslasync.android.admin.gasprice.GasPriceAutoPollPageHost
import io.teslasync.android.admin.ingestxray.IngestXRayPageHost
import io.teslasync.android.admin.region.TeslaRegionPageHost
import io.teslasync.android.admin.schemadrift.SchemaDriftPageHost
import io.teslasync.android.admin.slowqueries.SlowQueriesPageHost
import io.teslasync.android.analytics.lifetimestats.LifetimeStatsPageHost
import io.teslasync.android.analytics.statistics.StatisticsPageHost
import io.teslasync.android.analytics.yearreview.YearReviewPageHost
import io.teslasync.android.auth.AuthContainer
import io.teslasync.android.battery.batteryhealth.BatteryHealthPageHost
import io.teslasync.android.battery.energyproducts.EnergyProductsPageHost
import io.teslasync.android.charging.chargingcurve.ChargingCurvePageHost
import io.teslasync.android.charging.powershare.PowersharePageHost
import io.teslasync.android.dashboard.glance.GlancePageHost
import io.teslasync.android.data.live.AppLifecycleSseBinder
import io.teslasync.android.driving.driveslist.DrivesListPageHost
import io.teslasync.android.driving.regenefficiency.RegenEfficiencyPageHost
import io.teslasync.android.driving.tripplanner.TripPlannerPageHost
import io.teslasync.android.maps.geofences.GeofencesPageHost
import io.teslasync.android.settings.SettingsPageHost
import io.teslasync.android.shortcuts.ShortcutPublisher

/**
 * Process [Application] owning the [AuthContainer] (the auth + networking + data dependency graph) and
 * binding the live-data pipe to the app's foreground lifecycle (ADR-009).
 *
 * On process start it attaches an [AppLifecycleSseBinder] to `ProcessLifecycleOwner`, so the shared SSE
 * stream is held only while the app is foreground and resumes when it returns — independent of any single
 * Activity. Realizing the container here (rather than fully lazily) is intentional: the foreground binding
 * must exist before the first `ON_START`, and a foreground app needs the graph immediately anyway.
 */
class TeslaSyncApplication : Application() {
    val container: AuthContainer by lazy { AuthContainer(this) }

    private var liveBinder: AppLifecycleSseBinder? = null

    override fun onCreate() {
        super.onCreate()
        liveBinder =
            AppLifecycleSseBinder(
                store = container.data.liveSessionStore,
                lifecycle = ProcessLifecycleOwner.get().lifecycle,
            ).also { it.bind() }

        // Create the OS notification channels and bind FCM device registration to the auth state
        // machine (ADR-009): a sign-in registers this device, a sign-out unregisters it. Done here
        // (not lazily) so registration follows auth even when the process is started by an FCM
        // delivery rather than by the user opening the app.
        container.push.start()

        // Device-local settings (P3/A8): load the persisted theme/language/diagnostics preferences so
        // the app root applies them on first composition and the diagnostics consent (ADR-016) is honored.
        container.appSettings.start()

        // Register the native settings screen for the /settings route and publish the launcher
        // shortcuts (P3/A8). Both are idempotent; publishing on every start keeps the shortcut set
        // fresh (e.g. after a per-app language change re-localizes the labels).
        SettingsPageHost.register()
        // Register the native API-logs admin screen for the /api-logs route (P3/A7). Idempotent.
        ApiLogsPageHost.register()
        // Register the native feedback-queue admin screen for the /admin/feedback route (P3/A7). Idempotent.
        FeedbackQueuePageHost.register()
        // Register the native gas-price auto-poll admin screen for the /gas-price route (P3/A7). Idempotent.
        GasPriceAutoPollPageHost.register()
        // Register the native ingest-X-Ray admin screen for the /admin/ingest-xray route (P3/A7). Idempotent.
        IngestXRayPageHost.register()
        // Register the native schema-drift admin screen for the /admin/schema-drift route (P3/A7). Idempotent.
        SchemaDriftPageHost.register()
        // Register the native slow-queries admin screen for the /admin/slow-queries route (P3/A7). Idempotent.
        SlowQueriesPageHost.register()
        // Register the native Tesla Region & API admin screen for the /tesla-region route (P3/A7). Idempotent.
        TeslaRegionPageHost.register()
        // Register the native lifetime-stats analytics screen for the /lifetime-stats route (P3/A7). Idempotent.
        LifetimeStatsPageHost.register()
        // Register the native statistics analytics screen for the /statistics route (P3/A7). Idempotent.
        StatisticsPageHost.register()
        // Register the native year-in-review story screen for the /year-review/:year route (P3/A7). Idempotent.
        YearReviewPageHost.register()
        // Register the native battery-health screen for the /battery route (P3/A7). Idempotent.
        BatteryHealthPageHost.register()
        // Register the native energy-products screen for the /energy-products route (P3/A7). Idempotent.
        EnergyProductsPageHost.register()
        // Register the native charging-curve screen for the /charging-curve route (P3/A7). Idempotent.
        ChargingCurvePageHost.register()
        // Register the native Powershare screen for the /powershare route (P3/A7). Idempotent.
        PowersharePageHost.register()
        // Register the native Glance quick-glance screen for the /glance route (P3/A7). Idempotent.
        GlancePageHost.register()
        // Register the native drive-history screen for the /drives route (P3/A7). Idempotent.
        DrivesListPageHost.register()
        // Register the native regen-efficiency screen for the /regen-efficiency route (P3/A7). Idempotent.
        RegenEfficiencyPageHost.register()
        // Register the native trip-planner screen for the /trip-planner route (P3/A7). Idempotent.
        TripPlannerPageHost.register()
        // Register the native geofences map screen for the /geofences route (P3/A7). Idempotent.
        GeofencesPageHost.register()
        ShortcutPublisher(this).publish()
    }
}
