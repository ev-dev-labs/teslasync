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

    // The durable chart-annotation store (`GET /annotations`). The web `useChartAnnotations`
    // hook reads it with `STALE_TIMES.SLOW` (5 minutes), so the window matches verbatim.
    // Annotations are user-authored notes (title, hex colour, scope buckets, timestamps) — not
    // display-unit-bearing — so they round-trip verbatim with no SI conversion. A create/update/
    // delete invalidates the whole partition (the web hooks invalidate `annotationKeys.all`).
    Annotations("annotations", 5.minutes),

    // The per-vehicle signal-anomaly report (`GET /analytics/anomalies`). The web
    // `useAnomalies` hook reads it with `STALE_TIMES.SLOW` (5 minutes), so the window matches
    // verbatim. The payload (z-scores, baselines, raw signal values, detection counts) is SI on
    // the wire and not display-unit-bearing, so it round-trips verbatim with no SI conversion.
    // The web hook declares no mutations, so the partition has no invalidation surface.
    Anomalies("anomalies", 5.minutes),

    // The deployment auth-mode contract (`GET /system/auth-mode`). The web `useAuthMode` hook
    // reads it with a 5-minute `staleTime` (`AUTH_MODE_STALE_MS`) and never polls — the mode is
    // fixed at deployment time — so the window matches verbatim. The payload (mode, subject,
    // capability bools) is plain auth metadata, not display-unit-bearing, so it round-trips
    // verbatim with no SI conversion. The web hook file declares no mutations, so the partition
    // has no invalidation surface.
    AuthMode("auth_mode", 5.minutes),

    // The Automations control plane (`GET /automations`, `/automations/history`,
    // `/automations/{id}`, `/automations/presets`, `/automations/presets/{id}`). The web
    // `useAutomations`/`useAutomationHistory` hooks poll the live list + history on
    // `INTERVALS.STANDARD` (30s) via `refetchInterval`, so the 30-second window keeps the
    // freshness flag honest while the S8/UI refetch cadence drives the actual live polling.
    // The preset feeds use `STALE_TIMES.STATIC` on the web (they are pure, deployment-static
    // catalogs); they share this partition because they change far more slowly than the
    // window, so an occasionally-stale flag on a static catalog is harmless. Payloads are SI
    // on the wire and not display-unit-bearing, so they round-trip verbatim with no SI
    // conversion. A create/toggle/re-enable/delete/bulk/test-run mutation re-fetches the
    // web-faithful feeds via the S8 store's targeted refresh (the `invalidateQueries`
    // analogue); the durable cache is intentionally left intact so a refresh shows the
    // last-known rows while the network reload runs (TanStack keeps previous data on
    // invalidate), and `cacheThenNetwork` always hits the network on refresh so no stale
    // value is ever served as fresh.
    Automations("automations", 30.seconds),

    // The AI assistant chat store (`GET /chatbot/sessions`, `GET /chatbot/history`). The web
    // `useChatSessions`/`useChatHistory` hooks use the default TanStack `staleTime` (0 = always
    // refetch on mount) and never poll; the 30-second window keeps the freshness flag honest
    // without thrashing it while the cache-then-network operator always re-fetches on refresh, so
    // no stale value is ever served as fresh. Two distinct read shapes (session list, message
    // history) share this partition, each cached as its raw JsonElement (the verbatim-SI strategy
    // the Admin/Automations ports use) and decoded per-feed. Payloads are plain chat metadata and
    // text — not display-unit-bearing — so they round-trip verbatim with no SI conversion. A
    // rename/delete optimistically patches the cached session list (the web `setQueryData`
    // analogue) and the S8 store re-fetches it (the `invalidateQueries` analogue); a delete also
    // evicts the deleted session's history key (the web `removeQueries` analogue).
    Chat("chat", 30.seconds),

    // The per-vehicle command audit feeds (`GET /vehicles/{id}/commands/history?limit=200`,
    // `GET /vehicles/{id}/commands/latest`). The web `useCommandHistory` hook reads with
    // `STALE_TIMES.QUICK` (10s) and `useCommandLatest` with `STALE_TIMES.MODERATE` (15s). The two
    // reads share this partition under distinct prefixed keys (`history:{id}` / `latest:{id}`); a
    // single window cannot honour both staleTimes exactly, so the tighter 10-second bound is used —
    // the conservative choice, which only ever flags a value stale *sooner* than the web would (the
    // latest feed's 15s threshold), never later, so nothing is shown fresh that the web considers
    // stale. The per-feed refetch cadence is an S8/UI concern (the web `staleTime` only gates the
    // freshness flag, not whether the cache-then-network refresh runs). Payloads are command audit
    // rows (command name, params, status, error, timestamps) — not display-unit-bearing — so they
    // round-trip verbatim with no SI conversion. The web hook file declares no mutations, so the
    // partition has no invalidation surface.
    Commands("commands", 10.seconds),
    ;

    /** Default staleness threshold in whole milliseconds, for the freshness math. */
    public val defaultTtlMillis: Long get() = defaultTtl.inWholeMilliseconds
}
