package io.teslasync.shared.core.presentation.operatorconfidence

import io.teslasync.shared.core.data.repo.OPERATOR_CONFIDENCE_AUDIT_ACTIONS_KEY
import io.teslasync.shared.core.data.repo.OPERATOR_CONFIDENCE_AUDIT_CATEGORIES_KEY
import io.teslasync.shared.core.data.repo.OPERATOR_CONFIDENCE_DISK_FORECAST_KEY
import io.teslasync.shared.core.data.repo.OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY
import io.teslasync.shared.core.data.repo.OPERATOR_CONFIDENCE_SECRET_ROTATION_KEY
import io.teslasync.shared.core.data.repo.OperatorConfidenceRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.auditChainVerifyKey
import io.teslasync.shared.core.data.repo.auditLogKey
import io.teslasync.shared.core.data.repo.gdprExportKey
import io.teslasync.shared.core.data.repo.slowQueriesKey
import io.teslasync.shared.core.data.repo.vehicleCostKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Operator-Confidence admin surface — the cross-platform port of
 * the web `useOperatorConfidence` hook domain (web/src/api/hooks/useOperatorConfidence.ts). Every
 * native Operator-Confidence screen (Android/Apple via KMP, Windows via the C# port) binds to this
 * single holder rather than re-implementing the ten endpoints, their query keys, their param
 * defaults, or the audit-log query-string derivation.
 *
 * The ten reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each
 * `(feed, params)` is lazily created on first access, shared so every observer of the same params
 * folds into one upstream collection, and refreshable via the matching `refresh*` call. The domain
 * is READ-ONLY — the web hook file declares zero mutations — so the holder exposes no
 * mutation/invalidation API; the per-feed `refresh*` calls are the platform pull-to-refresh seam
 * (the web `refetchInterval`/`refetch()` analogue), and a feed nobody observes is a no-op to refresh.
 *
 * The web hooks' `staleTime`/`refetchInterval` cadence and their `enabled` lazy gates
 * (`useAuditLog(enabled)`, `useAuditChainVerify(enabled=false)` driven by an explicit re-verify
 * button, `useGDPRExport(id != null)`) are render-layer concerns and are intentionally NOT
 * reproduced here; a platform live-poll / pull-to-refresh cadence drives re-collection, and the
 * caller simply does not open a feed until it wants one. The holder makes no network calls itself —
 * it delegates entirely to the injected [OperatorConfidenceRepository] (S7). Values stay SI (the
 * control-plane carries none anyway); any display formatting is the render boundary's job (S5).
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class OperatorConfidenceStore(
    private val repo: OperatorConfidenceRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<*>>>()

    // ---- Reads (10) ---------------------------------------------------------------

    /** Shared, refreshable `GET /admin/observability/schema-drift` feed (web `useSchemaDrift`). */
    public fun schemaDrift(): StateFlow<Resource<SchemaDriftResponse>> = feed(OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY) { repo.schemaDrift() }

    /** Shared, refreshable `GET /admin/observability/slow-queries` feed (web `useSlowQueries`). */
    public fun slowQueries(
        orderBy: SlowQueryOrderBy = OperatorConfidenceRepository.DEFAULT_SLOW_QUERY_ORDER_BY,
        limit: Int = OperatorConfidenceRepository.DEFAULT_SLOW_QUERY_LIMIT,
    ): StateFlow<Resource<SlowQueriesResponse>> = feed(slowQueriesKey(orderBy, limit)) { repo.slowQueries(orderBy, limit) }

    /** Shared, refreshable `GET /admin/observability/vehicle-cost` feed (web `useVehicleCost`). */
    public fun vehicleCost(
        sinceIso: String? = null,
        limit: Int = OperatorConfidenceRepository.DEFAULT_VEHICLE_COST_LIMIT,
    ): StateFlow<Resource<VehicleCostResponse>> = feed(vehicleCostKey(sinceIso, limit)) { repo.vehicleCost(sinceIso, limit) }

    /** Shared, refreshable `GET /admin/observability/disk-forecast` feed (web `useDiskForecast`). */
    public fun diskForecast(): StateFlow<Resource<DiskForecastResponse>> =
        feed(OPERATOR_CONFIDENCE_DISK_FORECAST_KEY) { repo.diskForecast() }

    /** Shared, refreshable `GET /admin/observability/secret-rotation` feed (web `useSecretRotation`). */
    public fun secretRotation(): StateFlow<Resource<SecretRotationResponse>> =
        feed(OPERATOR_CONFIDENCE_SECRET_ROTATION_KEY) { repo.secretRotation() }

    /** Shared, refreshable `GET /admin/audit-log` feed for [params] (web `useAuditLog`). */
    public fun auditLog(params: AuditLogQueryParams = AuditLogQueryParams()): StateFlow<Resource<AuditLogListResponse>> =
        feed(auditLogKey(params)) { repo.auditLog(params) }

    /** Shared, refreshable `GET /admin/audit-log/categories` feed (web `useAuditCategories`). */
    public fun auditCategories(): StateFlow<Resource<AuditCategoriesResponse>> =
        feed(OPERATOR_CONFIDENCE_AUDIT_CATEGORIES_KEY) { repo.auditCategories() }

    /** Shared, refreshable `GET /admin/audit-log/actions` feed (web `useAuditActions`). */
    public fun auditActions(): StateFlow<Resource<AuditActionsResponse>> =
        feed(OPERATOR_CONFIDENCE_AUDIT_ACTIONS_KEY) { repo.auditActions() }

    /** Shared, refreshable `GET /admin/audit-log/verify` feed (web `useAuditChainVerify`). */
    public fun auditChainVerify(
        sinceIso: String? = null,
        limit: Int = OperatorConfidenceRepository.DEFAULT_AUDIT_VERIFY_LIMIT,
    ): StateFlow<Resource<AuditChainVerifyResponse>> = feed(auditChainVerifyKey(sinceIso, limit)) { repo.auditChainVerify(sinceIso, limit) }

    /** Shared, refreshable `GET /admin/gdpr/exports/{id}` feed (web `useGDPRExport`). */
    public fun gdprExport(id: String): StateFlow<Resource<GDPRExportArtifact>> = feed(gdprExportKey(id)) { repo.gdprExport(id) }

    // ---- Refresh ------------------------------------------------------------------

    /** Re-fetches the [schemaDrift] feed if it is being observed. */
    public fun refreshSchemaDrift(): Unit = refresh(OPERATOR_CONFIDENCE_SCHEMA_DRIFT_KEY)

    /** Re-fetches the [slowQueries] feed for the given params if it is being observed. */
    public fun refreshSlowQueries(
        orderBy: SlowQueryOrderBy = OperatorConfidenceRepository.DEFAULT_SLOW_QUERY_ORDER_BY,
        limit: Int = OperatorConfidenceRepository.DEFAULT_SLOW_QUERY_LIMIT,
    ): Unit = refresh(slowQueriesKey(orderBy, limit))

    /** Re-fetches the [vehicleCost] feed for the given params if it is being observed. */
    public fun refreshVehicleCost(
        sinceIso: String? = null,
        limit: Int = OperatorConfidenceRepository.DEFAULT_VEHICLE_COST_LIMIT,
    ): Unit = refresh(vehicleCostKey(sinceIso, limit))

    /** Re-fetches the [diskForecast] feed if it is being observed. */
    public fun refreshDiskForecast(): Unit = refresh(OPERATOR_CONFIDENCE_DISK_FORECAST_KEY)

    /** Re-fetches the [secretRotation] feed if it is being observed. */
    public fun refreshSecretRotation(): Unit = refresh(OPERATOR_CONFIDENCE_SECRET_ROTATION_KEY)

    /** Re-fetches the [auditLog] feed for [params] if it is being observed. */
    public fun refreshAuditLog(params: AuditLogQueryParams = AuditLogQueryParams()): Unit = refresh(auditLogKey(params))

    /** Re-fetches the [auditCategories] feed if it is being observed. */
    public fun refreshAuditCategories(): Unit = refresh(OPERATOR_CONFIDENCE_AUDIT_CATEGORIES_KEY)

    /** Re-fetches the [auditActions] feed if it is being observed. */
    public fun refreshAuditActions(): Unit = refresh(OPERATOR_CONFIDENCE_AUDIT_ACTIONS_KEY)

    /**
     * Re-fetches the [auditChainVerify] feed for the given params if it is being observed. This is the
     * port of the web "Re-verify" button, which triggers the otherwise-disabled `useAuditChainVerify`
     * query's `refetch()`; the platform opens the feed and drives this on the button press.
     */
    public fun refreshAuditChainVerify(
        sinceIso: String? = null,
        limit: Int = OperatorConfidenceRepository.DEFAULT_AUDIT_VERIFY_LIMIT,
    ): Unit = refresh(auditChainVerifyKey(sinceIso, limit))

    /** Re-fetches the [gdprExport] feed for [id] if it is being observed. */
    public fun refreshGdprExport(id: String): Unit = refresh(gdprExportKey(id))

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed]
     * keeps a single upstream shared across observers while at least one is active. The heterogeneous
     * [feeds] map is keyed by the same stable per-feed string as the cache, so the cast back to the
     * caller's `T` is always sound (one key ⇒ one source type).
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> feed(
        key: String,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        } as StateFlow<Resource<T>>

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<Nothing> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
