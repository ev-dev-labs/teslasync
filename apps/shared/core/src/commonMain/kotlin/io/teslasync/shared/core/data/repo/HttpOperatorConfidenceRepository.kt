package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.operatorconfidence.AuditActionsResponse
import io.teslasync.shared.core.presentation.operatorconfidence.AuditCategoriesResponse
import io.teslasync.shared.core.presentation.operatorconfidence.AuditChainVerifyResponse
import io.teslasync.shared.core.presentation.operatorconfidence.AuditLogListResponse
import io.teslasync.shared.core.presentation.operatorconfidence.AuditLogQueryParams
import io.teslasync.shared.core.presentation.operatorconfidence.DiskForecastResponse
import io.teslasync.shared.core.presentation.operatorconfidence.GDPRExportArtifact
import io.teslasync.shared.core.presentation.operatorconfidence.SchemaDriftResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueriesResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryOrderBy
import io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostResponse
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [OperatorConfidenceRepository] over the resilient [ApiHttpClient] and the offline
 * cache (ADR-013). Every read shares the single [CacheDomain.OperatorConfidence] partition, keyed by
 * a stable per-feed string that mirrors the web `operatorConfidenceKeys` tuples, so a distinct query
 * caches independently while logout still clears the whole domain in one call.
 *
 * Each read goes through the generic cache-then-network operator (the per-entry-TTL [observe]
 * overload), storing the ENVELOPE-UNWRAPPED raw [JsonElement] verbatim (the same SI-faithful
 * strategy as the FleetTelemetry/IngestXRay ports) so the cached bytes round-trip unchanged. Each
 * emission is then decoded to its typed DTO. The unwrap mirrors the web `fetchEnvelope`: the
 * platform `httputil.Respond` handlers wrap their payloads as `{data: T}`, so the `data` member is
 * peeled off before caching/decoding (a no-op when the body has no `data` key, exactly as the web
 * helper degrades).
 *
 * A typed decode failure on the FRESH value surfaces as [Resource.Error] (never a thrown exception
 * that would cancel the flow before the next refresh); a failure decoding a CACHED value degrades
 * that slot to `null` so a schema-drifted cache can never brick the network reload.
 *
 * Per-read freshness mirrors the web `staleTime`s verbatim (see [OperatorConfidence] TTL constants);
 * the finer-grained `refetchInterval` poll and the `enabled` lazy gates are UI concerns (the
 * S8/platform layer chooses when to re-collect). There are no mutations — the web hook file has none
 * — so there is nothing to invalidate.
 */
public class HttpOperatorConfidenceRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    OperatorConfidenceRepository {
    override val domain: CacheDomain = CacheDomain.OperatorConfidence

    override fun schemaDrift(): Flow<Resource<SchemaDriftResponse>> =
        observe(OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY, TTL_STANDARD) {
            envelope(api.request<JsonElement>(path = "/admin/observability/schema-drift"))
        }.typed(SchemaDriftResponse.serializer())

    override fun slowQueries(
        orderBy: SlowQueryOrderBy,
        limit: Int,
    ): Flow<Resource<SlowQueriesResponse>> =
        observe(slowQueriesKey(orderBy, limit), TTL_MODERATE) {
            envelope(
                api.request<JsonElement>(
                    path = "/admin/observability/slow-queries",
                    query = slowQueriesQuery(orderBy, limit),
                ),
            )
        }.typed(SlowQueriesResponse.serializer())

    override fun vehicleCost(
        sinceIso: String?,
        limit: Int,
    ): Flow<Resource<VehicleCostResponse>> =
        observe(vehicleCostKey(sinceIso, limit), TTL_STANDARD) {
            envelope(
                api.request<JsonElement>(
                    path = "/admin/observability/vehicle-cost",
                    query = vehicleCostQuery(sinceIso, limit),
                ),
            )
        }.typed(VehicleCostResponse.serializer())

    override fun diskForecast(): Flow<Resource<DiskForecastResponse>> =
        observe(OPERATOR_CONFIDENCE_DISK_FORECAST_KEY, TTL_STANDARD) {
            envelope(api.request<JsonElement>(path = "/admin/observability/disk-forecast"))
        }.typed(DiskForecastResponse.serializer())

    override fun secretRotation(): Flow<Resource<SecretRotationResponse>> =
        observe(OPERATOR_CONFIDENCE_SECRET_ROTATION_KEY, TTL_STANDARD) {
            envelope(api.request<JsonElement>(path = "/admin/observability/secret-rotation"))
        }.typed(SecretRotationResponse.serializer())

    override fun auditLog(params: AuditLogQueryParams): Flow<Resource<AuditLogListResponse>> =
        observe(auditLogKey(params), TTL_MODERATE) {
            envelope(
                api.request<JsonElement>(
                    path = "/admin/audit-log",
                    query = auditLogQuery(params),
                ),
            )
        }.typed(AuditLogListResponse.serializer())

    override fun auditCategories(): Flow<Resource<AuditCategoriesResponse>> =
        observe(OPERATOR_CONFIDENCE_AUDIT_CATEGORIES_KEY, TTL_EXTENDED) {
            envelope(api.request<JsonElement>(path = "/admin/audit-log/categories"))
        }.typed(AuditCategoriesResponse.serializer())

    override fun auditActions(): Flow<Resource<AuditActionsResponse>> =
        observe(OPERATOR_CONFIDENCE_AUDIT_ACTIONS_KEY, TTL_EXTENDED) {
            envelope(api.request<JsonElement>(path = "/admin/audit-log/actions"))
        }.typed(AuditActionsResponse.serializer())

    override fun auditChainVerify(
        sinceIso: String?,
        limit: Int,
    ): Flow<Resource<AuditChainVerifyResponse>> =
        observe(auditChainVerifyKey(sinceIso, limit), TTL_FAST) {
            envelope(
                api.request<JsonElement>(
                    path = "/admin/audit-log/verify",
                    query = auditChainVerifyQuery(sinceIso, limit),
                ),
            )
        }.typed(AuditChainVerifyResponse.serializer())

    override fun gdprExport(id: String): Flow<Resource<GDPRExportArtifact>> =
        observe(gdprExportKey(id), TTL_QUICK) {
            envelope(api.request<JsonElement>(path = "/admin/gdpr/exports/$id"))
        }.typed(GDPRExportArtifact.serializer())

    // ---- Envelope + typed-decode plumbing -----------------------------------------

    /**
     * Peels the platform `{data: T}` envelope (web `fetchEnvelope`): when [body] is a [JsonObject]
     * carrying a `data` member, that member is returned; otherwise [body] is returned unchanged (the
     * defensive no-op for handlers ever migrated off `httputil.Respond`). The unwrapped element is
     * what gets cached, so the cached bytes are already the payload — never the wrapper.
     */
    private fun envelope(body: JsonElement): JsonElement = (body as? JsonObject)?.get("data") ?: body

    private fun <T : Any> Flow<Resource<JsonElement>>.typed(serializer: KSerializer<T>): Flow<Resource<T>> = map { it.toTyped(serializer) }

    /**
     * Maps a raw-JSON cache-then-network emission onto the typed DTO, guarding every decode. A cached
     * slot on a Loading/Error emission is decoded best-effort (a drifted cache degrades to `null`),
     * while a fresh Success that fails to decode becomes an Error so the stream survives to the next
     * refresh instead of throwing across the flow boundary.
     */
    private fun <T : Any> Resource<JsonElement>.toTyped(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(it, serializer) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(it, serializer) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { decode(data, serializer) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    private fun <T : Any> tryDecode(
        element: JsonElement,
        serializer: KSerializer<T>,
    ): T? = runCatching { decode(element, serializer) }.getOrNull()

    private fun <T : Any> decode(
        element: JsonElement,
        serializer: KSerializer<T>,
    ): T = json.decodeFromJsonElement(serializer, element)

    private companion object {
        // Per-read freshness windows, mapped verbatim from the web `STALE_TIMES` the hooks declare.
        const val TTL_QUICK = 10_000L // STALE_TIMES.QUICK — gdpr export
        const val TTL_MODERATE = 15_000L // STALE_TIMES.MODERATE — slow queries, audit log
        const val TTL_FAST = 30_000L // STALE_TIMES.FAST — audit chain verify
        const val TTL_STANDARD = 60_000L // STALE_TIMES.STANDARD — schema drift, vehicle cost, disk, secrets
        const val TTL_EXTENDED = 600_000L // STALE_TIMES.EXTENDED — audit categories, actions
    }
}
