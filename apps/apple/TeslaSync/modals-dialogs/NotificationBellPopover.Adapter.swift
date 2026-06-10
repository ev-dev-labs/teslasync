//
//  NotificationBellPopover.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  The testable, dependency-free projection core for the notification bell popover — the faithful
//  port of components/layout/NotificationBellPopover.tsx and the `useNotifications` /
//  `useVehicles` wire types it binds to (`NotificationLog`, `AlertRule`, `Vehicle`). Everything
//  here is pure Foundation so the severity enum, the joined display-ready entry, the
//  log×rule×vehicle join (web `ruleMap` / `vehicleMap`), the unread-badge text (web `99+` clamp),
//  the body phase, the inline-failure envelope, the mark-all-read predicate, and the relative-time
//  projection are all unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web popover badge is `useUnreadCount` (30s poll); the panel list is
//      `useUnreadNotifications({ limit: 10 })`, mounted only while open. The two streams are
//      coalesced into one `NotificationBellUpdate` (count + entries) so the badge stays live while
//      the list mounts on open — see NotificationBellSource.setOpen.
//    • Each row's severity comes from the matched alert rule (web `severityOf(rule)`), the title
//      falls back rule-name → "Notification" (web `log.title || rule?.name || t('untitled')`), and
//      the vehicle name falls back to `#id` (web `vehicle.display_name || '#${vehicle.id}'`).
//    • `bodyPhase` widens the web isLoading/list split with empty + error envelopes so a first-load
//      failure with no cached rows is never a blank box (engineering guideline #6).
//    • `NotificationBellRelative` is a faithful port of lib/dateFormat.ts `formatRelative`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum NotificationBellSurface {
    public static let slug = "NotificationBellPopover"
}

// MARK: - Severity (web `Severity` / `severityOf`)

/// A notification's severity, derived from its alert rule (web `'info' | 'warn' | 'critical'`). An
/// absent or unknown token collapses to `info`, matching web `severityOf`'s default arm. The label
/// resolves through the injected P1/S10 localizer so the view holds no hardcoded English.
public enum NotificationBellSeverity: String, Sendable, Equatable, Hashable, CaseIterable {
    case info
    case warn
    case critical

    /// Maps a raw rule-severity token to a severity, collapsing unknown/absent to `info` (web
    /// `severityOf`: only `warn`/`critical` pass through).
    public init(raw: String?) {
        switch raw {
        case "warn": self = .warn
        case "critical": self = .critical
        default: self = .info
        }
    }

    /// The per-severity i18n key for the dot's VoiceOver label (web `SEVERITY_TONE[sev].label`).
    public var labelKey: String {
        "notifications.bellPopover.severity.\(rawValue)"
    }

    /// The web English fallback for the dot label (web `SEVERITY_TONE` `label`).
    public var labelFallback: String {
        switch self {
        case .info: "Info"
        case .warn: "Warning"
        case .critical: "Critical"
        }
    }
}

// MARK: - Wire types (subset used by the popover)

/// One unread notification row — the subset of the web `NotificationLog` the popover reads.
public struct NotificationBellLog: Sendable, Equatable, Identifiable {
    public let id: Int
    public let alertID: Int?
    public let title: String
    public let message: String
    public let createdAt: Date

    public init(id: Int, alertID: Int?, title: String, message: String, createdAt: Date) {
        self.id = id
        self.alertID = alertID
        self.title = title
        self.message = message
        self.createdAt = createdAt
    }
}

/// One alert rule — the subset of the web `AlertRule` the popover joins for severity + vehicle.
public struct NotificationBellRule: Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let severity: NotificationBellSeverity
    public let vehicleID: Int?

    public init(id: Int, name: String, severity: NotificationBellSeverity, vehicleID: Int?) {
        self.id = id
        self.name = name
        self.severity = severity
        self.vehicleID = vehicleID
    }
}

/// One vehicle — the subset of the web `Vehicle` the popover joins for the row's vehicle name.
public struct NotificationBellVehicle: Sendable, Equatable, Identifiable {
    public let id: Int
    public let displayName: String

    public init(id: Int, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Display-ready entry (web joined row)

/// One joined, display-ready notification row — the native parity of a web bell-popover `<li>`. The
/// severity, the optional rule-name title fallback, and the optional vehicle name are resolved by
/// the join; `title`/`message` stay optional so the view picks the fallbacks explicitly.
public struct NotificationBellEntry: Sendable, Equatable, Identifiable {
    public let id: Int
    public let severity: NotificationBellSeverity
    public let title: String?
    public let ruleName: String?
    public let message: String?
    public let createdAt: Date
    public let vehicleName: String?

    public init(
        id: Int,
        severity: NotificationBellSeverity,
        title: String?,
        ruleName: String?,
        message: String?,
        createdAt: Date,
        vehicleName: String?
    ) {
        self.id = id
        self.severity = severity
        self.title = title
        self.ruleName = ruleName
        self.message = message
        self.createdAt = createdAt
        self.vehicleName = vehicleName
    }

    /// The row title, resolved through the localizer (web `log.title || rule?.name ||
    /// t('untitled')`): the non-empty log title, else the non-empty rule name, else the localized
    /// "Notification" fallback.
    public func displayTitle(localize: (String, String) -> String) -> String {
        if let title, !title.isEmpty { return title }
        if let ruleName, !ruleName.isEmpty { return ruleName }
        return localize("notifications.bellPopover.untitled", "Notification")
    }
}

// MARK: - Load status / freshness / body phase

/// The bound source's load status for the unread-list query (web `isLoading` / resolved / failure).
public enum NotificationBellLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a cached
/// preview is clearly labeled while reconnecting / offline.
public enum NotificationBellConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the open panel body renders. The web splits loading vs the list; the empty + error
/// envelopes are added so an opened popover is never a blank box (engineering guideline #6).
public enum NotificationBellPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case populated
}

// MARK: - Relative time (port of lib/dateFormat.ts `formatRelative`)

/// The structured relative-time bucket the web `formatRelative` collapses an instant into. Kept as
/// data (not a localized string) so the projection is pure + testable; the date facade resolves it
/// to copy through P1/S10.
public enum NotificationBellRelative: Sendable, Equatable {
    case empty
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)
    case absolute(Date)

    /// The faithful port of web `formatRelative(iso)` against an injected `now` (so tests are
    /// deterministic): < 60s → just now, < 60m → m, < 24h → h, < 7d → d, else absolute date.
    public static func from(_ date: Date?, now: Date) -> NotificationBellRelative {
        guard let date else { return .empty }
        let diff = now.timeIntervalSince(date)
        if diff < 60 { return .justNow }
        let seconds = Int(diff)
        let minutes = seconds / 60
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        let days = hours / 24
        if days < 7 { return .days(days) }
        return .absolute(date)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution from the bound wire data to the joined rows, the badge text, the
/// body phase, and the action predicates. The faithful port of the web component's `useMemo`
/// maps + render branches.
public enum NotificationBellProjection {
    /// The cap on preview rows (web `PREVIEW_LIMIT` = 10). The query already limits server-side; the
    /// client cap guards against an over-long payload.
    public static let previewLimit = 10

    /// Joins the unread logs with their alert rules + vehicles into display-ready entries (web
    /// `logs.map` over `ruleMap` / `vehicleMap`). Order is preserved (the API returns newest-first)
    /// and the result is capped at `limit` rows.
    public static func entries(
        logs: [NotificationBellLog],
        rules: [NotificationBellRule],
        vehicles: [NotificationBellVehicle],
        limit: Int = previewLimit
    ) -> [NotificationBellEntry] {
        let ruleMap = Dictionary(rules.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let vehicleMap = Dictionary(
            vehicles.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }
        )
        let joined = logs.map { log -> NotificationBellEntry in
            let rule = log.alertID.flatMap { ruleMap[$0] }
            let vehicle = rule?.vehicleID.flatMap { vehicleMap[$0] }
            return NotificationBellEntry(
                id: log.id,
                severity: rule?.severity ?? .info,
                title: log.title.isEmpty ? nil : log.title,
                ruleName: rule?.name,
                message: log.message.isEmpty ? nil : log.message,
                createdAt: log.createdAt,
                vehicleName: vehicle.map(vehicleName(for:))
            )
        }
        return Array(joined.prefix(max(0, limit)))
    }

    /// The row's vehicle name (web `vehicle.display_name || '#${vehicle.id}'`).
    public static func vehicleName(for vehicle: NotificationBellVehicle) -> String {
        vehicle.displayName.isEmpty ? "#\(vehicle.id)" : vehicle.displayName
    }

    /// The unread badge text, or `nil` when the badge is hidden (web `count > 0 &&` render guard,
    /// with the `count > 99 ? '99+'` clamp).
    public static func badgeText(count: Int) -> String? {
        guard count > 0 else { return nil }
        return count > 99 ? "99+" : String(count)
    }

    /// The open panel body phase. The web shows the spinner until the first rows arrive, then the
    /// list; empty + error are added so an opened popover is never blank.
    public static func phase(
        status: NotificationBellLoadStatus,
        hasEntries: Bool
    ) -> NotificationBellPhase {
        switch status {
        case .loading:
            hasEntries ? .populated : .loading
        case .loaded:
            hasEntries ? .populated : .empty
        case let .failed(message):
            hasEntries ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while cached rows survive a failed reload (the inline
    /// error shown above the list), else `nil`.
    public static func inlineFailure(
        status: NotificationBellLoadStatus,
        hasEntries: Bool
    ) -> String? {
        guard hasEntries, case let .failed(message) = status else { return nil }
        return message
    }

    /// Whether "Mark all read" is enabled (web `disabled={!hasLogs || bulkMarkRead.isPending}`).
    public static func markAllEnabled(hasEntries: Bool, pending: Bool) -> Bool {
        hasEntries && !pending
    }
}
