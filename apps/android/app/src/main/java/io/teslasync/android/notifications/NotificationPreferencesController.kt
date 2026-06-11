package io.teslasync.android.notifications

import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Observable projection of the user's [NotificationSettings] for the settings UI (P3/A8). It loads from
 * and persists to the SAME [NotificationSettingsStore] the [NotificationDispatcher] consults on every
 * push, so a toggle here takes effect on the next notification with no extra plumbing. Built in the app
 * DI graph and reached through [LocalNotificationPreferences]; exposes the settings as Compose snapshot
 * state and a focused setter per preference.
 */
@Stable
class NotificationPreferencesController(
    private val store: NotificationSettingsStore,
    private val scope: CoroutineScope,
) {
    /** The current notification preferences; mutating recomposes the settings screen. */
    var settings: NotificationSettings by mutableStateOf(NotificationSettings.Default)
        private set

    private var loaded = false

    /** Loads the persisted preferences. Idempotent. */
    fun start() {
        if (loaded) return
        loaded = true
        scope.launch { settings = store.load() }
    }

    fun setEnabled(enabled: Boolean) = update { it.copy(enabled = enabled) }

    fun setKindEnabled(
        kind: NotificationKind,
        enabled: Boolean,
    ) = update {
        val kinds = if (enabled) it.enabledKinds + kind else it.enabledKinds - kind
        it.copy(enabledKinds = kinds)
    }

    fun setRedactSensitiveContent(enabled: Boolean) = update { it.copy(redactSensitiveContent = enabled) }

    fun setAllowCriticalBreakthrough(enabled: Boolean) = update { it.copy(allowCriticalBreakthrough = enabled) }

    fun setQuietHours(quietHours: QuietHours) = update { it.copy(quietHours = quietHours) }

    private fun update(transform: (NotificationSettings) -> NotificationSettings) {
        val next = transform(settings)
        if (next == settings) return
        settings = next
        scope.launch { store.save(next) }
    }
}

/** Ambient notification-preferences controller for the settings screen (null until the app provides it). */
val LocalNotificationPreferences = staticCompositionLocalOf<NotificationPreferencesController?> { null }
