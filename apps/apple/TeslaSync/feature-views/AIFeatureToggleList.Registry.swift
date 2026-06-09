//
//  AIFeatureToggleList.Registry.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  The canonical, ordered AI-feature catalogue — the native mirror of the generated TypeScript
//  registry web/src/ai/features.ts (`AI_FEATURE_IDS` + each entry's `name`), itself generated from
//  internal/ai/features/registry.go. The web AIFeatureToggleList maps over `AI_FEATURE_IDS` and reads
//  `AI_FEATURES[id].name` / `.description`; this surface reproduces that 1:1 by iterating
//  `AIFeatureRegistry.all` in the same order.
//
//  Only the id + the (short) display name live here; each feature's long-form blurb is the i18n
//  catalogue's job (AIFeatureToggleList.strings, keys `ai.settings.feature.<id>.description`), exactly
//  as the web resolves `t('ai.settings.feature.<id>.description', meta.description)`. The name doubles
//  as the web fallback for `t('ai.settings.feature.<id>.label', meta.name)`.
//
//  Foundation-only so the registry + the projection it feeds are host-testable without SwiftUI.
//

import Foundation

// MARK: - Feature descriptor (web `AiFeatureMeta` subset this surface consumes)

/// One AI feature as the toggle list consumes it — the canonical id plus its short display name (the
/// web `meta.name`, used as the `ai.settings.feature.<id>.label` fallback). The long description is
/// resolved from the i18n catalogue by id, never carried here.
public struct AIFeatureDescriptor: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

// MARK: - Registry (web `AI_FEATURE_IDS` order — never hand-reordered)

/// The ordered AI-feature catalogue, mirroring `AI_FEATURE_IDS` from the canonical TS registry. The
/// list is generated; adding a feature upstream re-generates this in lockstep, exactly like the web
/// `AIFeatureToggleList` picks up new registry entries automatically.
public enum AIFeatureRegistry {
    public static let all: [AIFeatureDescriptor] = [
        AIFeatureDescriptor(id: "__redaction_bypass__", name: "AI Redaction Bypass Report"),
        AIFeatureDescriptor(id: "__usage__", name: "AI Usage Card"),
        AIFeatureDescriptor(id: "ai-provider-health", name: "AI Provider Health (ops)"),
        AIFeatureDescriptor(id: "alert-tuning-suggestions", name: "Alert tuning suggestions"),
        AIFeatureDescriptor(id: "anomaly-explanations", name: "Anomaly explanation narration"),
        AIFeatureDescriptor(id: "auto-name-unnamed-locations", name: "Auto-name unnamed locations"),
        AIFeatureDescriptor(id: "auto-trip-naming", name: "Auto trip naming"),
        AIFeatureDescriptor(id: "battery-health-forecast-narrative", name: "Battery health forecast narrative"),
        AIFeatureDescriptor(id: "cabin-temperature-impact-narrative", name: "Cabin temperature impact narrative"),
        AIFeatureDescriptor(id: "charging-curve-fingerprint-clustering", name: "Charging-curve fingerprint clustering"),
        AIFeatureDescriptor(id: "charging-diagnosis", name: "Charging session diagnosis"),
        AIFeatureDescriptor(id: "chatbot-llm", name: "LLM Chatbot"),
        AIFeatureDescriptor(id: "cost-forecast-narration", name: "Cost forecast narration"),
        AIFeatureDescriptor(id: "cross-rule-conflict-detection", name: "Cross-rule conflict detection"),
        AIFeatureDescriptor(id: "data-repair-suggestions", name: "Data repair suggestions"),
        AIFeatureDescriptor(id: "digest-narration", name: "Weekly digest narration"),
        AIFeatureDescriptor(id: "drive-coaching", name: "Per-drive coaching"),
        AIFeatureDescriptor(id: "feedback-queue-triage", name: "Feedback queue triage"),
        AIFeatureDescriptor(id: "geofence-aware-automation-suggestions", name: "Geofence-aware automation suggestions"),
        AIFeatureDescriptor(id: "inbox-auto-categorization", name: "Inbox auto-categorization"),
        AIFeatureDescriptor(id: "incident-timeline-summarizer", name: "Incident timeline summarizer"),
        AIFeatureDescriptor(id: "learned-per-vehicle-anomaly-baselines", name: "Learned per-vehicle anomaly baselines"),
        AIFeatureDescriptor(id: "lifetime-stats-qa", name: "Lifetime stats Q&A"),
        AIFeatureDescriptor(id: "log-trace-summarization", name: "Log and trace summarization"),
        AIFeatureDescriptor(id: "ml-charging-curve-clustering", name: "Charging-curve clustering model"),
        AIFeatureDescriptor(id: "mqtt-sse-inspector-explanations", name: "MQTT and SSE inspector explanations"),
        AIFeatureDescriptor(id: "nl-alert-builder", name: "Natural-language alert builder"),
        AIFeatureDescriptor(id: "nl-automation-builder", name: "Natural-language automation builder"),
        AIFeatureDescriptor(id: "nl-dashboard-composer", name: "Helix natural-language dashboard composer"),
        AIFeatureDescriptor(id: "nl-drive-search-replay", name: "NL drive search and replay"),
        AIFeatureDescriptor(id: "nl-grafana-panel", name: "Helix natural-language Grafana panel"),
        AIFeatureDescriptor(id: "nl-search", name: "Natural-language search"),
        AIFeatureDescriptor(id: "nl-sql-playground", name: "Helix natural-language SQL playground"),
        AIFeatureDescriptor(id: "period-compare-narration", name: "Period compare narration"),
        AIFeatureDescriptor(id: "pii-redaction-shared-exports", name: "Helix export redaction advisor"),
        AIFeatureDescriptor(id: "predictive-maintenance", name: "Predictive maintenance"),
        AIFeatureDescriptor(id: "preheat-precool-recommender", name: "Preheat and precool recommender"),
        AIFeatureDescriptor(id: "quiet-hours-suggestion", name: "Helix quiet-hours suggestion"),
        AIFeatureDescriptor(id: "rag-help", name: "RAG-backed app help"),
        AIFeatureDescriptor(id: "range-prediction-model", name: "Range prediction model"),
        AIFeatureDescriptor(id: "route-efficiency-suggestions", name: "Route-efficiency suggestions"),
        AIFeatureDescriptor(id: "safety-setting-explainer", name: "Helix safety setting explainer"),
        AIFeatureDescriptor(id: "signal-explorer-nl-filter", name: "Signal explorer natural-language filter"),
        AIFeatureDescriptor(id: "smart-charge-schedule-suggestion", name: "Smart-charge schedule suggestion"),
        AIFeatureDescriptor(id: "software-update-changelog-summarizer", name: "Software update changelog summarizer"),
        AIFeatureDescriptor(id: "speed-profile-insights", name: "Speed-profile insights"),
        AIFeatureDescriptor(id: "state-machine-debugger-narrator", name: "State-machine debugger narrator"),
        AIFeatureDescriptor(id: "suggest-new-geofences", name: "Suggest new geofences"),
        AIFeatureDescriptor(id: "tco-narration", name: "TCO narration"),
        AIFeatureDescriptor(id: "tire-pressure-trend-reasoning", name: "Tire pressure trend reasoning"),
        AIFeatureDescriptor(id: "trip-planner-llm-agent", name: "Trip planner LLM agent"),
        AIFeatureDescriptor(
            id: "trip-postcard-share-card-image-generation",
            name: "Trip postcard and share-card image generation"
        ),
        AIFeatureDescriptor(id: "vampire-drain-explanation", name: "Vampire-drain explanation"),
        AIFeatureDescriptor(id: "vehicle-paint-preview", name: "Vehicle paint preview"),
        AIFeatureDescriptor(id: "voice-mode", name: "Helix voice mode"),
        AIFeatureDescriptor(id: "watch-face-nl-response", name: "Helix watch face natural-language response"),
        AIFeatureDescriptor(id: "yir-narration", name: "Year-in-review narration")
    ]
}
