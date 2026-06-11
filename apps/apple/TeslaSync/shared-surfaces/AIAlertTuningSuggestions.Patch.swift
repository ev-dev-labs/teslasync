//
//  AIAlertTuningSuggestions.Patch.swift
//  TeslaSync — P4 shared surface · 0004 · AIAlertTuningSuggestions (Apple)
//
//  The typed proposed-patch value captured from `tool_result` frames — split from the Adapter so each
//  file stays within the repo's SwiftLint file-length budget. Pure Foundation: the per-field `typeof`
//  guards, the ordered preview rows, and the empty-patch predicate are unit tested in isolation
//  against the exact web `AlertRuleDraftPatch` capture expressions.
//

import Foundation

// MARK: - Proposed patch (web `AlertRuleDraftPatch`)

/// The subset of AlertRule scalars the LLM is allowed to propose — the native port of the web
/// `AlertRuleDraftPatch` interface (which itself mirrors the `proposed` fields of
/// internal/ai/tools/alert_tuning.go's AlertRulePatchProposal). Keeping it narrow prevents the Helix
/// panel from over-writing fields the user did not consent to changing (signal_name, vehicle scope).
public struct AlertRuleDraftPatch: Sendable, Equatable {
    public var valueNum: Double?
    public var valueMin: Double?
    public var valueMax: Double?
    public var cooldownMin: Int?
    public var severity: String?
    public var triggerMode: String?
    public var op: String?

    public init(
        valueNum: Double? = nil,
        valueMin: Double? = nil,
        valueMax: Double? = nil,
        cooldownMin: Int? = nil,
        severity: String? = nil,
        triggerMode: String? = nil,
        op: String? = nil
    ) {
        self.valueNum = valueNum
        self.valueMin = valueMin
        self.valueMax = valueMax
        self.cooldownMin = cooldownMin
        self.severity = severity
        self.triggerMode = triggerMode
        self.op = op
    }

    /// True when the LLM proposed no recognised field. A present-but-empty `proposed` object still
    /// yields a (non-nil) empty patch — matching the web, where `{}` is truthy and sets the proposal.
    public var isEmpty: Bool {
        valueNum == nil && valueMin == nil && valueMax == nil && cooldownMin == nil
            && severity == nil && triggerMode == nil && op == nil
    }

    /// The ordered `(field, value)` rows for the preview list — the exact web render order
    /// (value_num, value_min, value_max, cooldown_min, severity, trigger_mode, op), only the present
    /// fields included. The field identifiers are the literal AlertRule schema names (not localized
    /// — they are technical tokens, rendered code-style, exactly like the web `value_num: {n}`).
    public func rows() -> [(field: String, value: String)] {
        var out: [(field: String, value: String)] = []
        if let valueNum { out.append(("value_num", Self.format(valueNum))) }
        if let valueMin { out.append(("value_min", Self.format(valueMin))) }
        if let valueMax { out.append(("value_max", Self.format(valueMax))) }
        if let cooldownMin { out.append(("cooldown_min", String(cooldownMin))) }
        if let severity { out.append(("severity", severity)) }
        if let triggerMode { out.append(("trigger_mode", triggerMode)) }
        if let op { out.append(("op", op)) }
        return out
    }

    /// Extracts a typed patch from a decoded `proposed` JSON object — the native port of the web
    /// per-field `typeof` guards. Numeric fields are taken only from real numbers (a JSON bool, which
    /// `JSONSerialization` also bridges to `NSNumber`, is rejected to mirror JS `typeof === 'number'`,
    /// where `true`/`false` are booleans, not numbers); string fields only when non-empty.
    public static func extract(fromProposed proposed: [String: Any]) -> AlertRuleDraftPatch {
        AlertRuleDraftPatch(
            valueNum: number(proposed["value_num"]),
            valueMin: number(proposed["value_min"]),
            valueMax: number(proposed["value_max"]),
            cooldownMin: number(proposed["cooldown_min"]).map { Int($0) },
            severity: nonEmptyString(proposed["severity"]),
            triggerMode: nonEmptyString(proposed["trigger_mode"]),
            op: nonEmptyString(proposed["op"])
        )
    }

    /// A JSON number coerced to `Double`, rejecting booleans (whose `NSNumber` objCType is "c").
    private static func number(_ value: Any?) -> Double? {
        guard let num = value as? NSNumber else { return nil }
        if CFGetTypeID(num) == CFBooleanGetTypeID() { return nil }
        return num.doubleValue
    }

    /// A non-empty JSON string (web `typeof === 'string' && value !== ''`).
    private static func nonEmptyString(_ value: Any?) -> String? {
        guard let str = value as? String, !str.isEmpty else { return nil }
        return str
    }

    /// Renders a proposed scalar without a trailing `.0` (15.0 → "15", 15.5 → "15.5"), matching the
    /// way the web prints a JS number into the preview list.
    static func format(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }
}
