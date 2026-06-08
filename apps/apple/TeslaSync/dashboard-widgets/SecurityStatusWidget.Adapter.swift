//
//  SecurityStatusWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0085 · SecurityStatusWidget (Apple)
//
//  The testable projection core: the cached `SecurityLatestInput` DTO → the four
//  view-ready `SecurityStatusCell` rows (lock / sentry / doors / windows), the
//  door + window open-count parsing (faithful port of the web `useMemo` block),
//  the status → tone mapping, and the VoiceOver summary builder. All pure +
//  dependency-free so the adapter can be unit-tested without a store, a bundle,
//  or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Cell status (web `StatusCell['status']`)

/// The status carried by one cell, mirroring the web union
/// `'ok' | 'warning' | 'error' | 'inactive' | 'unknown'`. Each maps to a shared
/// `TSTone` and a tinting decision so the dot + chrome read identically to the
/// web `statusStyles` table.
public enum SecurityCellStatus: String, Sendable, Equatable, CaseIterable {
    case ok
    case warning
    case error
    case inactive
    case unknown

    /// The semantic tone for the status dot + tinted background.
    public var tone: TSTone {
        switch self {
        case .ok: .success
        case .warning: .warning
        case .error: .danger
        case .inactive, .unknown: .neutral
        }
    }

    /// Web `statusStyles` tints `ok/warning/error` with a colored fill+border and
    /// leaves `inactive/unknown` on the neutral surface fill.
    public var isTinted: Bool {
        switch self {
        case .ok, .warning, .error: true
        case .inactive, .unknown: false
        }
    }

    /// A localized word spoken after the cell value for VoiceOver (e.g. "Lock,
    /// Locked, OK"). Resolved through the injected localizer so it stays
    /// translatable and bundle-free in tests.
    public func accessibilityWord(localize: (String, String) -> String) -> String {
        switch self {
        case .ok: localize("widget.securityStateOk", "OK")
        case .warning: localize("widget.securityStateWarning", "Warning")
        case .error: localize("widget.securityStateAlert", "Alert")
        case .inactive: localize("widget.securityStateInactive", "Inactive")
        case .unknown: localize("widget.securityStateUnknown", "Unknown")
        }
    }
}

// MARK: - One projected cell (web `StatusCell`)

/// One cell in the 2-column status grid — the native port of the web `StatusCell`,
/// carrying its stable id, the resolved (localized) label + value, the SF Symbol,
/// and the status. Identifiable + Equatable so SwiftUI can diff the grid and the
/// projection can be asserted in tests.
public struct SecurityStatusCell: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let systemImage: String
    public let status: SecurityCellStatus

    public init(id: String, label: String, value: String, systemImage: String, status: SecurityCellStatus) {
        self.id = id
        self.label = label
        self.value = value
        self.systemImage = systemImage
        self.status = status
    }
}

// MARK: - Door / window parsing (port of the web `useMemo` block)

/// The pure door/window parsing the web computes inline, lifted out so it can be
/// unit-tested independently of the cell projection.
public enum SecuritySignalParser {
    /// Open-door count — faithful port of the web logic:
    /// `door_state === true` counts as one open door; otherwise the comma list is
    /// split, trimmed, emptied-filtered, and the entries whose lowercase form
    /// contains `"open"` are counted.
    public static func openDoorCount(_ value: SecuritySignalValue) -> Int {
        if case .boolean(true) = value { return 1 }
        guard case let .text(raw) = value, !raw.isEmpty else { return 0 }
        return raw
            .split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .count(where: { $0.lowercased().contains("open") })
    }

    /// Whether one window is open — faithful port of the web filter: a native
    /// boolean is taken as-is; a non-empty string is open unless it lowercases to
    /// exactly `"closed"`; an absent/empty value is closed.
    public static func isWindowOpen(_ value: SecuritySignalValue) -> Bool {
        switch value {
        case let .boolean(open):
            open
        case let .text(raw):
            !raw.isEmpty && raw.lowercased() != "closed"
        case .absent:
            false
        }
    }

    /// Open-window count across the four window fields (web `openWindows.length`).
    public static func openWindowCount(_ windows: [SecuritySignalValue]) -> Int {
        windows.filter(isWindowOpen).count
    }
}

// MARK: - Cell projection (web `cells` useMemo)

/// Builds the four status cells from the cached latest event, resolving every
/// label/value through the injected localizer (so it is bundle-free in tests).
/// Returns `[]` when there is no event — exactly the web `if (!securityData)
/// return []`, which drives the grid's empty state.
public enum SecurityCellsBuilder {
    public static func build(
        latest: SecurityLatestInput?,
        localize: (String, String) -> String
    ) -> [SecurityStatusCell] {
        guard let latest else { return [] }
        return [
            lockCell(latest, localize),
            sentryCell(latest, localize),
            doorsCell(latest, localize),
            windowsCell(latest, localize)
        ]
    }

    private static func lockCell(
        _ latest: SecurityLatestInput,
        _ localize: (String, String) -> String
    ) -> SecurityStatusCell {
        SecurityStatusCell(
            id: "lock",
            label: localize("widget.lock", "Lock"),
            value: latest.locked
                ? localize("widget.locked", "Locked")
                : localize("widget.unlocked", "Unlocked"),
            systemImage: latest.locked ? "lock.fill" : "lock.open.fill",
            status: latest.locked ? .ok : .error
        )
    }

    private static func sentryCell(
        _ latest: SecurityLatestInput,
        _ localize: (String, String) -> String
    ) -> SecurityStatusCell {
        SecurityStatusCell(
            id: "sentry",
            label: localize("widget.sentry", "Sentry"),
            value: latest.sentryMode
                ? localize("widget.active", "Active")
                : localize("widget.off", "Off"),
            systemImage: latest.sentryMode ? "checkmark.shield.fill" : "shield.fill",
            status: latest.sentryMode ? .ok : .inactive
        )
    }

    private static func doorsCell(
        _ latest: SecurityLatestInput,
        _ localize: (String, String) -> String
    ) -> SecurityStatusCell {
        let open = SecuritySignalParser.openDoorCount(latest.doorState)
        return SecurityStatusCell(
            id: "doors",
            label: localize("widget.doors", "Doors"),
            value: open == 0
                ? localize("widget.allClosed", "All Closed")
                : "\(open.formatted()) \(localize("widget.open", "Open"))",
            systemImage: "door.left.hand.open",
            status: open == 0 ? .ok : .warning
        )
    }

    private static func windowsCell(
        _ latest: SecurityLatestInput,
        _ localize: (String, String) -> String
    ) -> SecurityStatusCell {
        let open = SecuritySignalParser.openWindowCount(latest.windows)
        return SecurityStatusCell(
            id: "windows",
            label: localize("widget.windows", "Windows"),
            value: open == 0
                ? localize("widget.allClosed", "All Closed")
                : "\(open.formatted()) \(localize("widget.open", "Open"))",
            systemImage: "macwindow",
            status: open == 0 ? .ok : .warning
        )
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the grid and each cell. Pure + public so the
/// spoken content can be unit-tested without rendering the view.
public enum SecurityAccessibility {
    /// Per-cell label, e.g. "Lock, Locked, OK".
    public static func cellSummary(
        for cell: SecurityStatusCell,
        localize: (String, String) -> String
    ) -> String {
        "\(cell.label), \(cell.value), \(cell.status.accessibilityWord(localize: localize))"
    }

    /// The whole-grid summary spoken for the content container, joining each
    /// cell so VoiceOver can read the security posture in one pass.
    public static func gridSummary(
        for cells: [SecurityStatusCell],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("widget.security", "Security")
        guard !cells.isEmpty else {
            return "\(title). \(localize("widget.noSecurity", "No security data"))"
        }
        let body = cells
            .map { "\($0.label): \($0.value)" }
            .joined(separator: ". ")
        return "\(title). \(body)"
    }
}
