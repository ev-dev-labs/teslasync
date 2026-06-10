//
//  AIInboxAutoCategorization.Logic.swift
//  TeslaSync — P4 shared surface · 0021 · AIInboxAutoCategorization (Apple)
//
//  The pure, view-free decision logic split out of `…Adapter.swift` (one file ≤ 400 lines per
//  the SwiftLint contract): the `AIFeatureCard` / `AiOutputPanel` button + visibility booleans,
//  the captured-proposal "Apply" rule-id collection (web `allRuleIds`), the memoised request body
//  (web `body`), and the testable VoiceOver summary. Each function is a direct translation of a
//  web expression so the view is a pure function of these and every branch is unit tested without
//  rendering.
//

import Foundation

// MARK: - Pure button / output logic (web `AIFeatureCard` + `AiOutputPanel` branches)

/// The pure decision logic ported from `AIFeatureCard`, `AiOutputPanel`, and the web `Apply`
/// button. Each function is a direct translation of a web boolean so the view stays a pure
/// function of these.
public enum InboxCategoryLogic {
    /// Web `isBusy = stream.state === 'streaming' || stream.state === 'paused-confirm'`.
    public static func isBusy(_ phase: InboxCategoryStreamPhase) -> Bool {
        phase == .streaming || phase == .pausedConfirm
    }

    /// Web `canStart={stream.state !== 'paused-confirm'}` — the suggest button has no scope
    /// minimum; only an in-flight confirmation pause blocks a fresh categorize run.
    public static func canStart(phase: InboxCategoryStreamPhase) -> Bool {
        phase != .pausedConfirm
    }

    /// The suggest button's disabled flag — web `disabled = !canStart || isStreaming`, widened
    /// with the native leaf contract so the action cannot fire while offline (no stream possible).
    public static func suggestDisabled(
        phase: InboxCategoryStreamPhase,
        connection: InboxCategoryConnection
    ) -> Bool {
        !canStart(phase: phase) || phase == .streaming || connection == .offline
    }

    /// Web `applyDisabled = allRuleIds.length === 0 || isBusy` — the "Apply categories as filter"
    /// button is enabled only once at least one rule id has been captured and no stream is busy.
    public static func applyDisabled(
        buckets: [InboxCategoryBucket]?,
        phase: InboxCategoryStreamPhase
    ) -> Bool {
        allRuleIDs(buckets).isEmpty || isBusy(phase)
    }

    /// Web `allRuleIds`: the de-duplicated, ascending union of every `rule_ids` value across every
    /// captured bucket — the canonical baseline-narrowing payload forwarded to the parent filter.
    public static func allRuleIDs(_ buckets: [InboxCategoryBucket]?) -> [Int64] {
        guard let buckets else { return [] }
        var seen = Set<Int64>()
        for bucket in buckets {
            guard let ids = bucket.ruleIDs else { continue }
            for id in ids {
                seen.insert(id)
            }
        }
        return seen.sorted()
    }

    /// Web `AiOutputPanel` `hasAnything = text.length > 0 || state ∈ {streaming, error, done}`.
    public static func outputVisible(phase: InboxCategoryStreamPhase, hasText: Bool) -> Bool {
        hasText || phase == .streaming || phase == .done || phase.isError
    }

    /// Web `text.length === 0 && state === 'streaming'` → the animated thinking indicator.
    public static func thinkingVisible(phase: InboxCategoryStreamPhase, hasText: Bool) -> Bool {
        !hasText && phase == .streaming
    }

    /// Web `proposal && proposal.length > 0` → the proposed-category chip list + Apply button.
    public static func showsProposal(_ buckets: [InboxCategoryBucket]?) -> Bool {
        guard let buckets else { return false }
        return !buckets.isEmpty
    }

    /// The resolved-but-empty capture (`proposal != nil && proposal.isEmpty`) → the friendly "no
    /// categories suggested" box. The web silently shows nothing here; the native leaf renders a
    /// message so the surface is never a blank box (P4).
    public static func showsEmptyProposal(_ buckets: [InboxCategoryBucket]?) -> Bool {
        guard let buckets else { return false }
        return buckets.isEmpty
    }
}

// MARK: - Request (web memoised `body` + `useAiStream` url)

/// Builds the SSE request — the native mirror of the web memoised `body`: every field is optional
/// and only emitted when it carries a value (web drops `null` vehicleId / null windowDays / empty
/// severities / empty ruleIds to match the backend handler's optional-field contract). Pure so the
/// wiring contract is asserted without a live stream.
public enum InboxCategoryRequest {
    /// The backend path after the client strips the `/api/v1` prefix (web `useAiStream` url).
    public static let path = "/ai/alerts/inbox/categorize"

    /// Web `body`: `{ ...(vehicleId != null ? { vehicle_id } : {}), ...(windowDays != null ?
    /// { window_days } : {}), ...(severities.length ? { severities } : {}), ...(ruleIds.length ?
    /// { rule_ids } : {}) }`.
    public static func body(
        vehicleID: Int64?,
        windowDays: Int?,
        severities: [String],
        ruleIDs: [Int64]
    ) -> [String: InboxCategoryJSONValue] {
        var out: [String: InboxCategoryJSONValue] = [:]
        if let vehicleID {
            out["vehicle_id"] = .number(Double(vehicleID))
        }
        if let windowDays {
            out["window_days"] = .number(Double(windowDays))
        }
        if !severities.isEmpty {
            out["severities"] = .array(severities.map { .string($0) })
        }
        if !ruleIDs.isEmpty {
            out["rule_ids"] = .array(ruleIDs.map { .number(Double($0)) })
        }
        return out
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the card from already-localised parts, so the spoken content
/// is asserted without rendering. Mirrors the visible reading order: the title, then either the
/// empty message (resolved, no categories) or one "{category}, {count}" line per captured bucket.
/// A `nil` proposal (nothing suggested yet) reads as the title alone.
public enum InboxCategoryAccessibility {
    public static func summary(
        title: String,
        buckets: [InboxCategoryBucket]?,
        emptyLabel: String,
        countLabel: (Int) -> String
    ) -> String {
        var parts: [String] = [title]
        if let buckets {
            if buckets.isEmpty {
                parts.append(emptyLabel)
            } else {
                for bucket in buckets {
                    parts.append("\(bucket.category), \(countLabel(bucket.count))")
                }
            }
        }
        return parts.joined(separator: ". ")
    }
}
