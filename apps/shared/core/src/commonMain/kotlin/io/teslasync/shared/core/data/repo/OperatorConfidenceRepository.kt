package io.teslasync.shared.core.data.repo

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

/**
 * The S7 data port for the Operator-Confidence admin surface — the cross-platform analogue of the
 * web `useOperatorConfidence` hook domain (web/src/api/hooks/useOperatorConfidence.ts), served by
 * the Go handlers under `/api/v1/admin/…`. Every native Operator-Confidence screen (Android/Apple
 * via KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a
 * single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * Every route is READ-ONLY — `useOperatorConfidence.ts` contains ten `useQuery` calls and zero
 * mutations — so each function streams a cache-then-network [Resource] (ADR-013): the cached value
 * first for an instant cold start, then the refreshed value. There is no invalidation surface
 * because there is nothing to mutate.
 *
 * Each read is cached under its own per-params key (mirroring the web `operatorConfidenceKeys`
 * tuples) so a distinct query caches independently while logout still clears the whole domain in
 * one call. Payloads are SI-agnostic control-plane data (fingerprints, counts, ms timings, ISO
 * stamps, severity/status strings) and round-trip verbatim with no conversion.
 *
 * Each web route degrades to HTTP 503 (`code: SUBSYSTEM_NOT_CONFIGURED`) when its backing repo was
 * never wired; that surfaces here as a [Resource.Error] carrying the transport [io.teslasync.shared.core.net.ApiError]
 * (whose status the platform can branch on to render an explanatory empty-state, exactly as the web
 * branches on `error.status === 503`) — never a thrown exception that would cancel the flow.
 *
 * The web hooks' `staleTime`/`refetchInterval` poll cadence and the `enabled` lazy gates
 * (`useAuditLog(enabled)`, `useAuditChainVerify(enabled=false)`, `useGDPRExport(id != null)`) are
 * render-layer concerns and are intentionally NOT reproduced at this layer; a platform
 * pull-to-refresh / live-poll cadence drives re-collection.
 */
public interface OperatorConfidenceRepository {
    /** `GET /admin/observability/schema-drift` → [SchemaDriftResponse] (web `useSchemaDrift`). */
    public fun schemaDrift(): Flow<Resource<SchemaDriftResponse>>

    /**
     * `GET /admin/observability/slow-queries?order_by={orderBy}&limit={limit}` → [SlowQueriesResponse]
     * (web `useSlowQueries`). The enum [orderBy] makes an invalid order-by token unrepresentable.
     */
    public fun slowQueries(
        orderBy: SlowQueryOrderBy = DEFAULT_SLOW_QUERY_ORDER_BY,
        limit: Int = DEFAULT_SLOW_QUERY_LIMIT,
    ): Flow<Resource<SlowQueriesResponse>>

    /**
     * `GET /admin/observability/vehicle-cost?limit={limit}[&since={sinceIso}]` → [VehicleCostResponse]
     * (web `useVehicleCost`). [sinceIso] is the ISO-8601 lower bound (the web `since.toISOString()`);
     * when `null` the param is omitted and the server defaults to the last 30 days. The platform owns
     * the `Date → ISO` formatting so this layer stays clock/locale-agnostic.
     */
    public fun vehicleCost(
        sinceIso: String? = null,
        limit: Int = DEFAULT_VEHICLE_COST_LIMIT,
    ): Flow<Resource<VehicleCostResponse>>

    /** `GET /admin/observability/disk-forecast` → [DiskForecastResponse] (web `useDiskForecast`). */
    public fun diskForecast(): Flow<Resource<DiskForecastResponse>>

    /** `GET /admin/observability/secret-rotation` → [SecretRotationResponse] (web `useSecretRotation`). */
    public fun secretRotation(): Flow<Resource<SecretRotationResponse>>

    /**
     * `GET /admin/audit-log{query}` → [AuditLogListResponse] (web `useAuditLog`). The [params] are
     * folded into the snake_case query string by [auditLogQuery] (the port of `buildAuditLogQuery`).
     */
    public fun auditLog(params: AuditLogQueryParams = AuditLogQueryParams()): Flow<Resource<AuditLogListResponse>>

    /** `GET /admin/audit-log/categories` → [AuditCategoriesResponse] (web `useAuditCategories`). */
    public fun auditCategories(): Flow<Resource<AuditCategoriesResponse>>

    /** `GET /admin/audit-log/actions` → [AuditActionsResponse] (web `useAuditActions`). */
    public fun auditActions(): Flow<Resource<AuditActionsResponse>>

    /**
     * `GET /admin/audit-log/verify?limit={limit}[&since={sinceIso}]` → [AuditChainVerifyResponse]
     * (web `useAuditChainVerify`). Re-derives the SHA-256 row-hash chain; defaults to the last 1 000
     * rows since 30 days ago. [sinceIso] is the web `since.toISOString()`; omitted when `null`.
     */
    public fun auditChainVerify(
        sinceIso: String? = null,
        limit: Int = DEFAULT_AUDIT_VERIFY_LIMIT,
    ): Flow<Resource<AuditChainVerifyResponse>>

    /** `GET /admin/gdpr/exports/{id}` → [GDPRExportArtifact] (web `useGDPRExport`). */
    public fun gdprExport(id: String): Flow<Resource<GDPRExportArtifact>>

    public companion object {
        /** The web `useSlowQueries(orderBy = 'mean_time')` default. */
        public val DEFAULT_SLOW_QUERY_ORDER_BY: SlowQueryOrderBy = SlowQueryOrderBy.MEAN_TIME

        /** The web `useSlowQueries(limit = 25)` default. */
        public const val DEFAULT_SLOW_QUERY_LIMIT: Int = 25

        /** The web `useVehicleCost(limit = 100)` default. */
        public const val DEFAULT_VEHICLE_COST_LIMIT: Int = 100

        /** The web `useAuditChainVerify(limit = 1000)` default. */
        public const val DEFAULT_AUDIT_VERIFY_LIMIT: Int = 1000
    }
}

// ---- Query builders (web param semantics) -----------------------------------------

/**
 * The `/admin/observability/slow-queries` query — the port of the web hook's
 * `?order_by=${orderBy}&limit=${limit}`. Both keys are unconditional and emitted in the web's
 * order (order_by, limit).
 */
public fun slowQueriesQuery(
    orderBy: SlowQueryOrderBy,
    limit: Int,
): Map<String, String> =
    linkedMapOf(
        "order_by" to orderBy.wire,
        "limit" to limit.toString(),
    )

/**
 * The `/admin/observability/vehicle-cost` query — the port of the web hook's
 * `?limit=${limit}${since ? '&since=' + iso : ''}`. `limit` is unconditional and emitted first;
 * `since` is appended only when [sinceIso] is non-null (mirroring the web conditional).
 */
public fun vehicleCostQuery(
    sinceIso: String?,
    limit: Int,
): Map<String, String> =
    linkedMapOf<String, String>().apply {
        put("limit", limit.toString())
        if (sinceIso != null) put("since", sinceIso)
    }

/**
 * The `/admin/audit-log/verify` query — the port of the web hook's
 * `?limit=${limit}${since ? '&since=' + iso : ''}`. `limit` is unconditional and emitted first;
 * `since` is appended only when [sinceIso] is non-null.
 */
public fun auditChainVerifyQuery(
    sinceIso: String?,
    limit: Int,
): Map<String, String> =
    linkedMapOf<String, String>().apply {
        put("limit", limit.toString())
        if (sinceIso != null) put("since", sinceIso)
    }

/**
 * The `/admin/audit-log` query — the port of the web `buildAuditLogQuery` (`URLSearchParams`). Only
 * the populated filters are emitted, in the web's insertion order
 * (since, until, categories, actors, actions, entity_type, entity_id, limit, offset). The
 * multi-value `categories`/`actors`/`actions` are comma-joined and emitted only when non-empty;
 * `since`/`until`/`entity_type` are emitted only when non-null AND non-blank (the web truthiness
 * check); `entity_id`/`limit`/`offset` are emitted whenever present.
 *
 * This is the one non-trivial derivation of the domain, pinned by language-neutral golden vectors so
 * the KMP core and the Windows C# port cannot drift (ADR-004).
 */
public fun auditLogQuery(params: AuditLogQueryParams): Map<String, String> =
    linkedMapOf<String, String>().apply {
        params.since?.takeIf { it.isNotEmpty() }?.let { put("since", it) }
        params.until?.takeIf { it.isNotEmpty() }?.let { put("until", it) }
        if (params.categories.isNotEmpty()) put("categories", params.categories.joinToString(","))
        if (params.actors.isNotEmpty()) put("actors", params.actors.joinToString(","))
        if (params.actions.isNotEmpty()) put("actions", params.actions.joinToString(","))
        params.entityType?.takeIf { it.isNotEmpty() }?.let { put("entity_type", it) }
        params.entityId?.let { put("entity_id", it.toString()) }
        params.limit?.let { put("limit", it.toString()) }
        params.offset?.let { put("offset", it.toString()) }
    }

// ---- Cache/feed keys (mirror the web TanStack query keys) --------------------------

/** The tuple separator used by every Operator-Confidence cache key. */
internal const val OPERATOR_CONFIDENCE_KEY_SEP: String = "|"

/** Cache key for [OperatorConfidenceRepository.schemaDrift] — web `operatorConfidenceKeys.schemaDrift`. */
public const val OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY: String = "schema-drift"

/** Cache key for [OperatorConfidenceRepository.diskForecast] — web `operatorConfidenceKeys.diskForecast`. */
public const val OPERATOR_CONFIDENCE_DISK_FORECAST_KEY: String = "disk-forecast"

/** Cache key for [OperatorConfidenceRepository.secretRotation] — web `operatorConfidenceKeys.secretRotation`. */
public const val OPERATOR_CONFIDENCE_SECRET_ROTATION_KEY: String = "secret-rotation"

/** Cache key for [OperatorConfidenceRepository.auditCategories] — web `operatorConfidenceKeys.auditCategories`. */
public const val OPERATOR_CONFIDENCE_AUDIT_CATEGORIES_KEY: String = "audit-categories"

/** Cache key for [OperatorConfidenceRepository.auditActions] — web `operatorConfidenceKeys.auditActions`. */
public const val OPERATOR_CONFIDENCE_AUDIT_ACTIONS_KEY: String = "audit-actions"

/** Cache key for [OperatorConfidenceRepository.slowQueries] — web `operatorConfidenceKeys.slowQueries`. */
public fun slowQueriesKey(
    orderBy: SlowQueryOrderBy,
    limit: Int,
): String =
    listOf("slow-queries", orderBy.wire, limit.toString())
        .joinToString(OPERATOR_CONFIDENCE_KEY_SEP)

/** Cache key for [OperatorConfidenceRepository.vehicleCost] — web `operatorConfidenceKeys.vehicleCost`. */
public fun vehicleCostKey(
    sinceIso: String?,
    limit: Int,
): String =
    listOf("vehicle-cost", sinceIso ?: "null", limit.toString())
        .joinToString(OPERATOR_CONFIDENCE_KEY_SEP)

/** Cache key for [OperatorConfidenceRepository.auditChainVerify] — web `operatorConfidenceKeys.auditVerify`. */
public fun auditChainVerifyKey(
    sinceIso: String?,
    limit: Int,
): String =
    listOf("audit-verify", sinceIso ?: "null", limit.toString())
        .joinToString(OPERATOR_CONFIDENCE_KEY_SEP)

/** Cache key for [OperatorConfidenceRepository.gdprExport] — web `operatorConfidenceKeys.gdprExport`. */
public fun gdprExportKey(id: String): String = listOf("gdpr-export", id).joinToString(OPERATOR_CONFIDENCE_KEY_SEP)

/**
 * Cache/feed key for [OperatorConfidenceRepository.auditLog]. The web `operatorConfidenceKeys.auditLogList`
 * tuple keys on the full params OBJECT; this port instead canonicalises on the resolved [auditLogQuery]
 * map (the exact set of emitted params, in order), so two params objects that resolve to the same HTTP
 * query — and therefore the same backend response — deliberately share one cache slot. This is a faithful
 * mirror at the URL/response level (an equivalent-empty filter change yields the identical request); a
 * platform that wants the web's "any filter edit re-collects" feel should call `refreshAuditLog(params)`
 * on apply. Audit category/action/actor tokens are controlled-vocabulary identifiers, so the `|`/`=`
 * key separators do not collide in practice.
 */
public fun auditLogKey(params: AuditLogQueryParams): String =
    buildString {
        append("audit-log")
        for ((k, v) in auditLogQuery(params)) {
            append(OPERATOR_CONFIDENCE_KEY_SEP)
            append(k)
            append('=')
            append(v)
        }
    }
