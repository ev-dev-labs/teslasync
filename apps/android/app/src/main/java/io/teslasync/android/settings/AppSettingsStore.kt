package io.teslasync.android.settings

/**
 * Persists [AppSettings] (P3/A8). The app stores them in private `SharedPreferences`; the in-memory
 * default backs unit tests and the settings controller until a persisted value exists. Mirrors the
 * shape of `NotificationSettingsStore` so the two device-local preference stores stay consistent.
 */
interface AppSettingsStore {
    /** Loads the persisted settings, or [AppSettings.Default] when none exist. */
    suspend fun load(): AppSettings

    /** Persists [settings]. */
    suspend fun save(settings: AppSettings)
}

/** The default in-memory [AppSettingsStore] (tests and previews). */
class InMemoryAppSettingsStore(
    initial: AppSettings = AppSettings.Default,
) : AppSettingsStore {
    private var current: AppSettings = initial

    override suspend fun load(): AppSettings = current

    override suspend fun save(settings: AppSettings) {
        current = settings
    }
}
