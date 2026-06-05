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

    // The fleet-overview dashboard summary (`GET /dashboard/stats`). The web `useDashboardStats`
    // hook reads it with `STALE_TIMES.STANDARD` (60s), so the 1-minute window matches verbatim.
    // The payload is SI on the wire (`total_m` meters, `total_energy_wh` watt-hours, cost in
    // integer cents) and stays SI through the cache; display conversion is the render boundary's
    // job (S5), never this layer's. The web hook file declares no mutations, so the partition has
    // no invalidation surface.
    Dashboard("dashboard", 1.minutes),

    // The named dashboard-layout library (`GET /dashboard/layouts`), backing the LayoutSwitcher's
    // per-row presets. The web `useNamedDashboardLayouts` hook reads it with `STALE_TIMES.SLOW`
    // (5 minutes), so the window matches verbatim. Each (vehicle | global) scope is cached under
    // its own key (mirroring the web `dashboardLayoutLibraryKeys.list` tuple); a
    // create/update/delete/apply invalidates the WHOLE partition (the web hooks invalidate
    // `dashboardLayoutLibraryKeys.all`). The `layout` field is an opaque SavedDashboard JSON blob
    // round-tripped verbatim — not display-unit-bearing — so there is no SI conversion here.
    DashboardLayouts("dashboard_layouts", 5.minutes),

    // The dead-letter-queue inspector feeds (`GET /system/dlq`, `/system/dlq/{id}`,
    // `/system/dlq/audit`, `/system/dlq/{id}/audit`). The web `useDLQ` hooks read the list and
    // audit feeds with `STALE_TIMES.MODERATE` (15s) and poll them on `INTERVALS.STANDARD` (30s);
    // the stored single entry uses `STALE_TIMES.STATIC` (never stale — a DLQ row is immutable once
    // written). A single partition window cannot honour both, so the tighter 15-second bound is
    // used — the conservative choice, which only ever flags a value stale *sooner* than the web
    // would (the static entry), never later, so nothing immutable is shown fresh that the web
    // considers stale. The per-feed refetch cadence is an S8/UI concern (the web `staleTime`/
    // `refetchInterval` gate the freshness flag, not whether the cache-then-network refresh runs).
    // Payloads are DLQ rows (topics, error reasons, base64 inner payloads, replay-audit rows) — not
    // display-unit-bearing — so they round-trip verbatim with no SI conversion. The replay mutation
    // (web `useDLQReplay`) invalidates the whole `['system','dlq']` prefix, so it clears this entire
    // partition (the `invalidateQueries(['system','dlq'])` analogue).
    Dlq("dlq", 15.seconds),

    // The Exports control plane (`GET /export/jobs`, `/export/jobs/{id}`, `/exports/{id}`,
    // `/exports/columns`, `/scheduled-exports`). The web `useExports`/`useExportJobs`/
    // `useExportJob` hooks use the default TanStack `staleTime` (0 = always refetch on mount) and
    // poll the job feeds every 5s while a job is queued/processing (`refetchInterval`);
    // `useScheduledExports` polls every 60s; `useExportColumns` is a deployment-static catalog
    // (`STALE_TIME` 5 minutes). Six distinct read shapes share this partition under distinct
    // prefixed keys; a single window cannot honour every staleTime exactly, so the tightest
    // meaningful bound — the 5-second job-poll cadence — is used. That is the conservative choice:
    // it only ever flags a value stale *sooner* than the web would (the 60s scheduled / 5min
    // columns feeds), never later, so nothing is shown fresh that the web considers stale. The
    // per-feed refetch cadence is an S8/UI concern (the web `staleTime`/`refetchInterval` gate the
    // freshness flag, not whether the cache-then-network refresh runs). Payloads are export-job
    // metadata (formats, statuses, byte sizes, record counts, ms durations, cron strings) — not
    // display-unit-bearing — so they round-trip verbatim with no SI conversion. A create/account/
    // bulk-delete mutation re-fetches the `['export-jobs']` + `['exports']` prefixes and a
    // scheduled create/update/delete/run re-fetches `['scheduled-exports']` via the S8 store's
    // targeted refresh (the `invalidateQueries` analogue); the durable cache is intentionally left
    // intact so a refresh shows the last-known rows while the network reload runs.
    Exports("exports", 5.seconds),

    // The typed feature-flag registry (`GET /system/flags`, `/system/flags/{key}`,
    // `/system/flags/changes`, `/system/flags/{key}/changes`). The web `useFlags`/`useFlagChanges`
    // hooks read with `STALE_TIMES.MODERATE` (15s) and poll on `INTERVALS.STANDARD` (30s) via
    // `refetchInterval`, so the 15-second window keeps the freshness flag honest while the S8/UI
    // refetch cadence drives the actual live polling. The list, the per-key entries, and the
    // global/per-key change feeds share this partition under distinct prefixed keys
    // (`list` / `flag:{key}` / `changes:{scope}:{limit}`). Flag values are arbitrary JSON and no
    // field is unit-bearing, so payloads round-trip verbatim with no SI conversion. A sudo-gated
    // set/delete invalidates the WHOLE partition (the web hooks invalidate the `['system','flags']`
    // prefix), so a write clears the list, every entry, and every change feed at once.
    FeatureFlags("feature_flags", 15.seconds),

    // The in-app feedback widget's admin queue (`GET /admin/feedback`). The web `useFeedbackList`
    // hook reads it with the default TanStack `staleTime` (60s — `DEFAULT_QUERY_CLIENT_CONFIG`),
    // so the 1-minute window matches verbatim. Each `(status, category, limit, offset)` page is
    // cached under its own key (mirroring the web `feedbackKeys.list` tuple). The public submit
    // (`useSubmitFeedback`) invalidates nothing; the admin patch (`useUpdateFeedback`) invalidates
    // the WHOLE partition (the web hook invalidates `feedbackKeys.all`). Payloads are feedback rows
    // (free text, a status enum, timestamps, an opaque recent-errors blob) — not display-unit-
    // bearing — so they round-trip verbatim with no SI conversion.
    Feedback("feedback", 1.minutes),

    // The Fleet-Telemetry routing-coverage snapshot (`GET /tesla/fleet-telemetry/coverage`). The
    // web `useFleetTelemetryCoverage` hook reads it with `STALE_TIMES.SLOW` (5 minutes), so the
    // window matches verbatim. The single feed is a package-derived routing map built from
    // `router.LoadMap()` + `teslaconfig.Builder` (the "what's actively ingested" view), so it has
    // exactly one cache key and no parameters. Payloads are per-category destination breakdowns
    // (category names, integer field/destination counts, subscription bools) — not
    // display-unit-bearing — so they round-trip verbatim with no SI conversion. The web hook file
    // declares no mutations, so the partition has no invalidation surface.
    FleetTelemetry("fleet_telemetry", 5.minutes),

    // The FSM shadow-mode debugger feeds (`GET /fsm/stats`, `GET /fsm/transitions`). The web
    // `useFSMStats`/`useFSMTransitions` hooks declare no `staleTime` (TanStack default 0 = always
    // refetch on mount) and poll both on `INTERVALS.FAST` (10s) via `refetchInterval`, so the
    // 10-second window keeps the freshness flag honest while the S8/UI refetch cadence drives the
    // actual live polling and the cache-then-network operator always re-fetches on refresh, so no
    // stale value is ever served as fresh. The two read shapes share this partition under distinct
    // prefixed keys (`stats:{vehicleId}` / the transitions query tuple). Payloads are FSM audit rows
    // (state names, triggers, transition counts, timestamps, pagination ints) — not
    // display-unit-bearing — so they round-trip verbatim with no SI conversion. The web hook file
    // declares no mutations, so the partition has no invalidation surface.
    Fsm("fsm", 10.seconds),
    ;

    /** Default staleness threshold in whole milliseconds, for the freshness math. */
    public val defaultTtlMillis: Long get() = defaultTtl.inWholeMilliseconds
}
