package io.teslasync.shared.core.cache

import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/**
 * The cacheable read-model domains (ADR-013 scope) and their default freshness
 * window. Each domain partitions rows in the shared cache table so a single domain
 * can be invalidated independently and logout can clear everything.
 *
 * The TTL is the per-entity staleness threshold: a cached value older than
 * [defaultTtl] is flagged *stale* by the repository layer. Live-ish domains
 * (vehicle state, signals) use the backend's 2-minute cross-pod contract; slower
 * read-models use longer windows so the UI does not thrash a freshness badge.
 *
 * @property key the stable, persisted discriminator written to the `domain` column.
 *   It MUST NOT change once data exists, or previously cached rows become orphaned.
 * @property defaultTtl the default staleness threshold for values in this domain.
 */
public enum class CacheDomain(
    public val key: String,
    public val defaultTtl: Duration,
) {
    Vehicles("vehicles", 5.minutes),
    VehicleState("vehicle_state", 2.minutes),
    Drives("drives", 5.minutes),
    Charging("charging", 5.minutes),
    Energy("energy", 5.minutes),
    Analytics("analytics", 10.minutes),
    Notifications("notifications", 1.minutes),
    Signals("signals", 2.minutes),

    // Admin/operational read-models (api keys, logs, backups, health, audit, …). These
    // are control-plane feeds the web polls on short intervals; the 1-minute window keeps
    // the freshness flag honest while their UI-side refetch cadence (an S8/UI concern,
    // mirroring the web `refetchInterval`) drives the actual live polling.
    Admin("admin", 1.minutes),

    // The single-document app settings read-model (`GET /settings`). The AI-settings save
    // path (web `useSaveAiSettings`) reads this cached document, shallow-merges its AI patch
    // on top, and re-submits the whole thing because `/settings` is full-replace; on success
    // it invalidates this key so the next read re-fetches. The 5-minute window matches the
    // other slow-moving read-models — settings change rarely and via explicit user action.
    Settings("settings", 5.minutes),

    // The AI-usage audit feeds (`GET /ai/usage/today|by-feature|recent`). The web hooks poll
    // these on `INTERVALS.STANDARD` (30s) via `refetchInterval`; the 30-second window keeps the
    // freshness flag honest while the S8/UI refetch cadence drives the actual live polling. The
    // payloads are token counts / micro-cents / millisecond latencies — not display-unit-bearing,
    // so they round-trip verbatim with no SI conversion.
    AiUsage("ai_usage", 30.seconds),

    // The Alert Studio message-template helper catalogs: the preset gallery
    // (`/alerts/message-presets`) and the autocomplete field catalog. The web hooks treat these
    // as pure functions of their inputs (no per-user state) and read them with
    // `STALE_TIMES.EXTENDED` (10 minutes), so the window matches verbatim. The
    // `POST /alerts/message-preview` render is a mutation with no cache interaction, so it does
    // not participate in this domain. Payloads (preset templates, catalog entries, preview
    // title/body) are plain strings — not display-unit-bearing — so they round-trip verbatim
    // with no SI conversion.
    AlertMessages("alert_messages", 10.minutes),
    ;

    /** Default staleness threshold in whole milliseconds, for the freshness math. */
    public val defaultTtlMillis: Long get() = defaultTtl.inWholeMilliseconds
}
