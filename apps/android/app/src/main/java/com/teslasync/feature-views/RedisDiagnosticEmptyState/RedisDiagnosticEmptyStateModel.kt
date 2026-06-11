// Pure, framework-free model + projection for the RedisDiagnosticEmptyState feature view — the native
// analogue of every render branch the web component selects between before returning JSX
// (web/src/features/admin/components/RedisDiagnosticEmptyState.tsx). No Compose, no Android, no HTTP:
// every declaration here is exercised off-device in the :app:testReleaseUnitTest gate, so the composable
// stays a thin render layer over the pure [RedisDiagnosticProjection].
//
// The web component branches on a `meta` block plus an upstream error, in a strict precedence order:
// the four error shapes win first (a backend outage is never disguised as an empty cache), then the
// pre-meta fallback, then the four meta-driven root-cause branches. This file reproduces that ladder
// exactly and derives the tone + glyph each branch maps to, leaving only i18n string resolution and the
// date-format boundary to the Compose layer.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/RedisDiagnosticEmptyState — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package identifier, so the package intentionally diverges from the path.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.redisdiagnosticemptystate

import io.teslasync.shared.core.diagnostics.Logger
import java.time.OffsetDateTime

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, vehicle id,
 * or error payload, so a diagnostics line can never leak the fleet's posture.
 */
const val REDIS_DIAGNOSTIC_EMPTY_STATE_SLUG: String = "RedisDiagnosticEmptyState"

/** The web `otherKeys.slice(0, 6)` chip cap for the "other vehicles with cached signals" section. */
const val MAX_OTHER_VEHICLE_CHIPS: Int = 6

/** Status codes the web treats as "Redis configured but unreachable" (web `502 || 503 || 504`). */
private val UNREACHABLE_STATUSES = setOf(502, 503, 504)

/** The web `serverError.status === 503` check for the cache-not-wired branch. */
private const val CACHE_NOT_WIRED_STATUS = 503

/** The web `SEVEN_DAYS_MS` Redis TTL window used by the no-telemetry branch. */
private const val SEVEN_DAYS_MS = 7L * 24 * 60 * 60 * 1000

/** Live-store mode values from `meta.live_signal_store_mode` (web `'hybrid' | 'local'`). */
private const val HYBRID_MODE = "hybrid"
private const val LOCAL_MODE = "local"

/**
 * The `meta` block returned by `GET /api/v1/dev-tools/redis-signals` — the native mirror of the web
 * `RedisSignalsMeta`. Field names are camelCased; the web JSON snake_case origin is noted per field.
 * A host state holder (P1/S8) decodes the API document into this shape and hands it to the view.
 */
data class RedisSignalsMeta(
    /** web `live_signal_store_mode`: `hybrid` (L1+L2) or `local` (L1 only). */
    val liveSignalStoreMode: String,
    /** web `redis_key`: the `vehicle:{id}:signals` HSET key. */
    val redisKey: String,
    /** web `redis_field_count`: raw L2 field count. */
    val redisFieldCount: Int,
    /** web `l1_signal_count`: in-process L1 signal count. */
    val l1SignalCount: Int,
    /** web `l1_last_seen_at`: ISO-8601 instant of the newest L1 entry, or null. */
    val l1LastSeenAt: String?,
    /** web `l2_last_seen_at`: ISO-8601 instant of the newest L2 entry, or null. */
    val l2LastSeenAt: String?,
    /** web `vehicle_vin`: the vehicle VIN (may be blank). */
    val vehicleVin: String,
)

/**
 * One entry from `GET /api/v1/dev-tools/redis-signals/keys` — the native mirror of the web
 * `RedisSignalKeyEntry`. Powers the "other vehicles with cached signals" chips.
 */
data class RedisSignalKeyEntry(
    /** web `vehicle_id`. */
    val vehicleId: Int,
    /** web `field_count`: cached L2 field count for that vehicle. */
    val fieldCount: Int,
    /** web `vehicle_vin` (optional). */
    val vehicleVin: String? = null,
    /** web `display_name` (optional). */
    val displayName: String? = null,
)

/**
 * The upstream request outcome — the native, non-nullable encoding of the web discriminated union
 * (`{ no error } | { serverError: ApiError } | { serverError: null, networkError: true }`). Making the
 * three shapes a sealed type means the illegal "server error AND network error" combination the web
 * rejects at the call site is simply unrepresentable here.
 */
sealed interface DiagnosticError {
    /** The request succeeded (web both undefined / false). */
    data object None : DiagnosticError

    /** The server replied with a typed error (web `serverError: ApiError`). */
    data class Server(
        val status: Int,
        val message: String,
    ) : DiagnosticError

    /** The fetch threw before the server replied (web `networkError: true`). */
    data object Network : DiagnosticError
}

/** Banner accent tone — the native mirror of the web `tone` prop (`danger|warning|info|neutral`). */
enum class DiagnosticTone { Danger, Warning, Info, Neutral }

/**
 * The leading glyph each branch shows — the native analogue of the web lucide icons (ServerCrash,
 * AlertTriangle, Database, Zap, Radio). The composable maps each to a concrete vector.
 */
enum class DiagnosticGlyph { ServerCrash, AlertTriangle, Database, Zap, Radio }

/**
 * The nine mutually-exclusive root-cause branches the web component selects between. Each maps to one
 * actionable banner so an operator sees a specific next step instead of a black box.
 */
enum class DiagnosticKind {
    /** 503 + "not available": Redis wiring missing on the API server. */
    CacheNotWired,

    /** 5xx + "unreachable"/"upstream": Redis configured but the connection failed. */
    Unreachable,

    /** Any other typed API error: generic request failure showing status + message. */
    RequestFailed,

    /** Network-layer failure: the fetch threw before the server replied. */
    NetworkError,

    /** mode=local: L2 writes are disabled, so this Redis-only page cannot show data. */
    ModeLocal,

    /** hybrid + L1 has data + L2 empty: the async mirror goroutine is failing. */
    MirrorBroken,

    /** hybrid + both empty + L1 stale-or-absent: TTL expired or the vehicle never streamed. */
    NoTelemetry,

    /** hybrid + both empty + recent L1 absence: the rare post-TTL fall-through. */
    Empty,
}

/**
 * The resolved render state — either the pre-meta [LegacyEmpty] generic message, or a structured
 * [Banner]. Pure data so the branch selection is unit-tested without a UI host.
 */
sealed interface RedisDiagnosticState {
    /**
     * The backend exposed no `meta` block (pre-meta rollback). The web falls back to the legacy
     * generic "No signals cached" empty state with the Database icon.
     */
    data object LegacyEmpty : RedisDiagnosticState

    /**
     * A structured diagnostic banner. [meta] is rendered as the meta list whenever non-null (the web
     * passes `meta={meta}` on every branch). [otherKeys] is the already-filtered "other vehicles"
     * list, populated only on the meta-driven branches (web passes it to mirror/no-telemetry/empty).
     * [requestStatus]/[requestMessage] carry the [DiagnosticKind.RequestFailed] interpolation args.
     */
    data class Banner(
        val kind: DiagnosticKind,
        val meta: RedisSignalsMeta?,
        val otherKeys: List<RedisSignalKeyEntry> = emptyList(),
        val requestStatus: Int? = null,
        val requestMessage: String? = null,
    ) : RedisDiagnosticState
}

/**
 * Pure projection from the component's inputs to its [RedisDiagnosticState] — a 1:1 port of the web
 * component's error-precedence-then-meta `if` ladder, plus the tone/glyph each branch maps to and the
 * "other vehicles" filter. Side-effect-free, so every branch is verified off-device.
 */
object RedisDiagnosticProjection {
    /**
     * Select the render state in the web's exact precedence order: the four [DiagnosticError] shapes
     * win first, then the pre-meta fallback, then the four meta-driven branches.
     *
     * @param vehicleId the active vehicle (its own key is filtered out of the "other vehicles" chips).
     * @param meta the `meta` block, or null when the backend does not expose it yet.
     * @param error the upstream request outcome (takes precedence over every meta branch).
     * @param otherVehicleKeys the raw `/keys` list supplied by the host state holder (P1/S8).
     * @param keysUnavailable true when the keys query errored or has not resolved (web hides chips).
     * @param nowMs the wall clock used for the 7-day TTL check; injectable for tests.
     *
     * The six inputs are a 1:1 mirror of the web component's props that select the branch; bundling them
     * into a holder would only move the count onto a data-class constructor (also flagged), so the
     * parameter-list threshold is suppressed rather than worked around.
     */
    @Suppress("LongParameterList")
    fun project(
        vehicleId: Int,
        meta: RedisSignalsMeta?,
        error: DiagnosticError,
        otherVehicleKeys: List<RedisSignalKeyEntry>,
        keysUnavailable: Boolean,
        nowMs: Long,
    ): RedisDiagnosticState =
        errorBanner(error, meta)
            ?: if (meta == null) {
                RedisDiagnosticState.LegacyEmpty
            } else {
                metaBanner(vehicleId, meta, otherVehicleKeys, keysUnavailable, nowMs)
            }

    /** The banner accent for [kind] — web per-branch `tone`. */
    fun toneFor(kind: DiagnosticKind): DiagnosticTone =
        when (kind) {
            DiagnosticKind.CacheNotWired, DiagnosticKind.Unreachable, DiagnosticKind.ModeLocal -> DiagnosticTone.Danger
            DiagnosticKind.RequestFailed, DiagnosticKind.NetworkError, DiagnosticKind.MirrorBroken -> DiagnosticTone.Warning
            DiagnosticKind.NoTelemetry -> DiagnosticTone.Info
            DiagnosticKind.Empty -> DiagnosticTone.Neutral
        }

    /** The leading glyph for [kind] — web per-branch lucide icon. */
    fun glyphFor(kind: DiagnosticKind): DiagnosticGlyph =
        when (kind) {
            DiagnosticKind.CacheNotWired, DiagnosticKind.Unreachable, DiagnosticKind.ModeLocal -> DiagnosticGlyph.ServerCrash
            DiagnosticKind.RequestFailed, DiagnosticKind.NetworkError, DiagnosticKind.MirrorBroken -> DiagnosticGlyph.AlertTriangle
            DiagnosticKind.NoTelemetry -> DiagnosticGlyph.Zap
            DiagnosticKind.Empty -> DiagnosticGlyph.Radio
        }

    /**
     * The "other vehicles with cached signals" list — web
     * `keysQueryError ? [] : keysData?.keys.filter(k => k.vehicle_id !== vehicleId && k.field_count > 0)`.
     * Self and zero-field vehicles are dropped; the chip cap is applied at the render boundary.
     */
    fun otherKeys(
        vehicleId: Int,
        keys: List<RedisSignalKeyEntry>,
        keysUnavailable: Boolean,
    ): List<RedisSignalKeyEntry> =
        if (keysUnavailable) {
            emptyList()
        } else {
            keys.filter { it.vehicleId != vehicleId && it.fieldCount > 0 }
        }

    /**
     * True when the 7-day Redis TTL has likely expired — web
     * `!lastSeenL1 || Date.now() - lastSeenL1.getTime() > SEVEN_DAYS_MS`. An absent or unparseable
     * last-seen instant counts as suspected (the web treats a missing date as "never streamed").
     */
    fun ttlSuspected(
        l1LastSeenAt: String?,
        nowMs: Long,
    ): Boolean {
        val lastSeen = parseEpochMillis(l1LastSeenAt) ?: return true
        return nowMs - lastSeen > SEVEN_DAYS_MS
    }

    /** True when the live store is in hybrid (L1+L2) mode — web `=== 'hybrid'` meta-list badge gate. */
    fun isHybridMode(mode: String): Boolean = mode == HYBRID_MODE

    private fun errorBanner(
        error: DiagnosticError,
        meta: RedisSignalsMeta?,
    ): RedisDiagnosticState.Banner? =
        when (error) {
            is DiagnosticError.Server -> serverBanner(error, meta)
            DiagnosticError.Network -> RedisDiagnosticState.Banner(DiagnosticKind.NetworkError, meta)
            DiagnosticError.None -> null
        }

    private fun serverBanner(
        error: DiagnosticError.Server,
        meta: RedisSignalsMeta?,
    ): RedisDiagnosticState.Banner =
        when {
            error.status == CACHE_NOT_WIRED_STATUS && error.message.contains("not available", ignoreCase = true) ->
                RedisDiagnosticState.Banner(DiagnosticKind.CacheNotWired, meta)
            error.status in UNREACHABLE_STATUSES && isUnreachableMessage(error.message) ->
                RedisDiagnosticState.Banner(DiagnosticKind.Unreachable, meta)
            else ->
                RedisDiagnosticState.Banner(
                    kind = DiagnosticKind.RequestFailed,
                    meta = meta,
                    requestStatus = error.status,
                    requestMessage = error.message,
                )
        }

    private fun isUnreachableMessage(message: String): Boolean =
        message.contains("unreachable", ignoreCase = true) || message.contains("upstream", ignoreCase = true)

    private fun metaBanner(
        vehicleId: Int,
        meta: RedisSignalsMeta,
        keys: List<RedisSignalKeyEntry>,
        keysUnavailable: Boolean,
        nowMs: Long,
    ): RedisDiagnosticState.Banner {
        val others = otherKeys(vehicleId, keys, keysUnavailable)
        return when {
            meta.liveSignalStoreMode == LOCAL_MODE ->
                RedisDiagnosticState.Banner(DiagnosticKind.ModeLocal, meta)
            meta.l1SignalCount > 0 && meta.redisFieldCount == 0 ->
                RedisDiagnosticState.Banner(DiagnosticKind.MirrorBroken, meta, others)
            meta.l1SignalCount == 0 && ttlSuspected(meta.l1LastSeenAt, nowMs) ->
                RedisDiagnosticState.Banner(DiagnosticKind.NoTelemetry, meta, others)
            else ->
                RedisDiagnosticState.Banner(DiagnosticKind.Empty, meta, others)
        }
    }

    private fun parseEpochMillis(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        return runCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }.getOrNull()
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [REDIS_DIAGNOSTIC_EMPTY_STATE_SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls
 * it from its first-composition effect.
 */
fun recordRedisDiagnosticEmptyStateOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to REDIS_DIAGNOSTIC_EMPTY_STATE_SLUG))
}
