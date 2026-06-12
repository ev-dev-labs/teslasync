// The pure, framework-free model + projection for the AIFeatureToggleList settings feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/settings/components/AIFeatureToggleList.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is purely presentational and prop-driven: it takes `values: Record<AiFeatureId, boolean>`
// + `onToggle`, then maps over `AI_FEATURE_IDS` from the generated registry `@/ai/features` (the TS mirror of
// internal/ai/features/registry.go) and renders one toggle row per feature — a legend (Subhead), then for each
// feature a label + description (Caption) + a Toggle. Each row's copy is resolved with
// `t('ai.settings.feature.<id>.label', meta.name)` / `t('ai.settings.feature.<id>.description', meta.description)`:
// the i18n catalog wins, and the generated registry's name/description is the fallback that keeps a
// newly-added feature self-describing before its translations land.
//
// There is no native AI-feature registry (the shared component-library / KMP bundle that would host one is out
// of this surface's scope and allowed-files), so [AI_FEATURE_REGISTRY] below is the faithful, verbatim mirror
// of `@/ai/features` (`AI_FEATURE_IDS` order + each `AI_FEATURES[id]` name/description), carrying exactly the
// fields this surface renders (id + the two i18n fallbacks) plus the AI-off invariant flag (`defaultOn`, all
// false — ADR-015). It is generated from the same TS source, so the two cannot silently drift.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AIFeatureToggleList — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.aifeaturetogglelist

import io.teslasync.shared.core.diagnostics.Logger

/**
 * One AI feature, mirroring the slice of the web `AiFeatureMeta` (`@/ai/features`) that the toggle list
 * renders: the canonical [id], plus the [name] / [description] the web uses as the `t(key, fallback)` defaults.
 * [defaultOn] mirrors the registry's per-feature default — every shipped feature is opt-in (`false`), the
 * AI-off contract (ADR-015) the legend states ("all default off"); it is asserted by the off-device test.
 *
 * @property id the canonical feature id (web `AiFeatureId`), e.g. `ai-provider-health`.
 * @property name the registry display name — the label fallback when the catalog has no `*.label` entry.
 * @property description the registry description — the description fallback when the catalog has no entry.
 * @property defaultOn whether the feature ships enabled; always `false` (ADR-015 AI-off contract).
 */
data class AiFeatureMeta(
    val id: String,
    val name: String,
    val description: String,
    val defaultOn: Boolean,
)

/**
 * The canonical AI feature registry — the verbatim native mirror of the generated web registry `@/ai/features`
 * (`AI_FEATURE_IDS` order + `AI_FEATURES` metadata), the single source the web AIFeatureToggleList maps over.
 * The toggle list renders rows in exactly this order.
 */
internal val AI_FEATURE_REGISTRY: List<AiFeatureMeta> =
    listOf(
        AiFeatureMeta(
            id = "__redaction_bypass__",
            name = "AI Redaction Bypass Report",
            description = "Per-(feature, provider) bypass summary from F8 redact decorator. Gates on ai_mode != 'off' only.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "__usage__",
            name = "AI Usage Card",
            description = "Per-call audit log + spend visualisation for the AI provider chain. Gates on ai_mode != 'off' only.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "ai-provider-health",
            name = "AI Provider Health (ops)",
            description =
                "Diagnostic endpoint that reports the active AI provider and its capabilities. Off by default; " +
                    "enable only for ops debugging.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "alert-tuning-suggestions",
            name = "Alert tuning suggestions",
            description =
                "Opt-in LLM that proposes a lower-noise typed AlertRule patch for an existing rule based on the " +
                    "rule's recent firing history (sourced from notification_logs). The assistant calls " +
                    "draft_alert_rule_patch to compute a descriptive replay of the recent firing window through the " +
                    "proposed threshold + cooldown, then validate_alert_rule to confirm the merged proposal is " +
                    "byte-equivalent to a draft accepted by the canonical PUT /api/v1/alerts/rules/{id} handler. The " +
                    "narration explicitly surfaces that the projected post-patch firing count is a DESCRIPTIVE " +
                    "estimate from the recent firing window — NOT a forecast — and refuses to propose suspending, " +
                    "disabling, deleting, or loosening severity. The user reviews the typed patch in the Alert Studio " +
                    "UI and clicks Save to apply. The deterministic Alert Studio (manual threshold tuning + the " +
                    "existing alert analytics dashboard) remains the canonical baseline when AI is off. Per-feature " +
                    "redaction policy denies every PII class — alert IDs, signal names, and thresholds flow through " +
                    "the typed F4 tool envelope, not through prompt prose.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "anomaly-explanations",
            name = "Anomaly explanation narration",
            description =
                "Opt-in LLM narration that explains already-detected anomalies in plain language. The " +
                    "deterministic detector and safe-range explanations remain the baseline when AI is off.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "auto-name-unnamed-locations",
            name = "Auto-name unnamed locations",
            description =
                "Opt-in LLM-assisted location-name proposals grounded in the visited-location's visit pattern " +
                    "(current address_name, visit_count, total_duration_s, last_visited). Propose-only: the AI " +
                    "produces a structured proposal via two typed read-only tools (draft_location_name then " +
                    "validate_location_name) and the user explicitly confirms or edits before saving through the " +
                    "existing baseline geofence-create / location-rename path. The deterministic visited-location " +
                    "stat cards, frequency bar charts, and existing list rendered by LocationsPage at /locations " +
                    "remain the canonical baseline when AI is off. The per-feature redaction policy keeps lat/long, " +
                    "street addresses, and place names tagged; only the vehicle name may be narrated.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "auto-trip-naming",
            name = "Auto trip naming",
            description =
                "Opt-in LLM-assisted trip-name suggestions grounded in the trip's route context (start/end " +
                    "places, drive count, distance, time window). Propose-only: the AI produces a structured proposal " +
                    "via two typed read-only tools and the user explicitly confirms or edits before saving through " +
                    "the existing trip-update path. The deterministic TripDetailPage stat cards, KVList of metadata, " +
                    "and existing trip labels remain the canonical baseline when AI is off. The per-feature redaction " +
                    "policy keeps lat/long, street addresses, and place names tagged; only the vehicle name may be " +
                    "narrated.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "battery-health-forecast-narrative",
            name = "Battery health forecast narrative",
            description =
                "Opt-in LLM-narrated explanation of the drivers behind the deterministic battery-health forecast " +
                    "(state-of-health, degradation rate, projected 80% date, charging habit ratios, risk factors). " +
                    "The deterministic Capacity Trend & Prediction chart, hero metric cards, and recommendations " +
                    "panel on the Battery Health page remain the canonical baseline when AI is off. Per-feature " +
                    "redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript " +
                    "does not reveal the user's location or charging cadence in plain text.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "cabin-temperature-impact-narrative",
            name = "Cabin temperature impact narrative",
            description =
                "Opt-in LLM narrator that explains how outside ambient temperature affects the in-scope vehicle's " +
                    "driving efficiency and range, grounded strictly in the same deterministic bucketed-efficiency + " +
                    "monthly seasonal-trend aggregates the existing /temperature-impact analytics page already " +
                    "renders. The narration may quote bucket labels, the avg_battery_pct_per_100km of the best and " +
                    "worst bucket, the rolling 12-month avg_temp_c paired with avg_efficiency, and the deterministic " +
                    "insights the tool returns; it never invents alternate bucket boundaries, never reclassifies the " +
                    "best/worst bucket, and explicitly surfaces the descriptive-aggregate (NOT forecast / regression) " +
                    "nature of the surface. The deterministic temperature-impact charts (scatter, bucket bars, " +
                    "optimal-range panel, seasonal trend, tips) remain the canonical baseline when AI is off. " +
                    "Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked " +
                    "transcript reveals neither the user's typical route start/end nor the schedule the recent-drives " +
                    "sample might surface.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "charging-curve-fingerprint-clustering",
            name = "Charging-curve fingerprint clustering",
            description =
                "Opt-in LLM narrator that names and explains the deterministic charging-curve fingerprint " +
                    "clusters for one vehicle. The deterministic charging-curve charts and per-session labels on the " +
                    "Charging Curves page remain the canonical baseline when AI is off. Per-feature redaction policy " +
                    "keeps every PII class except the vehicle name tagged so a leaked transcript does not reveal the " +
                    "user's home charger address or the supercharger network they frequent.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "charging-diagnosis",
            name = "Charging session diagnosis",
            description =
                "Opt-in LLM-narrated explanation of trickle, expensive, low-power, or interrupted charging flags " +
                    "for an individual charging session. Reads from the existing /charging/{sessionID} aggregates " +
                    "plus a deterministic flag-detection envelope; the deterministic charging stat cards, hero " +
                    "gauges, charge curve, and existing flag badges on the charging detail page remain the canonical " +
                    "baseline when AI is off.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "chatbot-llm",
            name = "LLM Chatbot",
            description = "Conversational fleet assistant powered by an LLM. Falls back to the heuristic chatbot when AI is off.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "cost-forecast-narration",
            name = "Cost forecast narration",
            description =
                "Opt-in LLM narrator that explains the deterministic cost forecast on the Cost Analysis page — " +
                    "historical monthly totals, the linear-regression projection with seasonal adjustment and " +
                    "approximate 95% prediction interval, the home-vs-supercharger split, gas-comparison savings, and " +
                    "the deterministic insights — with explicit assumptions and uncertainty. The deterministic " +
                    "cost-forecast chart and breakdown panels remain the canonical baseline when AI is off. " +
                    "Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked " +
                    "transcript reveals neither the user's home charger address nor the supercharger sites they " +
                    "regularly use.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "cross-rule-conflict-detection",
            name = "Cross-rule conflict detection",
            description =
                "Opt-in LLM that reads the caller's alert_rules definitions and surfaces structural conflicts " +
                    "(rule-pair definitions that overlap or are byte-identical) so the user can review them via the " +
                    "existing baseline AlertStudio editor. The assistant calls query_alert_rules FIRST to fetch the " +
                    "typed rule envelope for the in-scope set, then detect_rule_conflicts on the SAME set so the " +
                    "conflict report is byte-equivalent to the deterministic structural detector. Conflict kinds are " +
                    "drawn from a closed taxonomy: redundant_duplicate (byte-identical predicate + same vehicle " +
                    "scope) and overlapping_threshold (same signal_name, overlapping vehicle scope, predicate " +
                    "intervals overlap). Severity / cooldown / trigger-mode mismatches surface as METADATA flags on a " +
                    "conflict, NOT as standalone conflict kinds. The narration explicitly surfaces that the report is " +
                    "a STRUCTURAL OVERLAP ANALYSIS of the current rule definitions — NOT a runtime firing prediction " +
                    "or a claim that one rule shadows another — and refuses to invent conflict kinds outside the " +
                    "closed taxonomy. The user reviews the typed envelope inline and clicks 'Review rule' on each " +
                    "conflict to navigate to the offending rule in the canonical AlertStudio sidebar list — the AI " +
                    "never edits, merges, deletes, or auto-disables any rule; the existing baseline PUT " +
                    "/api/v1/alerts/rules/{id} + validateAlertRule path remains the canonical write surface. " +
                    "Per-feature redaction policy denies every PII class — alert IDs, signal names, and notification " +
                    "text flow through the typed F4 tool envelope, not through prompt prose.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "data-repair-suggestions",
            name = "Data repair suggestions",
            description =
                "Opt-in LLM that proposes a typed RepairPlan (close, discard, or partial-update) for ONE stale " +
                    "charging session OR ONE stale drive from the server-side inventory shown on /system/data-repair. " +
                    "PROPOSE-ONLY: routes through two propose-only tools (draft_data_repair_plan + " +
                    "validate_data_repair_plan) that share the SAME per-kind update_fields allowlist used by " +
                    "database.chargingPartialAllowed / drivePartialAllowed. The user reviews the typed proposal in " +
                    "the AI side panel and clicks the canonical Save / Close / Discard button on the baseline edit " +
                    "form to apply it; the LLM never writes. The deterministic stale-session list and per-row edit " +
                    "forms at /system/data-repair remain the canonical baseline when AI is off. Per-feature redaction " +
                    "policy is PolicyAlertBuilder (deny-by-default; every PII class redacted to a round-trip tag) so " +
                    "a leaked transcript reveals nothing about VINs, coordinates, place names, or vehicle names. " +
                    "Per-request scope binding installs the current (chargingIDs, driveIDs) snapshot in ctx and " +
                    "refuses any cross-row mutation proposal to defend against prompt-injection exfiltration via " +
                    "operator-authored start_place / end_place fields.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "digest-narration",
            name = "Weekly digest narration",
            description =
                "Opt-in LLM narration of the weekly digest. The deterministic template digest remains the " +
                    "baseline when AI is off.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "drive-coaching",
            name = "Per-drive coaching",
            description =
                "Opt-in LLM-narrated 2-4 paragraph coaching summary for an individual drive. Reads from the " +
                    "deterministic per-drive aggregates surfaced by the existing /drives/{driveID} handler and a " +
                    "small typed telemetry-summary tool; the deterministic stat cards, hero gauges, and energy " +
                    "summary on the drive detail page remain the canonical baseline when AI is off.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "feedback-queue-triage",
            name = "Feedback queue triage",
            description =
                "Opt-in LLM triage advisor that proposes a typed {proposed_status, proposed_category, " +
                    "proposed_priority, rationale} envelope for one user_feedback row by routing through three " +
                    "propose/read-only tools: draft_feedback_triage (loads the in-scope row via the " +
                    "FeedbackTriageSource port — a thin wrapper around *dbuser.UserFeedbackRepo.Get that " +
                    "PII-minimizes the row into a FeedbackTriageEntry; only id / created_at / category / title / " +
                    "body[truncated] / page_route / app_version / status / github_issue_url are forwarded; " +
                    "user_email, submitter_subject, submitter_ip, recent_errors, console_tail are NOT forwarded), " +
                    "validate_feedback_triage (pure DTO transform asserting enum membership for status / category / " +
                    "priority), and the OPTIONAL retrieve_feedback_chunks (F7 retrieval restricted to {feedback_item, " +
                    "audit_log} source types) for per-row context. The deterministic FeedbackQueuePage manual-triage " +
                    "surface remains the canonical baseline when AI is off. Per-feature redaction policy is " +
                    "PolicyAlertBuilder (deny-by-default; every tag class redacted to a round-trip tag) so a leaked " +
                    "transcript reveals nothing about VINs, coordinates, or any value the user typed into the " +
                    "feedback body. Per-request scope binding installs the body-supplied feedback_id in ctx and " +
                    "refuses any LLM-supplied feedback_id outside that id to defend against prompt-injection " +
                    "exfiltration via user-authored feedback bodies. Only proposed_status maps onto the canonical " +
                    "FeedbackUpdateInput.status field; proposed_category and proposed_priority are " +
                    "recommendation-only chips with no persistence path.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "geofence-aware-automation-suggestions",
            name = "Geofence-aware automation suggestions",
            description =
                "Opt-in LLM-assisted assistant that DRAFTS a typed Automation graph (trigger + conditions + " +
                    "actions) whose trigger and/or at least one condition references one of the user's existing " +
                    "geofences (by place_id). The handler injects a deterministic catalog of the user's geofences (id " +
                    "+ name + category) into the user message so the LLM picks a real place_id rather than " +
                    "hallucinating one. Propose-only: the typed draft flows back through the SSE stream, the user " +
                    "reviews + clicks 'Apply to form' inside AutomationBuilderPage to copy the envelope into the " +
                    "existing baseline form state, then SAVES IT THEMSELVES via the canonical POST " +
                    "/api/v1/automations write path. The deterministic AutomationBuilder graph editor + validators " +
                    "remain the canonical baseline when AI is off. The per-feature redaction policy denies every PII " +
                    "class — vehicle, place, and channel identifiers flow through the typed F4 tool envelope, not " +
                    "through prose.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "inbox-auto-categorization",
            name = "Inbox auto-categorization",
            description =
                "Opt-in LLM that reads the recent notification_logs window for the user's current inbox filter " +
                    "and proposes a small ordered set of categorical labels (drawn from a closed taxonomy: battery, " +
                    "charging, climate, tire, security, connectivity, maintenance, noise, other) describing the " +
                    "dominant noise sources. The assistant calls draft_alert_categories to compute a descriptive " +
                    "count of how many recent notifications fall into each category — based on a deterministic " +
                    "signal_name → category mapping over the same notification_logs rows the SPA inbox already " +
                    "renders — then validate_alert_category to assert every proposed label is in the closed taxonomy. " +
                    "The narration explicitly surfaces that the counts are DESCRIPTIVE over the recent window — NOT a " +
                    "forecast — and refuses to invent categories outside the taxonomy or to comment on inbox rows the " +
                    "user is not currently viewing. The user reviews the typed proposal in the Inbox UI and clicks " +
                    "'Apply as filter' to copy the suggested rule_ids into the canonical inbox filter — the AI never " +
                    "writes to notification_logs, never assigns labels to rows, never bypasses the canonical " +
                    "/api/v1/notifications inbox listing handler. The deterministic NotificationFilterBar + " +
                    "user-driven filters remain the canonical baseline when AI is off. Per-feature redaction policy " +
                    "denies every PII class — alert IDs, signal names, and notification text flow through the typed " +
                    "F4 tool envelope, not through prompt prose.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "incident-timeline-summarizer",
            name = "Incident timeline summarizer",
            description =
                "Opt-in LLM summarizer that condenses one incident's chronological timeline into a 3-6 sentence " +
                    "factual summary by routing through two read-only tools: query_incident_timeline (the " +
                    "deterministic envelope ALSO served by the canonical GET /api/v1/status/incidents/{id} handler — " +
                    "id, title, description, severity, status, source, affected_components, started_at, resolved_at, " +
                    "total_updates count, and the full chronological updates list with at/status/message/author) and " +
                    "the OPTIONAL retrieve_system_chunks (F7 retrieval restricted to {system_event, audit_log} source " +
                    "types) for per-event context. The deterministic incident timeline list, append-update form, and " +
                    "lifecycle controls at /system-status/incidents/:id remain the canonical baseline when AI is off. " +
                    "Per-feature redaction policy is PolicyChatbot (deny-by-default; every PII class redacted to a " +
                    "round-trip tag) so a leaked transcript reveals nothing about IPs, hostnames, ports, tokens, or " +
                    "any value an operator pasted into an incident update message. Per-request scope binding rejects " +
                    "any cross-incident tool call to defend against prompt-injection exfiltration via " +
                    "operator-authored text.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "learned-per-vehicle-anomaly-baselines",
            name = "Learned per-vehicle anomaly baselines",
            description =
                "Opt-in LLM narrator that EXPLAINS the per-signal learned anomaly envelope (mean/stddev/p5/p95 " +
                    "per signal, clamped to the static safe-range envelope; safe-range fallback per signal when fewer " +
                    "than 30 samples exist in the recent signal_log window) for one vehicle. The deterministic " +
                    "Z-score detector with static safeRanges on the Anomaly Detection page remains the canonical " +
                    "baseline when AI is off. Per-feature redaction policy keeps every PII class tagged so a leaked " +
                    "transcript does not reveal vehicle identity beyond the user-supplied vehicle_id.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "lifetime-stats-qa",
            name = "Lifetime stats Q&A",
            description =
                "Opt-in LLM Q&A surface that answers natural-language questions about one vehicle's all-time " +
                    "stats by routing through two read-only tools: query_lifetime_stats (the deterministic envelope " +
                    "ALSO served by the canonical GET /api/v1/analytics/lifetime handler — total drives, total " +
                    "distance, charge sessions, savings, achievements, personal records, ownership timeline) and the " +
                    "OPTIONAL retrieve_analytics_chunks (F7 retrieval restricted to {analytics_lifetime, " +
                    "drive_summary, charge_session} source types) for per-event context. The deterministic Lifetime " +
                    "Stats hero card, key-stats grid, achievements gallery, fun-facts cards, personal-records panel, " +
                    "and ownership timeline at /lifetime-stats remain the canonical baseline when AI is off. " +
                    "Per-feature redaction policy is PolicyChatbot (deny-by-default; every PII class redacted to a " +
                    "round-trip tag including vehicle name) so a leaked transcript reveals nothing about the user's " +
                    "vehicle, location, or charger addresses.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "log-trace-summarization",
            name = "Log and trace summarization",
            description =
                "Opt-in LLM summarizer that condenses a recent redacted log / trace window into a 3-6 sentence " +
                    "factual summary by routing through two read-only tools: query_trace_window (a typed " +
                    "deterministic TraceWindowEnvelope: window bounds, log-event counts by level, top recurring " +
                    "log-event templates with counts, trace-span count, top trace-span operations with mean duration; " +
                    "the slice ships with a deterministic empty source adapter because the operator-facing log " +
                    "surface is stream-only and has no historical log persistence beyond zerolog's stdout — a future " +
                    "slice that wires a log-history reader can do so behind the same per-request scope binding " +
                    "without widening the contract) and the OPTIONAL retrieve_log_chunks (F7 retrieval restricted to " +
                    "{log_event, trace_span} source types) for per-event context. The deterministic LiveLogsPage " +
                    "SSE-backed log tail with manual level + grep + vehicle filters remains the canonical baseline " +
                    "when AI is off. Per-feature redaction policy is PolicyChatbot (deny-by-default; every PII class " +
                    "redacted to a round-trip tag) so a leaked transcript reveals nothing about IPs, hostnames, " +
                    "ports, tokens, stack-trace fragments, or any value zerolog wrote into a structured field. " +
                    "Per-request scope binding installs the URL supplied (from_unix, to_unix, vehicle_id?) tuple in " +
                    "ctx and refuses any LLM-supplied window outside that tuple to defend against prompt-injection " +
                    "exfiltration via operator-authored log messages.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "ml-charging-curve-clustering",
            name = "Charging-curve clustering model",
            description =
                "Opt-in LLM narrator that EXPLAINS the per-cluster (L1 overnight / L2 workplace / DC fast / " +
                    "unknown) learned charging envelope (mean peak power plus stddev/p5/p95 per cluster, mean avg " +
                    "power / total energy / duration / ramp shape; rule-label fallback per cluster when fewer than 3 " +
                    "sessions exist in the recent window) for one vehicle. The deterministic Charging Curve page with " +
                    "the rule-label classification remains the canonical baseline when AI is off. Per-feature " +
                    "redaction policy keeps every PII class tagged so a leaked transcript does not reveal vehicle " +
                    "identity beyond the user-supplied vehicle_id.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "mqtt-sse-inspector-explanations",
            name = "MQTT and SSE inspector explanations",
            description =
                "Opt-in LLM-backed explainer that turns the deterministic MQTT-broker / SSE-hub / background-job " +
                    "snapshot into a 3-6 sentence operator-readable factual explanation by routing through two " +
                    "read-only tools: query_stream_inspector (loads the in-scope window via the StreamInspectorSource " +
                    "port — a thin deterministic adapter around the same MQTT status snapshot the canonical baseline " +
                    "/api/v1/admin/mqtt/status endpoint already serves; emits a typed StreamInspectorEnvelope of " +
                    "broker connectivity + per-vehicle stream stats + SSE hub state + background-job freshness) and " +
                    "the OPTIONAL retrieve_stream_chunks (F7 retrieval restricted to {mqtt_status, sse_status, " +
                    "job_status} source types) for per-event context. The deterministic MQTTInspectorPage " +
                    "broker-status snapshot table remains the canonical baseline when AI is off. Per-feature " +
                    "redaction policy is PolicyChatbot (deny-by-default; every tag class redacted to a round-trip " +
                    "tag) so a leaked transcript reveals nothing about broker hostnames, ports, SSE client " +
                    "identifiers, or VINs. Per-request scope binding installs the body-supplied (from_unix, to_unix) " +
                    "tuple in ctx and refuses any LLM-supplied window outside that tuple to defend against " +
                    "prompt-injection exfiltration via operator-readable VINs, topic names, or broker hostnames. Both " +
                    "tools are READ-only — no record is created, mutated, or deleted by the AI surface; the existing " +
                    "telemetry-ingest path is the only mutation surface and the AI never touches it.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "nl-alert-builder",
            name = "Natural-language alert builder",
            description =
                "Opt-in LLM assistant that drafts typed AlertRule DTOs from a plain-language description. The " +
                    "deterministic AlertStudio form + validators remain the baseline when AI is off; saving still " +
                    "flows through the existing typed alerts handler.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "nl-automation-builder",
            name = "Natural-language automation builder",
            description =
                "Opt-in LLM assistant that drafts typed Automation graph DTOs (trigger + conditions + actions) " +
                    "from a plain-language description. The deterministic AutomationBuilder graph editor + validators " +
                    "remain the baseline when AI is off; saving still flows through the existing typed automations " +
                    "handler.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "nl-dashboard-composer",
            name = "Helix natural-language dashboard composer",
            description =
                "Opt-in Helix translator on the /power/dashboards route that turns plain-English dashboard " +
                    "requests (e.g. \"give me an overview dashboard with daily drives, current battery, and recent " +
                    "alerts\") into a typed DashboardLayoutDraft JSON envelope (title + ordered list of panel slots " +
                    "picking panels by name from a curated install-wide panel catalog and placing each on the Grafana " +
                    "24-column grid) you can review before clicking the canonical Apply to editor button on the " +
                    "manual dashboard composer form. The translator uses TWO propose-only typed tools " +
                    "(draft_dashboard_layout, validate_dashboard_layout) that share the SAME single-dimension " +
                    "allowlist enforcement: every slot.panel_name MUST be in the in-scope curated panel catalog (six " +
                    "install-wide panel templates: drives_per_day_timeseries, battery_soc_stat, " +
                    "charging_sessions_table, alerts_count_stat, vehicles_table, energy_used_per_day_barchart); each " +
                    "slot's grid_pos MUST be inside the dashboard grid (x in [0..23], y in [0..49], w in [1..24], h " +
                    "in [1..50]; x+w ≤ 24); the dashboard MUST contain at least 1 and at most 12 slots; slots MUST " +
                    "NOT use the same panel_name twice; slot bounding boxes MUST NOT overlap. The LLM NEVER pushes " +
                    "the dashboard to Grafana itself — the user reviews the typed draft in the Helix panel, clicks " +
                    "Apply to editor to copy the draft into the manual dashboard composer form, then clicks Copy to " +
                    "clipboard on the baseline editor to copy the JSON for pasting into their own Grafana dashboard. " +
                    "The Helix panel is propose-only and never bypasses the existing manual composer. Per-request " +
                    "scope binding rejects any panel_name not in the in-scope curated catalog so a prompt-injection " +
                    "attempt cannot exfiltrate or invent panels. Per-feature redaction policy is PolicyAlertBuilder " +
                    "(Allow=nil); only catalog metadata (panel names + descriptions) crosses the tool boundary, no " +
                    "row data, no operator-authored text from any non-prompt source. Retrieval is constrained to two " +
                    "source types: dashboard_schema (a feature-local string referring to the in-scope curated panel " +
                    "catalog) and widget_catalog (a feature-local string referring to per-panel rendering hints). The " +
                    "deterministic /power/dashboards baseline (manual JSON dashboard composer + curated panel catalog " +
                    "viewer + Copy to clipboard button) remains the canonical surface when Helix is off (ADR-015 §I3 " +
                    "+ §I5 + §I6).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "nl-drive-search-replay",
            name = "NL drive search and replay",
            description =
                "Opt-in LLM-assisted natural-language search across the calling user's drive history with " +
                    "one-click jump-to-replay anchors, grounded in the F7 RAG retriever over drive_summary, " +
                    "route_segment, and location_summary corpora. The deterministic typed filters on /drives and the " +
                    "existing /drives/:id/replay TripReplayPage controls remain the canonical baseline when AI is " +
                    "off; the AI side panel only narrates and cites already-retrieved drives with replay anchors — it " +
                    "never replaces the typed query path.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "nl-grafana-panel",
            name = "Helix natural-language Grafana panel",
            description =
                "Opt-in Helix translator on the /power/grafana route that turns plain-English data questions " +
                    "(e.g. \"show me a daily time series of how far I drove this month\") into a typed Grafana panel " +
                    "JSON draft (title, type, datasource, targets, grid_pos) you can review before clicking the " +
                    "canonical Copy to clipboard button on the manual Grafana panel-builder form. The translator uses " +
                    "TWO propose-only typed tools (draft_grafana_panel, validate_grafana_panel) that share the SAME " +
                    "three-dimensional allowlist enforcement: panel.type MUST be in the in-scope curated panel-type " +
                    "whitelist (timeseries, stat, gauge, table, barchart, heatmap, piechart, logs); " +
                    "panel.datasource.type MUST be in the in-scope curated datasource-type whitelist (postgres, " +
                    "prometheus); for postgres targets the rawSql MUST start with SELECT or WITH, MUST be a single " +
                    "statement (no semicolons), MUST NOT contain any DML/DDL keyword (INSERT, UPDATE, DELETE, DROP, " +
                    "ALTER, CREATE, TRUNCATE, GRANT, REVOKE, VACUUM, COPY, CALL, DO, MERGE, EXECUTE), and every " +
                    "referenced table MUST appear in the same in-scope curated table catalog the nl-sql-playground " +
                    "tools enforce; for prometheus targets the expr MUST be a single non-empty PromQL expression (no " +
                    "semicolons); grid_pos MUST be inside the dashboard grid (x in [0..23], y in [0..49], w in " +
                    "[1..24], h in [1..50]). The LLM NEVER pushes the panel itself — the user reviews the typed draft " +
                    "in the Helix panel and clicks the canonical Copy to clipboard button on the baseline manual " +
                    "Grafana panel-builder editor to copy the JSON for pasting into their own Grafana dashboard. The " +
                    "Helix panel is propose-only and never bypasses the existing manual editor. Per-request scope " +
                    "binding rejects any panel type, datasource type, or table name not in the in-scope curated " +
                    "catalog so a prompt-injection attempt cannot exfiltrate out-of-scope tables or smuggle a panel " +
                    "against an out-of-catalog datasource. Per-feature redaction policy is PolicyAlertBuilder " +
                    "(Allow=nil); only schema metadata (panel-type slugs, datasource-type slugs + their canonical " +
                    "UIDs, table + column names + descriptions) crosses the tool boundary, no row data, no " +
                    "operator-authored text from any non-prompt source. Retrieval is constrained to two source types: " +
                    "schema_catalog (the feature-local string referring to the in-scope curated table descriptions, " +
                    "shared with nl-sql-playground) and grafana_panel_schema (a feature-local string referring to the " +
                    "in-scope curated panel-type and datasource-type whitelists). The deterministic /power/grafana " +
                    "baseline (manual JSON editor + curated panel-builder catalog viewer + Copy to clipboard button) " +
                    "remains the canonical surface when Helix is off (ADR-015 §I3 + §I5 + §I6).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "nl-search",
            name = "Natural-language search",
            description =
                "Opt-in LLM-assisted natural-language search across the user's drives, charging sessions, and " +
                    "alert history via the F7 RAG retriever. The deterministic typed search filters at /search remain " +
                    "the baseline when AI is off; results are still rendered via the existing typed search handler — " +
                    "the AI side panel only narrates and cites the retrieved chunks.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "nl-sql-playground",
            name = "Helix natural-language SQL playground",
            description =
                "Opt-in Helix translator on the /power/sql route that turns plain-English data questions (e.g. " +
                    "\"how far did I drive last week\") into a typed read-only SELECT draft you can review before " +
                    "clicking the canonical Run button on the manual SQL playground form. The translator uses TWO " +
                    "propose-only typed tools (draft_readonly_sql, validate_readonly_sql) that share the SAME " +
                    "allowlist enforcement: every proposed statement MUST start with SELECT or WITH, MUST be a single " +
                    "statement (no semicolons), every referenced table MUST appear in the per-request scope-bound " +
                    "schema catalog the handler installs, and any DML/DDL keyword (INSERT, UPDATE, DELETE, DROP, " +
                    "ALTER, CREATE, TRUNCATE, GRANT, REVOKE, VACUUM, COPY, CALL, DO, MERGE, EXECUTE) is rejected at " +
                    "parse time. The LLM NEVER executes the SQL itself — the user reviews the typed draft in the " +
                    "Helix panel and clicks the canonical Run button on the baseline manual SQL editor to actually " +
                    "execute the query. The Helix panel is propose-only and never bypasses the existing read-only " +
                    "execution handler. Per-request scope binding rejects any table name not in the in-scope curated " +
                    "catalog (drives, charging_sessions, vehicles, signal_log_view, alerts) so a prompt-injection " +
                    "attempt that pastes \"select * from secrets\" cannot exfiltrate out-of-scope tables — the LLM " +
                    "physically cannot reference a table name the catalog does not list. Per-feature redaction policy " +
                    "is PolicyAlertBuilder (Allow=nil); only schema metadata (table + column names + descriptions) " +
                    "crosses the tool boundary, no row data, no operator-authored text from any non-prompt source. " +
                    "Retrieval is constrained to two source types: schema_catalog (a feature-local string referring " +
                    "to the in-scope curated table descriptions) and docs (the existing rag.SourceDocs for SPA " +
                    "help-page chunks that describe each table's columns). The deterministic /power/sql baseline " +
                    "(manual SQL textarea + curated schema catalog viewer + Run button + read-only result table) " +
                    "remains the canonical surface when Helix is off (ADR-015 §I3 + §I5 + §I6).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "period-compare-narration",
            name = "Period compare narration",
            description =
                "Opt-in LLM narrator that explains the deterministic period-over-period analytics already shown " +
                    "on the Period Comparison page — total distance, total drives, energy used, average efficiency, " +
                    "total cost, and CO2 saved across two trailing-day windows for one vehicle, plus the per-metric " +
                    "percent change. The deterministic Period Comparison selectors, metric cards, side-by-side bar " +
                    "chart, comparison data table, and deterministic insights bullets remain the canonical baseline " +
                    "when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name " +
                    "tagged so a leaked transcript reveals neither the user's home charger address nor the locations " +
                    "they regularly drive to.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "pii-redaction-shared-exports",
            name = "Helix redaction advisor",
            description =
                "Opt-in Helix advisor on the Exports page that recommends which PII classes (VINs, GPS " +
                    "coordinates, addresses, vehicle names, charger network labels, IPs, emails, phone numbers, MAC " +
                    "addresses, user-subject ids, precise timestamps) you should redact before sharing or downloading " +
                    "an export. Routes through two read-only typed tools: draft_export_redaction_plan returns a " +
                    "STATIC Go catalog of PII classes typically present in the chosen export_type ({drives, charging, " +
                    "trips, analytics, backup, account}) plus per-class recommendations and limiting-assumption " +
                    "disclosures (catalog-based, NOT a per-row PII scan); validate_export_redaction_plan asserts " +
                    "every cited class is recognized and every highly-recommended class is covered before the " +
                    "narrator is allowed to narrate. The advisor NEVER triggers an export, NEVER mutates state, and " +
                    "NEVER claims it scanned your data — it only narrates the catalog-based recommendation. " +
                    "Per-feature redaction policy is PolicyAlertBuilder (Allow=nil); the static catalog never carries " +
                    "PII so the policy is defence-in-depth. The deterministic /exports list, /export/jobs endpoints, " +
                    "and the existing manual flow remain the canonical baseline when AI is off (ADR-015 §I3).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "predictive-maintenance",
            name = "Predictive maintenance",
            description =
                "Opt-in LLM-backed advisor that turns the deterministic per-vehicle maintenance reminders + " +
                    "service history + (when indexed) ML-anomaly signals into a 3-6 sentence operator-readable risk " +
                    "narration by routing through two read-only tools: query_maintenance_context (loads the in-scope " +
                    "vehicle's items, recent_records, and summary counts via the MaintenancePredictionContextSource " +
                    "port — a thin deterministic adapter around the same default-items + Redis-odometer reader the " +
                    "canonical baseline GET /api/v1/maintenance handler already serves) and the OPTIONAL " +
                    "retrieve_maintenance_chunks (F7 retrieval restricted to {maintenance_event, vehicle_state, " +
                    "ml_anomaly} source types) for per-event context. The deterministic MaintenancePage items grid + " +
                    "summary cards + service records table + due-soon / overdue badges remain the canonical baseline " +
                    "when AI is off; the existing manual service-record write path is the SOLE mutation surface. " +
                    "Per-feature redaction policy is PolicyDigest (Allow=[ClassVehicleName]) so a leaked transcript " +
                    "reveals nothing beyond the operator-chosen car name. Per-request scope binding installs the " +
                    "body-supplied vehicle_id in ctx and refuses any LLM-supplied vehicle_id that does not match to " +
                    "defend against prompt-injection exfiltration via operator-authored service-record description / " +
                    "provider strings. Both tools are READ-only — no record is created, mutated, or deleted by the AI " +
                    "surface.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "preheat-precool-recommender",
            name = "Preheat and precool recommender",
            description =
                "Opt-in LLM agent that proposes a preheat or precool window — start_time, end_time, target cabin " +
                    "temperature, mode (preheat | precool) — by combining the user's typical departure timestamp with " +
                    "the vehicle's current cabin and outside temperatures. The proposal is structured and " +
                    "PROPOSE-only: the user reviews the typed draft in the AI panel and clicks the existing canonical " +
                    "climate-controls UI to apply it; the AI never creates a schedule directly. The deterministic " +
                    "Climate Control page (HVAC banner, status cards, efficiency panel, history table, seat-heater " +
                    "controls, manual departure-time heuristic) remains the canonical baseline when AI is off. " +
                    "Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked " +
                    "transcript reveals neither the user's home address nor the workplaces they typically depart " +
                    "from.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "quiet-hours-suggestion",
            name = "Helix quiet-hours suggestion",
            description =
                "Opt-in Helix advisor on the Quiet hours / Do-Not-Disturb settings page that proposes ONE " +
                    "candidate quiet-hours window from your recent notification history. Routes through two read-only " +
                    "typed tools: draft_quiet_hours_window aggregates the trailing 30-day notification_logs " +
                    "(non-critical severities only) into per-hour event counts, finds the longest contiguous interval " +
                    "where non-critical traffic is sparsest, and returns a typed candidate {start_local, end_local, " +
                    "weekdays, timezone, bypass_severities, history_summary, assumptions, status} (the " +
                    "candidate-finder NEVER quotes individual notification titles/messages — only aggregated counts " +
                    "cross the tool boundary); validate_quiet_hours_window asserts the candidate satisfies the SAME " +
                    "validation rules the canonical POST /api/v1/notifications/quiet-hours handler enforces (HH:MM, " +
                    "distinct start/end, valid IANA timezone, weekday bitmask 0..127, bypass severities subset of " +
                    "{info, warn, critical}) so an AI-accepted window is byte-equivalent to a hand-typed one. The " +
                    "advisor NEVER triggers a save; the user clicks 'Apply to form' which copies the typed candidate " +
                    "into the existing QuietHoursPanel form state, then reviews and clicks the canonical Save button " +
                    "(which still fires the canonical useSaveQuietHours mutation against " +
                    "/api/v1/notifications/quiet-hours). The narrator surfaces a 2-3 sentence rationale grounded " +
                    "strictly in the aggregated history and explicitly discloses the descriptive-replay caveat: the " +
                    "candidate is derived from past notification cadence, not a forecast of future traffic. " +
                    "Per-feature redaction policy is PolicyAlertBuilder (Allow=nil); tool aggregation is the primary " +
                    "privacy guard, the redaction policy is defence-in-depth. The deterministic QuietHoursPanel CRUD " +
                    "form, the /api/v1/notifications/quiet-hours endpoints, and the notification dispatcher's defer " +
                    "logic remain the canonical baseline when AI is off (ADR-015 §I3).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "rag-help",
            name = "RAG-backed app help",
            description =
                "Opt-in LLM-narrated answers to natural-language application help questions, grounded in the " +
                    "application's own documentation, runbooks, and i18n strings via the F7 RAG retriever. The " +
                    "deterministic curated /help page links + tooltips + i18n help copy remain the canonical baseline " +
                    "when AI is off.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "range-prediction-model",
            name = "Range prediction model",
            description =
                "Opt-in LLM narrator that EXPLAINS the per-bucket (temp_bucket × speed_bucket) learned range " +
                    "envelope (mean Wh/km plus stddev/p5/p95 per bucket; linear-fallback to the static heuristic " +
                    "curve per bucket when fewer than 5 drives exist in the recent window) for one vehicle. The " +
                    "deterministic Projected Range page with the static heuristic curve remains the canonical " +
                    "baseline when AI is off. Per-feature redaction policy keeps every PII class tagged so a leaked " +
                    "transcript does not reveal vehicle identity beyond the user-supplied vehicle_id.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "route-efficiency-suggestions",
            name = "Route-efficiency suggestions",
            description =
                "Opt-in LLM-narrated suggestions for lower-consumption habits and route choices, grounded in the " +
                    "user's repeat-driven routes via the F7 RAG retriever plus a typed read-only route-aggregation " +
                    "tool. The deterministic RouteCards and kWh/100mi metric bars on /analytics/route-efficiency " +
                    "remain the canonical baseline when AI is off; precise route coordinates and street addresses " +
                    "remain tagged by the per-feature redaction policy so only the vehicle name may be narrated.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "safety-setting-explainer",
            name = "Helix safety setting explainer",
            description =
                "Opt-in Helix advisor on the Safety settings page that explains your TeslaSync safety-related " +
                    "settings in plain English without changing any defaults. Routes through two read-only typed " +
                    "tools: query_safety_settings reads the deterministic SettingsRepo and returns a typed envelope " +
                    "of every safety-related toggle (notification quiet hours state, alert digest mode, " +
                    "critical-flash signalling, tab-badge signalling, and the api_suspended operational gate) — each " +
                    "entry carries {key, current_value, default_value, allowed_values, short_description, " +
                    "docs_anchor} so the narrator has a schema-plus-state envelope and never needs to invent a " +
                    "setting that does not exist; retrieve_docs (the shared F7-backed RAG tool registered by the " +
                    "rag-help slice) pulls matching documentation chunks scoped to the global docs corpus only — " +
                    "runbooks and i18n corpora are forbidden by the system prompt because the explainer is " +
                    "user-facing help, not operator guidance. The advisor NEVER persists state and NEVER changes a " +
                    "setting; the user must use the existing Settings UI to change values. The narrator surfaces a " +
                    "2-4 sentence explanation grounded strictly in the typed envelope plus the retrieved chunks, " +
                    "names the current value (from query_safety_settings), and cites the matching docs chunk by its " +
                    "source label so the user can read more. Per-feature redaction policy is PolicyChatbot " +
                    "(Allow=nil); the typed tool returns scalar setting values only — no PII, no notification titles, " +
                    "no addresses — so the policy is defence in depth. The deterministic baseline rendering of the " +
                    "Safety settings page (the listing of every safety-related setting with its current value plus a " +
                    "static link to the canonical docs) is unchanged when AI is off; the AI panel is absent (ADR-015 " +
                    "§I3 + §I5).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "signal-explorer-nl-filter",
            name = "Signal explorer natural-language filter",
            description =
                "Opt-in LLM that translates a natural-language filter request into a typed SignalFilter DTO the " +
                    "deterministic SignalExplorerPage at /signals/explorer can apply. PROPOSE-ONLY: routes through " +
                    "two propose-only tools (draft_signal_filter + validate_signal_filter) bound to the per-vehicle " +
                    "signal catalog the handler installs server-side. The user reviews the typed proposal in the AI " +
                    "side panel and clicks Apply to copy the draft into the baseline filter form; the LLM never edits " +
                    "filter state directly. The deterministic SignalSelector + RangePicker + per-page controls at " +
                    "/signals/explorer remain the canonical baseline when AI is off. Per-feature redaction policy is " +
                    "PolicyChatbot (deny-by-default; every PII class redacted to a round-trip tag) so a leaked " +
                    "transcript reveals nothing about VINs, vehicle names, or coordinates. Per-request scope binding " +
                    "installs the per-vehicle signal catalog snapshot in ctx and refuses any out-of-catalog signal " +
                    "proposal to defend against prompt-injection exfiltration via operator-authored prompts.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "smart-charge-schedule-suggestion",
            name = "Smart-charge schedule suggestion",
            description =
                "Opt-in LLM agent that proposes a TOU-optimized charge schedule by delegating to the canonical " +
                    "ChargePlannerHandler.computeSchedule path. The manual schedule form, deterministic POST " +
                    "/api/v1/charge-planner/optimize optimizer, and explicit Schedule button on the Smart Charge page " +
                    "remain the canonical baseline when AI is off; the AI never writes a schedule directly. Home/work " +
                    "locations remain tagged by the per-feature redaction policy so only the vehicle name may be " +
                    "narrated.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "software-update-changelog-summarizer",
            name = "Software update changelog summarizer",
            description =
                "Opt-in Helix narrator that summarizes the deterministic firmware update history the SPA's " +
                    "SoftwareUpdatesPage already renders from GET /api/v1/software-updates. Routes through one " +
                    "read-only typed tool (query_vehicle_software) that loads the in-scope vehicle's deterministic " +
                    "update envelope (current installed version, recent install/scheduled history, install cadence) " +
                    "from the SAME software_updates table the canonical baseline timeline reads — no new SQL, no " +
                    "separate write path. An OPTIONAL second tool (retrieve_update_notes) is the F7 retrieval surface " +
                    "scoped to {software_update, docs} source types so the narrator can quote cached release-note " +
                    "chunks when available. The narrator quotes ONLY what the deterministic envelope + cached chunks " +
                    "contain — it never invents a version number, never invents a feature/fix, never speculates about " +
                    "Tesla's roadmap, and is honest when a recently-listed version has no cached release-note chunks. " +
                    "Per-feature redaction policy is PolicyChatbot (Allow=nil) so VIN, coordinates, addresses, place " +
                    "names, and charger network labels stay tagged round-trip; release-note text is public so no " +
                    "class is allowed in cleartext. The deterministic firmware history timeline, current-version stat " +
                    "card, and external 'View release notes' links on the SoftwareUpdatesPage remain the canonical " +
                    "baseline when AI is off (ADR-015 §I3).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "speed-profile-insights",
            name = "Speed-profile insights",
            description =
                "Opt-in LLM-narrated insights about a single drive's speed regime, outliers, and route context. " +
                    "Reads from the existing *drivemodel.Drive aggregates via two read-only tools; the deterministic " +
                    "SpeedHistogramChart + summary metrics on /drives/:id remain the canonical baseline when AI is " +
                    "off. Precise route coordinates remain tagged by the per-feature redaction policy; only the " +
                    "vehicle name may be narrated.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "state-machine-debugger-narrator",
            name = "State-machine debugger narrator",
            description =
                "Opt-in LLM-backed narrator that turns the deterministic per-vehicle FSM transition trace into a " +
                    "3-6 sentence operator-readable factual narration by routing through two read-only tools: " +
                    "query_fsm_trace (loads the in-scope (vehicle_id, from_unix, to_unix) window via the " +
                    "FSMTraceSource port — a thin deterministic adapter around the same database.FSMTransitionRepo " +
                    "the canonical baseline /api/v1/fsm/transitions endpoint already serves; emits a typed " +
                    "FSMTraceEnvelope of window bounds + vehicle id + total_transitions + per_fsm + per_edge + " +
                    "flap_count + transitions) and the OPTIONAL retrieve_fsm_chunks (F7 retrieval restricted to " +
                    "{fsm_transition, signal_history_summary} source types) for per-event context. The deterministic " +
                    "StateMachineDebuggerPage transition table + state diagram + FSM health panel + timeline chart " +
                    "remain the canonical baseline when AI is off. Per-feature redaction policy is PolicyDigest " +
                    "(Allow=[ClassVehicleName]) so a leaked transcript reveals nothing beyond the operator-chosen car " +
                    "name. Per-request scope binding installs the body-supplied (vehicle_id, from_unix, to_unix) " +
                    "tuple in ctx and refuses any LLM-supplied tuple outside that triple to defend against " +
                    "prompt-injection exfiltration via operator-readable trigger strings or FSM names. Both tools are " +
                    "READ-only — no record is created, mutated, or deleted by the AI surface; the existing " +
                    "fsm-transition write path is the only mutation surface and the AI never touches it.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "suggest-new-geofences",
            name = "Suggest new geofences",
            description =
                "Opt-in LLM-assisted geofence-suggestion proposals grounded in repeated visits to the same " +
                    "location (visit_count, total_duration_s, last_visited, current address_name). Propose-only: the " +
                    "AI produces a typed geofence draft envelope (centroid lat/lon + radius_m + name) via two typed " +
                    "read-only tools (draft_geofence then validate_geofence) and the user reviews + clicks 'Apply to " +
                    "form' before SAVING IT THEMSELVES through the existing baseline POST /api/v1/geofences write " +
                    "path. The deterministic geofence list, Add Geofence modal, and map rendered by GeofencesPage at " +
                    "/geofences remain the canonical baseline when AI is off. The per-feature redaction policy keeps " +
                    "lat/long and street addresses tagged; only the vehicle name may be narrated.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "tco-narration",
            name = "TCO narration",
            description =
                "Opt-in LLM narrator for the deterministic Total-Cost-of-Ownership envelope the SPA's " +
                    "TrueCostPage already renders from GET /api/v1/analytics/tco. Routes through one read-only typed " +
                    "tool (query_tco_summary) that calls the SAME api.ComputeTCOSummary helper backing the canonical " +
                    "baseline chart — no separate SQL, no separate write path. Limited to OPERATING cost narration: " +
                    "monthly EV charging cost, monthly equivalent gas cost (estimated from charged energy + " +
                    "user-editable gas_price/gas_efficiency_mpg, NOT real-world distance), monthly maintenance " +
                    "savings (flat \$50/mo heuristic × months_of_ownership), and cumulative savings month-over-month. " +
                    "The narrator MUST NOT speak about depreciation, resale value, insurance, registration, " +
                    "financing, or recommend purchasing a different vehicle (ICE or otherwise) — these are out of " +
                    "scope and would be hallucinated. When the deterministic envelope reports negative savings the " +
                    "narrator is required to state that fact honestly rather than cheerlead. Per-feature redaction " +
                    "policy is PolicyTCONarration (PolicyDigest, Allow=[ClassVehicleName]). The deterministic " +
                    "TrueCostPage charts remain the canonical baseline when AI is off (ADR-015 §I3).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "tire-pressure-trend-reasoning",
            name = "Tire pressure trend reasoning",
            description =
                "Opt-in LLM narrator that explains the recent 30-day trend in this vehicle's four corner tire " +
                    "pressures (front-left, front-right, rear-left, rear-right), the seasonality the change feed " +
                    "shows when paired with the same outside ambient temperature signal, and the most likely driver " +
                    "of any deviation from the deterministic soft-low / normal-min / normal-max / soft-high " +
                    "thresholds the canonical Tire Pressure page already shows. The narration may quote the per-tire " +
                    "latest, average, min, max, and rate-of-change-per-day, the soft and normal threshold band edges, " +
                    "the deterministic likely-cause hints the tool returns (cold-weather correlation, slow-leak " +
                    "signature, all-tires-trending suggesting weather rather than puncture), and the deterministic " +
                    "insights the tool returns; it never invents alternate thresholds, never reclassifies a tire as " +
                    "critical when the deterministic helper says low, and explicitly surfaces that the rate-of-change " +
                    "projection is a descriptive linear extrapolation rather than a predictive model. The " +
                    "deterministic Tire Pressure page (4-tire radial gauges, soft/hard warning banner, summary metric " +
                    "cards, pressure history chart, history table) remains the canonical baseline when AI is off. " +
                    "Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked " +
                    "transcript reveals neither the user's typical commute corridor nor the place names where a " +
                    "pressure event occurred.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "trip-planner-llm-agent",
            name = "Trip planner LLM agent",
            description =
                "Opt-in LLM-assisted trip planner that proposes a route + charger sequence by projecting the " +
                    "user's past charging history onto the corridor and delegating the actual plan to the canonical " +
                    "TripPlannerHandler.computePlan path. The deterministic heuristic planner at POST " +
                    "/api/v1/trip-planner/plan and the manual /trip-planner form remain the canonical baseline when " +
                    "AI is off; start/end locations and charger place names remain tagged by the per-feature " +
                    "redaction policy so only the vehicle name may be narrated.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "trip-postcard-share-card-image-generation",
            name = "Trip postcard and share-card image generation",
            description =
                "Opt-in LLM-backed propose-only assistant that drafts a typed share-card image-prompt plus a " +
                    "render-ready share-card preview envelope (proposed title, optional subtitle, image_prompt, " +
                    "optional style/palette hint) for ONE existing trip, grounded in the trip's route context " +
                    "(start_place, end_place, drive count, distance, time window). The strategy NEVER generates image " +
                    "bytes, NEVER calls an external image-generation provider, NEVER persists or uploads anything; " +
                    "the user reviews the structured proposal in the AI panel and applies it through the existing " +
                    "manual share-link controls on /sharing/trips. The static /s/:token shared-drive baseline and " +
                    "existing share-link generator / list / copy / revoke controls remain the canonical baseline when " +
                    "AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so " +
                    "a leaked transcript reveals neither the user's home/work locations nor exact route geometry.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "vampire-drain-explanation",
            name = "Vampire-drain explanation",
            description =
                "Opt-in LLM narrator that explains the deterministic vampire-drain (idle-energy-loss) signal — " +
                    "total observed parked hours, average / median / p95 drain rate per day, the recent worst event, " +
                    "and the most relevant per-event driver (Sentry on, ambient temperature, very long parked window) " +
                    "— grounded in the same numeric envelope the Vampire Drain page already renders. The AI surface " +
                    "narrates drivers and offers honest, non-mutating tips; it never invents events. The " +
                    "deterministic Vampire Drain summary cards, drain-rate trend chart, daily-drain bar chart, " +
                    "drain-sessions table, and tips panel remain the canonical baseline when AI is off. Per-feature " +
                    "redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript " +
                    "reveals neither the user's home charger address nor the locations they regularly park.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "vehicle-paint-preview",
            name = "Vehicle paint preview",
            description =
                "Opt-in LLM-backed propose-only assistant that drafts a typed paint-preview image-prompt envelope " +
                    "(proposed color, image prompt, optional style hint) for ONE existing vehicle grounded in the " +
                    "vehicle's read-only model / trim / current exterior color. The strategy NEVER generates image " +
                    "bytes, NEVER calls an external image-generation provider, NEVER persists or applies a new color; " +
                    "the user reviews the structured proposal in the AI panel and applies the new paint color through " +
                    "the existing manual per-vehicle Color setting on /vehicles/:vehicleId. The existing vehicle " +
                    "photo gallery + manual exterior_color row + manual theme/appearance settings remain the " +
                    "canonical baseline when AI is off. Per-feature redaction policy keeps every PII class tagged so " +
                    "a leaked transcript reveals neither the vehicle's display name nor VIN nor any location.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "voice-mode",
            name = "Helix voice mode",
            description =
                "Opt-in browser-local voice mode for the Helix chatbot on the /chatbot page. The browser handles " +
                    "speech-to-text (window.SpeechRecognition) and text-to-speech (window.speechSynthesis) entirely " +
                    "client-side — only the transcribed text is POSTed to /api/v1/ai/voice/chat and only the streamed " +
                    "text is spoken back. The backend strategy uses ONE read-only typed tool " +
                    "(stream_chatbot_response) that returns a deterministic envelope of recent chat history plus an " +
                    "install-wide vehicle snapshot so the LLM has the same class of grounding the text chatbot has, " +
                    "with a voice-specific system prompt that keeps replies conversational, short (1-3 sentences per " +
                    "turn), and free of markdown / lists / code blocks because TTS would otherwise read the syntax " +
                    "aloud. The user must explicitly press the mic button each turn — there is no always-on " +
                    "listening; the transcript draft is persisted to localStorage under " +
                    "'ai.voiceMode.transcriptDraft' so an interrupted browser session can recover the last unsent " +
                    "utterance. Per-feature redaction policy is PolicyChatbot (Allow=nil; every PII class is tagged " +
                    "round-trip before the provider sees the message). The deterministic text-only /chatbot baseline " +
                    "page remains the canonical surface when AI is off; the voice card is ABSENT (ADR-015 §I3 + §I5 + " +
                    "§I12), so no audio capture, no TTS playback, and no localStorage key are touched in off mode.",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "watch-face-nl-response",
            name = "Helix watch face natural-language response",
            description =
                "Opt-in Helix narrator on the /watch route that answers glance-style natural-language questions " +
                    "(battery, range, charging, locks, climate, recent alerts) about the install's primary vehicle. " +
                    "The narrator uses ONE read-only typed tool (query_watch_context) that returns a deterministic " +
                    "envelope mirroring the deterministic /watch card state (vehicle_name, soc_percent, range_km AND " +
                    "range_mi, is_charging, time_to_full_min, is_locked, sentry_mode, inside_temp_c AND " +
                    "inside_temp_f, outside_temp_c AND outside_temp_f, is_climate_on, recent_alerts (max 5, " +
                    "non-critical, {severity, age_seconds} pair only — NO alert title, message body, or kind tag " +
                    "because the canonical notification_log table has no stable kind enum and the title is a " +
                    "templated string that may contain custom rule names / vehicle names / place names), " +
                    "last_updated). Both °C AND pre-computed °F fields are emitted side by side for every temperature " +
                    "reading, and both km AND mi fields are emitted side by side for range — the LLM picks whichever " +
                    "matches the user's preferred display unit rather than doing arithmetic on small local models " +
                    "(cToFPtr precedent in drive_coaching.go). Replies are 1-2 sentences, plain prose only (no " +
                    "markdown, no lists, no code blocks, no URLs) because watch panels render plain text and are " +
                    "40-45 mm wide. The narrator is READ-only: it NEVER claims to have changed a setting, NEVER " +
                    "promises to send a vehicle command, NEVER says 'I have locked it' — the deterministic tap-icons " +
                    "on the watch face remain the only command path and continue to work regardless of whether this " +
                    "narrator is enabled. Per-feature redaction policy is PolicyChatbot (Allow=nil); the typed " +
                    "envelope omits PII (no GPS, no street names, no charger labels, no alert titles or message " +
                    "bodies) by construction, and the redaction policy is defence in depth in case a future edit " +
                    "widens the schema or the user's free-text question contains PII the policy will tag round-trip. " +
                    "The deterministic /watch route (battery gauge, status icons, tap-commands, /api/v1/watch/summary " +
                    "read path) remains the canonical surface when AI is off (ADR-015 §I3 + §I5 + §I6).",
            defaultOn = false,
        ),
        AiFeatureMeta(
            id = "yir-narration",
            name = "Year-in-review narration",
            description =
                "Opt-in LLM narration of the annual year-in-review slides. The deterministic template slides " +
                    "remain the baseline when AI is off.",
            defaultOn = false,
        ),
    )

/**
 * Read accessors over [AI_FEATURE_REGISTRY] mirroring the web exports: [features] is the ordered list
 * (web `AI_FEATURE_IDS` + `AI_FEATURES`), [ids] the ordered id list (web `AI_FEATURE_IDS`), and [byId] the
 * id → meta map (web `AI_FEATURES`). [isKnown] mirrors web `isKnownAiFeature`.
 */
object AiFeatureRegistry {
    /** All features in canonical order (web `AI_FEATURE_IDS`). */
    val features: List<AiFeatureMeta> = AI_FEATURE_REGISTRY

    /** Canonical ordered ids (web `AI_FEATURE_IDS`). */
    val ids: List<String> = features.map { it.id }

    /** id → meta (web `AI_FEATURES`). */
    val byId: Map<String, AiFeatureMeta> = features.associateBy { it.id }

    /** Whether [id] is a known registry feature (web `isKnownAiFeature`). */
    fun isKnown(id: String): Boolean = byId.containsKey(id)
}

/**
 * The web i18n keys (P1/S10) this surface reads and their Android string-resource names. Web keys carry dots
 * and feature ids carry hyphens; the Android catalog flattens both to underscores under a `translation_`
 * prefix (e.g. `ai.settings.feature.ai-provider-health.label` →
 * `translation_ai_settings_feature_ai_provider_health_label`). Pure string helpers, unit-tested off-device;
 * the composable resolves the resource name through `getIdentifier`, falling back to the registry text when
 * the catalog has no entry — the native analogue of the web `t(key, fallback)`.
 */
object AiFeatureI18n {
    /** Web `ai.settings.feature.legend` — the always-present section legend key. */
    const val LEGEND_KEY: String = "ai.settings.feature.legend"

    /** Web `ai.settings.feature.<id>.label`. */
    fun labelKey(id: String): String = "ai.settings.feature.$id.label"

    /** Web `ai.settings.feature.<id>.description`. */
    fun descriptionKey(id: String): String = "ai.settings.feature.$id.description"

    /** Maps a web i18n key to its Android string-resource name (`.`/`-` → `_`, `translation_` prefix). */
    fun resourceName(key: String): String = "translation_" + key.replace('.', '_').replace('-', '_')
}

/**
 * One fully projected toggle row — the render-ready native analogue of one web `AI_FEATURE_IDS.map` iteration.
 * Pure data (no Compose, no `Context`): the composable resolves [labelResourceName] / [descriptionResourceName]
 * through `getIdentifier`, falling back to [labelFallback] / [descriptionFallback], reads the toggle value from
 * the host `values` map, and tags the row / toggle with [rowTestTag] / [toggleTestTag] (web `data-testid`).
 */
data class AiFeatureRow(
    val id: String,
    val labelResourceName: String,
    val labelFallback: String,
    val descriptionResourceName: String,
    val descriptionFallback: String,
    val rowTestTag: String,
    val toggleTestTag: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-row derivations.
 * Stateless and side-effect-free, so it is fully covered by the off-device unit gate.
 */
object AIFeatureToggleListProjection {
    /** Web list `data-testid="ai-feature-toggle-list"`. */
    const val LIST_TEST_TAG: String = "ai-feature-toggle-list"

    /** Web per-row `data-testid={\`ai-feature-row-${id}\`}`. */
    fun rowTestTag(id: String): String = "ai-feature-row-$id"

    /** Web per-toggle `data-testid={\`ai-feature-toggle-${id}\`}`. */
    fun toggleTestTag(id: String): String = "ai-feature-toggle-$id"

    /** The Android resource name for the section legend (web `ai.settings.feature.legend`). */
    val legendResourceName: String = AiFeatureI18n.resourceName(AiFeatureI18n.LEGEND_KEY)

    /**
     * Projects [registry] into render-ready rows, preserving the canonical order. Each row carries its
     * catalog resource names and the registry fallbacks for the label + description, and its row/toggle test
     * tags. Defaults to the full [AiFeatureRegistry.features] (the web `AI_FEATURE_IDS`).
     */
    fun rows(registry: List<AiFeatureMeta> = AiFeatureRegistry.features): List<AiFeatureRow> =
        registry.map { meta ->
            AiFeatureRow(
                id = meta.id,
                labelResourceName = AiFeatureI18n.resourceName(AiFeatureI18n.labelKey(meta.id)),
                labelFallback = meta.name,
                descriptionResourceName = AiFeatureI18n.resourceName(AiFeatureI18n.descriptionKey(meta.id)),
                descriptionFallback = meta.description,
                rowTestTag = rowTestTag(meta.id),
                toggleTestTag = toggleTestTag(meta.id),
            )
        }

    /** Web `Boolean(values[id])` — an absent or false flag renders the toggle off. */
    fun isEnabled(
        values: Map<String, Boolean>,
        id: String,
    ): Boolean = values[id] == true
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AIFeatureToggleListRegistration {
    /** Stable surface id (matches the web list `data-testid`). */
    const val ID: String = "ai-feature-toggle-list"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AIFeatureToggleList"
}

private const val VIEW_OPENED_EVENT = "view.opened"
private const val SURFACE_FIELD = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AIFeatureToggleListRegistration.SLUG]
 * (P1/S11) — never a feature id or toggle value. Kept Compose-free so it is unit-tested with a recording
 * [Logger]; the composable calls it from its first-composition effect.
 */
fun recordAIFeatureToggleListOpened(logger: Logger) {
    logger.info(VIEW_OPENED_EVENT, mapOf(SURFACE_FIELD to AIFeatureToggleListRegistration.SLUG))
}
