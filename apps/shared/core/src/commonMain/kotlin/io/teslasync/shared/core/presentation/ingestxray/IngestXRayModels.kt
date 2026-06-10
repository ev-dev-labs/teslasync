package io.teslasync.shared.core.presentation.ingestxray

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The wire shapes + derivations of the per-vehicle Ingest X-Ray — the cross-platform port of the
 * web `useIngestXRay` hook domain (web/src/api/hooks/useIngestXRay.ts and
 * web/src/types/admin-diagnostics.ts), served by the Go `IngestXRayHandler`
 * (internal/api/ingest_xray_handler.go) at `GET /api/v1/system/ingest-xray/{vehicleID}`.
 *
 * None of these fields is unit-bearing — they are signal field names, integer sample counts, ISO
 * timestamps and a `value_kind` enum — so every value round-trips verbatim with no SI conversion;
 * the X-Ray is already SI-agnostic. Keys arrive snake_case and are matched verbatim via @SerialName
 * so the cached payload round-trips unchanged.
 */

/**
 * The rolling time window the X-Ray summarizes — the port of the web `IngestXRayWindow` string
 * union. The server validates `window` ∈ {5m, 15m, 1h, 6h, 24h} and rejects anything else with
 * 400; modelling it as an enum makes the same invalid values unrepresentable on the native side.
 * The [wire] value is the exact query-string token the web `URLSearchParams({ window })` sends.
 */
public enum class IngestXRayWindow(
    public val wire: String,
) {
    W5M("5m"),
    W15M("15m"),
    W1H("1h"),
    W6H("6h"),
    W24H("24h"),
}

/**
 * The sample-count bucket size for the sparkline series — the port of the web `IngestXRayBucket`
 * string union. The server validates `bucket` ∈ {30s, 1m, 5m, 15m, 1h} (and rejects bucket >=
 * window) and 400s anything else; the enum makes those invalid tokens unrepresentable. The [wire]
 * value is the exact query-string token the web `URLSearchParams({ bucket })` sends.
 */
public enum class IngestXRayBucket(
    public val wire: String,
) {
    B30S("30s"),
    B1M("1m"),
    B5M("5m"),
    B15M("15m"),
    B1H("1h"),
}

/**
 * One signal `field`'s arrival stats within the window (web `IngestXRayFieldStat`): how many
 * [sampleCount] samples arrived, the [lastSeenAt] ISO-8601 timestamp of the most recent one, and
 * the observed [valueKind] (the integer `protomodel.ValueKind`, rendered via
 * [IngestXRayValueKinds.format]).
 */
@Serializable
public data class IngestXRayFieldStat(
    val field: String = "",
    @SerialName("sample_count") val sampleCount: Long = 0,
    @SerialName("last_seen_at") val lastSeenAt: String = "",
    @SerialName("value_kind") val valueKind: Int = 0,
)

/**
 * One point in the bucketed sample-count time-series (web `IngestXRayBucketPoint`): the
 * [bucketStart] ISO-8601 bucket boundary and the [count] of samples in it.
 */
@Serializable
public data class IngestXRayBucketPoint(
    @SerialName("bucket_start") val bucketStart: String = "",
    val count: Long = 0,
)

/**
 * The full Ingest X-Ray for one vehicle over one window (web `IngestXRayResponse`): the echoed
 * [vehicleId]/[window]/[bucket] request context, the [generatedAt] stamp, the [totalSamples] and
 * [uniqueFields] roll-ups, the per-field [fields] stats, and the [buckets] sparkline series.
 *
 * [window]/[bucket] are carried as the raw echoed strings (not the request enums) so an unexpected
 * server value round-trips verbatim instead of failing the decode — the X-Ray is a diagnostic
 * screen and must never blank out because the server added a window token the client predates.
 */
@Serializable
public data class IngestXRayResponse(
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    val window: String = "",
    val bucket: String = "",
    @SerialName("generated_at") val generatedAt: String = "",
    @SerialName("total_samples") val totalSamples: Long = 0,
    @SerialName("unique_fields") val uniqueFields: Long = 0,
    val fields: List<IngestXRayFieldStat> = emptyList(),
    val buckets: List<IngestXRayBucketPoint> = emptyList(),
)

/**
 * The lone client-side derivation of the Ingest X-Ray domain — the port of the web
 * `formatValueKind` helper (web/src/api/hooks/useIngestXRay.ts). Mirrors `protomodel.ValueKind` in
 * the Go ingest path: a known kind maps to its label, and anything outside the map renders as
 * `kind {n}` so an operator can still cross-reference the raw enum without a UI patch.
 *
 * Extracted as a pure, side-effect-free function so the KMP state holder, its golden vectors, and
 * the future Windows C# port all label identically (ADR-004) and can never drift — the same fixture
 * (apps/shared/core/spec/ingest-xray-value-kind-golden.json) pins both ports.
 */
public object IngestXRayValueKinds {
    /** Human-readable label for a `value_kind` integer — verbatim with the web `formatValueKind`. */
    public fun format(kind: Int): String =
        when (kind) {
            0 -> "unknown"
            1 -> "string"
            2 -> "bool"
            3 -> "int32"
            4 -> "int64"
            5 -> "float32"
            6 -> "float64"
            7 -> "enum"
            8 -> "invalid"
            9 -> "time"
            10 -> "location"
            else -> "kind $kind"
        }
}
