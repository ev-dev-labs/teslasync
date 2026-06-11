package io.teslasync.android.settings

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.auth.LocalAuthController
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.notifications.LocalNotificationPreferences
import kotlinx.coroutines.launch

/**
 * The settings page host (P3/A8): the stateful entry registered for the `settings` route. It reads the
 * app DI graph from CompositionLocals (the [AppSettingsController], the notification preferences, the
 * auth controller, and the [SettingsEnvironment]) and binds the stateless [SettingsScreen] to the
 * platform: applying the per-app language ([PerAppLanguage]), launching the OS notification/language
 * screens and the Play listing, clearing the offline cache, and the secure sign-out. The OS
 * notification-enabled state is re-read on every resume so returning from system settings reflects.
 */
@Composable
fun SettingsRoute() {
    val appSettings = LocalAppSettings.current
    val notifications = LocalNotificationPreferences.current
    val environment = LocalSettingsEnvironment.current
    val authController = LocalAuthController.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    if (appSettings == null || notifications == null) {
        // The app always provides these at the root; render a friendly state rather than crash if not.
        EmptyState(message = stringResource(R.string.settings_unavailable))
        return
    }

    val notificationsEnabled = rememberNotificationsEnabled(context)
    val versionLabel = remember { "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})" }

    SettingsScreen(
        appSettings = appSettings,
        notifications = notifications,
        notificationsEnabled = notificationsEnabled,
        languageSettingsSupported = PerAppLanguage.isPlatformManaged,
        versionLabel = versionLabel,
        onSelectLanguage = { tag ->
            appSettings.setLanguage(tag)
            if (PerAppLanguage.isPlatformManaged) {
                PerAppLanguage.apply(context, tag)
            } else {
                // Below API 33: persist synchronously, then recreate so attachBaseContext re-wraps.
                SharedPreferencesAppSettingsStore.writeLanguageTag(context, tag)
                context.findActivity()?.recreate()
            }
        },
        onOpenNotificationSystemSettings = {
            context.startActivitySafely(SystemSettingsIntents.appNotificationSettings(context))
        },
        onOpenLanguageSystemSettings = {
            SystemSettingsIntents.appLanguageSettings(context)?.let(context::startActivitySafely)
        },
        onOpenPlayStore = { context.startActivitySafely(SystemSettingsIntents.playStoreListing(context)) },
        onClearCache = { scope.launch { environment?.clearOfflineCache?.invoke() } },
        onSignOut = authController::signOut,
    )
}

/** Tracks `areNotificationsEnabled()` and refreshes it on every ON_RESUME (e.g. back from settings). */
@Composable
private fun rememberNotificationsEnabled(context: Context): Boolean {
    val lifecycleOwner = LocalLifecycleOwner.current
    var enabled by remember { mutableStateOf(NotificationManagerCompat.from(context).areNotificationsEnabled()) }
    DisposableEffect(lifecycleOwner) {
        val observer =
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
                }
            }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    return enabled
}

/** Walks the [ContextWrapper] chain to the host [Activity] (for recreate on a locale change < API 33). */
private fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}

/** Launches [intent], swallowing the rare no-handler case so the settings screen never crashes. */
private fun Context.startActivitySafely(intent: Intent) {
    runCatching { startActivity(intent) }
}
