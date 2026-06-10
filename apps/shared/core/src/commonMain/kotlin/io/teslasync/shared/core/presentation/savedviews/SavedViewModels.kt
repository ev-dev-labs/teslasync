package io.teslasync.shared.core.presentation.savedviews

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The wire shape of one saved view — the cross-platform port of the web `SavedView` interface
 * (web/src/api/types.ts), itself mirroring the Go `dashboardmodel.SavedView` struct
 * (internal/models/dashboard/saved_view.go). Keys arrive snake_case from
 * `GET /api/v1/saved-views?route=`; they are matched verbatim via [SerialName] so the cached
 * payload round-trips unchanged.
 *
 * [id], [name], [route], [query], the flags, [sortOrder], and the timestamps are always present;
 * [userId] is nullable. [query] is the opaque list-page querystring snapshot (filters, sort,
 * pagination) the frontend recalls later — carried verbatim as a raw string, exactly as the web
 * hook keeps it. No field is unit-bearing, so there is no SI conversion at this layer — display
 * formatting is the render boundary's job (S5).
 */
@Serializable
public data class SavedView(
    val id: Long,
    @SerialName("user_id") val userId: Long? = null,
    val name: String,
    val route: String,
    val query: String,
    @SerialName("is_default") val isDefault: Boolean = false,
    @SerialName("is_pinned") val isPinned: Boolean = false,
    @SerialName("sort_order") val sortOrder: Int = 0,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

/**
 * The `POST /saved-views` body — the port of the web `SavedViewCreateInput`. [name], [route], and
 * [query] are required by the server; [isDefault], [isPinned], and [sortOrder] are optional and only
 * carried on the wire when supplied (mirroring `JSON.stringify` dropping `undefined` keys).
 */
public data class SavedViewCreateInput(
    val name: String,
    val route: String,
    val query: String,
    val isDefault: Boolean? = null,
    val isPinned: Boolean? = null,
    val sortOrder: Int? = null,
)

/**
 * The `PUT /saved-views/{id}` body — the port of the web `SavedViewUpdateInput`. Every mutable field
 * is optional so a partial update only sends what changed (the web sends `JSON.stringify(patch)`);
 * scope (`user_id`, `route`) is immutable server-side.
 */
public data class SavedViewUpdateInput(
    val name: String? = null,
    val query: String? = null,
    val isDefault: Boolean? = null,
    val isPinned: Boolean? = null,
    val sortOrder: Int? = null,
)

/**
 * The argument bundle for an update — the port of the web `UpdateSavedViewArgs`. The caller passes
 * the [route] alongside the [id] so the right list cache can be invalidated without a round-trip to
 * read the row back, exactly as the web hook does.
 *
 * @property id the saved view to update (carried in the path, not the body).
 * @property route the list-page route whose feed is refreshed on success.
 * @property patch the partial update body.
 */
public data class UpdateSavedViewArgs(
    val id: Long,
    val route: String,
    val patch: SavedViewUpdateInput,
)

/**
 * The argument bundle for a delete — the port of the web `DeleteSavedViewArgs`. The caller passes
 * the [route] so the right list cache can be invalidated.
 */
public data class DeleteSavedViewArgs(
    val id: Long,
    val route: String,
)

/**
 * The argument bundle for toggling the default flag — the port of the web `SetDefaultSavedViewArgs`.
 * Backed by the same Update endpoint, exposed separately for clarity at call sites that only flip the
 * default. The caller passes the [route] so the right list cache can be invalidated.
 */
public data class SetDefaultSavedViewArgs(
    val id: Long,
    val route: String,
    val isDefault: Boolean,
)
