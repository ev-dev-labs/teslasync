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

    // The Vehicles hook-domain partition (web/src/api/hooks/useVehicles.ts): the enrolled-vehicle
    // list and per-vehicle detail, the last-known state, the positions track, the
    // motor/climate/security/tire/charging-telemetry/media/location/config/user-preference "latest"
    // projections, the motor history, and the Tesla Fleet-API info envelopes (mobile-enabled,
    // options, specs, subscriptions, upgrades, warranty). One partition keeps every vehicles feed
    // cached independently under a distinct per-feed key while logout still clears the whole domain
    // in one call. The web reads the list/detail/state/latest/positions feeds with the default
    // `staleTime` (0) and poll them via `refetchInterval`, so the 30-second default window keeps the
    // freshness flag honest while the S8/UI refetch cadence drives the actual live polling and
    // `cacheThenNetwork` always re-fetches on refresh; the slower info-envelope feeds carry an
    // explicit per-entry TTL override (the list FAST≈default, mobile-enabled SLOW, options/specs
    // STATIC, subscriptions/upgrades RARE, warranty DAILY) matching their web `staleTime`s. Payloads
    // are SI on the wire (ranges in meters, temps in °C, pressures in Pa) and round-trip verbatim —
    // display conversion is the render boundary's job (S5). A per-vehicle info refresh re-fetches
    // exactly the affected feed via the S8 store's targeted family refresh (the `invalidateQueries`
    // analogue).
    VehicleInfo("vehicle_info", 30.seconds),
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

    // The Sentry-Guard control plane (`GET /vehicles/{id}/guard`, `/vehicles/{id}/guard/events`).
    // The web `useGuardConfig` hook reads the config with `STALE_TIMES.REALTIME` (5s) and polls it on
    // `INTERVALS.REALTIME` (5s); `useGuardEvents` reads the events with `STALE_TIMES.QUICK` (10s). The
    // two reads share this partition under distinct prefixed keys (`config:{id}` / `events:{id}`); a
    // single window cannot honour both staleTimes exactly, so the tighter 5-second bound is used — the
    // conservative choice, which only ever flags a value stale *sooner* than the web would (the events
    // feed's 10s threshold), never later, so nothing is shown fresh that the web considers stale. The
    // per-feed refetch cadence is an S8/UI concern (the web `staleTime`/`refetchInterval` gate the
    // freshness flag, not whether the cache-then-network refresh runs). Payloads are guard config +
    // event rows (enums, ids, timestamps, opaque detail maps) — not display-unit-bearing — so they
    // round-trip verbatim with no SI conversion. The set-config/panic/acknowledge mutations re-fetch
    // the web-faithful feeds via the S8 store's targeted refresh (the `invalidateQueries` analogue);
    // the durable cache is intentionally left intact so a refresh shows the last-known value while the
    // network reload runs, and `cacheThenNetwork` always hits the network on refresh so no stale value
    // is ever served as fresh.
    Guard("guard", 5.seconds),

    // The admin impersonation feeds (`GET /admin/impersonate`, `/admin/impersonate/candidates`).
    // The web `useImpersonationStatus` hook reads the state with a 15-second `staleTime` and polls
    // it every 30s (`refetchInterval`); `useImpersonationCandidates` reads with a 30-second
    // `staleTime`. The two reads share this partition under distinct keys (`status` / `candidates`);
    // a single window cannot honour both staleTimes exactly, so the tighter 15-second bound is used —
    // the conservative choice, which only ever flags a value stale *sooner* than the web would (the
    // candidates feed's 30s threshold), never later, so nothing is shown fresh that the web considers
    // stale. The per-feed refetch cadence is an S8/UI concern (the web `staleTime`/`refetchInterval`
    // gate the freshness flag, not whether the cache-then-network refresh runs). Payloads are auth
    // metadata (mode discriminator, subject strings, RFC3339 expiry) — not display-unit-bearing — so
    // they round-trip verbatim with no SI conversion. A start/end mutation changes WHICH principal
    // every endpoint answers as, so it invalidates the WHOLE cache via `clearAll` (the data-layer
    // analogue of the web hooks' argument-less `invalidateQueries()`) and then primes this partition's
    // `status` key with the new state (the web `setQueryData` analogue).
    Impersonation("impersonation", 15.seconds),

    // The status-page incident store (`GET /status/incidents`, `/status/incidents/{id}`). The web
    // `useIncidents` hook declares no `staleTime` (TanStack default 0 = always refetch on mount) and
    // polls the list on `refetchInterval` 30s; `useIncident` reads a single incident on demand. The
    // two read shapes (list envelope, single incident) share this partition under distinct prefixed
    // keys (`list:{activeOnly}:{limit}` / `detail:{id}`); the 30-second window keeps the freshness
    // flag honest while the S8/UI refetch cadence drives the actual live polling and the
    // cache-then-network operator always re-fetches on refresh, so no stale value is ever served as
    // fresh. Payloads are incident rows (enum strings, timestamps, free text, component lists) — not
    // display-unit-bearing — so they round-trip verbatim with no SI conversion. A create/patch/
    // append-update/delete mutation invalidates the WHOLE partition (the web hooks invalidate
    // `['status-incidents']`), dropping every list AND detail query at once.
    Incidents("incidents", 30.seconds),

    // The per-vehicle Ingest X-Ray (`GET /system/ingest-xray/{vehicleID}`). The web `useIngestXRay`
    // hook reads it with `STALE_TIMES.REALTIME` (5s) and polls it on `INTERVALS.FAST` (10s) via
    // `refetchInterval` because the screen is meant to feel "live" while an operator diagnoses a
    // stalled signal pipeline, so the 5-second window matches the web `staleTime` verbatim while the
    // S8/UI refetch cadence drives the actual live polling and the cache-then-network operator always
    // re-fetches on refresh, so no stale value is ever served as fresh. Each
    // `(vehicleId, window, bucket, limit)` query is cached under its own key (mirroring the web
    // `ingestXRayKeys.detail` tuple). Payloads are diagnostic rows (signal field names, integer
    // sample counts, ISO timestamps, a value_kind enum) — not display-unit-bearing — so they
    // round-trip verbatim with no SI conversion. The web hook file declares no mutations, so the
    // partition has no invalidation surface.
    IngestXRay("ingest_xray", 5.seconds),

    // The Locations store (`GET /locations?vehicle_id=`, `GET /geofences`, `POST /geofences/bulk`).
    // The web `useLocations`/`useGeofences` hooks declare no `staleTime`, so they fall back to the
    // QueryClient default (60s, `web/src/api/queryClient.ts`); the 1-minute window matches that
    // verbatim while the S8/UI refetch cadence drives any live polling and the cache-then-network
    // operator always re-fetches on refresh, so no stale value is ever served as fresh. The two read
    // shapes (the visited-location list, the geofence list) share this partition under distinct
    // prefixed keys (`locations:{vehicleId}` / `geofences`), mirroring the web `locationKeys.all` /
    // `locationKeys.geofences` query keys, so the visited-location list and the geofence list cache
    // independently while logout still clears the whole domain in one call. Payloads are SI on the
    // wire (`total_duration_s` seconds, geofence `radius` meters, lat/long degrees) and not
    // display-converted here — formatting is the render boundary's job (S5). The single mutation
    // (`useBulkGeofencesDelete`) invalidates ONLY the geofences feed (the web hook invalidates
    // `locationKeys.geofences`, never `locationKeys.all`), so the visited-location list is left
    // untouched; the targeted refresh lives in the S8 store (the `invalidateQueries` analogue) and
    // the durable cache is left intact so a refresh shows the last-known list while the reload runs.
    Locations("locations", 1.minutes),

    // The Onboarding first-run gate (`GET /onboarding/status`). The web `useOnboardingStatus` hook
    // (web/src/api/hooks/useOnboarding.ts) declares `staleTime: 15_000`, so the 15-second window
    // matches that verbatim: long enough that mount/unmount churn does not thrash a refetch, short
    // enough that a freshly-connected Tesla token / first vehicle / first telemetry batch is picked
    // up promptly. The single read shape lives under one fixed key (`status`); the S8 store drives
    // the 30s poll cadence (web `refetchInterval`) and stops polling once `is_complete` flips true,
    // while the cache-then-network operator always re-fetches on refresh so no stale value is ever
    // served as fresh. The three anchor fields are plain booleans/counts — not unit-bearing — so
    // there is no SI conversion at this layer; the gate is read directly off `is_complete`.
    Onboarding("onboarding", 15.seconds),

    // The Operator-Confidence admin control-plane (`GET /admin/observability/*`, `/admin/audit-log*`,
    // `/admin/gdpr/exports/{id}`). The web `useOperatorConfidence` hooks read these with a spread of
    // staleTimes — STANDARD/60s (schema-drift, vehicle-cost, disk-forecast, secret-rotation),
    // MODERATE/15s (slow-queries, audit-log), EXTENDED/10min (audit categories/actions), FAST/30s
    // (audit chain verify) and QUICK/10s (gdpr export) — so no single domain window honours them all.
    // Rather than pick a lossy compromise, each read passes its own per-entity TTL through the
    // `observe(key, ttlMillis, fetch)` overload (mapping the web staleTime verbatim); this default is
    // the modal 60-second STANDARD bound used as the fallback. The reads share this partition under
    // distinct keys (mirroring the web `operatorConfidenceKeys` tuples) so each caches independently
    // while logout still clears the whole domain in one call. Every route is read-only (the hook file
    // declares zero mutations) so the partition has no invalidation surface; the S8/UI refetch cadence
    // (web `refetchInterval`) drives the actual live polling and `cacheThenNetwork` always re-fetches
    // on refresh so no stale value is ever served as fresh. Payloads are SI-agnostic control-plane data
    // (SHA fingerprints, row/byte counts, ms timings, ISO stamps, severity/status strings) and
    // round-trip verbatim with no SI conversion.
    OperatorConfidence("operator_confidence", 1.minutes),

    // The unified pin store (`GET /pinned?type=&context=`). The web `usePinned` hook reads it with
    // `STALE_TIMES.SLOW` (5 minutes), so the window matches verbatim. Each `(type, context)` bucket
    // is cached under its own key (mirroring the web `pinnedKeys.list` tuple), so a vehicle-picker
    // feed and a widget feed cache independently while logout still clears the whole domain in one
    // call. Pins are plain rows (ids, item ids, integer positions, timestamps) — not
    // display-unit-bearing — so they round-trip verbatim with no SI conversion. The mutations have
    // no cache interaction here; invalidation is the S8 store's targeted refresh (the web
    // `invalidateQueries` analogue — a toggle refreshes every feed via `pinnedKeys.all`, a reorder
    // only the no-context feed via `pinnedKeys.list(type)`), and `cacheThenNetwork` always hits the
    // network on refresh so no stale value is ever served as fresh.
    Pinned("pinned", 5.minutes),

    // The browser/Web-Push subscription surface (`GET /push/public-key`, `GET /push/subscribe`).
    // The web `usePush` hooks read these with two different staleTimes — the VAPID public key with
    // `STALE_TIMES.RARE` (1 hour, near-static install config) and the subscription list with
    // `STALE_TIMES.STANDARD` (60s) — so no single domain window honours both. Each read therefore
    // passes its own per-entity TTL through the `observe(key, ttlMillis, fetch)` overload (mapping
    // the web staleTime verbatim via PUSH_PUBLIC_KEY_TTL_MILLIS / PUSH_SUBSCRIPTIONS_TTL_MILLIS);
    // this default is the 60-second list bound used as the fallback. The two reads share this
    // partition under distinct keys (mirroring the web `pushKeys.publicKey` / `pushKeys.list`
    // tuples) so each caches independently while logout still clears the whole domain in one call.
    // The subscribe/unsubscribe mutations have no cache interaction here; invalidation is the S8
    // store's targeted refresh of the subscription feed (the web `invalidateQueries(pushKeys.list)`
    // analogue — neither mutation touches the public-key feed). Payloads are plain rows (ids,
    // endpoint URLs, opaque key strings, user-agents, ISO stamps) — not display-unit-bearing — so
    // they round-trip verbatim with no SI conversion; the public key is cached as the derived
    // `{key}` wrapper (the web `publicKey || null`, with 404/"not configured" ⇒ null).
    Push("push", 1.minutes),

    // The RBAC admin matrix (`GET /admin/rbac/matrix`). The web `useRbacMatrix` hook reads it with
    // a 30-second `staleTime` and never polls — the matrix only changes through an explicit admin
    // edit — so the 30-second window matches verbatim. The single document (roles, permissions,
    // categories, the role×permission grant map, the caller's effective grants, the caller's roles,
    // the groups-header name) is cached under one key; an open-mode `501 AUTH_MODE_OPEN` is mapped to
    // the open sentinel `{ "mode": "open" }` and cached as a successful no-op (the web 501 →
    // `{ mode: 'open' }` normalisation), never an error. Payloads are plain identity/boolean data —
    // not display-unit-bearing — so they round-trip verbatim with no SI conversion. The
    // upsert-cells mutation has no cache interaction here; invalidation is the S8 store's targeted
    // refresh (the web `invalidateQueries(rbacMatrixKeys.matrix())` analogue), and `cacheThenNetwork`
    // always hits the network on refresh so no stale value is ever served as fresh while the
    // last-known matrix stays visible during the reload.
    Rbac("rbac", 30.seconds),

    // The per-list-page saved-views library (`GET /saved-views?route=`), backing the SavedViewMenu's
    // "save this filter combo" affordance. The web `useSavedViews` hook reads it with
    // `STALE_TIMES.STANDARD` (60s), so the 1-minute window matches verbatim. Each list-page `route`
    // is cached under its own key (mirroring the web `savedViewsKeys.list(route)` tuple); a
    // create/update/delete/set-default invalidates ONLY that route's key (the web hooks invalidate
    // `savedViewsKeys.list(route)`, never the whole `all` prefix), so the data-layer eviction is the
    // single-key `removeQueries` analogue and the S8 store refreshes just that route's feed. Payloads
    // are plain rows (ids, a route string, an opaque querystring blob, boolean flags, an int sort
    // order, ISO stamps) — not display-unit-bearing — so they round-trip verbatim with no SI
    // conversion.
    SavedViews("saved_views", 1.minutes),

    // The unified entity-search read-model (`GET /search?q=`), backing the command palette and the
    // full-results search page. The web `useGlobalSearch` hook reads it with `STALE_TIMES.FAST` (30s),
    // so the 30-second window matches verbatim. Each distinct (query, types, limit) tuple is cached
    // under its own key (mirroring the web `searchKeys.global` tuple); the domain has no mutations (the
    // web hook is read-only) so there is no per-key eviction — logout clears the whole partition.
    // Payloads (titles, urls, scores, ISO stamps) are not display-unit-bearing, so they round-trip
    // verbatim with no SI conversion.
    Search("search", 30.seconds),

    // The active-session / device-management list (`GET /auth/sessions`), backing the Settings
    // sessions section. The web `useSessions` hook reads it with a 30s `staleTime`, so the
    // 30-second window matches verbatim. There is a single list feed (the web `sessionKeys.list`
    // tuple `['sessions','list']`), so the whole partition is the one cached entry; a
    // revoke-one / revoke-all-others mutation evicts that key (the web hooks invalidate
    // `sessionKeys.list`) and the S8 store refreshes the feed. The `{ mode: 'open' }` path (the
    // backend's 501 `AUTH_MODE_OPEN` sentinel) is cached as a successful no-session value exactly
    // as the web hook normalises it. Payloads are plain device rows (ids, user-agent, ip, ISO
    // stamps, a current flag) — not display-unit-bearing — so they round-trip verbatim with no SI
    // conversion.
    Sessions("sessions", 30.seconds),

    // The shareable-drive-reports surface (`GET /drives/{driveID}/shares`, `GET /share/{token}`),
    // backing the SharedDrivePage owner controls + the public read-only report. The web `useSharing`
    // hooks read these with two different staleTimes — the owner's link list with NO staleTime
    // (default 0 ⇒ always stale, refetch on every access) and the public report with
    // `STALE_TIMES.SLOW` (5 minutes) — so no single domain window honours both. Each read therefore
    // passes its own per-entity TTL through the `observe(key, ttlMillis, fetch)` overload (mapping
    // the web staleTime verbatim via SHARE_LINKS_TTL_MILLIS / SHARED_DRIVE_TTL_MILLIS); this default
    // is the 5-minute report bound used as the fallback. The two reads share this partition under
    // distinct prefixed keys (mirroring the web `sharingKeys.shares` / `sharingKeys.shared` tuples)
    // so each caches independently while logout still clears the whole domain in one call. The
    // create/revoke mutations evict ONLY the affected drive's share-link key (the web hooks
    // invalidate ONLY `sharingKeys.shares(driveId)`); the public report feed is never invalidated by
    // a mutation. Share-link rows (ids, tokens, booleans, view counts, ISO stamps) are not
    // display-unit-bearing; the public report's canonical values are SI on the wire and converted
    // only at the render boundary (S5), while the legacy v1 variant round-trips verbatim.
    Sharing("sharing", 5.minutes),

    // The Tesla/API rate-limit budget feed (`GET /system/rate-limits`), backing the Settings
    // rate-limit panel. The web `useRateLimitStatus` hook reads it with a 15s `staleTime`
    // (`RATE_LIMIT_STALE_TIME_MS`) and polls it every 30s (`RATE_LIMIT_REFETCH_INTERVAL_MS`) with
    // `refetchIntervalInBackground:false`, so the 15-second window keeps the freshness flag honest
    // while the S8/UI refetch cadence drives the actual live polling. There is a single feed (the
    // web `systemKeys.rateLimits` tuple `['system','rate-limits']`), so the whole partition is the
    // one cached entry; the web hook file declares no mutations, so the partition has no
    // invalidation surface (logout clears it). Payloads are budget rows (scope ids/labels, usage
    // counts, a window-seconds integer, a severity enum, ISO stamps) — not display-unit-bearing —
    // so they round-trip verbatim with no SI conversion.
    System("system", 15.seconds),

    // The worker job-queue feeds (`GET /system/queues` and `GET /system/queues/{worker}/jobs`),
    // backing the admin queue-health panel and its per-worker drawer. The web `useSystemQueues`
    // domain reads the status feed with a 15s `staleTime` (`QUEUE_STATUS_STALE_TIME_MS`, polled
    // every 30s) and the per-worker jobs feed with a 30s `staleTime` (`QUEUE_JOBS_STALE_TIME_MS`,
    // polled every 60s), both with `refetchIntervalInBackground:false`. The two reads live in one
    // partition under distinct keys (the web `queueKeys.status` / `queueKeys.jobs(worker)` tuples);
    // because they carry different `staleTime`s, the repository overrides the jobs feed's TTL
    // per-read rather than compromising on a single domain default — the 15s default here keeps the
    // status feed's freshness flag web-faithful. The web hook file declares no mutations, so the
    // partition has no invalidation surface (logout clears it). Payloads are counts, second-based
    // ages, and millisecond durations — not display-unit-bearing — so they round-trip verbatim with
    // no SI conversion.
    SystemQueues("system_queues", 15.seconds),

    // The raw signal-inspector / fleet-telemetry-diagnostics surface (the web `useTelemetry` hook
    // domain: `GET /signals/{id}/available|live|stats|{sig}/history|snapshot|diff`, `/signals/catalog`,
    // `/signals/observations`, `/telemetry`, `/tesla/fleet-telemetry/error-vins|errors`). The web hooks
    // read with a SPREAD of staleTimes — REALTIME/5s (live signals, observations), SLOW/5min (catalog),
    // and STANDARD/60s or the TanStack default (everything else) — so no single domain window honours
    // them all. Each read therefore passes its own per-entity TTL through the
    // `observe(key, ttlMillis, fetch)` overload (mapping the web staleTime verbatim via
    // TELEMETRY_REALTIME/SLOW/STANDARD_TTL_MILLIS); this 60-second default is the modal STANDARD bound
    // used as the fallback. The fourteen reads share this partition under distinct keys (mirroring the
    // web `telemetryKeys` tuples) so each caches independently while logout still clears the whole
    // domain in one call. Payloads are SI on the wire (signal values, ms ages, second-based uptime) and
    // are NOT display-converted here — formatting is the render boundary's job (S5). The two
    // error-refresh mutations have no cache interaction here; invalidation is the S8 store's targeted
    // re-collection of only the affected feed family (the web `invalidateQueries` analogue), and
    // `cacheThenNetwork` always hits the network on refresh so no stale value is ever served as fresh.
    Telemetry("telemetry", 1.minutes),

    // The per-user TOTP enrollment status (`GET /auth/totp`), backing the Settings two-factor
    // section. The web `useTOTPStatus` hook reads it with a 30s `staleTime`, so the 30-second
    // window matches verbatim. There is a single status feed (the web `totpKeys.status` tuple
    // `['totp','status']`), so the whole partition is the one cached entry; the enroll / verify /
    // revoke / regenerate-backup-codes mutations evict that key (the web hooks invalidate
    // `totpKeys.status`) and the S8 store refreshes the feed, while the step-up mutation
    // (`POST /auth/totp/sudo`) performs no invalidation (the web `useTOTPStepUp` declares none).
    // The `{ mode: 'open' }` path (the backend's 501 `AUTH_MODE_OPEN` sentinel) is cached as a
    // successful feature-unavailable value exactly as the web hook normalises it. Payloads are
    // booleans, counts and ISO stamps — not display-unit-bearing — so they round-trip verbatim
    // with no SI conversion.
    Totp("totp", 30.seconds),

    // The trip-log read-models (`GET /trips` list, `GET /trips/{id}` detail), backing the Trips
    // list page, the trip detail page, and the dashboard/sharing trip widgets. The web `useTrips`/
    // `useTrip` hooks declare no explicit `staleTime`, so they inherit the QueryClient default (60s,
    // web/src/api/queryClient.ts); the 1-minute window matches that verbatim. The two reads live in
    // one partition under distinct keys (the web `tripKeys` tuples: the list keyed by its params
    // object, the detail by id), so each caches independently while logout clears the whole domain in
    // one call. The list read applies `safeArray` (the web `select: safeArray`) once at the data
    // layer. The web hook file declares no mutations, so the partition has no invalidation surface
    // (the family refresh is the S8 store's targeted re-collection of the `['trips']` family, the web
    // `invalidateQueries` analogue). Payloads carry SI columns (`total_distance_m`, `total_energy_wh`,
    // `total_duration_s`) and round-trip verbatim — display conversion is the render boundary's job
    // (S5), never this layer's. The web `useTrip` 404 (the backend registers only `GET /trips`) is a
    // render-layer error-path concern and surfaces through [Resource.Error] unchanged.
    Trips("trips", 1.minutes),

    // The per-user account read-models (`GET /users/me`, `GET /users/me/activity`, and the four
    // account-level Tesla feeds `GET /tesla/user/{feature-config,region,orders,profile}`), backing
    // the Account / Settings → Profile surfaces. The web `useUser` hooks declare a SPREAD of
    // `staleTime`s — `useCurrentUser` default-0, `useMyRecentActivity` `STALE_TIMES.STANDARD` (60s),
    // `useTeslaFeatureConfig` `STALE_TIMES.EXTENDED` (10m), `useTeslaUserRegion` `STALE_TIMES.STATIC`
    // (never), `useTeslaUserOrders`/`useTeslaUserProfile` `STALE_TIMES.SLOW` (5m) — so each read
    // overrides this 5-minute domain default with its own web-faithful per-entry TTL rather than a
    // single lossy window. The six reads live in one partition under distinct keys (the web
    // `userKeys` tuples; the activity feed keyed by its params object), so each caches independently
    // while logout clears the whole domain in one call. The five mutations (`PUT /users/me` and the
    // four `POST .../refresh` actions) call the API directly and never evict the cache — the S8
    // store re-collects exactly the feed each web hook invalidates (`useUpdateUser` → the `me` feed
    // via `setQueryData`; each refresh → its matching Tesla feed via `invalidateQueries`), the web
    // keep-prior-data-during-refetch behaviour. Payloads are account identity / order / region
    // strings and ISO stamps — not display-unit-bearing telemetry — so they round-trip verbatim with
    // no SI conversion; display formatting is the render boundary's job (S5).
    User("user", 5.minutes),

    // The per-vehicle access-control read-models (`GET /vehicles/{id}/drivers`,
    // `GET /vehicles/{id}/invitations`), backing the VehicleAccess management surface. The web
    // `useVehicleDrivers` / `useVehicleInvitations` hooks both read with `STALE_TIMES.STANDARD`
    // (60s), so the 1-minute window matches both verbatim and neither read needs a per-entry TTL
    // override. The two reads live in one partition under distinct keys (the web
    // `vehicleAccessKeys.drivers` / `vehicleAccessKeys.invitations` tuples, prefixed so a shared
    // vehicleId can never collide), so each caches independently while logout still clears the whole
    // domain in one call. Each list read applies `safeArray` (the web `select: safeArray`) once at
    // the data layer. The five mutations (drivers refresh/remove, invitations refresh/create/revoke)
    // call the API directly and on success evict ONLY the affected vehicle's affected feed key — the
    // driver actions invalidate `vehicleAccessKeys.drivers(id)`, the invitation actions
    // `vehicleAccessKeys.invitations(id)`, never the sibling feed and never another vehicle — and the
    // S8 store re-collects that one feed. Payloads are identity/role/url/status strings and ISO
    // stamps — not display-unit-bearing — so they round-trip verbatim with no SI conversion.
    VehicleAccess("vehicle_access", 1.minutes),

    // The per-vehicle photo metadata read-model (`GET /vehicles/{id}/photo`), backing the hero card
    // + upload control. The web `useVehiclePhoto` hook reads with `staleTime: 60_000`, so the
    // 1-minute window matches it verbatim and the read needs no per-entry TTL override. Each
    // vehicle's meta lives under its own key (the web `vehiclePhotoKeys.detail` tuple, prefixed
    // `vehicle-photos:` so a shared partition never collides), so each caches independently while
    // logout still clears the whole domain in one call. The two mutations (upload/delete) write the
    // new meta through that key (the web `setQueryData`) and never evict — the S8 store's feed
    // refresh drives the cache-then-network refetch, the `invalidateQueries` analogue. The payload
    // is a bool + an ISO stamp + rendered-path strings — not display-unit-bearing — so it
    // round-trips verbatim with no SI conversion.
    VehiclePhoto("vehicle_photo", 1.minutes),

    // The per-vehicle resolved-settings read-model (`GET /vehicles/{id}/settings`), backing the
    // VehicleSettings tab. The web `useVehicleSettings` hook reads with `staleTime: 30_000`, so the
    // 30-second window matches it verbatim and the read needs no per-entry TTL override. Each
    // vehicle's payload lives under its own key (the web `vehicleSettingsKeys.detail` tuple, prefixed
    // `vehicle-settings:` so a shared partition never collides), so each caches independently while
    // logout still clears the whole domain in one call. The two mutations (upsert/reset) call the API
    // directly and on success evict ONLY the affected vehicle's settings key — the web
    // `invalidateQueries(vehicleSettingsKeys.detail(id))` analogue — and the S8 store re-collects
    // that one feed; the web's SECOND invalidation (`vehicleKeys.detail(id)`, because a nickname
    // override feeds the display name) is a cross-domain concern the S8 store's injected
    // vehicle-refresh hook handles. The payload is per-key { key, value, source } rows whose `value`
    // is arbitrary JSON — not display-unit-bearing — so it round-trips verbatim with no SI conversion.
    VehicleSettings("vehicle_settings", 30.seconds),

    // The VehicleSystems read-models (web/src/api/hooks/useVehicleSystems.ts): the per-vehicle
    // climate/tire-pressure/safety/media "latest" snapshots and their history lists, plus the
    // global maintenance-schedule + service-record catalogs and the per-vehicle software-update
    // list. The four "latest" reads poll `INTERVALS.STANDARD` (30s) via `refetchInterval` and the
    // history / software-update reads use the default TanStack `staleTime` (0 = refetch on mount);
    // the 30-second window keeps the freshness flag honest while the S8/UI refetch cadence drives
    // the actual live polling and `cacheThenNetwork` always re-fetches on refresh, so no stale value
    // is ever served as fresh. The global `useMaintenance`/`useServiceRecords` catalogs read with
    // `STALE_TIMES.STATIC` (never stale — deployment-static reference data); they carry an explicit
    // per-entry STATIC TTL override ([io.teslasync.shared.core.data.repo.VEHICLE_SYSTEMS_STATIC_TTL_MILLIS])
    // rather than the domain window. Every feed is cached under its own per-feed key (mirroring the
    // web `vehicleSystemsKeys` tuples) so each caches independently while logout clears the whole
    // domain in one call; the many distinct read shapes are each carried verbatim as a raw SI
    // [kotlinx.serialization.json.JsonElement] (the Driving/Analytics strategy). Payloads are SI on
    // the wire (temps in °C, pressures in Pa, ranges in meters) and round-trip verbatim — display
    // conversion is the render boundary's job (S5). The web hook file declares no mutations, so the
    // partition has no invalidation surface.
    VehicleSystems("vehicle_systems", 30.seconds),

    // The Watch read-models (web/src/api/hooks/useWatch.ts): the full `GET /watch/summary` glance
    // payload and the minimal `GET /watch/complication` projection, both optionally scoped by
    // `?vehicle_id=`. The two reads carry distinct web `staleTime`s — the summary `STALE_TIMES.MODERATE`
    // (15s) and the complication `STALE_TIMES.FAST` (30s) — so each read applies an explicit per-entry
    // TTL override ([io.teslasync.shared.core.data.repo.WATCH_SUMMARY_TTL_MILLIS] /
    // [io.teslasync.shared.core.data.repo.WATCH_COMPLICATION_TTL_MILLIS]) rather than the domain window;
    // the 15-second default below tracks the faster (summary) read. Each feed is cached under its own
    // per-feed key (mirroring the web `watchKeys` tuples) so each caches independently while logout
    // clears the whole domain in one call; the two distinct read shapes are each carried verbatim as a
    // raw [kotlinx.serialization.json.JsonElement] (the Driving/Analytics strategy). The web
    // `useWatchCommand` mutation invalidates no query on success (its `onSuccess` only raises a toast),
    // so the partition has no eviction surface. The summary's numeric fields are backend-rendered
    // (`range_km` in km, temps in °C) and round-trip verbatim — display formatting is the render
    // boundary's job (S5). The web's `X-API-Key`/`skipAuthRefresh` transport is a networking-layer
    // concern wired at the platform boundary, not a cache concern.
    Watch("watch", 15.seconds),
    ;

    /** Default staleness threshold in whole milliseconds, for the freshness math. */
    public val defaultTtlMillis: Long get() = defaultTtl.inWholeMilliseconds
}
