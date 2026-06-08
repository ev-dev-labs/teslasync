//
//  NotificationFilterBar.Adapter.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  The testable projection core for the notifications inbox filter bar — the faithful
//  port of features/notifications/components/NotificationFilterBar.tsx. Everything here
//  is pure and dependency-free (Foundation only) so it can be unit-tested without a
//  bundle or a rendered view.
//
//  Web parity notes:
//    • The web bar is a CONTROLLED component: the parent inbox owns `NotificationFilters`
//      and merges the `onChange` patches the bar emits. The native surface reproduces
//      that contract — the model holds the canonical filter state and forwards each
//      patch to the host through a change seam (P1/S8). The patch math (toggle severity,
//      set vehicle/rule, set query/from/to, clear-all) is pure and unit-tested here.
//    • `vehicle_id` / `rule_id` are web `number[]`; the bar is single-select, so it
//      reads `.first` and writes `[id]` / `[]`, preserving the array shape the parent
//      serializes. Parent-owned fields (read/archived/group_key/limit/offset) are
//      carried through every patch, matching the web `{ ...filters, … }` spread.
//

import Foundation

// MARK: - Severity (web `SEVERITY_OPTIONS`)

/// The three notification severities the chips toggle (web `'info' | 'warn' | 'critical'`).
public enum NotificationSeverity: String, Sendable, CaseIterable, Identifiable {
    case info
    case warn
    case critical

    public var id: String {
        rawValue
    }

    /// The web i18n key `notifications.inbox.filter.severity.<value>`.
    public var localizationKey: String {
        "notifications.inbox.filter.severity.\(rawValue)"
    }

    /// The web English fallback label (`Info` / `Warn` / `Critical`).
    public var fallback: String {
        switch self {
        case .info: "Info"
        case .warn: "Warn"
        case .critical: "Critical"
        }
    }

    /// The SF Symbol mapped from the web lucide icon (Info / AlertTriangle / AlertOctagon).
    public var iconSystemName: String {
        switch self {
        case .info: "info.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Filter state (web `NotificationFilters`)

/// The bar-controlled filter state. Mirrors the web `NotificationFilters` shape,
/// including the parent-owned fields the bar never edits but must preserve on each
/// patch so the inbox's read/archived/paging context survives a filter change.
public struct NotificationFilters: Sendable, Equatable {
    public var severity: [NotificationSeverity]
    public var vehicleIDs: [Int]
    public var ruleIDs: [Int]
    public var query: String?
    public var from: String?
    public var to: String?

    // Parent-owned pass-through fields (web `read` / `archived` / `group_key` /
    // `limit` / `offset`) — preserved verbatim across every bar patch.
    public var read: Bool?
    public var archived: Bool?
    public var groupKey: String?
    public var limit: Int?
    public var offset: Int?

    public init(
        severity: [NotificationSeverity] = [],
        vehicleIDs: [Int] = [],
        ruleIDs: [Int] = [],
        query: String? = nil,
        from: String? = nil,
        to: String? = nil,
        read: Bool? = nil,
        archived: Bool? = nil,
        groupKey: String? = nil,
        limit: Int? = nil,
        offset: Int? = nil
    ) {
        self.severity = severity
        self.vehicleIDs = vehicleIDs
        self.ruleIDs = ruleIDs
        self.query = query
        self.from = from
        self.to = to
        self.read = read
        self.archived = archived
        self.groupKey = groupKey
        self.limit = limit
        self.offset = offset
    }
}

public extension NotificationFilters {
    /// The selected vehicle id (web `filters.vehicle_id?.[0]`).
    var selectedVehicleID: Int? {
        vehicleIDs.first
    }

    /// The selected rule id (web `filters.rule_id?.[0]`).
    var selectedRuleID: Int? {
        ruleIDs.first
    }

    /// Whether any bar-owned filter is active (drives the clear-all affordance).
    var hasActiveBarFilters: Bool {
        !severity.isEmpty
            || !vehicleIDs.isEmpty
            || !ruleIDs.isEmpty
            || isPresent(query)
            || isPresent(from)
            || isPresent(to)
    }

    /// Web `toggleSeverity`: append when absent, drop when present — order preserved.
    func togglingSeverity(_ severityValue: NotificationSeverity) -> NotificationFilters {
        var copy = self
        if let index = copy.severity.firstIndex(of: severityValue) {
            copy.severity.remove(at: index)
        } else {
            copy.severity.append(severityValue)
        }
        return copy
    }

    /// Web `setVehicle`: a single selected id (or none), stored as the web array.
    func settingVehicle(_ id: Int?) -> NotificationFilters {
        var copy = self
        copy.vehicleIDs = id.map { [$0] } ?? []
        return copy
    }

    /// Web `setRule`: a single selected id (or none), stored as the web array.
    func settingRule(_ id: Int?) -> NotificationFilters {
        var copy = self
        copy.ruleIDs = id.map { [$0] } ?? []
        return copy
    }

    /// Web `setQuery`: keeps the raw value when it has non-blank content, else clears.
    func settingQuery(_ value: String) -> NotificationFilters {
        var copy = self
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.query = trimmed.isEmpty ? nil : value
        return copy
    }

    /// Web `setFrom`: stores the ISO date, clearing on an empty string.
    func settingFrom(_ date: String) -> NotificationFilters {
        var copy = self
        copy.from = date.isEmpty ? nil : date
        return copy
    }

    /// Web `setTo`: stores the ISO date, clearing on an empty string.
    func settingTo(_ date: String) -> NotificationFilters {
        var copy = self
        copy.to = date.isEmpty ? nil : date
        return copy
    }

    /// Web `handleClearAll`: clears only the bar-owned fields, keeping pass-throughs.
    func clearingBarFilters() -> NotificationFilters {
        var copy = self
        copy.severity = []
        copy.vehicleIDs = []
        copy.ruleIDs = []
        copy.query = nil
        copy.from = nil
        copy.to = nil
        return copy
    }

    private func isPresent(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.isEmpty
    }
}

// MARK: - Projection core (pure)

/// The dependency-free derivations the surface needs: the top-level phase from the
/// option load status, and the active-filter chip list in the exact web order.
public enum NotificationFilterProjection {
    /// Resolves the render phase. Cached options survive a refresh/failure (freshness
    /// shown by the banner), exactly like the reference list surfaces.
    public static func resolvePhase(
        _ status: NotificationFilterLoadStatus,
        optionCount: Int
    ) -> NotificationFilterPhase {
        let hasData = optionCount > 0
        switch status {
        case .loading:
            return hasData ? .content : .loading
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }

    /// The active-filter chips in web order: severity, vehicle, rule, search, from, to.
    /// Copy resolves through the injected localizer so the result is bundle-free testable.
    public static func activeChips(
        for filters: NotificationFilters,
        vehicles: [NotificationVehicleOption],
        rules: [NotificationRuleOption],
        localize: (String, String) -> String
    ) -> [NotificationActiveChip] {
        [
            severityChip(filters, localize),
            vehicleChip(filters, vehicles, localize),
            ruleChip(filters, rules, localize),
            queryChip(filters, localize),
            dateChip(.from, value: filters.from, key: "notifications.inbox.filter.from", fallback: "From", localize),
            dateChip(.to, value: filters.to, key: "notifications.inbox.filter.to", fallback: "To", localize)
        ].compactMap(\.self)
    }

    private static func severityChip(
        _ filters: NotificationFilters,
        _ localize: (String, String) -> String
    ) -> NotificationActiveChip? {
        guard !filters.severity.isEmpty else { return nil }
        let summary = filters.severity
            .map { localize($0.localizationKey, $0.fallback) }
            .joined(separator: ", ")
        return NotificationActiveChip(
            kind: .severity,
            label: localize("notifications.inbox.filter.severity", "Severity"),
            value: summary
        )
    }

    private static func vehicleChip(
        _ filters: NotificationFilters,
        _ vehicles: [NotificationVehicleOption],
        _ localize: (String, String) -> String
    ) -> NotificationActiveChip? {
        guard let id = filters.selectedVehicleID else { return nil }
        let match = vehicles.first { $0.id == id }
        return NotificationActiveChip(
            kind: .vehicle,
            label: localize("notifications.inbox.filter.vehicle", "Vehicle"),
            value: match?.label ?? "#\(id)"
        )
    }

    private static func ruleChip(
        _ filters: NotificationFilters,
        _ rules: [NotificationRuleOption],
        _ localize: (String, String) -> String
    ) -> NotificationActiveChip? {
        guard let id = filters.selectedRuleID else { return nil }
        let match = rules.first { $0.id == id }
        return NotificationActiveChip(
            kind: .rule,
            label: localize("notifications.inbox.filter.rule", "Rule"),
            value: match?.label ?? "#\(id)"
        )
    }

    private static func queryChip(
        _ filters: NotificationFilters,
        _ localize: (String, String) -> String
    ) -> NotificationActiveChip? {
        guard let query = filters.query, !query.isEmpty else { return nil }
        return NotificationActiveChip(
            kind: .query,
            label: localize("notifications.inbox.filter.searchLabel", "Search"),
            value: query
        )
    }

    private static func dateChip(
        _ kind: NotificationActiveChip.Kind,
        value: String?,
        key: String,
        fallback: String,
        _ localize: (String, String) -> String
    ) -> NotificationActiveChip? {
        guard let value, !value.isEmpty else { return nil }
        return NotificationActiveChip(
            kind: kind,
            label: localize(key, fallback),
            value: String(value.prefix(10))
        )
    }
}
