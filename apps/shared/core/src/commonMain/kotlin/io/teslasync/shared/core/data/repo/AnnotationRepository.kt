package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.annotations.AnnotationListParams
import io.teslasync.shared.core.presentation.annotations.ChartAnnotationRow
import io.teslasync.shared.core.presentation.annotations.CreateAnnotationInput
import io.teslasync.shared.core.presentation.annotations.UpdateAnnotationInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the durable chart-annotation store — the cross-platform analogue of
 * the web `useAnnotations` hook domain (web/src/api/hooks/useAnnotations.ts). Every native
 * Annotations screen (Android/Apple via KMP, Windows via the C# port) reaches the backend
 * exclusively through this interface, so a single fake stands in for the whole domain in the
 * S8 state-holder tests.
 *
 * The single read ([chartAnnotations]) streams a cache-then-network [Resource] (ADR-013): the
 * cached rows first for an instant cold start, then the refreshed rows. The three mutations
 * are non-throwing suspend [Result]s; on success each invalidates the WHOLE annotation cache
 * partition — the data-layer analogue of the web hooks invalidating `annotationKeys.all`
 * (`['annotations']`), which drops every `(vehicle, scope, window)` query at once because a
 * write can affect any list (a fleet-wide row shows up on every vehicle).
 *
 * Annotation fields are plain (ids, timestamps, titles, hex colours) — not unit-bearing — so
 * they round-trip verbatim with no SI conversion; display formatting is the render boundary's
 * job (S5), never this layer's.
 */
public interface AnnotationRepository {
    /**
     * `GET /annotations/` (optionally `?vehicle_id=&scope=&from=&to=`) — the annotation list
     * for [params] (web `useChartAnnotations`). The query is built by [annotationQuery] with
     * the web `buildQuery` semantics (a blank scope/from/to is omitted), and the cache key by
     * [annotationCacheKey] mirroring the web `annotationKeys.list` tuple.
     */
    public fun chartAnnotations(params: AnnotationListParams = AnnotationListParams()): Flow<Resource<List<ChartAnnotationRow>>>

    /**
     * `POST /annotations/` — creates an annotation (web `useCreateAnnotation`). On success the
     * whole annotation partition is evicted so the next list read re-fetches.
     */
    public suspend fun createAnnotation(input: CreateAnnotationInput): Result<ChartAnnotationRow>

    /**
     * `PATCH /annotations/{id}` — patches an annotation (web `useUpdateAnnotation`). On success
     * the whole annotation partition is evicted.
     */
    public suspend fun updateAnnotation(input: UpdateAnnotationInput): Result<ChartAnnotationRow>

    /**
     * `DELETE /annotations/{id}` — removes an annotation (web `useDeleteAnnotation`). On success
     * the whole annotation partition is evicted.
     */
    public suspend fun deleteAnnotation(id: Long): Result<Unit>
}

/**
 * Builds the `/annotations` query map with the web `buildQuery` semantics
 * (web/src/api/hooks/useAnnotations.ts): `vehicle_id` is sent whenever an id is present
 * (mirroring `if (params.vehicleId != null)`); `scope`/`from`/`to` are sent only when
 * non-blank (mirroring JavaScript's truthy `if (params.scope)` guard, so an empty string is
 * treated as "no filter"). Keys are snake_case, matching the Go handler. Locked by golden
 * vectors shared with the C# port.
 */
public fun annotationQuery(params: AnnotationListParams): Map<String, String> {
    val query = linkedMapOf<String, String>()
    params.vehicleId?.let { query["vehicle_id"] = it.toString() }
    params.scope?.takeIf { it.isNotEmpty() }?.let { query["scope"] = it }
    params.from?.takeIf { it.isNotEmpty() }?.let { query["from"] = it }
    params.to?.takeIf { it.isNotEmpty() }?.let { query["to"] = it }
    return query
}

/**
 * Builds the stable cache/feed key for [params], mirroring the web `annotationKeys.list`
 * tuple `['annotations', vehicleId ?? 'all', scope ?? 'all', from ?? '', to ?? '']`. Only the
 * null-coalescing of the web tuple is reproduced (a present-but-empty scope stays `''`, not
 * `'all'`), so two param sets collide in the cache exactly when their web query keys do.
 * Locked by golden vectors shared with the C# port.
 */
public fun annotationCacheKey(params: AnnotationListParams): String =
    listOf(
        params.vehicleId?.toString() ?: "all",
        params.scope ?: "all",
        params.from ?: "",
        params.to ?: "",
    ).joinToString(":")
