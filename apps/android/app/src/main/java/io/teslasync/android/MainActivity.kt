package io.teslasync.android

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import io.teslasync.android.notifications.NotificationIntent
import io.teslasync.android.settings.PerAppLanguage
import io.teslasync.android.settings.SharedPreferencesAppSettingsStore
import io.teslasync.android.ui.App

class MainActivity : ComponentActivity() {
    /**
     * Applies the persisted per-app language (P3/A8, ADR-014) below Android 13, where the platform has
     * no per-app language: the base-context resource configuration is wrapped with the stored locale so
     * every screen renders in it. On API 33+ the platform [android.app.LocaleManager] owns the locale,
     * so the base context already carries it and no wrapping is needed.
     */
    override fun attachBaseContext(newBase: Context) {
        val base =
            if (PerAppLanguage.isPlatformManaged) {
                newBase
            } else {
                PerAppLanguage.wrap(newBase, SharedPreferencesAppSettingsStore.readLanguageTag(newBase))
            }
        super.attachBaseContext(base)
    }

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // A cold start launched from a notification carries the deep link in the launch intent.
        routeNotificationDeepLink(intent)
        setContent {
            App(
                windowSizeClass = calculateWindowSizeClass(this),
                container = (application as TeslaSyncApplication).container,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // A notification tap while the Activity is already running (singleTop) arrives here.
        setIntent(intent)
        routeNotificationDeepLink(intent)
    }

    /**
     * Forwards a notification-tap deep link into the navigation graph via the push container's
     * [io.teslasync.android.notifications.DeepLinkRouter]. The URI is validated against the app's own
     * scheme so a forged intent extra can never drive navigation to an arbitrary target.
     */
    private fun routeNotificationDeepLink(intent: Intent) {
        val uri = NotificationIntent.sanitize(intent.getStringExtra(NotificationIntent.EXTRA_DEEP_LINK)) ?: return
        (application as TeslaSyncApplication)
            .container.push.deepLinkRouter
            .request(uri)
    }
}
