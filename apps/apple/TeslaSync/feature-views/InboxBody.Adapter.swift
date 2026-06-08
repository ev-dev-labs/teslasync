//
//  InboxBody.Adapter.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The decoded, Foundation-only domain models for the shared notification-log
//  inbox surface — the native ports of the web `NotificationLog` /
//  `NotificationLogGroup` / `AlertRule` / `Vehicle` types and the URL-backed
//  filter state (severity / vehicle / rule / search / read-state / from-to /
//  view) that `features/notifications/components/InboxBody.tsx` owns. Everything
//  here is pure value types + enums (no store, no SwiftUI) so the day-grouping,
//  drill-through, row-menu, bulk-action, and selection logic in
//  `InboxBody.Projection.swift` is unit-testable in isolation.
//

import Foundation

// MARK: - Severity (web rule.severity → 'info' | 'warn' | 'critical')

/// The three alert severities a row's rule can carry (web `SEVERITY_VALUES`).
/// The view maps each to a tint + SF Symbol; the adapter only resolves the
/// semantic case + its localized label, defaulting to `info` for an unmapped
/// value exactly like the web `rule?.severity ?? 'info'`.
public enum InboxSeverity: String, Sendable, Equatable, CaseIterable {
    case info
    case warn
    case critical

    /// Web `rule?.severity ?? 'info'`: an unknown / blank severity folds to `info`.
    public static func parse(_ raw: String?) -> InboxSeverity {
        guard let raw, let value = InboxSeverity(rawValue: raw.lowercased()) else { return .info }
        return value
    }

    /// The P1/S10 localization key for the severity chip label.
    public var labelKey: String {
        "notifications.severity.\(rawValue)"
    }

    /// The web English label (the chip renders the raw severity word).
    public var labelFallback: String {
        switch self {
        case .info: "info"
        case .warn: "warn"
        case .critical: "critical"
        }
    }
}

// MARK: - Read filter (web `READ_VALUES`) + view mode (web `VIEW_VALUES`)

/// The inbox read-state filter (web `READ_VALUES = ['all','read','unread']`).
/// `all` clears the filter; `read` / `unread` map to the boolean query param.
public enum InboxReadFilter: String, Sendable, Equatable, CaseIterable {
    case all
    case read
    case unread

    /// Web `read === 'all' ? undefined : read === 'read'` — the tri-state maps to
    /// an optional boolean for the request payload.
    public var readFlag: Bool? {
        switch self {
        case .all: nil
        case .read: true
        case .unread: false
        }
    }
}

/// Grouped/threaded vs flat inbox view (web `VIEW_VALUES = ['grouped','flat']`).
/// Default is `grouped` (web rationale: power users with many rules drown in flat
/// duplicates); `flat` remains for the historical row-by-row workflow.
public enum InboxViewMode: String, Sendable, Equatable, CaseIterable {
    case grouped
    case flat
}

// MARK: - Domain models (ports of the web API types)

/// One notification-log row (web `NotificationLog`). `readAt` / `archivedAt`
/// presence is the read / archived signal (web `!!log.read_at`); `alertId` links
/// to the firing rule. Carries only the fields this surface reads.
public struct InboxNotification: Identifiable, Equatable, Sendable {
    public var id: Int
    public var alertId: Int?
    public var title: String
    public var message: String
    public var severity: String?
    public var createdAt: String
    public var readAt: String?
    public var archivedAt: String?

    public init(
        id: Int,
        alertId: Int? = nil,
        title: String,
        message: String = "",
        severity: String? = nil,
        createdAt: String,
        readAt: String? = nil,
        archivedAt: String? = nil
    ) {
        self.id = id
        self.alertId = alertId
        self.title = title
        self.message = message
        self.severity = severity
        self.createdAt = createdAt
        self.readAt = readAt
        self.archivedAt = archivedAt
    }

    /// Web `!!log.read_at` — a non-empty `read_at` marks the row read.
    public var isRead: Bool {
        !(readAt ?? "").isEmpty
    }

    /// Web `!!log.archived_at` — a non-empty `archived_at` marks the row archived.
    public var isArchived: Bool {
        !(archivedAt ?? "").isEmpty
    }
}

/// One alert rule (web `AlertRule`) — the fields the inbox reads to resolve a
/// row's severity colour, name, vehicle scope, and drill-through signal.
public struct InboxRule: Identifiable, Equatable, Sendable {
    public var id: Int
    public var name: String?
    public var severity: String?
    public var vehicleId: Int?
    public var signalName: String?

    public init(
        id: Int,
        name: String? = nil,
        severity: String? = nil,
        vehicleId: Int? = nil,
        signalName: String? = nil
    ) {
        self.id = id
        self.name = name
        self.severity = severity
        self.vehicleId = vehicleId
        self.signalName = signalName
    }
}

/// One vehicle (web `Vehicle`) — the fields the inbox reads for the row's
/// timezone hint + display name.
public struct InboxVehicle: Identifiable, Equatable, Sendable {
    public var id: Int
    public var displayName: String?

    public init(id: Int, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }

    /// Web `vehicle.display_name || \`#${vehicle.id}\``.
    public var label: String {
        let name = displayName ?? ""
        return name.isEmpty ? "#\(id)" : name
    }
}

/// One server-aggregated notification thread (web `NotificationLogGroup`): the
/// canonical `groupKey` (nil = singleton), the `latest` member rendered as the
/// thread head, the filtered `count` / `unreadCount`, the affected `vehicleIds`,
/// and any eagerly-supplied `members` for the expanded list.
public struct InboxGroup: Identifiable, Equatable, Sendable {
    public var groupKey: String?
    public var latest: InboxNotification
    public var count: Int
    public var unreadCount: Int
    public var vehicleIds: [Int]
    public var members: [InboxNotification]

    public init(
        groupKey: String?,
        latest: InboxNotification,
        count: Int,
        unreadCount: Int = 0,
        vehicleIds: [Int] = [],
        members: [InboxNotification] = []
    ) {
        self.groupKey = groupKey
        self.latest = latest
        self.count = count
        self.unreadCount = unreadCount
        self.vehicleIds = vehicleIds
        self.members = members
    }

    /// Stable identity (web key `g.group_key ?? \`singleton:${g.latest.id}\``).
    public var id: String {
        groupKey ?? "singleton:\(latest.id)"
    }

    /// Web `group.group_key == null` — a singleton renders as a plain row with the
    /// grouping chrome hidden.
    public var isSingleton: Bool {
        groupKey == nil
    }

    /// Web `Math.max(0, group.count - 1)` — the "+N similar" overflow count.
    public var extraCount: Int {
        max(0, count - 1)
    }

    /// The expanded list omits the head (web `members.filter(m => m.id !== latest.id)`).
    public var otherMembers: [InboxNotification] {
        members.filter { $0.id != latest.id }
    }
}

// MARK: - Filter state (web URL-backed params)

/// The inbox's filter + view state — the native value-typed mirror of the web
/// URL params (`severity`, `vehicle_id`, `rule_id`, `q`, `read`, `from`, `to`,
/// `view`) plus the `archived` mode the parent page fixes. In the web these live
/// in the URL so a filtered view is shareable; natively they are model state the
/// host can hydrate from a deep link.
public struct InboxFilters: Equatable, Sendable {
    public var archived: Bool
    public var severity: [InboxSeverity]
    public var vehicleIds: [Int]
    public var ruleIds: [Int]
    public var search: String
    public var from: String
    public var to: String
    public var read: InboxReadFilter
    public var view: InboxViewMode

    public init(
        archived: Bool = false,
        severity: [InboxSeverity] = [],
        vehicleIds: [Int] = [],
        ruleIds: [Int] = [],
        search: String = "",
        from: String = "",
        to: String = "",
        read: InboxReadFilter = .all,
        view: InboxViewMode = .grouped
    ) {
        self.archived = archived
        self.severity = severity
        self.vehicleIds = vehicleIds
        self.ruleIds = ruleIds
        self.search = search
        self.from = from
        self.to = to
        self.read = read
        self.view = view
    }

    /// Web `isGrouped = view === 'grouped' && !archived` — the archive workflow is
    /// always row-by-row, never threaded.
    public var isGrouped: Bool {
        view == .grouped && !archived
    }

    /// The number of active narrowing filters (drives the summary bar's clear
    /// affordance). The view mode + archived mode are not "filters".
    public var activeFilterCount: Int {
        var total = severity.count + vehicleIds.count + ruleIds.count
        if !search.isEmpty { total += 1 }
        if !from.isEmpty { total += 1 }
        if !to.isEmpty { total += 1 }
        if read != .all { total += 1 }
        return total
    }

    /// Whether any narrowing filter is active.
    public var hasActiveFilters: Bool {
        activeFilterCount > 0
    }
}
