package io.teslasync.android.notifications

import android.content.Context
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationManagerCompat
import io.teslasync.android.R

/**
 * Creates the TeslaSync Android notification channels from the framework-free [NotificationChannels]
 * taxonomy (P3/A6, ADR-009). Each channel gets a user-visible, localized name and description from
 * string resources (so the system Settings → Notifications screen is meaningful) and the channel's
 * importance mapped from [ChannelImportance]. Idempotent — re-creating an existing channel only
 * refreshes its name/description (importance is owned by the user once created, per the platform).
 */
class AndroidNotificationChannels(
    context: Context,
) {
    private val appContext = context.applicationContext

    /** Registers every channel in [NotificationChannels.all] with the OS. */
    fun create() {
        val manager = NotificationManagerCompat.from(appContext)
        val channels =
            NotificationChannels.all.map { def ->
                NotificationChannelCompat
                    .Builder(def.id, importanceOf(def.importance))
                    .setName(appContext.getString(nameRes(def.id)))
                    .setDescription(appContext.getString(descriptionRes(def.id)))
                    .build()
            }
        manager.createNotificationChannelsCompat(channels)
    }

    private fun importanceOf(importance: ChannelImportance): Int =
        when (importance) {
            ChannelImportance.Low -> NotificationManagerCompat.IMPORTANCE_LOW
            ChannelImportance.Default -> NotificationManagerCompat.IMPORTANCE_DEFAULT
            ChannelImportance.High -> NotificationManagerCompat.IMPORTANCE_HIGH
        }

    private fun nameRes(channelId: String): Int =
        when (channelId) {
            NotificationChannels.CRITICAL_ALERTS -> R.string.push_channel_critical_alerts_name
            NotificationChannels.VEHICLE_EVENTS -> R.string.push_channel_vehicle_events_name
            NotificationChannels.CHARGING -> R.string.push_channel_charging_name
            NotificationChannels.AUTOMATION -> R.string.push_channel_automation_name
            NotificationChannels.MAINTENANCE -> R.string.push_channel_maintenance_name
            NotificationChannels.SYSTEM -> R.string.push_channel_system_name
            else -> R.string.push_channel_general_name
        }

    private fun descriptionRes(channelId: String): Int =
        when (channelId) {
            NotificationChannels.CRITICAL_ALERTS -> R.string.push_channel_critical_alerts_description
            NotificationChannels.VEHICLE_EVENTS -> R.string.push_channel_vehicle_events_description
            NotificationChannels.CHARGING -> R.string.push_channel_charging_description
            NotificationChannels.AUTOMATION -> R.string.push_channel_automation_description
            NotificationChannels.MAINTENANCE -> R.string.push_channel_maintenance_description
            NotificationChannels.SYSTEM -> R.string.push_channel_system_description
            else -> R.string.push_channel_general_description
        }
}
