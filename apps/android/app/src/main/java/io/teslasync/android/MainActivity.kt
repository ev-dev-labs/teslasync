package io.teslasync.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import io.teslasync.android.notifications.NotificationIntent
import io.teslasync.android.ui.App

class MainActivity : ComponentActivity() {
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
