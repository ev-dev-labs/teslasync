package io.teslasync.android.settings

import io.teslasync.android.navigation.PageHosts

/**
 * Registers the native settings screen ([SettingsRoute]) for the `settings` route (P3/A8). Called once
 * at process start by [io.teslasync.android.TeslaSyncApplication]; until A7 wires its generated pages
 * this is the seam that attaches real content to the `/settings` destination (the route otherwise falls
 * through to the shared not-found screen). Idempotent.
 */
object SettingsPageHost {
    private const val ID = "settings"
    private var registered = false

    /** Registers the settings host into [PageHosts]. Safe to call repeatedly. */
    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(ID) { SettingsRoute() }
    }
}
