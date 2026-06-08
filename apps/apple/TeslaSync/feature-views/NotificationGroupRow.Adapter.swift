//
//  NotificationGroupRow.Adapter.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  The testable projection core for one server-aggregated notification thread —
//  the faithful port of
//  features/notifications/components/NotificationGroupRow.tsx. Everything here is
//  pure and dependency-free (Foundation only) so it can be unit-tested without a
//  bundle or a rendered view.
//
//  Web parity notes:
//    • The web component is prop-fed a `NotificationLogGroup` (`group`) plus
//      `ruleMap` / `vehicleMap` lookups its parent inbox owns; it derives
//      `isSingleton = group.group_key == null` and `extraCount = max(0, count-1)`,
//      renders the latest member as a row, and gates the grouping chrome on
//      `!isSingleton && (extraCount > 0 || unread_count > 1)`. The native source
//      seam supplies the already-resolved per-row display fields (rule name /
//      vehicle name / severity) the web parent resolved through the maps, and this
//      adapter reproduces the exact derivation + render gating.
//    • Member fetching is lazy on expand (web `useGroupMembers` gated on
//      `expanded && !isSingleton`); the expanded list omits the latest member
//      (web `members.filter(m => m.id !== latest.id)`) and shows the loading /
//      error / "no thread members" branches. `NotificationMembersProjector`
//      reproduces that filter + the empty resolution.
//    • The loading / empty / error load envelope plus the live-state freshness
//      (stale / offline) around the prop-fed row are supplied by the bound source
//      (prompt P4 states), mirroring how the parent inbox owns `isLoading` / error /
//      freshness.
//

import Foundation

// MARK: - Severity kind (web rule severity string → semantic kind)

/// The semantic classification of a notification's severity. The web reads
/// `rule?.severity ?? 'info'` (`AlertRuleSeverity = 'info' | 'warn' | 'critical'`)
/// and feeds it to `SeverityBadge`; any missing/unknown value defaults to `.info`
/// exactly like the web `?? 'info'`.
public enum NotificationSeverityKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case info
    case warn
    case critical

    public var id: String {
        rawValue
    }

    /// Maps a raw web severity string to a semantic kind (case-insensitive). Both
    /// `warn` and `warning` route to `.warn`; everything else (including `nil`)
    /// defaults to `.info` — the web `rule?.severity ?? 'info'` behavior.
    public static func from(_ raw: String?) -> NotificationSeverityKind {
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
        case .info: "notifications.group.severity.info"
        case .warn: "notifications.group.severity.warn"
        case .critical: "notifications.group.severity.critical"
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

// MARK: - Log projection (one resolved notification row)

/// One notification row's resolved display data — the native parity of what the
/// web `NotificationRow` reads off a `NotificationLog` + its resolved `rule` /
/// `vehicle`. `severity` already folds the web `rule?.severity ?? 'info'` default.
public struct NotificationLogProjection: Sendable, Equatable, Identifiable {
    public var id: Int
    public var title: String
    public var message: String
    public var severity: NotificationSeverityKind
    public var createdAt: Date
    /// Whether the row has a `read_at` (web `!!log.read_at`): drives the unread accent.
    public var isRead: Bool
    /// Whether the row has an `archived_at` (web `!!log.archived_at`).
    public var isArchived: Bool
    /// The resolved vehicle display name (web `vehicle.display_name`), if known.
    public var vehicleName: String?
    /// The resolved alert-rule name (web `rule.name`), if known.
    public var ruleName: String?

    public init(
        id: Int,
        title: String,
        message: String,
        severity: NotificationSeverityKind,
        createdAt: Date,
        isRead: Bool,
        isArchived: Bool,
        vehicleName: String? = nil,
        ruleName: String? = nil
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
    }
}

// MARK: - Group projection (the thread + its grouping derivations)

/// The resolved thread: the latest member row plus the grouping counts and the
/// derived render gating. A faithful port of the web component's reads of
/// `group.group_key` / `group.count` / `group.unread_count` / `group.vehicle_ids`.
public struct NotificationGroupProjection: Sendable, Equatable {
    /// The canonical thread key (web `group.group_key`); `nil` = singleton.
    public var groupKey: String?
    /// The latest member (web `group.latest`), rendered as the always-visible row.
    public var latest: NotificationLogProjection
    /// The filtered member count in this thread (web `group.count`).
    public var count: Int
    /// The unread member count in this thread (web `group.unread_count`).
    public var unreadCount: Int
    /// Distinct affected vehicles (web `group.vehicle_ids.length`).
    public var vehicleAffectedCount: Int
    /// Whether the parent inbox is in archived mode (web `archived` prop): when
    /// `true`, the "Mark group read" affordance is suppressed.
    public var archived: Bool

    public init(
        groupKey: String?,
        latest: NotificationLogProjection,
        count: Int,
        unreadCount: Int,
        vehicleAffectedCount: Int,
        archived: Bool
    ) {
        self.groupKey = groupKey
        self.latest = latest
        self.count = count
        self.unreadCount = unreadCount
        self.vehicleAffectedCount = vehicleAffectedCount
        self.archived = archived
    }

    /// Web `isSingleton = group.group_key == null`.
    public var isSingleton: Bool {
        groupKey == nil
    }

    /// Web `extraCount = Math.max(0, group.count - 1)`.
    public var extraCount: Int {
        max(0, count - 1)
    }

    /// Web `!isSingleton && (extraCount > 0 || group.unread_count > 1)` — whether
    /// the grouping chip row renders at all.
    public var showsGroupChrome: Bool {
        !isSingleton && (extraCount > 0 || unreadCount > 1)
    }

    /// Web `extraCount > 0` — whether the expand/collapse "+N similar" toggle shows.
    public var showsExpandToggle: Bool {
        extraCount > 0
    }

    /// Web `group.unread_count > 0` — whether the unread-count chip shows.
    public var showsUnreadChip: Bool {
        unreadCount > 0
    }

    /// Web `group.vehicle_ids.length > 0` — whether the "N vehicles affected" hint shows.
    public var showsVehicleAffected: Bool {
        vehicleAffectedCount > 0
    }

    /// Web `group.unread_count > 0 && !archived` — whether the "Mark group read"
    /// button shows (and is actionable).
    public var canMarkGroupRead: Bool {
        unreadCount > 0 && !archived
    }
}

// MARK: - Load envelope (web parent `isLoading` / error / resolved)

/// The bound source's load status for the thread (web parent `isLoading` /
/// resolved / failure), projected into a `NotificationGroupPhase`.
public enum NotificationLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// What the surface should render at the top level. The web component is itself
/// prop-fed (always has a group), but the prompt's P4 state envelope (loading /
/// empty / error) is supplied by the bound source, mirroring the parent inbox.
public enum NotificationGroupPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a thread is clearly labeled while reconnecting / offline.
public enum NotificationConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Members region phase (web lazy-expand states)

/// The expanded thread-member region's state — the native parity of the web
/// `membersLoading` / `membersError` / `otherMembers.length === 0` / list branches.
/// `idle` is the pre-expand state (web `useGroupMembers` disabled), so no network
/// traffic happens until the user expands.
public enum NotificationMembersPhase: Sendable, Equatable {
    case idle
    case loading
    case empty
    case loaded([NotificationLogProjection])
    case error(String)
}

// MARK: - Projectors (pure)

/// The dependency-free projections: the top-level phase from the load status, and
/// the expanded member list from the raw members (web `members.filter`).
public enum NotificationGroupProjector {
    /// Resolves the top-level render phase from the bound load status + whether a
    /// group resolved. A `loaded` status with no group is `.empty` (never a blank box).
    public static func resolvePhase(
        _ status: NotificationLoadStatus,
        hasGroup: Bool
    ) -> NotificationGroupPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasGroup ? .content : .empty
        }
    }
}

/// Projects the lazily-loaded raw members into the region phase. Reproduces the
/// web `otherMembers = members.filter(m => m.id !== latest.id)` and the
/// "No thread members found" empty when that filtered list is empty.
public enum NotificationMembersProjector {
    public static func project(
        status: NotificationLoadStatus,
        members: [NotificationLogProjection],
        latestId: Int
    ) -> NotificationMembersPhase {
        switch status {
        case .loading:
            return .loading
        case let .failed(message):
            return .error(message)
        case .loaded:
            let others = members.filter { $0.id != latestId }
            return others.isEmpty ? .empty : .loaded(others)
        }
    }
}
