//
//  AlertStudioPage.Adapter.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The pure, testable projection core for the AlertStudioPage surface (part 1) — the
//  native ports of the web helpers the page derives from: the operator option lists,
//  the severity rank, the severity / trigger-mode / snooze normalisers, the
//  `templateKey` slug, the numeric parsers, the escalation-payload builder, the
//  operator classification, the signal-type inference + catalog, and the value-kind
//  ladder. The hydration / validation / payload / filter ports live in
//  AlertStudioPage.Adapter.Logic.swift. No SwiftUI and no I/O — every branch the web
//  source carries is decided here so the XCTest suite covers it without a host.
//

import Foundation

/// The wire sub-payload for `AlertRuleInput`'s vehicle targeting (web
/// `buildVehiclePayload` return), always carrying both flags (Decision D11/D14).
public struct ASVehiclePayload: Sendable, Equatable {
    public let allVehicles: Bool
    public let vehicleIDs: [Int64]

    public init(allVehicles: Bool, vehicleIDs: [Int64]) {
        self.allVehicles = allVehicles
        self.vehicleIDs = vehicleIDs
    }
}

/// The three localized-string resolvers the template filter searches over (web
/// `getTemplateName` / `getTemplateMessage` / `getTemplateCategory`).
public struct ASTemplateResolvers {
    public let name: (RuleTemplate) -> String
    public let message: (RuleTemplate) -> String
    public let category: (String) -> String

    public init(
        name: @escaping (RuleTemplate) -> String,
        message: @escaping (RuleTemplate) -> String,
        category: @escaping (String) -> String
    ) {
        self.name = name
        self.message = message
        self.category = category
    }
}

public enum AlertStudioAdapter {
    // MARK: - Operator option lists (web `numericOperatorOptions` / `scalarOperatorOptions`)

    /// Web `numericOperatorOptions`.
    public static let numericOperatorOptions: [ASRuleOp] = [
        .equal, .notEqual, .lessThan, .lessThanOrEqual, .greaterThan, .greaterThanOrEqual,
        .changed, .between, .outside
    ]

    /// Web `scalarOperatorOptions`.
    public static let scalarOperatorOptions: [ASRuleOp] = [.equal, .notEqual, .changed]

    /// Web `customSignalCategory = '__custom__'`.
    public static let customSignalCategory = "__custom__"

    /// Web `SEVERITY_RANK = { info: 1, warn: 2, critical: 3 }`. Must match the Go
    /// `alertSeverityRank` helper used by the escalation higher-severity check.
    public static func severityRank(_ severity: ASSeverity) -> Int {
        switch severity {
        case .info: 1
        case .warn: 2
        case .critical: 3
        }
    }

    // MARK: - Normalisers (web `normalizeSeverity` / `normalizeTriggerMode` / `isSnoozeActive`)

    /// Web `normalizeSeverity(value)`: tolerant fold onto the canonical union; the legacy
    /// `warning` alias becomes `warn`, everything else unknown becomes `info`.
    public static func normalizeSeverity(_ value: String?) -> ASSeverity {
        switch value {
        case "info": .info
        case "warn": .warn
        case "critical": .critical
        case "warning": .warn
        default: .info
        }
    }

    /// Web `normalizeTriggerMode(value)`: `once`/`repeat` pass through, anything else
    /// (incl. `nil`) defaults to `repeat`.
    public static func normalizeTriggerMode(_ value: String?) -> ASTriggerMode {
        value == "once" ? .once : .repeatMode
    }

    /// Web `isSnoozeActive(snoozedUntil)`: a parseable timestamp strictly in the future.
    public static func isSnoozeActive(_ snoozedUntil: String?, now: Date = Date()) -> Bool {
        guard let snoozedUntil, let date = ASDateParse.iso(snoozedUntil) else { return false }
        return date > now
    }

    // MARK: - Slug + numeric parsers (web `templateKey` / `parseOptional*`)

    /// Web `templateKey(value)`: lowercase, non-alphanumerics → `.`, trim dots.
    public static func templateKey(_ value: String) -> String {
        let lowered = value.lowercased()
        let collapsed = lowered.replacingOccurrences(
            of: "[^a-z0-9]+",
            with: ".",
            options: .regularExpression
        )
        return collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    }

    /// Web `valueToInput(value)`: `nil` → `""`, otherwise the number's string form
    /// (integers render without a trailing `.0`, matching JS `String(n)`).
    public static func valueToInput(_ value: Double?) -> String {
        guard let value else { return "" }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// Web `parseOptionalNumber(value)`: blank → `nil`, else a finite parse or `nil`.
    public static func parseOptionalNumber(_ value: String) -> Double? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        guard let parsed = Double(trimmed), parsed.isFinite else { return nil }
        return parsed
    }

    /// Web `parseOptionalMaxFires(value)`: blank → `nil`, else a positive integer or
    /// `nil` (fractional / non-positive collapse to `nil`).
    public static func parseOptionalMaxFires(_ value: String) -> Int? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { return nil }
        guard let parsed = Double(trimmed), parsed.isFinite else { return nil }
        guard parsed > 0, parsed == parsed.rounded() else { return nil }
        return Int(parsed)
    }

    /// Web `normalizeMsgTemplateForSave(value)`: whitespace-only collapses to `nil`.
    public static func normalizeMsgTemplateForSave(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: - Escalation payload (web `buildEscalationPayload`)

    /// Web `buildEscalationPayload(state, triggerMode)`: both `nil` unless the rule is
    /// repeat-mode, escalation is enabled, the after-minutes parse, and a severity is
    /// chosen; otherwise the populated pair.
    public static func buildEscalationPayload(
        _ state: EditorState,
        triggerMode: ASTriggerMode
    ) -> (afterMin: Int?, severity: ASSeverity?) {
        guard triggerMode == .repeatMode, state.escalationEnabled else { return (nil, nil) }
        guard let after = parseOptionalMaxFires(state.escalationAfterMin),
              let severity = state.escalationSeverity
        else {
            return (nil, nil)
        }
        return (after, severity)
    }

    // MARK: - Operator classification (web `isNumericOnlyOp` / `isRangeOp`)

    /// Web `isNumericOnlyOp(op)`.
    public static func isNumericOnlyOp(_ op: ASRuleOp) -> Bool {
        op == .lessThan || op == .lessThanOrEqual || op == .greaterThan || op == .greaterThanOrEqual
    }

    /// Web `isRangeOp(op)`.
    public static func isRangeOp(_ op: ASRuleOp) -> Bool {
        op == .between || op == .outside
    }

    // MARK: - Signal-type inference (web `inferTemplateSignalType` / `mergeSignalType`)

    /// Web `inferTemplateSignalType(template)`.
    public static func inferTemplateSignalType(_ template: RuleTemplate) -> ASSignalValueType {
        let isNumeric = template.valueNum != nil || template.valueMin != nil || template.valueMax != nil
            || isNumericOnlyOp(template.op) || isRangeOp(template.op)
        if isNumeric { return .numeric }
        if template.valueBool != nil { return .bool }
        return .text
    }

    /// Web `mergeSignalType(current, next)`.
    public static func mergeSignalType(_ current: ASSignalValueType, _ next: ASSignalValueType) -> ASSignalValueType {
        if current == next { return current }
        if current == .numeric || next == .numeric { return .numeric }
        if current == .bool || next == .bool { return .bool }
        return .text
    }

    /// Web `buildSignalCatalog(templates)`: one `SignalDefinition` per signal name,
    /// merging types across templates, sorted by category then name.
    public static func buildSignalCatalog(_ templates: [RuleTemplate]) -> [SignalDefinition] {
        var byName: [String: SignalDefinition] = [:]
        var order: [String] = []
        for template in templates {
            let valueType = inferTemplateSignalType(template)
            if var existing = byName[template.signalName] {
                existing.valueType = mergeSignalType(existing.valueType, valueType)
                byName[template.signalName] = existing
            } else {
                byName[template.signalName] = SignalDefinition(
                    name: template.signalName,
                    category: template.category,
                    valueType: valueType
                )
                order.append(template.signalName)
            }
        }
        return order.compactMap { byName[$0] }.sorted { lhs, rhs in
            lhs.category != rhs.category ? lhs.category < rhs.category : lhs.name < rhs.name
        }
    }

    // MARK: - Value-kind ladder (web `signalTypeFor*` / `valueKindFor*` / `allowedOps*`)

    /// Web `signalTypeForValueKind(valueKind)`.
    public static func signalTypeForValueKind(_ valueKind: ASValueKind) -> ASSignalValueType {
        switch valueKind {
        case .bool: .bool
        case .text, .none: .text
        case .number, .range: .numeric
        }
    }

    /// Web `signalTypeForName(signalName, fallbackKind)`.
    public static func signalTypeForName(_ signalName: String, fallbackKind: ASValueKind) -> ASSignalValueType {
        AlertStudioTemplates.signalCatalogByName[signalName]?.valueType ?? signalTypeForValueKind(fallbackKind)
    }

    /// Web `allowedOpsForSignalType(valueType)`.
    public static func allowedOpsForSignalType(_ valueType: ASSignalValueType) -> [ASRuleOp] {
        valueType == .numeric ? numericOperatorOptions : scalarOperatorOptions
    }

    /// Web `coerceOperatorForSignalType(op, valueType)`.
    public static func coerceOperatorForSignalType(_ op: ASRuleOp, _ valueType: ASSignalValueType) -> ASRuleOp {
        allowedOpsForSignalType(valueType).contains(op) ? op : .equal
    }

    /// Web `valueKindForSignalOp(valueType, op)`.
    public static func valueKindForSignalOp(_ valueType: ASSignalValueType, _ op: ASRuleOp) -> ASValueKind {
        if op == .changed { return .none }
        if valueType == .numeric { return isRangeOp(op) ? .range : .number }
        if valueType == .bool { return .bool }
        return .text
    }

    /// Web `valueKindForState(state)`.
    public static func valueKindForState(_ state: EditorState) -> ASValueKind {
        valueKindForSignalOp(signalTypeForName(state.signalName, fallbackKind: state.valueKind), state.op)
    }

    /// Web `isOperatorAllowedForState(state)`.
    public static func isOperatorAllowedForState(_ state: EditorState) -> Bool {
        let type = signalTypeForName(state.signalName, fallbackKind: state.valueKind)
        return allowedOpsForSignalType(type).contains(state.op)
    }

    /// Web `inferValueKind(rule)`.
    public static func inferValueKind(_ rule: ASAlertRule) -> ASValueKind {
        if isRangeOp(rule.op) || rule.valueMin != nil || rule.valueMax != nil { return .range }
        if rule.valueBool != nil { return .bool }
        if rule.valueText != nil { return .text }
        if rule.valueNum != nil { return .number }
        return rule.op == .changed ? .none : .number
    }

    /// Web `inferTemplateValueKind(template)`.
    public static func inferTemplateValueKind(_ template: RuleTemplate) -> ASValueKind {
        valueKindForSignalOp(inferTemplateSignalType(template), template.op)
    }
}
