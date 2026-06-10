//
//  NotificationRow.Adapter.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  The testable projection core for one inbox notification row — the faithful port
//  of features/notifications/components/NotificationRow.tsx. Everything here is pure
//  and dependency-free (Foundation only) so it can be unit-tested without a bundle
//  or a rendered view.
//
//  Web parity notes:
//    • The web component is prop-fed a `NotificationLog` plus its already-resolved
//      `rule` / `vehicle` (the inbox owns the `ruleMap` / `vehicleMap` lookups). It
//      derives `isRead = !!log.read_at`, `isArchived = !!log.archived_at`, and
//      `severity = rule?.severity ?? 'info'`, then renders the selection checkbox,
//      the severity badge, the timestamp, the vehicle + rule meta, the title (bold
//      when unread), the message, and the trailing action cluster (mark read/unread,
//      archive/restore, and the "View context" drill-through). The native source
//      seam supplies the resolved per-row display fields; this adapter reproduces the
//      exact `?? 'info'` default and the read/archived derivations.
//    • The web row is itself prop-fed (always has a log), but the prompt's P4 state
//      envelope (loading / empty / error / stale / offline) is supplied by the bound
//      source, mirroring how the parent inbox owns `isLoading` / error / freshness.
//

import Foundation

// MARK: - Severity kind (web rule severity string → semantic kind)

/// The semantic classification of a notification's severity. The web reads
/// `rule?.severity ?? 'info'` (`AlertRuleSeverity = 'info' | 'warn' | 'critical'`)
/// and feeds it to `SeverityBadge`; any missing/unknown value defaults to `.info`
/// exactly like the web `?? 'info'`.
public enum NotificationRowSeverityKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case info
    case warn
    case critical

    public var id: String {
        rawValue
    }

    /// Maps a raw web severity string to a semantic kind (case-insensitive). Both
    /// `warn` and `warning` route to `.warn`; everything else (including `nil`)
    /// defaults to `.info` — the web `rule?.severity ?? 'info'` behavior.
    public static func from(_ raw: String?) -> NotificationRowSeverityKind {
        switch raw?.lowercased() {
        case "critical": .critical
        case "warn", "warning": .warn
        case "info": .info
        default: .info
        }
    }

    /// The i18n key the severity label resolves through.
    public var localizationKey: String {
        switch self {
        case .info: "notifications.inbox.row.severity.info"
        case .warn: "notifications.inbox.row.severity.warn"
        case .critical: "notifications.inbox.row.severity.critical"
        }
    }

    /// The English fallback for `localizationKey`.
    public var fallback: String {
        switch self {
        case .info: "Info"
        case .warn: "Warning"
        case .critical: "Critical"
        }
    }
}

// MARK: - Row projection (one resolved notification row)

/// One notification row's resolved display data — the native parity of what the web
/// `NotificationRow` reads off a `NotificationLog` + its resolved `rule` / `vehicle`.
/// `severity` already folds the web `rule?.severity ?? 'info'` default, and
/// `drillthrough` is non-nil only when a rule is known (web
/// `drillHref = rule ? getAlertDrillthroughHref(synthetic) : null`).
public struct NotificationRowProjection: Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var message: String
    public var severity: NotificationRowSeverityKind
    public var createdAt: Date
    /// Whether the row has a `read_at` (web `!!log.read_at`): drives the unread accent.
    public var isRead: Bool
    /// Whether the row has an `archived_at` (web `!!log.archived_at`).
    public var isArchived: Bool
    /// The resolved vehicle display name (web `vehicle.display_name || #id`), if known.
    public var vehicleName: String?
    /// The resolved alert-rule name (web `rule.name`), if known.
    public var ruleName: String?
    /// The drill-through destination (web `getAlertDrillthroughHref(synthetic)`), or
    /// `nil` when no rule is resolved (web `rule ? … : null`).
    public var drillthrough: NotificationRowDrillthrough?

    public init(
        id: Int,
        title: String,
        message: String,
        severity: NotificationRowSeverityKind,
        createdAt: Date,
        isRead: Bool,
        isArchived: Bool,
        vehicleName: String? = nil,
        ruleName: String? = nil,
        drillthrough: NotificationRowDrillthrough? = nil
    ) {
        self.id = id
        self.title = title
        self.message = message
        self.severity = severity
        self.createdAt = createdAt
        self.isRead = isRead
        self.isArchived = isArchived
        self.vehicleName = vehicleName
        self.ruleName = ruleName
        self.drillthrough = drillthrough
    }
}

// MARK: - Load envelope (web parent `isLoading` / error / resolved)

/// The bound source's load status for the row (web parent `isLoading` / resolved /
/// failure), projected into a `NotificationRowPhase`.
public enum NotificationRowLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// What the surface should render at the top level. The web component is itself
/// prop-fed (always has a row), but the prompt's P4 state envelope (loading / empty /
/// error) is supplied by the bound source, mirroring the parent inbox.
public enum NotificationRowPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a row is clearly labeled while reconnecting / offline.
public enum NotificationRowConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projector (pure)

/// The dependency-free top-level phase resolution from the bound load status.
public enum NotificationRowProjector {
    /// Resolves the top-level render phase from the bound load status + whether a row
    /// resolved. A `loaded` status with no row is `.empty` (never a blank box).
    public static func resolvePhase(
        _ status: NotificationRowLoadStatus,
        hasRow: Bool
    ) -> NotificationRowPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasRow ? .content : .empty
        }
    }
}
