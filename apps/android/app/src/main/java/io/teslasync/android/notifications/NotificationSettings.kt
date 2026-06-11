package io.teslasync.android.notifications

/**
 * The user's notification preferences (P3/A6). These gate the user-facing surfaces (in-app banner +
 * OS notification) without affecting whether the backend records the notification in the server inbox:
 * a disabled kind, the master toggle and quiet hours all affect whether the user is *interrupted*.
 * [allowCriticalBreakthrough] lets genuinely urgent notifications (alerts, security, incidents,
 * re-auth) surface even through quiet hours.
 */
data class NotificationSettings(
    val enabled: Boolean = true,
    val enabledKinds: Set<NotificationKind> = AllKinds,
    val quietHours: QuietHours = QuietHours.Disabled,
    val redactSensitiveContent: Boolean = false,
    val allowCriticalBreakthrough: Boolean = true,
) {
    /** True when [kind] is in the enabled set. */
    fun isKindEnabled(kind: NotificationKind): Boolean = kind in enabledKinds

    companion object {
        /** Every notification kind (the default enabled set). */
        val AllKinds: Set<NotificationKind> = NotificationKind.entries.toSet()

        /** The default preferences: everything on, no quiet hours. */
        val Default = NotificationSettings()
    }
}

/**
 * Persists [NotificationSettings] (P3/A6). The app stores them in private `SharedPreferences`; the
 * in-memory default backs tests and the headless graph until a settings UI drives changes.
 */
interface NotificationSettingsStore {
    /** Loads the persisted settings, or [NotificationSettings.Default] when none exist. */
    suspend fun load(): NotificationSettings

    /** Persists [settings]. */
    suspend fun save(settings: NotificationSettings)
}

/** The default in-memory [NotificationSettingsStore] (tests and the headless graph). */
class InMemoryNotificationSettingsStore(
    initial: NotificationSettings = NotificationSettings.Default,
) : NotificationSettingsStore {
    private var current: NotificationSettings = initial

    override suspend fun load(): NotificationSettings = current

    override suspend fun save(settings: NotificationSettings) {
        current = settings
    }
}
