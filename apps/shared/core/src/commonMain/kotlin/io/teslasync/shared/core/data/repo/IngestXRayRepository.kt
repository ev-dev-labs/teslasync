package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.ingestxray.IngestXRayBucket
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayResponse
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayWindow
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the Ingest X-Ray domain — the cross-platform analogue of the web
 * `useIngestXRay` hook (web/src/api/hooks/useIngestXRay.ts), served by the Go `IngestXRayHandler`
 * at `GET /system/ingest-xray/{vehicleID}`. Every native X-Ray surface (Android/Apple via KMP,
 * Windows via the C# port) reaches the backend exclusively through this interface, so a single
 * fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The domain is a single read — `useIngestXRay.ts` contains exactly one `useQuery` and no mutations
 * — so [xray] streams a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. Each `(vehicleId, window, bucket, limit)` query is
 * cached under its own key ([ingestXRayKey], mirroring the web `ingestXRayKeys.detail` tuple). There
 * is nothing to invalidate here.
 *
 * The payload is diagnostic data (signal field names, integer sample counts, ISO timestamps, a
 * `value_kind` enum) — not display-unit-bearing — so it round-trips verbatim with no SI conversion.
 *
 * The web hook's `staleTime`/`refetchInterval` poll cadence and its `enabled: numericId > 0` lazy
 * gate are render-layer concerns and are intentionally NOT reproduced at this layer; a platform
 * pull-to-refresh / live-poll cadence drives re-collection.
 */
public interface IngestXRayRepository {
    /**
     * `GET /system/ingest-xray/{vehicleId}?window={window}&bucket={bucket}&limit={limit}` — the
     * per-vehicle X-Ray (web `useIngestXRay`). The server validates the window/bucket tokens; the
     * enum params make an invalid token unrepresentable here. Cached under [ingestXRayKey].
     */
    public fun xray(
        vehicleId: Long,
        window: IngestXRayWindow = DEFAULT_WINDOW,
        bucket: IngestXRayBucket = DEFAULT_BUCKET,
        limit: Int = DEFAULT_LIMIT,
    ): Flow<Resource<IngestXRayResponse>>

    public companion object {
        /** The web `useIngestXRay({ window = '1h' })` default. */
        public val DEFAULT_WINDOW: IngestXRayWindow = IngestXRayWindow.W1H

        /** The web `useIngestXRay({ bucket = '1m' })` default. */
        public val DEFAULT_BUCKET: IngestXRayBucket = IngestXRayBucket.B1M

        /** The web `useIngestXRay({ limit = PAGINATION.DEFAULT_LIMIT })` default (50). */
        public const val DEFAULT_LIMIT: Int = 50
    }
}

// ---- Query builder (web param semantics) ------------------------------------------

/**
 * The `/system/ingest-xray/{id}` query — the port of the web `URLSearchParams({ window, bucket,
 * limit })` in `useIngestXRay`. All three keys are unconditional and emitted in the web's insertion
 * order (window, bucket, limit). Locked by the contract test shared with the C# port.
 */
public fun ingestXRayQuery(
    window: IngestXRayWindow,
    bucket: IngestXRayBucket,
    limit: Int,
): Map<String, String> =
    linkedMapOf(
        "window" to window.wire,
        "bucket" to bucket.wire,
        "limit" to limit.toString(),
    )

// ---- Cache/feed key (mirrors the web TanStack query key) --------------------------

/** The tuple separator used by every Ingest X-Ray cache key. */
internal const val INGEST_XRAY_KEY_SEP: String = "|"

/**
 * Cache/feed key for [IngestXRayRepository.xray] — the web `ingestXRayKeys.detail(vid, window,
 * bucket, limit)` tuple (`['system', 'ingest-xray', vid, window, bucket, limit]`). Distinct param
 * tuples cache independently; the same tuple folds into one shared feed.
 */
public fun ingestXRayKey(
    vehicleId: Long,
    window: IngestXRayWindow,
    bucket: IngestXRayBucket,
    limit: Int,
): String =
    listOf(
        "ingest-xray",
        vehicleId.toString(),
        window.wire,
        bucket.wire,
        limit.toString(),
    ).joinToString(INGEST_XRAY_KEY_SEP)
