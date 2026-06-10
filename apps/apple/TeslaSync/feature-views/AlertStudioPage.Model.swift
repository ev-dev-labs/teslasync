//
//  AlertStudioPage.Model.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The foundation of the SwiftUI parity of
//  web/src/features/notifications/pages/AlertStudioPage.tsx — the typed alert-rule
//  editor page. This file owns the surface identity (P1/S11 `view.opened`
//  diagnostics slug), the telemetry seam, the P1/S10 i18n facade (`ASStrings`) +
//  injectable localizer (`ASLocalizer`), the date-formatting facade, the verbatim
//  web key descriptors, every wire-shaped value type the page reads/writes
//  (`ASAlertRule`, `ASAlertRuleInput`, channels, vehicles, computed-metric
//  summaries, snooze + test requests), the canonical editor enums (severity,
//  operator, value-kind, trigger selection, rule kind), and the `EditorState` the
//  rule builder edits. No SwiftUI and no networking live here.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `AlertStudioPage` feature view. The slug
/// is the value emitted with the P1/S11 `view.opened` diagnostics contract and is
/// referenced by both the view and its tests so the two never drift.
public enum AlertStudioSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "AlertStudioPage"

    /// Reports the surface becoming visible. Factored out of the view's `.task` so it
    /// is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any AlertStudioTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can each
/// supply their own sink. `Sendable` so the view can emit from its `.task`.
public protocol AlertStudioTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no rule name, signal, or VIN is
/// ever recorded.
public struct OSLogAlertStudioTelemetry: AlertStudioTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the views
/// hold no hardcoded literals. Keys live in the per-surface "AlertStudioPage" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its strings without catalog collisions.
public enum ASStrings {
    public static let table = "AlertStudioPage"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves an `ASText` descriptor (web `t(key, fallback)`).
    public static func string(_ text: ASText) -> String {
        string(text.key, text.fallback)
    }

    /// Resolves then substitutes a single `{{token}}` (web i18next interpolation).
    public static func format(_ text: ASText, _ token: String, _ value: String) -> String {
        string(text).replacingOccurrences(of: "{{\(token)}}", with: value)
    }
}

/// A localizable string descriptor — the web `t(key, fallback)` pair. Kept as a value
/// so the catalog key and its English default never drift apart.
public struct ASText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }
}

/// A thin localization seam so the pure projections stay testable: production passes
/// the `ASStrings` facade (real catalog + English fallback); tests pass `echo`
/// (returns the fallback / interpolates it directly).
public struct ASLocalizer: Sendable {
    public let string: @Sendable (ASText) -> String
    public let format: @Sendable (ASText, String, String) -> String

    public init(
        string: @escaping @Sendable (ASText) -> String,
        format: @escaping @Sendable (ASText, String, String) -> String
    ) {
        self.string = string
        self.format = format
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = ASLocalizer(
        string: ASStrings.string,
        format: ASStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = ASLocalizer(
        string: { $0.fallback },
        format: { text, token, value in
            text.fallback.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
    )
}

// MARK: - Date-formatting facade (web `formatDateTime`)

/// Formats the rule's `updated_at` / snooze timestamps the rows + snooze sheet render
/// (web `formatDateTime`). Production injects a settings-backed implementation
/// (locale + 12/24h); previews/tests use `DefaultAlertStudioDateFormatting`.
public protocol AlertStudioDateFormatting: Sendable {
    func dateTime(_ iso: String) -> String
}

/// Bundle-free default: a medium date + short time, matching the web `formatDateTime`
/// closely enough for parity. Invalid/empty input renders the em-dash. Stateless.
public struct DefaultAlertStudioDateFormatting: AlertStudioDateFormatting {
    private let localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }

    public func dateTime(_ iso: String) -> String {
        guard let date = ASDateParse.iso(iso) else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

/// Lenient ISO-8601 parsing (with or without fractional seconds), matching the web
/// `Date.parse` / `new Date(iso)` the page relies on for snooze + timestamps.
public enum ASDateParse {
    public static func iso(_ iso: String) -> Date? {
        if iso.isEmpty { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}

// MARK: - Canonical editor enums (web union types)

/// Web `Severity = 'info' | 'warn' | 'critical'` (`AlertRuleSeverity`). `normalize`
/// lives in the adapter (web `normalizeSeverity`).
public enum ASSeverity: String, Sendable, Equatable, CaseIterable {
    case info
    case warn
    case critical
}

/// Web `RuleOp` (`AlertRuleOp`). `rawValue` is the exact wire/symbol the backend
/// stores and the editor renders.
public enum ASRuleOp: String, Sendable, Equatable, CaseIterable {
    case equal = "="
    case notEqual = "!="
    case lessThan = "<"
    case lessThanOrEqual = "<="
    case greaterThan = ">"
    case greaterThanOrEqual = ">="
    case changed
    case between
    case outside
}

/// Web `ValueKind = 'none' | 'number' | 'text' | 'bool' | 'range'` — which operand
/// editor the signal-rule form renders.
public enum ASValueKind: String, Sendable, Equatable {
    case none
    case number
    case text
    case bool
    case range
}

/// Web `AlertRuleTriggerMode = 'once' | 'repeat'` — the persisted re-alert behavior.
public enum ASTriggerMode: String, Sendable, Equatable {
    case once
    case repeatMode = "repeat"
}

/// Web `TriggerModeOrUnset` — the editor-only tri-state. `unset` exists purely so a
/// brand-new rule can be in the "user hasn't decided yet" state and Save can block
/// until they choose (Decision D3 "force-choose").
public enum ASTriggerSelection: String, Sendable, Equatable, CaseIterable {
    case unset
    case once
    case repeatMode = "repeat"

    /// The persisted mode, or `nil` while still `unset`.
    public var mode: ASTriggerMode? {
        switch self {
        case .unset: nil
        case .once: .once
        case .repeatMode: .repeatMode
        }
    }

    /// The `<select>` value (web `editor.trigger_mode === 'unset' ? '' : …`).
    public var selectValue: String {
        self == .unset ? "" : rawValue
    }
}

/// Web `AlertRuleKind = 'signal' | 'computed_metric'`.
public enum ASRuleKind: String, Sendable, Equatable {
    case signal
    case computedMetric = "computed_metric"
}

/// Web `ComputedMetricOp`.
public enum ASComputedMetricOp: String, Sendable, Equatable, CaseIterable {
    case greaterThan = ">"
    case greaterThanOrEqual = ">="
    case lessThan = "<"
    case lessThanOrEqual = "<="
    case equal = "="
    case notEqual = "!="
    case percentChangeGreater = "%_change_>"
    case percentChangeLess = "%_change_<"
}

/// Web `SignalValueType = 'numeric' | 'text' | 'bool'`.
public enum ASSignalValueType: String, Sendable, Equatable {
    case numeric
    case text
    case bool
}

// MARK: - Catalog value types (web `RuleTemplate` / `SignalDefinition`)

/// One curated rule template (web `RuleTemplate`). `systemImage` is the native SF
/// Symbol port of the web `icon: ElementType`; the comparison operands are carried as
/// optionals exactly as the web literal table declares them.
public struct RuleTemplate: Sendable, Equatable, Identifiable {
    public let name: String
    public let systemImage: String
    public let category: String
    public let severity: ASSeverity
    public let message: String
    public let cooldownMin: Int
    public let signalName: String
    public let op: ASRuleOp
    public let valueNum: Double?
    public let valueText: String?
    public let valueBool: Bool?
    public let valueMin: Double?
    public let valueMax: Double?

    public var id: String {
        name
    }

    public init(
        name: String,
        systemImage: String,
        category: String,
        severity: ASSeverity,
        message: String,
        cooldownMin: Int,
        signalName: String,
        op: ASRuleOp,
        valueNum: Double? = nil,
        valueText: String? = nil,
        valueBool: Bool? = nil,
        valueMin: Double? = nil,
        valueMax: Double? = nil
    ) {
        self.name = name
        self.systemImage = systemImage
        self.category = category
        self.severity = severity
        self.message = message
        self.cooldownMin = cooldownMin
        self.signalName = signalName
        self.op = op
        self.valueNum = valueNum
        self.valueText = valueText
        self.valueBool = valueBool
        self.valueMin = valueMin
        self.valueMax = valueMax
    }
}

/// One entry in the derived signal catalog (web `SignalDefinition`).
public struct SignalDefinition: Sendable, Equatable, Identifiable {
    public let name: String
    public let category: String
    public var valueType: ASSignalValueType

    public var id: String {
        name
    }

    public init(name: String, category: String, valueType: ASSignalValueType) {
        self.name = name
        self.category = category
        self.valueType = valueType
    }
}
