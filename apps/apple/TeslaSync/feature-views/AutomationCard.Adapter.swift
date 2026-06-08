//
//  AutomationCard.Adapter.swift
//  TeslaSync — P4 feature view · 0082 · AutomationCard (Apple)
//
//  The pure, testable projection core for the AutomationCard surface: the web
//  `getUIStatus` + `statusStyles` map, the `handleToggle` branch, the `timeAgo`
//  helper, the stat-row pieces, the conflict tint, the kebab-menu item set (incl.
//  the auto-disabled-only Re-enable), the delete `ConfirmDialog` content, the live
//  freshness chip, and the VoiceOver summaries. No SwiftUI and no I/O — every
//  branch the web source carries is decided here so the XCTest suite can cover it
//  without a rendering host (the same approach the sibling feature views use).
//

import Foundation

// MARK: - Localizer (P1/S10 facade injection)

/// A thin localization seam so the pure projections stay testable: production
/// passes the `AutomationCardStrings` facade (real catalog + English fallback),
/// tests pass `echo` (returns the fallback / formats it directly).
public struct AutomationCardLocalizer: Sendable {
    public let string: @Sendable (String, String) -> String
    public let format: @Sendable (String, String, String) -> String

    public init(
        string: @escaping @Sendable (String, String) -> String,
        format: @escaping @Sendable (String, String, String) -> String
    ) {
        self.string = string
        self.format = format
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = AutomationCardLocalizer(
        string: AutomationCardStrings.string,
        format: AutomationCardStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = AutomationCardLocalizer(
        string: { _, fallback in fallback },
        format: { _, fallbackFormat, argument in String(format: fallbackFormat, argument) }
    )
}

// MARK: - Status (web `getUIStatus` + `statusStyles`)

/// The UI status of an automation — the port of the web `AutomationUIStatus`
/// (`'active' | 'disabled' | 'auto-disabled'`) with its label key + badge tone.
public enum AutomationStatus: String, Equatable, Sendable, CaseIterable {
    case active
    case disabled
    case autoDisabled

    /// Web `getUIStatus`: auto-disabled wins, then disabled, then active.
    public static func project(autoDisabled: Bool, enabled: Bool) -> AutomationStatus {
        if autoDisabled { return .autoDisabled }
        if !enabled { return .disabled }
        return .active
    }

    public static func project(_ data: AutomationCardData) -> AutomationStatus {
        project(autoDisabled: data.autoDisabled, enabled: data.enabled)
    }

    /// i18n key — web `automations.status.${uiStatus}` (the raw web status slug).
    public var labelKey: String {
        "automations.status.\(webSlug)"
    }

    /// The web status slug used in the i18n key (`auto-disabled`, not `autoDisabled`).
    public var webSlug: String {
        switch self {
        case .active: "active"
        case .disabled: "disabled"
        case .autoDisabled: "auto-disabled"
        }
    }

    /// English fallback — web `statusStyles[status].label`.
    public var labelFallback: String {
        switch self {
        case .active: "Active"
        case .disabled: "Disabled"
        case .autoDisabled: "Auto-Disabled"
        }
    }

    /// Badge tone — web `variant` (`success` / `neutral` / `danger`).
    public var tone: TSTone {
        switch self {
        case .active: .success
        case .disabled: .neutral
        case .autoDisabled: .danger
        }
    }
}

// MARK: - Toggle (web `handleToggle` + the displayed checked state)

/// The settled intent of flipping the automation switch — the port of the web
/// `handleToggle`: an auto-disabled automation flipped on re-enables; otherwise it
/// is a plain enable/disable toggle.
public enum AutomationToggleIntent: Equatable, Sendable {
    case toggle(id: Int64, enabled: Bool)
    case reEnable(id: Int64)

    /// Web `handleToggle(checked)`.
    public static func resolve(_ data: AutomationCardData, checked: Bool) -> AutomationToggleIntent {
        if data.autoDisabled, checked {
            return .reEnable(id: data.id)
        }
        return .toggle(id: data.id, enabled: checked)
    }

    /// Web `checked={a.auto_disabled ? false : a.enabled}`.
    public static func displayedChecked(_ data: AutomationCardData) -> Bool {
        data.autoDisabled ? false : data.enabled
    }
}

// MARK: - Kebab menu (web actions menu)

/// The role of a menu item, driving its tint + native button role.
public enum AutomationMenuRole: Equatable, Sendable {
    case normal
    case accent
    case destructive
}

/// One kebab-menu action — the port of the web actions menu items. `reEnable` is
/// present only when the automation is auto-disabled (web conditional render).
public enum AutomationMenuItemKind: String, Equatable, Sendable {
    case testRun
    case reEnable
    case duplicate
    case export
    case delete

    /// The ordered set the menu renders, gated on `autoDisabled` exactly like the
    /// web (`Test Run`, then `Re-enable` iff auto-disabled, then `Duplicate`,
    /// `Export`, `Delete`).
    public static func items(autoDisabled: Bool) -> [AutomationMenuItemKind] {
        var items: [AutomationMenuItemKind] = [.testRun]
        if autoDisabled { items.append(.reEnable) }
        items.append(contentsOf: [.duplicate, .export, .delete])
        return items
    }

    public var labelKey: String {
        switch self {
        case .testRun: "automations.testRun"
        case .reEnable: "automations.reEnable"
        case .duplicate: "automations.duplicate"
        case .export: "automations.export"
        case .delete: "automations.delete"
        }
    }

    public var labelFallback: String {
        switch self {
        case .testRun: "Test Run"
        case .reEnable: "Re-enable"
        case .duplicate: "Duplicate"
        case .export: "Export"
        case .delete: "Delete"
        }
    }

    public var systemImage: String {
        switch self {
        case .testRun: "play.fill"
        case .reEnable: "arrow.counterclockwise"
        case .duplicate: "doc.on.doc"
        case .export: "square.and.arrow.down"
        case .delete: "trash"
        }
    }

    public var role: AutomationMenuRole {
        switch self {
        case .reEnable: .accent
        case .delete: .destructive
        default: .normal
        }
    }
}

// MARK: - Conflicts (web severity → tint)

/// The conflict row tint — the port of the web
/// `c.severity === 'warning' ? amber : blue` branch.
public enum AutomationConflictSeverity: Equatable, Sendable {
    case warning
    case info

    public static func project(_ severity: String) -> AutomationConflictSeverity {
        severity == "warning" ? .warning : .info
    }

    public var tone: TSTone {
        switch self {
        case .warning: .warning
        case .info: .info
        }
    }
}

// MARK: - Freshness (live / stale / offline chip for the firing flag)

/// The firing/freshness chip projection — `live` shows the animated "Firing"
/// pulse (web), `stale`/`offline` downgrade to a static chip so the card never
/// implies activity it cannot prove.
public enum AutomationFreshnessChip: Equatable, Sendable {
    case firing
    case stale
    case offline

    public static func project(isFiring: Bool, connection: AutomationLiveConnection) -> AutomationFreshnessChip? {
        switch connection {
        case .offline: .offline
        case .stale: .stale
        case .live: isFiring ? .firing : nil
        }
    }

    public var labelKey: String {
        switch self {
        case .firing: "automations.firing"
        case .stale: "automations.freshness.stale"
        case .offline: "automations.freshness.offline"
        }
    }

    public var labelFallback: String {
        switch self {
        case .firing: "Firing"
        case .stale: "Stale"
        case .offline: "Offline"
        }
    }

    public var systemImage: String {
        switch self {
        case .firing: "bolt.fill"
        case .stale: "clock.arrow.circlepath"
        case .offline: "wifi.slash"
        }
    }

    public var tone: TSTone {
        switch self {
        case .firing: .accent
        case .stale: .warning
        case .offline: .neutral
        }
    }
}

// MARK: - Time + date formatting (web `timeAgo` + `formatDateTime`)

/// Pure copy builders for the relative + absolute timestamps the stat row shows.
public enum AutomationTimeFormat {
    /// Web `timeAgo(iso)`: `—` / `just now` / `Xm ago` / `Xh ago` / `Xd ago`,
    /// routed through the localizer so no English is hardcoded.
    public static func timeAgo(
        _ iso: String?,
        now: Date,
        localize: AutomationCardLocalizer
    ) -> String {
        guard let iso, let date = isoDate(iso) else {
            return localize.string("automations.value.none", "—")
        }
        let minutes = Int(now.timeIntervalSince(date) / 60)
        if minutes < 1 { return localize.string("automations.timeAgo.justNow", "just now") }
        if minutes < 60 { return localize.format("automations.timeAgo.minutes", "%@m ago", String(minutes)) }
        let hours = minutes / 60
        if hours < 24 { return localize.format("automations.timeAgo.hours", "%@h ago", String(hours)) }
        return localize.format("automations.timeAgo.days", "%@d ago", String(hours / 24))
    }

    /// Web `formatDateTime(iso)`: locale-aware medium date + short time, `—` for
    /// missing/invalid input.
    public static func dateTime(
        _ iso: String?,
        locale: Locale = .current,
        timeZone: TimeZone = .current,
        localize: AutomationCardLocalizer
    ) -> String {
        guard let iso, let date = isoDate(iso) else {
            return localize.string("automations.value.none", "—")
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// Parses an ISO-8601 timestamp (with or without fractional seconds), matching
    /// the lenient web `new Date(iso)`.
    static func isoDate(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}

// MARK: - Delete confirmation (web `ConfirmDialog`)

/// The resolved delete-confirmation content — the port of the web `ConfirmDialog`
/// props (title, `{{name}}`-interpolated message, confirm + cancel labels).
public struct AutomationDeleteConfirm: Equatable, Sendable {
    public let title: String
    public let message: String
    public let confirmLabel: String
    public let cancelLabel: String

    public static func build(name: String, localize: AutomationCardLocalizer) -> AutomationDeleteConfirm {
        AutomationDeleteConfirm(
            title: localize.string("automations.deleteTitle", "Delete Automation"),
            message: localize.format(
                "automations.deleteMessage",
                "Are you sure you want to delete \"%@\"? This cannot be undone.",
                name
            ),
            confirmLabel: localize.string("automations.deleteConfirm", "Delete"),
            cancelLabel: localize.string("common.cancel", "Cancel")
        )
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the card announces as coherent elements and
/// the tests can assert label presence without a rendering host.
public enum AutomationCardAccessibility {
    /// A combined header summary: name, status, and (when live) firing.
    public static func headerLabel(
        _ data: AutomationCardData,
        status: AutomationStatus,
        chip: AutomationFreshnessChip?,
        localize: AutomationCardLocalizer
    ) -> String {
        var parts = [data.name, localize.string(status.labelKey, status.labelFallback)]
        if let chip {
            parts.append(localize.string(chip.labelKey, chip.labelFallback))
        }
        return parts.joined(separator: ", ")
    }

    /// The toggle's VoiceOver label — web `aria-label="Toggle automation"`.
    public static func toggleLabel(_ localize: AutomationCardLocalizer) -> String {
        localize.string("automations.toggleLabel", "Toggle automation")
    }

    /// The kebab menu's VoiceOver label — web `aria-label="Actions menu"`.
    public static func menuLabel(_ localize: AutomationCardLocalizer) -> String {
        localize.string("automations.menu", "Actions menu")
    }
}
