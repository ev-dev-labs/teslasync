// Page-host wiring for the BrowserNotificationsPage notifications surface (A7) — the seam that attaches real
// screen content to the `notificationsBrowser` ⁄ `/notifications/browser` navigation destination
// (Destinations.kt). It mirrors the [io.teslasync.android.admin.gasprice.GasPriceAutoPollPageHost] precedent:
// [register] is called once at process start by [io.teslasync.android.TeslaSyncApplication]; until then the
// route falls through to the shared not-found screen. [BrowserNotificationsRoute] reads the app DI graph from
// [LocalDataContainer], builds the shared NotificationSettings feature-view source over the shared resilient
// client + offline cache the container exposes (a page-local [HttpSettingsRepository], exactly as the
// GlanceRoute precedent builds a page-local store) plus the device-local SharedPreferences preference stores
// and the platform tone player, and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.notifications.browser

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.notificationsettings.SharedPreferencesNotificationSoundPrefsStore
import io.teslasync.android.featureviews.notificationsettings.SharedPreferencesWebPushPrefsStore
import io.teslasync.android.featureviews.notificationsettings.ToneGeneratorNotificationSoundPlayer
import io.teslasync.android.featureviews.notificationsettings.notificationSettingsSource
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpSettingsRepository

/**
 * The stateful route entry registered for the `notificationsBrowser` destination. Resolves the app data graph
 * from the CompositionLocal, builds the bundled NotificationSettings source — the cache-then-network `/settings`
 * document over a page-local [HttpSettingsRepository] (the shared resilient client + offline cache the container
 * exposes), the two device-local SharedPreferences preference stores, and the platform [ToneGenerator] cue
 * player — and binds the page to the app's redacting logger.
 */
@Composable
fun BrowserNotificationsRoute() {
    val container = LocalDataContainer.current
    val context = LocalContext.current
    val source =
        remember(container, context) {
            notificationSettingsSource(
                settingsRepository = HttpSettingsRepository(container.api, container.cacheStore),
                webPushPrefsStore = SharedPreferencesWebPushPrefsStore(context),
                soundPrefsStore = SharedPreferencesNotificationSoundPrefsStore(context),
                player = ToneGeneratorNotificationSoundPlayer(),
            )
        }
    BrowserNotificationsPage(source = source, logger = container.logger)
}

/**
 * Registers the [BrowserNotificationsRoute] host for the `notificationsBrowser` route. Called once at process
 * start; idempotent so a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object BrowserNotificationsPageHost {
    private val id: String = BrowserNotificationsPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { BrowserNotificationsRoute() }
    }
}
