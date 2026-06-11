package io.teslasync.android.shortcuts

import android.content.Context
import android.content.Intent
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import io.teslasync.android.MainActivity
import io.teslasync.android.R
import io.teslasync.android.notifications.NotificationIntent

/** The localized label + icon resources for a shortcut id (resolved at the Android boundary). */
private data class ShortcutResources(
    @StringRes val shortLabel: Int,
    @StringRes val longLabel: Int,
    @DrawableRes val icon: Int,
)

/**
 * Publishes the framework-free [AppShortcuts] matrix as dynamic launcher shortcuts (P3/A8). Each
 * shortcut launches [MainActivity] with an `ACTION_VIEW` intent carrying its `teslasync://app/...`
 * deep link in [NotificationIntent.EXTRA_DEEP_LINK] — the SAME channel notification and widget taps
 * use — so it routes through the one tested `DeepLinkRouter` → navigation path on both a cold start and
 * a warm `onNewIntent`. The set is capped at the launcher's per-activity limit (rank order) so
 * `setDynamicShortcuts` never overflows. Dynamic (not XML-static) shortcuts are used deliberately:
 * static `<intent>` elements cannot carry the private deep-link extra this app routes through, so a
 * static shortcut would bypass the guarded `DeepLinkRouter` path.
 */
class ShortcutPublisher(
    context: Context,
) {
    private val appContext = context.applicationContext

    /** Publishes (replaces) the dynamic launcher shortcuts. Safe to call repeatedly (e.g. on start). */
    fun publish() {
        val limit = ShortcutManagerCompat.getMaxShortcutCountPerActivity(appContext).takeIf { it > 0 } ?: DEFAULT_MAX
        val shortcuts = AppShortcuts.published(limit).map(::toShortcutInfo)
        ShortcutManagerCompat.setDynamicShortcuts(appContext, shortcuts)
    }

    private fun toShortcutInfo(shortcut: AppShortcut): ShortcutInfoCompat {
        val resources = RESOURCES.getValue(shortcut.id)
        val intent =
            Intent(appContext, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(NotificationIntent.EXTRA_DEEP_LINK, AppShortcuts.deepLinkUri(shortcut))
            }
        return ShortcutInfoCompat
            .Builder(appContext, "shortcut_${shortcut.id}")
            .setShortLabel(appContext.getString(resources.shortLabel))
            .setLongLabel(appContext.getString(resources.longLabel))
            .setIcon(IconCompat.createWithResource(appContext, resources.icon))
            .setIntent(intent)
            .setRank(shortcut.rank)
            .build()
    }

    private companion object {
        const val DEFAULT_MAX = 4

        val RESOURCES: Map<String, ShortcutResources> =
            mapOf(
                "dashboard" to
                    ShortcutResources(
                        R.string.shortcut_dashboard_short,
                        R.string.shortcut_dashboard_long,
                        R.drawable.ic_shortcut_dashboard,
                    ),
                "vehicles" to
                    ShortcutResources(R.string.shortcut_vehicles_short, R.string.shortcut_vehicles_long, R.drawable.ic_shortcut_vehicles),
                "charging" to
                    ShortcutResources(R.string.shortcut_charging_short, R.string.shortcut_charging_long, R.drawable.ic_shortcut_charging),
                "liveMap" to
                    ShortcutResources(R.string.shortcut_live_map_short, R.string.shortcut_live_map_long, R.drawable.ic_shortcut_live_map),
                "commands" to
                    ShortcutResources(R.string.shortcut_commands_short, R.string.shortcut_commands_long, R.drawable.ic_shortcut_commands),
                "notifications" to
                    ShortcutResources(
                        R.string.shortcut_notifications_short,
                        R.string.shortcut_notifications_long,
                        R.drawable.ic_shortcut_notifications,
                    ),
                "search" to
                    ShortcutResources(R.string.shortcut_search_short, R.string.shortcut_search_long, R.drawable.ic_shortcut_search),
            )
    }
}
