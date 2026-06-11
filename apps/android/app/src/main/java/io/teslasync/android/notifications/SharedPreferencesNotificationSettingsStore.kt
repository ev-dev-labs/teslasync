package io.teslasync.android.notifications

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The production [NotificationSettingsStore] backed by private `SharedPreferences` (P3/A6). The
 * enabled-kinds set is stored as the canonical wire tokens (via [NotificationKinds]) and the quiet
 * window as minutes-of-day, so the persisted form is stable and locale-independent. Reads/writes hop
 * to [Dispatchers.IO] since the commit touches disk.
 */
class SharedPreferencesNotificationSettingsStore(
    context: Context,
) : NotificationSettingsStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override suspend fun load(): NotificationSettings =
        withContext(Dispatchers.IO) {
            if (!prefs.contains(KEY_ENABLED)) return@withContext NotificationSettings.Default
            NotificationSettings(
                enabled = prefs.getBoolean(KEY_ENABLED, true),
                enabledKinds = loadKinds(),
                quietHours =
                    QuietHours(
                        enabled = prefs.getBoolean(KEY_QUIET_ENABLED, false),
                        startMinuteOfDay = prefs.getInt(KEY_QUIET_START, 0),
                        endMinuteOfDay = prefs.getInt(KEY_QUIET_END, 0),
                    ),
                redactSensitiveContent = prefs.getBoolean(KEY_REDACT, false),
                allowCriticalBreakthrough = prefs.getBoolean(KEY_BREAKTHROUGH, true),
            )
        }

    override suspend fun save(settings: NotificationSettings) {
        withContext(Dispatchers.IO) {
            prefs
                .edit()
                .putBoolean(KEY_ENABLED, settings.enabled)
                .putStringSet(KEY_KINDS, settings.enabledKinds.map(NotificationKinds::toWire).toSet())
                .putBoolean(KEY_QUIET_ENABLED, settings.quietHours.enabled)
                .putInt(KEY_QUIET_START, settings.quietHours.startMinuteOfDay)
                .putInt(KEY_QUIET_END, settings.quietHours.endMinuteOfDay)
                .putBoolean(KEY_REDACT, settings.redactSensitiveContent)
                .putBoolean(KEY_BREAKTHROUGH, settings.allowCriticalBreakthrough)
                .apply()
        }
    }

    private fun loadKinds(): Set<NotificationKind> {
        val tokens = prefs.getStringSet(KEY_KINDS, null) ?: return NotificationSettings.AllKinds
        return tokens.map(NotificationKinds::parse).toSet()
    }

    private companion object {
        const val PREFS = "teslasync.notifications.settings"
        const val KEY_ENABLED = "enabled"
        const val KEY_KINDS = "enabled_kinds"
        const val KEY_QUIET_ENABLED = "quiet_enabled"
        const val KEY_QUIET_START = "quiet_start_minute"
        const val KEY_QUIET_END = "quiet_end_minute"
        const val KEY_REDACT = "redact_sensitive"
        const val KEY_BREAKTHROUGH = "critical_breakthrough"
    }
}
