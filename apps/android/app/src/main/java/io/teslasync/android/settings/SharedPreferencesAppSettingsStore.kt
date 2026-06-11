package io.teslasync.android.settings

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The production [AppSettingsStore] backed by private `SharedPreferences` (P3/A8). Enum preferences are
 * stored as their stable [AppSettingsTokens] wire strings and the language as its BCP-47 tag (empty =
 * follow system), so the persisted form is locale-independent and survives enum churn. Reads/writes hop
 * to [Dispatchers.IO] since the commit touches disk.
 *
 * The language tag is additionally readable **synchronously** via [readLanguageTag] for the
 * `attachBaseContext` locale wrap (P3/A8 per-app language on API < 33), which runs before any coroutine
 * scope exists.
 */
class SharedPreferencesAppSettingsStore(
    context: Context,
) : AppSettingsStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override suspend fun load(): AppSettings =
        withContext(Dispatchers.IO) {
            if (!prefs.contains(KEY_THEME_MODE) && !prefs.contains(KEY_LANGUAGE)) {
                return@withContext AppSettings.Default
            }
            AppSettings(
                themeMode = AppSettingsTokens.themeModeFromWire(prefs.getString(KEY_THEME_MODE, null)),
                dynamicColor = prefs.getBoolean(KEY_DYNAMIC_COLOR, false),
                highContrast = prefs.getBoolean(KEY_HIGH_CONTRAST, false),
                density = AppSettingsTokens.densityFromWire(prefs.getString(KEY_DENSITY, null)),
                reduceMotion = prefs.getBoolean(KEY_REDUCE_MOTION, false),
                haptics = prefs.getBoolean(KEY_HAPTICS, true),
                languageTag = AppLanguage.fromPersisted(prefs.getString(KEY_LANGUAGE, null)),
                shareDiagnostics = prefs.getBoolean(KEY_DIAGNOSTICS, false),
            )
        }

    override suspend fun save(settings: AppSettings) {
        withContext(Dispatchers.IO) {
            prefs
                .edit()
                .putString(KEY_THEME_MODE, AppSettingsTokens.themeModeToWire(settings.themeMode))
                .putBoolean(KEY_DYNAMIC_COLOR, settings.dynamicColor)
                .putBoolean(KEY_HIGH_CONTRAST, settings.highContrast)
                .putString(KEY_DENSITY, AppSettingsTokens.densityToWire(settings.density))
                .putBoolean(KEY_REDUCE_MOTION, settings.reduceMotion)
                .putBoolean(KEY_HAPTICS, settings.haptics)
                .putString(KEY_LANGUAGE, AppLanguage.toPersisted(settings.languageTag))
                .putBoolean(KEY_DIAGNOSTICS, settings.shareDiagnostics)
                .apply()
        }
    }

    companion object {
        private const val PREFS = "teslasync.app.settings"
        private const val KEY_THEME_MODE = "theme_mode"
        private const val KEY_DYNAMIC_COLOR = "dynamic_color"
        private const val KEY_HIGH_CONTRAST = "high_contrast"
        private const val KEY_DENSITY = "density"
        private const val KEY_REDUCE_MOTION = "reduce_motion"
        private const val KEY_HAPTICS = "haptics"
        private const val KEY_LANGUAGE = "language_tag"
        private const val KEY_DIAGNOSTICS = "share_diagnostics"

        /**
         * Synchronously reads the persisted per-app language tag (or null for "follow system"). Used by
         * `MainActivity.attachBaseContext` to wrap the resource configuration before any UI is created.
         */
        fun readLanguageTag(context: Context): String? {
            val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return AppLanguage.fromPersisted(prefs.getString(KEY_LANGUAGE, null))
        }

        /**
         * Synchronously persists just the language tag so a pre-API-33 `recreate()` reads the new value
         * in `attachBaseContext` without racing the controller's async full save (which writes the same
         * value). `apply()` updates the in-process value immediately, so the very next [readLanguageTag]
         * observes it.
         */
        fun writeLanguageTag(
            context: Context,
            tag: String?,
        ) {
            context.applicationContext
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_LANGUAGE, AppLanguage.toPersisted(tag))
                .apply()
        }
    }
}
