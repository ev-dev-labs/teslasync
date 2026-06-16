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
import io.teslasync.android.maps.temperatureimpact.TemperatureImpactPageHost
import io.teslasync.android.notifications.archived.ArchivedPageHost
import io.teslasync.android.notifications.channels.ChannelsPageHost
import io.teslasync.android.notifications.webhooks.WebhooksPageHost
import io.teslasync.android.poweruser.sqlplayground.SqlPlaygroundPageHost
import io.teslasync.android.settings.SettingsPageHost
import io.teslasync.android.settings.privacy.PrivacyPageHost
import io.teslasync.android.sharing.shareddrive.SharedDrivePageHost
import io.teslasync.android.shortcuts.ShortcutPublisher
import io.teslasync.android.system.commands.CommandsPageHost
import io.teslasync.android.system.diagnostic.DiagnosticPageHost
import io.teslasync.android.system.search.SearchPageHost
import io.teslasync.android.system.teslaaccount.TeslaAccountPageHost
import io.teslasync.android.telemetry.signalgapdetector.SignalGapDetectorPageHost
import io.teslasync.android.telemetry.signallogviewer.SignalLogViewerPageHost
import io.teslasync.android.admin.dlq.DLQInspectorPageHost
import io.teslasync.android.admin.gdpr.GDPRExportPageHost
import io.teslasync.android.admin.fleettelemetry.FleetTelemetryCoveragePageHost
import io.teslasync.android.admin.fleetapi.FleetAPIPageHost
import io.teslasync.android.admin.livesignals.LiveSignalInspectorPageHost
import io.teslasync.android.admin.livelogs.LiveLogsPageHost
import io.teslasync.android.admin.rbac.RbacMatrixPageHost
import io.teslasync.android.admin.redissignals.RedisSignalViewerPageHost
import io.teslasync.android.admin.secretrotation.SecretRotationPageHost
import io.teslasync.android.admin.securityaccess.SecurityAccessPageHost
import io.teslasync.android.admin.teslafeatures.TeslaFeatureFlagsPageHost

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
        // Register the native temperature-impact map screen for the /temperature-impact route (P3/A7). Idempotent.
        TemperatureImpactPageHost.register()
        // Register the native archived-notifications screen for the /notifications/archived route (P3/A7). Idempotent.
        ArchivedPageHost.register()
        // Register the native notification-channels screen for the /notifications/channels route (P3/A7). Idempotent.
        ChannelsPageHost.register()
        // Register the native custom-webhooks screen for the /notifications/webhooks route (P3/A7). Idempotent.
        WebhooksPageHost.register()
        // Register the native account-privacy settings screen for the /account/privacy route (P3/A7). Idempotent.
        PrivacyPageHost.register()
        // Register the native SQL-playground power-user screen for the /power/sql route (P3/A7). Idempotent.
        SqlPlaygroundPageHost.register()
        // Register the native public shared-drive report screen for the /s/{token} route (P3/A7). Idempotent.
        SharedDrivePageHost.register()
        // Register the native vehicle-commands control-center screen for the /commands route (P3/A7). Idempotent.
        CommandsPageHost.register()
        // Register the native system diagnostic self-test screen for the unrouted DiagnosticPage route (P3/A7).
        DiagnosticPageHost.register()
        // Register the native app-wide unified-search screen for the /search route (P3/A7). Idempotent.
        SearchPageHost.register()
        // Register the native Tesla-account profile screen for the /tesla-account route (P3/A7). Idempotent.
        TeslaAccountPageHost.register()
        // Register the native signal-gap-detector telemetry screen for the /signal-gaps route (P3/A7). Idempotent.
        SignalGapDetectorPageHost.register()
        // Register the native signal-log-viewer telemetry screen for the /signal-log route (P3/A7). Idempotent.
        SignalLogViewerPageHost.register()
        DLQInspectorPageHost.register()
        GDPRExportPageHost.register()
        FleetTelemetryCoveragePageHost.register()
        FleetAPIPageHost.register()
        LiveSignalInspectorPageHost.register()
        LiveLogsPageHost.register()
        RbacMatrixPageHost.register()
        RedisSignalViewerPageHost.register()
        SecretRotationPageHost.register()
        SecurityAccessPageHost.register()
        TeslaFeatureFlagsPageHost.register()
        ShortcutPublisher(this).publish()
    }
}