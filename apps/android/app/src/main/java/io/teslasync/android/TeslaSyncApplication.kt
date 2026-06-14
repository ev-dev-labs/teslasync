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
import io.teslasync.android.auth.AuthContainer
import io.teslasync.android.data.live.AppLifecycleSseBinder
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
        ShortcutPublisher(this).publish()
    }
}
