//
//  NotificationFilterBar.Core.swift
//  TeslaSync — P4 feature view · 0189 · NotificationFilterBar (Apple)
//
//  Pure, dependency-free support types split out of NotificationFilterBar.Adapter.swift
//  to keep each file within the lint length budget: the selectable option models
//  (web `vehicleOptions` / `ruleOptions`), the render phase / load status / freshness
//  enums, the active-filter chip (web `FilterChipDescriptor`), and the diagnostics
//  surface slug. Foundation only, so it stays unit-testable without a rendered view.
//

import Foundation

// MARK: - Option models (web `vehicleOptions` / `ruleOptions`)

/// A selectable vehicle (web `Vehicle` → `{ value, label }`). `label` is the web
/// `display_name || '#<id>'`, applied here as a null-safe fallback.
public struct NotificationVehicleOption: Sendable, Equatable, Identifiable {
    public let id: Int
    public let label: String

    public init(id: Int, displayName: String?) {
        self.id = id
        if let name = displayName, !name.isEmpty {
            label = name
        } else {
            label = "#\(id)"
        }
    }
}

/// A selectable alert rule (web `AlertRule` → `{ value, label }`). `label` falls back
/// to `#<id>` when the rule name is missing, matching the web chip fallback.
public struct NotificationRuleOption: Sendable, Equatable, Identifiable {
    public let id: Int
    public let label: String

    public init(id: Int, name: String?) {
        self.id = id
        if let name, !name.isEmpty {
            label = name
        } else {
            label = "#\(id)"
        }
    }
}

// MARK: - Render phase / load status / freshness

/// What the surface renders at the top level. The bar presents the vehicle + rule
/// option lists; with options it renders the controls (`.content`), with none it shows
/// the friendly empty, and loading/failed without cache map to skeleton/retry.
public enum NotificationFilterPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case content
}

/// The bound source's load status for the option lists (web `isLoading` / resolved /
/// failure).
public enum NotificationFilterLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached option set is clearly labeled while reconnecting / offline.
public enum NotificationFilterConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Active-filter chip (web `ActiveFilterChips` / `FilterChipDescriptor`)

/// One active-filter token (web `FilterChipDescriptor`): a labeled, removable summary
/// of an active filter, rendered as "{label}: {value}".
public struct NotificationActiveChip: Sendable, Equatable, Identifiable {
    public enum Kind: String, Sendable, Equatable, CaseIterable {
        case severity
        case vehicle
        case rule
        case query
        case from
        case to
    }

    public var kind: Kind
    public var label: String
    public var value: String

    public var id: String {
        kind.rawValue
    }

    public init(kind: Kind, label: String, value: String) {
        self.kind = kind
        self.label = label
        self.value = value
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (P1/S11),
/// in the dependency-free core so the projection tests can reach it.
public enum NotificationFilterSurface {
    public static let slug = "NotificationFilterBar"
}
