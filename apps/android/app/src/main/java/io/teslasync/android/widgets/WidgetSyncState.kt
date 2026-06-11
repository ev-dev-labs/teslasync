package io.teslasync.android.widgets

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.appwidget.state.updateAppWidgetState

/**
 * The tiny per-widget state the background refresh records in Glance preferences (P3/A8): the coarse
 * last-sync [WidgetSyncStatus] and its wall-clock stamp. The cache-only render path reads this so it
 * can tell an honest stale-vs-offline-vs-error story.
 *
 * It holds NO data and NO secrets — only the sync outcome — so no PII or token ever lands in widget
 * storage (ADR-008). The actual cached values live in the shared offline cache (ADR-013).
 */
object WidgetSyncState {
    private val STATUS = stringPreferencesKey("sync_status")
    private val LAST_SYNC_MILLIS = longPreferencesKey("last_sync_millis")

    /** The last-recorded sync status for the widget instance whose [prefs] these are. */
    fun status(prefs: Preferences): WidgetSyncStatus = WidgetSyncStatus.fromToken(prefs[STATUS])

    /** Records [status] (stamped [nowMillis]) for the [glanceId] widget instance. */
    suspend fun write(
        context: Context,
        glanceId: GlanceId,
        status: WidgetSyncStatus,
        nowMillis: Long,
    ) {
        updateAppWidgetState(context, glanceId) { prefs ->
            prefs[STATUS] = status.token
            prefs[LAST_SYNC_MILLIS] = nowMillis
        }
    }
}
