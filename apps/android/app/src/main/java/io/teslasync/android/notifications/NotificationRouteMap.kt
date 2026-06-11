package io.teslasync.android.notifications

import io.teslasync.android.navigation.RouteTable

/** The deep-link target a notification opens: an in-app route path plus the entity id it was built from. */
data class ResolvedRoute(
    val path: String,
    val entityId: String?,
)

/**
 * Maps a [NotificationKind] (and the push `data` bag) to a concrete in-app route path and a
 * `teslasync://app/...` deep-link URI (P3/A6, ADR-009). Every candidate is validated against the real
 * [RouteTable] — the same registry the navigation shell uses — so a notification can never deep-link to
 * a route that does not exist; an unresolvable kind falls back to the always-present notifications inbox.
 *
 * Resolution order: (1) an explicit, valid `route` the backend supplied wins; (2) the kind's
 * parameterized candidate (with a safe entity id) then its static landing page; (3) the inbox.
 */
object NotificationRouteMap {
    /** The canonical, always-valid fallback route (the notifications inbox). */
    const val INBOX_PATH = "notifications/inbox"

    private val vehicleIdKeys = listOf("vehicle_id", "vehicleId", "id")
    private val sessionIdKeys = listOf("session_id", "sessionId", "charging_session_id", "chargingSessionId", "id")
    private val incidentIdKeys = listOf("incident_id", "incidentId", "id")
    private val genericIdKeys = listOf("id", "vehicle_id", "vehicleId")

    /** Resolves the deep-link route for [kind] given its push [data]. */
    fun resolve(
        kind: NotificationKind,
        data: Map<String, String>,
    ): ResolvedRoute {
        val entityId = entityIdFor(kind, data)
        val explicit = data["route"]
        val resolved =
            when {
                explicit != null && isReal(explicit) -> normalize(explicit)
                else -> firstRealCandidate(kind, entityId) ?: INBOX_PATH
            }
        return ResolvedRoute(resolved, entityId)
    }

    /** The full `teslasync://app/...` deep-link URI a tap on a [kind] notification should open. */
    fun deepLinkUri(
        kind: NotificationKind,
        data: Map<String, String>,
    ): String = deepLinkUriFor(resolve(kind, data).path)

    /** Builds the `teslasync://app/...` deep-link URI for an already-resolved in-app [path]. */
    fun deepLinkUriFor(path: String): String = "${RouteTable.APP_SCHEME}://app/" + path.removePrefix("/")

    private fun firstRealCandidate(
        kind: NotificationKind,
        entityId: String?,
    ): String? = candidatesFor(kind, entityId).firstOrNull { isReal(it) }?.let { normalize(it) }

    private fun candidatesFor(
        kind: NotificationKind,
        entityId: String?,
    ): List<String> =
        when (kind) {
            NotificationKind.Alert -> listOf("notifications/alerts", INBOX_PATH)
            NotificationKind.ChargeComplete ->
                buildList {
                    if (entityId != null) add("charging/$entityId")
                    add("charging")
                }
            NotificationKind.VehicleState ->
                buildList {
                    if (entityId != null) add("vehicles/$entityId")
                    add("vehicles")
                }
            NotificationKind.Automation -> listOf("automations")
            NotificationKind.CommandResult -> listOf("command-history", "commands")
            NotificationKind.SystemIncident ->
                buildList {
                    if (entityId != null) add("system-status/incidents/$entityId")
                    add("system-status")
                }
            NotificationKind.ReauthNeeded -> listOf("settings")
            NotificationKind.Generic -> listOf(INBOX_PATH)
        }

    private fun entityIdFor(
        kind: NotificationKind,
        data: Map<String, String>,
    ): String? {
        val keys =
            when (kind) {
                NotificationKind.ChargeComplete -> sessionIdKeys
                NotificationKind.VehicleState -> vehicleIdKeys
                NotificationKind.SystemIncident -> incidentIdKeys
                else -> genericIdKeys
            }
        return keys.firstNotNullOfOrNull { key -> data[key]?.takeIf(::isSafeSegment)?.trim() }
    }

    private fun isReal(path: String): Boolean {
        val destination = RouteTable.match(path)
        return destination != null && destination.id != RouteTable.notFound.id
    }

    private fun normalize(path: String): String = RouteTable.normalize(path).removePrefix("/")

    private fun isSafeSegment(value: String?): Boolean {
        if (value.isNullOrBlank()) return false
        return value.trim().all { char -> char.isLetterOrDigit() || char == '-' || char == '_' || char == '.' }
    }
}
