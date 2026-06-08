//
//  ConflictWarnings.Adapter.swift
//  TeslaSync — P4 feature view · 0084 · ConflictWarnings (Apple)
//
//  The testable projection core — the SwiftUI parity of
//  features/automations/pages/ConflictWarnings.tsx. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the severity →
//  variant/icon mapping, the `"{name}": {reason}` body composition, the stable
//  row keys, and the VoiceOver summary are unit tested in isolation.
//
//  The web component is a presentational leaf fed by its parent
//  (AutomationBuilderPage) `conflicts` prop. It maps each AutomationConflict to
//  an AlertBanner whose variant + icon branch on `severity` (`warning` →
//  warning/AlertTriangle, otherwise → info/Info), with a constant title and a
//  `"{automation_name}": {reason}` body, and renders nothing when the list is
//  empty. This file ports that mapping; the empty/loading/error/stale/offline
//  chrome required by the P4 states contract is resolved in the Model.
//

import Foundation

// MARK: - Wire value types (web @/api/types AutomationConflict shape)

/// The conflict severity reported in `conflict.severity` (web union
/// `'warning' | 'info'`). The web picks the warning variant only on an exact
/// `=== 'warning'` match and falls through to info for everything else, so any
/// unrecognized wire value decodes to `.info` to preserve that behavior.
public enum ConflictWarningsAutomationConflictSeverity: String, Sendable, Equatable, CaseIterable {
    case warning
    case info

    /// Maps a raw wire string to a severity, defaulting unknowns to `.info`
    /// (the web `severity === 'warning' ? 'warning' : 'info'` else branch).
    public init(wire: String) {
        self = ConflictWarningsAutomationConflictSeverity(rawValue: wire) ?? .info
    }

    /// SF Symbol parity with the web lucide icon (`AlertTriangle` / `Info`).
    public var iconSystemName: String {
        switch self {
        case .warning: "exclamationmark.triangle.fill"
        case .info: "info.circle.fill"
        }
    }
}

/// One automation conflict (web `AutomationConflict`): the offending automation,
/// a human-readable reason, and the severity that drives the banner tone + icon.
public struct AutomationConflict: Sendable, Equatable, Identifiable {
    public var automationId: Int
    public var automationName: String
    public var reason: String
    public var severity: ConflictWarningsAutomationConflictSeverity

    public var id: Int {
        automationId
    }

    public init(
        automationId: Int,
        automationName: String,
        reason: String,
        severity: ConflictWarningsAutomationConflictSeverity
    ) {
        self.automationId = automationId
        self.automationName = automationName
        self.reason = reason
        self.severity = severity
    }
}

// MARK: - Projection (web `conflicts.map((c, i) => <AlertBanner .../>)`)

/// One display-ready conflict banner row: a stable identity (web key
/// `${automation_id}-${i}`), the severity (→ tone + icon at the view layer), and
/// the pre-composed `"{name}": {reason}` detail the banner body renders verbatim.
public struct ConflictWarningRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let severity: ConflictWarningsAutomationConflictSeverity
    public let automationName: String
    public let reason: String

    public init(
        id: String,
        severity: ConflictWarningsAutomationConflictSeverity,
        automationName: String,
        reason: String
    ) {
        self.id = id
        self.severity = severity
        self.automationName = automationName
        self.reason = reason
    }

    /// SF Symbol for the banner's leading icon (severity parity with web).
    public var iconSystemName: String {
        severity.iconSystemName
    }

    /// The banner body, byte-for-byte the web template `"${name}": ${reason}`.
    public var detail: String {
        "\"\(automationName)\": \(reason)"
    }
}

/// Pure projection from the wire conflicts to display rows. Preserves order and
/// reproduces the web list key (`${automation_id}-${index}`) so repeated
/// automation ids still yield stable, distinct SwiftUI identities.
public enum ConflictWarningsProjection {
    public static func rows(from conflicts: [AutomationConflict]) -> [ConflictWarningRow] {
        conflicts.enumerated().map { index, conflict in
            ConflictWarningRow(
                id: "\(conflict.automationId)-\(index)",
                severity: conflict.severity,
                automationName: conflict.automationName,
                reason: conflict.reason
            )
        }
    }
}

// MARK: - Copy catalog (web `t(key, default)` — every string the surface resolves)

/// One localizable string: its catalog key plus the web English fallback. Keeping
/// the pair as a value lets the view resolve through the P1/S10 facade while tests
/// assert the key set without a bundle.
public struct CWText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    public func resolved(_ localize: (String, String) -> String) -> String {
        localize(key, fallback)
    }
}

/// The surface's full copy catalog — the one web-source key
/// (`automations.builder.conflict`) plus the native chrome/a11y strings the P4
/// states contract requires. The `.strings` table carries the same key set.
public enum CWCopy {
    public static let title = CWText("automations.builder.conflict", "Potential Conflict")
    public static let severityWarning = CWText("automations.conflicts.severity.warning", "Warning")
    public static let severityInfo = CWText("automations.conflicts.severity.info", "Info")
    public static let emptyTitle = CWText("automations.conflicts.empty.title", "No conflicts detected")
    public static let emptyMessage = CWText(
        "automations.conflicts.empty.message",
        "This automation doesn't overlap with any existing automation."
    )
    public static let loading = CWText("automations.conflicts.loading", "Checking for conflicts…")
    public static let errorMessage = CWText(
        "automations.conflicts.error.message",
        "Could not check for automation conflicts."
    )
    public static let retry = CWText("automations.conflicts.retry", "Retry")
    public static let stale = CWText("automations.conflicts.stale", "Conflict check may be out of date")
    public static let offline = CWText("automations.conflicts.offline", "Offline — showing last known conflicts")

    /// Every catalog entry — used by the keys-coverage unit test.
    public static let all: [CWText] = [
        title, severityWarning, severityInfo, emptyTitle, emptyMessage,
        loading, errorMessage, retry, stale, offline
    ]

    /// The localized severity word for a row's VoiceOver summary.
    public static func severityWord(for severity: ConflictWarningsAutomationConflictSeverity) -> CWText {
        switch severity {
        case .warning: severityWarning
        case .info: severityInfo
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a conflict banner so the spoken content is
/// asserted without rendering the view: the localized title, the localized
/// severity word, then the verbatim `"{name}": {reason}` detail.
public enum ConflictWarningsAccessibility {
    public static func bannerSummary(
        title: String,
        severityWord: String,
        detail: String
    ) -> String {
        "\(title), \(severityWord). \(detail)"
    }
}
