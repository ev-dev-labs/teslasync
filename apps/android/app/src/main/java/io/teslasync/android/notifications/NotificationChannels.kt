package io.teslasync.android.notifications

/**
 * The importance of an Android notification channel, expressed framework-free so the taxonomy stays
 * unit-testable (P3/A6). Mapped to `NotificationManagerCompat.IMPORTANCE_*` by the channel creator.
 */
enum class ChannelImportance {
    /** Quiet: no sound, may not appear in the status bar (background/low-priority channels). */
    Low,

    /** Standard: makes a sound, appears in the status bar. */
    Default,

    /** Urgent: makes a sound and may show as a heads-up notification (critical channels). */
    High,
}

/** One Android notification channel in the TeslaSync taxonomy: a stable [id] plus its [importance]. */
data class NotificationChannelDef(
    val id: String,
    val importance: ChannelImportance,
)

/**
 * The TeslaSync Android notification-channel taxonomy and the [NotificationKind] → channel routing
 * (P3/A6, ADR-009). It is framework-free and fully unit-tested; the user-visible localized name and
 * description for each channel are attached at creation time by `AndroidNotificationChannels`.
 *
 * Channel selection prefers an explicit, valid hint (the push `data.channel` or `category`, so the
 * backend can target e.g. the maintenance channel for a `Generic` kind), then falls back to the
 * kind's home channel, so every channel in [all] is reachable.
 */
object NotificationChannels {
    /** Urgent, user-configured alerts and security/re-auth prompts (heads-up). */
    const val CRITICAL_ALERTS = "critical_alerts"

    /** Drive / charge / park / sleep / online state changes. */
    const val VEHICLE_EVENTS = "vehicle_events"

    /** Charging started / target reached / completed. */
    const val CHARGING = "charging"

    /** Automation rule outcomes. */
    const val AUTOMATION = "automation"

    /** Maintenance reminders and software-update notices. */
    const val MAINTENANCE = "maintenance"

    /** System / service incidents and command results. */
    const val SYSTEM = "system"

    /** General / low-priority notifications (the quiet default channel). */
    const val GENERAL = "general"

    /** Every channel, in display order — the single source the creator iterates. */
    val all: List<NotificationChannelDef> =
        listOf(
            NotificationChannelDef(CRITICAL_ALERTS, ChannelImportance.High),
            NotificationChannelDef(VEHICLE_EVENTS, ChannelImportance.Default),
            NotificationChannelDef(CHARGING, ChannelImportance.Default),
            NotificationChannelDef(AUTOMATION, ChannelImportance.Low),
            NotificationChannelDef(MAINTENANCE, ChannelImportance.Low),
            NotificationChannelDef(SYSTEM, ChannelImportance.Default),
            NotificationChannelDef(GENERAL, ChannelImportance.Low),
        )

    /** The set of valid channel ids. */
    val ids: Set<String> = all.map { it.id }.toSet()

    private val channelByHint: Map<String, String> =
        mapOf(
            "maintenance" to MAINTENANCE,
            "service" to MAINTENANCE,
            "software" to MAINTENANCE,
            "software_update" to MAINTENANCE,
            "update" to MAINTENANCE,
            "charging" to CHARGING,
            "charge" to CHARGING,
            "vehicle" to VEHICLE_EVENTS,
            "vehicle_state" to VEHICLE_EVENTS,
            "automation" to AUTOMATION,
            "system" to SYSTEM,
            "incident" to SYSTEM,
            "critical" to CRITICAL_ALERTS,
            "alert" to CRITICAL_ALERTS,
            "security" to CRITICAL_ALERTS,
            "general" to GENERAL,
            "info" to GENERAL,
        )

    /**
     * The channel id for a [kind], optionally overridden by a valid [hint] (the push `data.channel` or
     * `category`). An unknown hint is ignored and the kind's home channel is used.
     */
    fun channelIdFor(
        kind: NotificationKind,
        hint: String? = null,
    ): String {
        val normalized = hint?.trim()?.lowercase()
        val fromHint = normalized?.let { if (it in ids) it else channelByHint[it] }
        return fromHint ?: homeChannel(kind)
    }

    private fun homeChannel(kind: NotificationKind): String =
        when (kind) {
            NotificationKind.Alert, NotificationKind.ReauthNeeded -> CRITICAL_ALERTS
            NotificationKind.VehicleState -> VEHICLE_EVENTS
            NotificationKind.ChargeComplete -> CHARGING
            NotificationKind.Automation -> AUTOMATION
            NotificationKind.CommandResult, NotificationKind.SystemIncident -> SYSTEM
            NotificationKind.Generic -> GENERAL
        }
}
