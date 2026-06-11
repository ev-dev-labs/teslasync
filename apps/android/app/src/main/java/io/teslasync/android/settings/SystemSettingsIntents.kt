package io.teslasync.android.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings

/**
 * Platform settings/store intents the settings screen launches (P3/A8). Each is a plain [Intent] the
 * caller starts via the Activity; the per-app-language intent is delegated to [PerAppLanguage] (33+
 * only). The Play listing uses the https URL so it resolves whether or not the Play app is installed —
 * doubling as the "check for updates / release notes" hook.
 */
object SystemSettingsIntents {
    /** The system notification settings for this app (the OS channel list). */
    fun appNotificationSettings(context: Context): Intent =
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)

    /** The app's Play Store listing (update + release notes + review). */
    fun playStoreListing(context: Context): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=${context.packageName}"))

    /** The platform per-app-language settings (API 33+), or null when the platform doesn't support it. */
    fun appLanguageSettings(context: Context): Intent? = PerAppLanguage.systemSettingsIntent(context)
}
