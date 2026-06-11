package io.teslasync.android.notifications

/**
 * The semantic class of a TeslaSync notification (P3/A6). Every push maps to exactly one kind, which
 * drives the Android notification channel, the deep-link route, the in-app banner severity and the
 * per-kind delivery toggle. The wire `kind`/`type` string from the backend notification-worker
 * envelope is normalized via [NotificationKinds.parse].
 */
enum class NotificationKind {
    /** An unrecognized or generic notification (the safe default). */
    Generic,

    /** A user-configured alert rule fired (battery, geofence, speed, tire pressure, …). */
    Alert,

    /** A charging session reached its target or otherwise completed. */
    ChargeComplete,

    /** A vehicle changed drive / charge / park / sleep / online state. */
    VehicleState,

    /** An automation rule executed and reported its outcome. */
    Automation,

    /** The success or failure result of a vehicle command. */
    CommandResult,

    /** A system or service incident was opened, updated or resolved. */
    SystemIncident,

    /** The Tesla / Authentik session expired and needs re-authentication. */
    ReauthNeeded,
}

/**
 * Maps between the backend notification `kind`/`type` wire strings and the typed [NotificationKind]
 * (P3/A6). Parsing is tolerant and case-insensitive: an unknown, empty or null wire value resolves to
 * [NotificationKind.Generic] so a malformed push is always classifiable. The canonical wire form is
 * the lower-snake-case token the worker emits.
 */
object NotificationKinds {
    private val wireByKind: Map<NotificationKind, String> =
        mapOf(
            NotificationKind.Generic to "generic",
            NotificationKind.Alert to "alert",
            NotificationKind.ChargeComplete to "charge_complete",
            NotificationKind.VehicleState to "vehicle_state",
            NotificationKind.Automation to "automation",
            NotificationKind.CommandResult to "command_result",
            NotificationKind.SystemIncident to "system_incident",
            NotificationKind.ReauthNeeded to "reauth_needed",
        )

    private val kindByToken: Map<String, NotificationKind> =
        mapOf(
            "generic" to NotificationKind.Generic,
            "info" to NotificationKind.Generic,
            "alert" to NotificationKind.Alert,
            "alerts" to NotificationKind.Alert,
            "alert_rule" to NotificationKind.Alert,
            "charge_complete" to NotificationKind.ChargeComplete,
            "charging_complete" to NotificationKind.ChargeComplete,
            "charge_done" to NotificationKind.ChargeComplete,
            "vehicle_state" to NotificationKind.VehicleState,
            "vehicle_state_change" to NotificationKind.VehicleState,
            "state_change" to NotificationKind.VehicleState,
            "fsm" to NotificationKind.VehicleState,
            "automation" to NotificationKind.Automation,
            "automation_event" to NotificationKind.Automation,
            "automation_run" to NotificationKind.Automation,
            "command_result" to NotificationKind.CommandResult,
            "command" to NotificationKind.CommandResult,
            "command_response" to NotificationKind.CommandResult,
            "system_incident" to NotificationKind.SystemIncident,
            "incident" to NotificationKind.SystemIncident,
            "system" to NotificationKind.SystemIncident,
            "reauth_needed" to NotificationKind.ReauthNeeded,
            "reauth" to NotificationKind.ReauthNeeded,
            "reauthentication" to NotificationKind.ReauthNeeded,
            "auth_required" to NotificationKind.ReauthNeeded,
        )

    /** Normalizes a wire [kind] token; unknown/empty resolves to [NotificationKind.Generic]. */
    fun parse(kind: String?): NotificationKind {
        val token = kind?.trim()?.lowercase().orEmpty()
        return kindByToken[token] ?: NotificationKind.Generic
    }

    /** The canonical lower-snake-case wire token for [kind]. */
    fun toWire(kind: NotificationKind): String = wireByKind[kind] ?: "generic"
}
