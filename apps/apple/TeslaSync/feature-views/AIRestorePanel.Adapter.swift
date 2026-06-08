//
//  AIRestorePanel.Adapter.swift
//  TeslaSync — P4 feature view · 0201 · AIRestorePanel (Apple)
//
//  The testable projection core for the "Restore previous Helix selection?" panel —
//  the SwiftUI parity of features/settings/components/AIRestorePanel.tsx and the
//  `@/ai/features` catalog it leans on. Everything here is pure + dependency-free
//  (no store, no bundle, no rendered view) so the archived-selection preview, the
//  known/unknown feature resolution, and the spoken summary are all unit tested in
//  isolation.
//
//  Parity note: the web `previewLabels` walks the archived map in order, drops the
//  `false` entries, resolves a known feature id to its translated label (falling back
//  to the `AI_FEATURES[id].name`), and renders an unknown id verbatim so the listing
//  is never blank. This core reproduces that walk exactly — the catalog below is the
//  native mirror of the frozen `AI_FEATURES` name table (57 features).
//

import Foundation

// MARK: - Archived selection entry (web `Record<string, boolean>` element)

/// One archived feature flag — the native, order-preserving mirror of a
/// `Object.entries(archived)` pair. `enabled` is the boolean the server stored for a
/// prior mode→off transition; only `enabled == true` entries are offered for restore.
public struct AIArchivedEntry: Equatable, Sendable {
    public let id: String
    public let enabled: Bool

    public init(id: String, enabled: Bool) {
        self.id = id
        self.enabled = enabled
    }
}

// MARK: - Resolved preview label (web `previewLabels` output element)

/// One resolved preview row — the native mirror of a web `previewLabels` entry. A
/// known feature carries its i18n `labelKey` plus the catalog English `fallback`; an
/// unknown id carries a `nil` key and the raw id as its `fallback`, so the view
/// resolves known labels through the P1/S10 facade and renders unknown ids verbatim.
public struct AIRestoreLabel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String?
    public let fallback: String
    public let isKnown: Bool

    public init(id: String, labelKey: String?, fallback: String, isKnown: Bool) {
        self.id = id
        self.labelKey = labelKey
        self.fallback = fallback
        self.isKnown = isKnown
    }
}

// MARK: - Feature catalog (native port of `@/ai/features`)

/// The frozen Helix feature catalog — the native mirror of the web `AI_FEATURES`
/// name table and `isKnownAiFeature` guard. The view never hardcodes a feature name;
/// it reads the English `name(for:)` as the i18n fallback exactly like the web source
/// reads `AI_FEATURES[id].name`.
public enum AIFeatureCatalog {
    /// The per-feature i18n key the web builds as `ai.settings.feature.${id}.label`.
    public static func labelKey(for id: String) -> String {
        "ai.settings.feature.\(id).label"
    }

    /// Native port of `isKnownAiFeature(id)` — membership in the frozen catalog.
    public static func isKnown(_ id: String) -> Bool {
        names[id] != nil
    }

    /// The English display name for a known feature (web `AI_FEATURES[id].name`), or
    /// `nil` when the id is not in the catalog.
    public static func name(for id: String) -> String? {
        names[id]
    }

    /// The frozen id→name table — a verbatim port of the web `AI_FEATURES` names.
    static let names: [String: String] = [
        "__redaction_bypass__": "AI Redaction Bypass Report",
        "__usage__": "AI Usage Card",
        "ai-provider-health": "AI Provider Health (ops)",
        "alert-tuning-suggestions": "Alert tuning suggestions",
        "anomaly-explanations": "Anomaly explanation narration",
        "auto-name-unnamed-locations": "Auto-name unnamed locations",
        "auto-trip-naming": "Auto trip naming",
        "battery-health-forecast-narrative": "Battery health forecast narrative",
        "cabin-temperature-impact-narrative": "Cabin temperature impact narrative",
        "charging-curve-fingerprint-clustering": "Charging-curve fingerprint clustering",
        "charging-diagnosis": "Charging session diagnosis",
        "chatbot-llm": "LLM Chatbot",
        "cost-forecast-narration": "Cost forecast narration",
        "cross-rule-conflict-detection": "Cross-rule conflict detection",
        "data-repair-suggestions": "Data repair suggestions",
        "digest-narration": "Weekly digest narration",
        "drive-coaching": "Per-drive coaching",
        "feedback-queue-triage": "Feedback queue triage",
        "geofence-aware-automation-suggestions": "Geofence-aware automation suggestions",
        "inbox-auto-categorization": "Inbox auto-categorization",
        "incident-timeline-summarizer": "Incident timeline summarizer",
        "learned-per-vehicle-anomaly-baselines": "Learned per-vehicle anomaly baselines",
        "lifetime-stats-qa": "Lifetime stats Q&A",
        "log-trace-summarization": "Log and trace summarization",
        "ml-charging-curve-clustering": "Charging-curve clustering model",
        "mqtt-sse-inspector-explanations": "MQTT and SSE inspector explanations",
        "nl-alert-builder": "Natural-language alert builder",
        "nl-automation-builder": "Natural-language automation builder",
        "nl-dashboard-composer": "Helix natural-language dashboard composer",
        "nl-drive-search-replay": "NL drive search and replay",
        "nl-grafana-panel": "Helix natural-language Grafana panel",
        "nl-search": "Natural-language search",
        "nl-sql-playground": "Helix natural-language SQL playground",
        "period-compare-narration": "Period compare narration",
        "pii-redaction-shared-exports": "Helix export redaction advisor",
        "predictive-maintenance": "Predictive maintenance",
        "preheat-precool-recommender": "Preheat and precool recommender",
        "quiet-hours-suggestion": "Helix quiet-hours suggestion",
        "rag-help": "RAG-backed app help",
        "range-prediction-model": "Range prediction model",
        "route-efficiency-suggestions": "Route-efficiency suggestions",
        "safety-setting-explainer": "Helix safety setting explainer",
        "signal-explorer-nl-filter": "Signal explorer natural-language filter",
        "smart-charge-schedule-suggestion": "Smart-charge schedule suggestion",
        "software-update-changelog-summarizer": "Software update changelog summarizer",
        "speed-profile-insights": "Speed-profile insights",
        "state-machine-debugger-narrator": "State-machine debugger narrator",
        "suggest-new-geofences": "Suggest new geofences",
        "tco-narration": "TCO narration",
        "tire-pressure-trend-reasoning": "Tire pressure trend reasoning",
        "trip-planner-llm-agent": "Trip planner LLM agent",
        "trip-postcard-share-card-image-generation": "Trip postcard and share-card image generation",
        "vampire-drain-explanation": "Vampire-drain explanation",
        "vehicle-paint-preview": "Vehicle paint preview",
        "voice-mode": "Helix voice mode",
        "watch-face-nl-response": "Helix watch face natural-language response",
        "yir-narration": "Year-in-review narration"
    ]
}

// MARK: - Preview labels (native port of `previewLabels`)

/// Builds the ordered preview of restorable feature labels — the native port of the
/// web `previewLabels`. The archived entries are walked in order, the disabled
/// (`enabled == false`) ones are dropped, a known id resolves to its catalog label,
/// and an unknown id falls back to the raw id so the listing is never blank.
public enum AIRestorePreview {
    public static func labels(for archived: [AIArchivedEntry]) -> [AIRestoreLabel] {
        var out: [AIRestoreLabel] = []
        for entry in archived where entry.enabled {
            if let name = AIFeatureCatalog.name(for: entry.id) {
                out.append(AIRestoreLabel(
                    id: entry.id,
                    labelKey: AIFeatureCatalog.labelKey(for: entry.id),
                    fallback: name,
                    isKnown: true
                ))
            } else {
                out.append(AIRestoreLabel(
                    id: entry.id,
                    labelKey: nil,
                    fallback: entry.id,
                    isKnown: false
                ))
            }
        }
        return out
    }

    /// Native port of `archiveHasRestorableEntries` — at least one `enabled` entry.
    public static func hasRestorableEntries(_ archived: [AIArchivedEntry]) -> Bool {
        archived.contains { $0.enabled }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for the alert from already-localised parts, so the
/// spoken content is asserted without rendering the view. Mirrors the web
/// `role="alert"` announcement: the title, the description, then the feature names.
public enum AIRestoreAccessibility {
    public static func summary(title: String, description: String, features: [String]) -> String {
        guard !features.isEmpty else {
            return "\(title) \(description)"
        }
        return "\(title) \(description) \(features.joined(separator: ", "))"
    }
}
