package io.teslasync.android.notifications

import io.teslasync.android.navigation.RouteTable

/**
 * How a notification action behaves when invoked (P3/A8, ADR-009). [Open] launches the app at a
 * deep-link route (an Activity `PendingIntent` carrying the `teslasync://app/...` URI); [Acknowledge]
 * handles the notification in the background without opening the app (a broadcast `PendingIntent` to
 * [NotificationActionReceiver]).
 */
enum class NotificationActionBehavior { Open, Acknowledge }

/**
 * A stable identifier for each action kind (P3/A8). Drives the user-visible label and icon at the
 * Android boundary and the broadcast extra the receiver reads; the wire token keeps the broadcast
 * intent self-describing and is the unit of the receiver's `when`.
 */
enum class NotificationActionId(
    val wire: String,
) {
    Open("open"),
    Acknowledge("acknowledge"),
    OpenSession("open_session"),
    OpenHistory("open_history"),
    OpenIncident("open_incident"),
    SignIn("sign_in"),
    QuietHours("quiet_hours"),
    ;

    companion object {
        /** Resolves a wire token back to its id, or null when unknown (a forged/legacy broadcast). */
        fun fromWire(wire: String?): NotificationActionId? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * One actionable button on a notification (P3/A8). For an [NotificationActionBehavior.Open] action
 * [deepLinkPath] is the validated in-app route the tap opens and [authRequired] asks the OS to unlock
 * the device first (lock-state safeguard, applied via `NotificationCompat.Action.setAuthenticationRequired`
 * on API 31+). The label/icon are resolved from [id] at the Android boundary so this type stays
 * framework-free and fully unit-tested.
 */
data class NotificationAction(
    val id: NotificationActionId,
    val behavior: NotificationActionBehavior,
    val deepLinkPath: String? = null,
    val authRequired: Boolean = false,
)

/**
 * Maps a composed [NotificationContent] to its action buttons (P3/A8, ADR-009). Pure and total so every
 * kind's action set is unit-tested:
 *
 * - [NotificationKind.Alert] → **Acknowledge** (background dismiss, no unlock) + **Open** the alert.
 * - [NotificationKind.ChargeComplete] → open the charging session.
 * - [NotificationKind.CommandResult] → open command history.
 * - [NotificationKind.SystemIncident] → open the incident.
 * - [NotificationKind.ReauthNeeded] → open sign-in (re-auth lands on settings/sign-in).
 * - quieter kinds ([NotificationKind.VehicleState]/[NotificationKind.Automation]/[NotificationKind.Generic])
 *   → a **Quiet hours** shortcut so a user can mute without hunting through Settings.
 *
 * Every open target is validated against the real [RouteTable]; an unresolvable path falls back to the
 * always-present notifications inbox, mirroring [NotificationRouteMap].
 */
object NotificationActions {
    private const val QUIET_HOURS_PATH = "notifications/quiet-hours"

    /** The ordered action buttons for [content]. */
    fun actionsFor(content: NotificationContent): List<NotificationAction> =
        when (content.kind) {
            NotificationKind.Alert ->
                listOf(acknowledge(), open(NotificationActionId.Open, content.routePath))
            NotificationKind.ChargeComplete ->
                listOf(open(NotificationActionId.OpenSession, content.routePath))
            NotificationKind.CommandResult ->
                listOf(open(NotificationActionId.OpenHistory, content.routePath))
            NotificationKind.SystemIncident ->
                listOf(open(NotificationActionId.OpenIncident, content.routePath))
            NotificationKind.ReauthNeeded ->
                listOf(open(NotificationActionId.SignIn, content.routePath))
            NotificationKind.VehicleState, NotificationKind.Automation, NotificationKind.Generic ->
                listOf(open(NotificationActionId.QuietHours, QUIET_HOURS_PATH))
        }

    private fun acknowledge(): NotificationAction =
        NotificationAction(NotificationActionId.Acknowledge, NotificationActionBehavior.Acknowledge, authRequired = false)

    private fun open(
        id: NotificationActionId,
        path: String,
    ): NotificationAction =
        NotificationAction(
            id = id,
            behavior = NotificationActionBehavior.Open,
            deepLinkPath = validPath(path),
            // Opening the app surfaces account/vehicle data, so require the device be unlocked first.
            authRequired = true,
        )

    /** The validated route for an open action: the path when real, else the notifications inbox. */
    private fun validPath(path: String): String {
        val destination = RouteTable.match(path)
        val real = destination != null && destination.id != RouteTable.notFound.id
        return if (real) RouteTable.normalize(path).removePrefix("/") else NotificationRouteMap.INBOX_PATH
    }
}
