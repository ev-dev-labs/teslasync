//
//  AICrossRuleConflictDetection.Adapter.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  The testable projection core for the "Detect cross-rule conflicts" Helix panel —
//  the SwiftUI parity of components/ai/AICrossRuleConflictDetection.tsx. Everything here
//  is pure + dependency-free (Foundation only — no SwiftUI, no Observation, no network),
//  so the typed `tool_result` → `[RuleConflict]` decode, the per-conflict relationship /
//  flag projection, and the stream-lifecycle types are all unit tested in isolation (and
//  in the SwiftPM harness) without rendering a view.
//
//  Parity note: the web `handleEvent` only captures a `tool_result` frame whose
//  `name === 'detect_rule_conflicts'` AND `ok === true`, requires `data.conflicts` to be
//  an array, then walks each element with `typeof` guards (`rule_a_id`/`rule_b_id` number,
//  `kind` string; optional `*_name` / `signal_name` / `reason` strings; the four mismatch
//  booleans via strict `=== true`) and drops anything that fails — never throwing, never
//  surfacing a partial conflict. `RuleConflict.list(from:)` reproduces that walk exactly,
//  and an empty (but non-nil) result is the distinct "no conflicts found" capture.
//

import Foundation

// MARK: - Surface identity (P1/S11 slug + web `withAiFeature` id)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`)
/// and the AI feature id the web `withAiFeature` gates on. Kept here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum RuleConflictSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "AICrossRuleConflictDetection"
    /// The AI feature id (web `withAiFeature('cross-rule-conflict-detection', …)`).
    public static let featureID = "cross-rule-conflict-detection"
}

// MARK: - JSON value (the `tool_result.data` payload element)

/// A minimal, `Sendable` JSON value — the native mirror of the untyped `ev.data` object
/// the web `handleEvent` narrows with `typeof` guards. Kept deliberately small (the only
/// shapes the SSE writer emits for this tool) so the decode stays a pure, exhaustively
/// tested function rather than a reflection-driven coder.
public enum RuleConflictJSONValue: Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: RuleConflictJSONValue])
    case array([RuleConflictJSONValue])
    case null

    /// The string payload (web `typeof x === 'string'`), or `nil` for any other kind.
    public var stringValue: String? {
        if case let .string(value) = self { return value }
        return nil
    }

    /// The numeric payload (web `typeof x === 'number'`), or `nil` for any other kind.
    public var numberValue: Double? {
        if case let .number(value) = self { return value }
        return nil
    }

    /// The boolean payload — only a literal `true`/`false` (web strict `=== true`).
    public var boolValue: Bool? {
        if case let .bool(value) = self { return value }
        return nil
    }

    /// The nested object (web `typeof raw === 'object'`), or `nil` for any other kind.
    public var objectValue: [String: RuleConflictJSONValue]? {
        if case let .object(value) = self { return value }
        return nil
    }

    /// The array payload (web `Array.isArray(data.conflicts)`), or `nil` otherwise.
    public var arrayValue: [RuleConflictJSONValue]? {
        if case let .array(value) = self { return value }
        return nil
    }
}

// MARK: - Tool result (web `AiStreamEvent` `tool_result` case)

/// One decoded `tool_result` SSE frame — the native mirror of the web event's
/// `{ id, name, ok, data, error }` shape. The view never sees this type; the state-holder
/// forwards it to `RuleConflict.list(from:)`.
public struct RuleConflictToolResult: Equatable, Sendable {
    public let id: String
    public let name: String
    public let ok: Bool
    public let data: [String: RuleConflictJSONValue]?
    public let error: String?

    public init(
        id: String,
        name: String,
        ok: Bool,
        data: [String: RuleConflictJSONValue]? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.name = name
        self.ok = ok
        self.data = data
        self.error = error
    }
}

// MARK: - Structural mismatch flags (web per-conflict chips)

/// The structural-mismatch chips the web row renders, in the web's source order. `subsumes`
/// is the amber/"warning" chip; the three `*Mismatch` flags are the rose/"danger" chips.
/// Modelling them as an enum keeps the active set + ordering pure and unit tested, with the
/// tone + localisation resolved in the view.
public enum RuleConflictFlag: String, CaseIterable, Sendable {
    case subsumes
    case severityMismatch
    case cooldownMismatch
    case triggerModeMismatch
}

// MARK: - Rule conflict (web `RuleConflict` envelope)

/// The typed envelope returned by the `detect_rule_conflicts` tool — the native mirror of
/// the web `RuleConflict` interface (internal/ai/tools/cross_rule_conflict.go `RuleConflict`).
/// Kept narrow so the Helix panel only renders fields it actually uses; `kind` stays the
/// web's open `'redundant_duplicate' | 'overlapping_threshold' | string`.
public struct RuleConflict: Equatable, Sendable, Identifiable {
    /// The conflict class — a known kind (mapped to a label) or an unknown raw string.
    public let kind: String
    /// The first offending rule's id.
    public let ruleAID: Int64
    /// The second offending rule's id.
    public let ruleBID: Int64
    /// The first rule's display name, when the tool echoed one.
    public let ruleAName: String?
    /// The second rule's display name, when the tool echoed one.
    public let ruleBName: String?
    /// The signal both rules watch, when relevant.
    public let signalName: String?
    /// The human-readable rationale, shown under the relationship line.
    public let reason: String?
    /// Whether the two rules' severities disagree (rose chip).
    public let severityMismatch: Bool
    /// Whether the two rules' cooldowns disagree (rose chip).
    public let cooldownMismatch: Bool
    /// Whether the two rules' trigger modes disagree (rose chip).
    public let triggerModeMismatch: Bool
    /// Whether rule A structurally subsumes rule B (amber chip).
    public let subsumes: Bool

    public init(
        kind: String,
        ruleAID: Int64,
        ruleBID: Int64,
        ruleAName: String? = nil,
        ruleBName: String? = nil,
        signalName: String? = nil,
        reason: String? = nil,
        severityMismatch: Bool = false,
        cooldownMismatch: Bool = false,
        triggerModeMismatch: Bool = false,
        subsumes: Bool = false
    ) {
        self.kind = kind
        self.ruleAID = ruleAID
        self.ruleBID = ruleBID
        self.ruleAName = ruleAName
        self.ruleBName = ruleBName
        self.signalName = signalName
        self.reason = reason
        self.severityMismatch = severityMismatch
        self.cooldownMismatch = cooldownMismatch
        self.triggerModeMismatch = triggerModeMismatch
        self.subsumes = subsumes
    }

    /// The stable list identity — the web React `key={kind:ruleA:ruleB}`.
    public var id: String {
        "\(kind):\(ruleAID):\(ruleBID)"
    }

    /// The tool whose `tool_result` frame carries conflicts (web
    /// `ev.name === 'detect_rule_conflicts'`).
    public static let toolName = "detect_rule_conflicts"

    /// The active mismatch chips in the web's render order (subsumes first, then the three
    /// `*Mismatch` flags). Empty when the conflict carries no structural flags.
    public func activeFlags() -> [RuleConflictFlag] {
        var flags: [RuleConflictFlag] = []
        if subsumes { flags.append(.subsumes) }
        if severityMismatch { flags.append(.severityMismatch) }
        if cooldownMismatch { flags.append(.cooldownMismatch) }
        if triggerModeMismatch { flags.append(.triggerModeMismatch) }
        return flags
    }

    /// The "Rule {a}{ (name)} ↔ Rule {b}{ (name)}{ · signal}" relationship line — the web
    /// secondary text under the kind label. `rulePrefix` is the localised "Rule" word.
    public func relationDescription(rulePrefix: String) -> String {
        var left = "\(rulePrefix) \(ruleAID)"
        if let ruleAName, !ruleAName.isEmpty { left += " (\(ruleAName))" }
        var right = "\(rulePrefix) \(ruleBID)"
        if let ruleBName, !ruleBName.isEmpty { right += " (\(ruleBName))" }
        var line = "\(left) ↔ \(right)"
        if let signalName, !signalName.isEmpty { line += " · \(signalName)" }
        return line
    }

    /// Native port of the web `handleEvent` walk: accept the frame only when it is the
    /// conflict tool, succeeded, and carries a `conflicts` array; then build a `RuleConflict`
    /// per element that has a `rule_a_id` + `rule_b_id` number and a `kind` string, dropping
    /// any element that fails (the web `continue`). Returns `nil` when the frame itself is
    /// rejected (web early `return`); returns an empty array for a valid-but-empty result
    /// (the distinct "no conflicts found" capture).
    public static func list(from result: RuleConflictToolResult) -> [RuleConflict]? {
        guard result.name == toolName, result.ok, let data = result.data else { return nil }
        guard let rawConflicts = data["conflicts"]?.arrayValue else { return nil }
        var out: [RuleConflict] = []
        for raw in rawConflicts {
            guard let object = raw.objectValue else { continue }
            guard
                let ruleA = object["rule_a_id"]?.numberValue,
                let ruleB = object["rule_b_id"]?.numberValue,
                let kind = object["kind"]?.stringValue
            else {
                continue
            }
            out.append(RuleConflict(
                kind: kind,
                ruleAID: Int64(ruleA),
                ruleBID: Int64(ruleB),
                ruleAName: object["rule_a_name"]?.stringValue,
                ruleBName: object["rule_b_name"]?.stringValue,
                signalName: object["signal_name"]?.stringValue,
                reason: object["reason"]?.stringValue,
                severityMismatch: object["severity_mismatch"]?.boolValue == true,
                cooldownMismatch: object["cooldown_mismatch"]?.boolValue == true,
                triggerModeMismatch: object["trigger_mode_mismatch"]?.boolValue == true,
                subsumes: object["subsumes"]?.boolValue == true
            ))
        }
        return out
    }
}

// MARK: - Stream lifecycle (web `AiStreamState`)

/// The user-facing stream lifecycle — the native port of the web
/// `'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error'`. `pausedConfirm` blocks a
/// new `start()` (web `canStart`), `streaming` flips the button to "Helix is thinking…".
public enum RuleConflictStreamPhase: Equatable, Sendable {
    case idle
    case streaming
    case pausedConfirm
    case done
    case error(String)

    /// Web `stream.state === 'error'`.
    public var isError: Bool {
        if case .error = self { return true }
        return false
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound feature-gate / context snapshot — the orthogonal connectivity
/// axis rendered as the header chip + banner. `live` hides the banner.
public enum RuleConflictConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Feature gate (web `withAiFeature` / `useAiEnabled`)

/// The AI-Off gate state (ADR-015) — the native mirror of `useAiEnabled(feature)`. `loading`
/// shows skeleton chrome while the gate resolves; `off` collapses the surface to nothing
/// (web `withAiFeature` returns `null`); `on` renders the card.
public enum RuleConflictGateState: String, Sendable, Equatable, CaseIterable {
    case loading
    case on
    case off
}
