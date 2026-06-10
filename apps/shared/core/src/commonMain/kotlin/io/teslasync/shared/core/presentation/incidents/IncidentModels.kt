package io.teslasync.shared.core.presentation.incidents

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One status-timeline entry on an [Incident] — the cross-platform port of the web
 * `IncidentUpdateEntry` interface (web/src/api/hooks/useIncidents.ts). Keys arrive snake_case
 * from `GET /api/v1/status/incidents/{id}`; they are matched verbatim via [SerialName] so the
 * cached payload round-trips unchanged. [author] is nullable (a system-authored update carries
 * no author). No field is unit-bearing, so there is no SI conversion at this layer — display
 * formatting is the render boundary's job (S5).
 */
@Serializable
public data class IncidentUpdateEntry(
    val at: String,
    val status: String,
    val message: String,
    val author: String? = null,
)

/**
 * The wire shape of one operational incident — the cross-platform port of the web `Incident`
 * interface (web/src/api/hooks/useIncidents.ts), backing the incidents block on /system-status
 * and the per-incident post-mortem page. Keys arrive snake_case; they are matched verbatim via
 * [SerialName] so the cached payload round-trips unchanged.
 *
 * [severity], [status], and [source] are the web string unions (`minor|major|critical`,
 * `investigating|identified|monitoring|resolved`, `manual|auto`); they are carried as plain
 * [String]s so an unknown future value decodes rather than bricking the feed (forward
 * compatibility), exactly as the web treats them as opaque strings at runtime. [resolvedAt] and
 * [createdBy] are nullable; [affectedComponents]/[updates] default to empty so a sparse row still
 * decodes. No field is unit-bearing, so there is no SI conversion at this layer (S5).
 */
@Serializable
public data class Incident(
    val id: Long,
    val title: String,
    val description: String,
    val severity: String,
    val status: String,
    val source: String,
    @SerialName("affected_components") val affectedComponents: List<String> = emptyList(),
    val updates: List<IncidentUpdateEntry> = emptyList(),
    @SerialName("started_at") val startedAt: String,
    @SerialName("resolved_at") val resolvedAt: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    @SerialName("created_by") val createdBy: String? = null,
)

/**
 * The `GET /status/incidents` list envelope — the port of the web `IncidentListResponse`
 * interface. [count] is the server-reported total; [incidents] defaults to empty so an empty
 * payload still decodes.
 */
@Serializable
public data class IncidentListResponse(
    val incidents: List<Incident> = emptyList(),
    val count: Int = 0,
)

/**
 * The optional list filter for the incidents feed — the port of the web `ListIncidentsParams`.
 *
 * @property activeOnly send `active=1` to scope the list to unresolved incidents (web
 *   `if (p.activeOnly) q.set('active', '1')`); `false` lists everything.
 * @property limit cap the number of rows; `null`/`0` omits the bound (the web `if (p.limit)`
 *   truthy guard drops a zero limit).
 */
public data class ListIncidentsParams(
    val activeOnly: Boolean = false,
    val limit: Int? = null,
)

/**
 * The `POST /status/incidents` body — the port of the web `CreateIncidentPayload`. [title] is
 * required by the server; the rest are optional and only carried on the wire when supplied
 * (mirroring `JSON.stringify` dropping `undefined` keys).
 */
public data class CreateIncidentInput(
    val title: String,
    val description: String? = null,
    val severity: String? = null,
    val status: String? = null,
    val affectedComponents: List<String>? = null,
    val initialMessage: String? = null,
)

/**
 * The `PATCH /status/incidents/{id}` body — the port of the web `PatchIncidentPayload`. Every
 * mutable field is optional so a partial patch only sends what changed (mirroring `JSON.stringify`
 * dropping `undefined` keys); [resolved] is the explicit resolve toggle.
 *
 * @property id the incident to patch (carried in the path, not the body).
 */
public data class PatchIncidentInput(
    val id: Long,
    val title: String? = null,
    val description: String? = null,
    val severity: String? = null,
    val status: String? = null,
    val affectedComponents: List<String>? = null,
    val resolved: Boolean? = null,
)

/**
 * The `POST /status/incidents/{id}/updates` body — the port of the web
 * `AppendIncidentUpdatePayload`. [message] is required; [status] is optional and only carried when
 * supplied.
 *
 * @property id the incident to append a timeline entry to (carried in the path, not the body).
 */
public data class AppendIncidentUpdateInput(
    val id: Long,
    val message: String,
    val status: String? = null,
)
