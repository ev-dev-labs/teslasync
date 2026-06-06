package io.teslasync.shared.core.presentation.pinned

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The surfaces that may be pinned — the cross-platform port of the web `PinnedItemType` union
 * (web/src/api/types.ts), itself the mirror of the Go closed enum `dashboardmodel.PinnedItemType`
 * (internal/models/dashboard/pinned.go) and the `pinned_items` CHECK constraint (migration
 * 000162). Modelled as a closed enum rather than a raw string so an invalid type can never reach
 * the wire; each entry carries its exact snake_case [wire] token (the value the web hook puts in
 * the `type=`/`item_type` field), matched verbatim on decode via [SerialName] so a server row
 * round-trips unchanged.
 *
 * @property wire the on-the-wire token (`alert_rule`, …) used in the query param, the POST body,
 *   and the cache/feed key.
 */
@Serializable
public enum class PinnedItemType(
    public val wire: String,
) {
    @SerialName("vehicle")
    Vehicle("vehicle"),

    @SerialName("widget")
    Widget("widget"),

    @SerialName("alert_rule")
    AlertRule("alert_rule"),

    @SerialName("location")
    Location("location"),

    @SerialName("geofence")
    Geofence("geofence"),

    @SerialName("automation")
    Automation("automation"),

    @SerialName("dashboard")
    Dashboard("dashboard"),

    @SerialName("command")
    Command("command"),
}

/**
 * The wire shape of one unified pin — the cross-platform port of the web `PinnedItem` interface
 * (web/src/api/types.ts), itself mirroring the Go `dashboardmodel.PinnedItem` struct
 * (internal/models/dashboard/pinned.go). Keys arrive snake_case from `GET /pinned`; they are
 * matched verbatim via [SerialName] so the cached payload round-trips unchanged.
 *
 * [userId] is null on a single-user install (an unscoped pin) and [context] is null for a pin
 * that is global within its `(user, item_type)` scope (sub-surface narrowing is carried in
 * [context], e.g. a dashboard id when pinning a widget). No field is unit-bearing, so there is
 * no SI conversion at this layer — display formatting is the render boundary's job (S5).
 * [position] is the absolute display order owned by the drag handler; the list arrives already
 * sorted pinned-first by the backend.
 */
@Serializable
public data class PinnedItem(
    val id: Long,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("item_type") val itemType: PinnedItemType,
    @SerialName("item_id") val itemId: String,
    val position: Int,
    @SerialName("pinned_at") val pinnedAt: String,
    val context: String? = null,
)
