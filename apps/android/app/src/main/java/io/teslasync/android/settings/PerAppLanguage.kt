package io.teslasync.android.settings

import android.app.LocaleManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.LocaleList
import android.provider.Settings
import java.util.Locale

/**
 * Applies the per-app language to the running app (P3/A8, ADR-014). On Android 13+ (API 33) this uses
 * the platform [LocaleManager]: the system persists the choice, recreates the foreground activity, and
 * surfaces the language in system settings (the manifest declares `android:localeConfig`). Below 33 —
 * where the platform has no per-app language — the app instead persists the tag (via [AppSettings]) and
 * wraps the base-context [Configuration] in `attachBaseContext` ([wrap]), recreating the activity on
 * change. Only the locales the bundled string catalog ships ([AppLanguage]) are ever applied.
 */
object PerAppLanguage {
    /** True when the platform manages per-app language itself (API 33+). */
    val isPlatformManaged: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    /**
     * Applies [tag] (null/blank = follow the system). On API 33+ this drives the platform LocaleManager
     * (which recreates the activity); below 33 it is a no-op here — the caller persists the tag and
     * recreates the activity so [wrap] re-reads it in `attachBaseContext`.
     */
    fun apply(
        context: Context,
        tag: String?,
    ) {
        if (!isPlatformManaged) return
        val normalized = AppLanguage.normalize(tag)
        val locales =
            if (normalized == null) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(normalized)
        context.getSystemService(LocaleManager::class.java)?.applicationLocales = locales
    }

    /** The platform's per-app-language settings screen intent (API 33+), or null when unsupported. */
    fun systemSettingsIntent(context: Context): Intent? {
        if (!isPlatformManaged) return null
        return Intent(
            Settings.ACTION_APP_LOCALE_SETTINGS,
            Uri.fromParts("package", context.packageName, null),
        )
    }

    /**
     * Wraps [context] so resources resolve in [tag]'s locale (used from `attachBaseContext` on API <33).
     * Returns [context] unchanged for "follow system" or an unsupported tag.
     */
    fun wrap(
        context: Context,
        tag: String?,
    ): Context {
        val normalized = AppLanguage.normalize(tag) ?: return context
        val locale = Locale.forLanguageTag(normalized)
        Locale.setDefault(locale)
        val config = Configuration(context.resources.configuration)
        val localeList = LocaleList(locale)
        LocaleList.setDefault(localeList)
        config.setLocale(locale)
        config.setLocales(localeList)
        return context.createConfigurationContext(config)
    }
}
