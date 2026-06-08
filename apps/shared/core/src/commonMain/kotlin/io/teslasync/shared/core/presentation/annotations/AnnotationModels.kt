package io.teslasync.shared.core.presentation.annotations

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The wire shape of one durable chart annotation — the cross-platform port of the web
 * `ChartAnnotationRow` interface (web/src/types/annotations.ts), itself mirroring the Go
 * `dashboardmodel.ChartAnnotation` struct (internal/api/chartannotation/handler.go). Keys
 * arrive snake_case from `GET /api/v1/annotations`; they are matched verbatim via
 * [SerialName] so the cached payload round-trips unchanged.
 *
 * Only [id], [occurredAt], [category], [title], and the timestamps are guaranteed by the
 * server; [userId]/[vehicleId]/[description]/[color] are nullable and [scope] defaults to an
 * empty list so a fleet-wide row (`vehicle_id` NULL) or a scope-less row still decodes. No
 * field is unit-bearing, so there is no SI conversion at this layer — display formatting is
 * the render boundary's job (S5).
 */
@Serializable
public data class ChartAnnotationRow(
    val id: Long,
    @SerialName("user_id") val userId: Long? = null,
    @SerialName("vehicle_id") val vehicleId: Long? = null,
    @SerialName("occurred_at") val occurredAt: String,
    val category: String,
    val title: String,
    val description: String? = null,
    val scope: List<String> = emptyList(),
    val color: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

/**
 * The chart-render projection of a [ChartAnnotationRow] — the port of the web `DataAnnotation`
 * interface. Produced by [toDataAnnotation], it flattens the annotation onto the shape the
 * native chart-overlay consumers bind to (a stringified id, the first scope bucket as the
 * render [context], and the `occurred_at` timestamp as the reference-line anchor).
 */
public data class DataAnnotation(
    val id: String,
    val timestamp: String,
    val label: String,
    val description: String? = null,
    val category: String,
    val context: String,
    val vehicleId: Long? = null,
    val createdAt: String,
)

/**
 * Projects a backend [row] onto the [DataAnnotation] render shape — the exact derivation of
 * the web `toDataAnnotation`. The numeric id is stringified so it can flow through the chart
 * overlay unchanged; [DataAnnotation.context] is the first scope bucket (or `""` when the row
 * is scope-less, mirroring `row.scope[0] ?? ''`); a null description/vehicle id stays null
 * (the web `?? undefined`). Locked by golden vectors shared with the Windows C# port so the
 * three platforms cannot drift (ADR-004).
 */
public fun toDataAnnotation(row: ChartAnnotationRow): DataAnnotation =
    DataAnnotation(
        id = row.id.toString(),
        timestamp = row.occurredAt,
        label = row.title,
        description = row.description,
        category = row.category,
        context = row.scope.firstOrNull() ?: "",
        vehicleId = row.vehicleId,
        createdAt = row.createdAt,
    )

/**
 * The optional list filter for [io.teslasync.shared.core.data.repo.AnnotationRepository.chartAnnotations]
 * — the port of the web `AnnotationListParams`. Every field is optional; the backend returns
 * the rows pinned to [vehicleId] PLUS fleet-wide rows (`vehicle_id` NULL) so a single
 * utility-rate annotation shows up on every vehicle's cost chart.
 *
 * @property vehicleId scope to a vehicle's annotations (plus fleet-wide); null lists everything.
 * @property scope restrict to a single chart bucket (`battery`, `cost`, …); null lists all buckets.
 * @property from inclusive lower time bound (RFC3339 or `YYYY-MM-DD`); null/blank omits it.
 * @property to inclusive upper time bound; null/blank omits it.
 */
public data class AnnotationListParams(
    val vehicleId: Long? = null,
    val scope: String? = null,
    val from: String? = null,
    val to: String? = null,
)

/**
 * The `POST /annotations` body — the port of the web `CreateAnnotationInput`. [occurredAt],
 * [category], and [title] are required by the server; the rest are optional and only carried
 * on the wire when supplied (mirroring `JSON.stringify` dropping `undefined` keys).
 */
public data class CreateAnnotationInput(
    val occurredAt: String,
    val category: String,
    val title: String,
    val vehicleId: Long? = null,
    val description: String? = null,
    val scope: List<String>? = null,
    val color: String? = null,
)

/**
 * The `PATCH /annotations/{id}` body — the port of the web `UpdateAnnotationInput`. Every
 * mutable field is optional so a partial patch only sends what changed; [clearDescription] /
 * [clearColor] are explicit erasers (the server distinguishes "leave alone" from "set null").
 *
 * @property id the annotation to patch (carried in the path, not the body).
 */
public data class UpdateAnnotationInput(
    val id: Long,
    val occurredAt: String? = null,
    val category: String? = null,
    val title: String? = null,
    val description: String? = null,
    val scope: List<String>? = null,
    val color: String? = null,
    val clearDescription: Boolean = false,
    val clearColor: Boolean = false,
)
