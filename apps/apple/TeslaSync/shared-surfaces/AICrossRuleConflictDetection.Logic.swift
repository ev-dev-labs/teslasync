//
//  AICrossRuleConflictDetection.Logic.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  The pure, view-free decision logic split out of `…Adapter.swift` (one file ≤ 400 lines
//  per the SwiftLint contract): the conflict-kind label mapping (web `labelForKind`), the
//  `AIFeatureCard` / `AiOutputPanel` button + visibility booleans, the request-body builder
//  (web memoised `body`), and the testable VoiceOver summary. Each function is a direct
//  translation of a web expression so the view is a pure function of these and every branch
//  is unit tested without rendering.
//

import Foundation

// MARK: - Conflict-kind label mapping (web `labelForKind`)

/// The native port of the web `labelForKind`: known kinds resolve to a localised label via
/// the returned `(key, fallback)`; an unknown kind has no mapping (web returns the raw kind
/// verbatim). Keeping the mapping here — not in the view — lets the i18n contract be asserted
/// without rendering.
public enum RuleConflictKind {
    /// Web `'redundant_duplicate'`.
    public static let redundantDuplicate = "redundant_duplicate"
    /// Web `'overlapping_threshold'`.
    public static let overlappingThreshold = "overlapping_threshold"

    /// The `(key, fallback)` for a known kind, or `nil` for an unknown kind (the web
    /// `return kind` branch). The view resolves the key through the P1/S10 facade and falls
    /// back to the raw kind string when this returns `nil`.
    public static func localization(for kind: String) -> (key: String, fallback: String)? {
        switch kind {
        case redundantDuplicate:
            (
                "notifications.alertStudio.aiConflicts.kind.redundant_duplicate",
                "Redundant duplicate"
            )
        case overlappingThreshold:
            (
                "notifications.alertStudio.aiConflicts.kind.overlapping_threshold",
                "Overlapping threshold"
            )
        default:
            nil
        }
    }
}

// MARK: - Structural-flag labels (web chip text, localised natively)

public extension RuleConflictFlag {
    /// The `(key, fallback)` for the chip label. The web row hardcodes the English chip text
    /// ("subsumes" / "severity mismatch" / …); the native surface routes every chip through the
    /// P1/S10 facade, so the keys are asserted by the i18n test.
    var localization: (key: String, fallback: String) {
        switch self {
        case .subsumes:
            ("notifications.alertStudio.aiConflicts.chip.subsumes", "Subsumes")
        case .severityMismatch:
            ("notifications.alertStudio.aiConflicts.chip.severityMismatch", "Severity mismatch")
        case .cooldownMismatch:
            ("notifications.alertStudio.aiConflicts.chip.cooldownMismatch", "Cooldown mismatch")
        case .triggerModeMismatch:
            ("notifications.alertStudio.aiConflicts.chip.triggerModeMismatch", "Trigger mode mismatch")
        }
    }

    /// Whether this chip is the amber/"warning" tone (`subsumes`) versus the rose/"danger" tone
    /// (the three `*Mismatch` flags) — the web colour split, kept pure for the snapshot test.
    var isWarningTone: Bool {
        self == .subsumes
    }
}

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure decision logic ported from `AIFeatureCard` and `AiOutputPanel`. Each function is
/// a direct translation of a web boolean so the view stays a pure function of these.
public enum RuleConflictLogic {
    /// The web minimum scope — you cannot have a conflict with fewer than two rules.
    public static let minRuleCount = 2

    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: RuleConflictStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart = ruleIds.length >= 2 && stream.state !== 'paused-confirm'`.
    public static func canStart(ruleCount: Int, phase: RuleConflictStreamPhase) -> Bool {
        ruleCount >= minRuleCount && phase != .pausedConfirm
    }

    /// Web `buttonDisabled = !canStart || isStreaming`, widened with the native leaf contract
    /// so the action cannot fire while offline (no stream is possible).
    public static func buttonDisabled(
        ruleCount: Int,
        phase: RuleConflictStreamPhase,
        connection: RuleConflictConnection
    ) -> Bool {
        let canStart = canStart(ruleCount: ruleCount, phase: phase)
        return !canStart || phase == .streaming || connection == .offline
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: RuleConflictStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: RuleConflictStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Web `conflicts != null && conflicts.length === 0` → the friendly "no conflicts" box.
    public static func showsEmptyMessage(_ conflicts: [RuleConflict]?) -> Bool {
        guard let conflicts else { return false }
        return conflicts.isEmpty
    }

    /// Web `conflicts != null && conflicts.length > 0` → the conflict list.
    public static func showsConflicts(_ conflicts: [RuleConflict]?) -> Bool {
        guard let conflicts else { return false }
        return !conflicts.isEmpty
    }
}

// MARK: - Request body (web memoised `body`)

/// Builds the SSE request body — the native mirror of the web memoised `body`: `rule_ids` is
/// always sent (the LLM sees the same scope the UI sees), and `vehicle_id` is included only
/// when non-nil. Pure so the wiring contract is asserted without a live stream.
public enum RuleConflictRequest {
    /// The backend path after the client strips the `/api/v1` prefix (web `useAiStream` url).
    public static let path = "/ai/alerts/rules/conflicts"

    /// Web `body = { rule_ids, ...(vehicleId != null ? { vehicle_id } : {}) }`.
    public static func body(ruleIDs: [Int64], vehicleID: Int64?) -> [String: RuleConflictJSONValue] {
        var out: [String: RuleConflictJSONValue] = [
            "rule_ids": .array(ruleIDs.map { .number(Double($0)) })
        ]
        if let vehicleID {
            out["vehicle_id"] = .number(Double(vehicleID))
        }
        return out
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the card from already-localised parts, so the spoken
/// content is asserted without rendering. Mirrors the visible reading order: the title, then
/// either the empty message (resolved, no conflicts) or one line per captured conflict
/// (kind label + relationship). A `nil` `conflicts` (nothing detected yet) reads as the
/// title alone.
public enum RuleConflictAccessibility {
    public static func summary(
        title: String,
        conflicts: [RuleConflict]?,
        emptyLabel: String,
        rulePrefix: String,
        kindLabel: (String) -> String
    ) -> String {
        var parts: [String] = [title]
        if let conflicts {
            if conflicts.isEmpty {
                parts.append(emptyLabel)
            } else {
                for conflict in conflicts {
                    let relation = conflict.relationDescription(rulePrefix: rulePrefix)
                    parts.append("\(kindLabel(conflict.kind)). \(relation)")
                }
            }
        }
        return parts.joined(separator: ". ")
    }
}
