//
//  AICrossRuleConflictDetection.Source.swift
//  TeslaSync — P4 shared surface · 0014 · AICrossRuleConflictDetection (Apple)
//
//  The in-memory `RuleConflictSource` for previews + unit/UI tests, split out of `…Model.swift`
//  (one file ≤ 400 lines per the SwiftLint contract). Drive it with `pushInput`,
//  `pushStreamState`, and `pushEvent`, and assert the forwarded action counts. No network, no
//  real store — the model under test is fully deterministic.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `pushInput`, `pushStreamState`,
/// and `pushEvent`, and assert the forwarded action counts (`startStreamCount`,
/// `cancelStreamCount`, `refreshCount`).
@MainActor
public final class InMemoryRuleConflictSource: RuleConflictSource {
    public var onInput: (@MainActor (RuleConflictInput) -> Void)?
    public var onStreamState: (@MainActor (RuleConflictStreamPhase) -> Void)?
    public var onEvent: (@MainActor (RuleConflictStreamEvent) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var startStreamCount = 0
    public private(set) var cancelStreamCount = 0

    private let initial: RuleConflictInput?

    public init(initial: RuleConflictInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onInput?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func startStream() {
        startStreamCount += 1
        onStreamState?(.streaming)
    }

    public func cancelStream() {
        cancelStreamCount += 1
    }

    /// Pushes a context snapshot to the bound model (test/preview affordance).
    public func pushInput(_ input: RuleConflictInput) {
        onInput?(input)
    }

    /// Pushes a stream-lifecycle transition to the bound model.
    public func pushStreamState(_ phase: RuleConflictStreamPhase) {
        onStreamState?(phase)
    }

    /// Pushes a parsed SSE event to the bound model.
    public func pushEvent(_ event: RuleConflictStreamEvent) {
        onEvent?(event)
    }

    /// Convenience: emit a successful `detect_rule_conflicts` tool_result carrying the given
    /// conflicts, mirroring the backend SSE frame the web `handleEvent` consumes. Pass an empty
    /// array to exercise the resolved-but-empty "no conflicts found" capture.
    public func pushConflicts(_ conflicts: [RuleConflict]) {
        let encoded = conflicts.map { RuleConflictJSONValue.object($0.encodedFields) }
        let data: [String: RuleConflictJSONValue] = ["conflicts": .array(encoded)]
        onEvent?(.toolResult(RuleConflictToolResult(
            id: "tr-1",
            name: RuleConflict.toolName,
            ok: true,
            data: data
        )))
        onStreamState?(.done)
    }
}

// MARK: - Encoding helper (round-trips a `RuleConflict` to the wire shape)

extension RuleConflict {
    /// The snake_case JSON object the backend SSE writer emits for one conflict — the inverse
    /// of `RuleConflict.list(from:)`. Used by `pushConflicts` so previews/tests exercise the
    /// real decode path rather than bypassing it.
    var encodedFields: [String: RuleConflictJSONValue] {
        var fields: [String: RuleConflictJSONValue] = [
            "kind": .string(kind),
            "rule_a_id": .number(Double(ruleAID)),
            "rule_b_id": .number(Double(ruleBID)),
            "severity_mismatch": .bool(severityMismatch),
            "cooldown_mismatch": .bool(cooldownMismatch),
            "trigger_mode_mismatch": .bool(triggerModeMismatch),
            "subsumes": .bool(subsumes)
        ]
        if let ruleAName { fields["rule_a_name"] = .string(ruleAName) }
        if let ruleBName { fields["rule_b_name"] = .string(ruleBName) }
        if let signalName { fields["signal_name"] = .string(signalName) }
        if let reason { fields["reason"] = .string(reason) }
        return fields
    }
}
