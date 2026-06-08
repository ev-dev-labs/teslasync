//
//  RecentActivity.Types.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  The value types for the dashboard "Recent Activity" surface — the inputs the bound source
//  provides (the web `Drive` / `ChargingSession` / `FleetAnalytics` subsets + the user's unit /
//  currency / locale preferences) and the outputs the projection emits (the three panels' view
//  models + the render phase). All pure value types (Foundation only), so they are shared by the
//  testable adapter and the SwiftUI views without dragging either into the other.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free
/// core so it is reachable from the projection's unit tests.
public enum RecentActivitySurface {
    public static let slug = "RecentActivity"
}

// MARK: - Input value types (web `Drive` / `ChargingSession` / `FleetAnalytics` subsets)

/// One recent drive, narrowed to the fields the web `RecentActivity` reads. The bound source maps
/// the shared dashboard query into these so the projection stays pure + testable.
public struct RecentActivityDrive: Identifiable, Equatable, Sendable {
    public let id: String
    /// Distance in meters (SI, web `distance_m`).
    public let distanceM: Double
    /// Duration in seconds (SI, web `duration_s`).
    public let durationS: Double
    public let startSocPct: Int?
    public let endSocPct: Int?
    /// Drive start instant (web `started_at`), used for the feed ordering + relative time.
    public let startedAt: Date?

    public init(
        id: String,
        distanceM: Double,
        durationS: Double,
        startSocPct: Int?,
        endSocPct: Int?,
        startedAt: Date?
    ) {
        self.id = id
        self.distanceM = distanceM
        self.durationS = durationS
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.startedAt = startedAt
    }
}

/// One recent charging session, narrowed to the fields the web `RecentActivity` reads.
public struct RecentActivityCharge: Identifiable, Equatable, Sendable {
    public let id: String
    /// Energy added in watt-hours (SI, web `total_energy_added_wh`).
    public let energyAddedWh: Double
    public let startSocPct: Int?
    public let endSocPct: Int?
    /// Session cost in the user's currency (web `cost`), or `nil` to omit (web `typeof … number`).
    public let cost: Double?
    public let startedAt: Date?

    public init(
        id: String,
        energyAddedWh: Double,
        startSocPct: Int?,
        endSocPct: Int?,
        cost: Double?,
        startedAt: Date?
    ) {
        self.id = id
        self.energyAddedWh = energyAddedWh
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.cost = cost
        self.startedAt = startedAt
    }
}

/// The most-efficient vehicle highlight (web `analytics.most_efficient_vehicle`).
public struct RecentActivityEfficientVehicle: Equatable, Sendable {
    public let name: String
    /// Efficiency in Wh/km (SI); `toEfficiencyDisplay` converts it for the user's distance unit.
    public let efficiencyWhKm: Double

    public init(name: String, efficiencyWhKm: Double) {
        self.name = name
        self.efficiencyWhKm = efficiencyWhKm
    }
}

/// The fleet analytics fields the web `RecentActivity` performance panel reads.
public struct RecentActivityAnalytics: Equatable, Sendable {
    public let totalDrives: Int
    public let totalChargingSessions: Int
    public let totalCost: Double
    public let totalEnergyKwh: Double
    public let mostEfficientVehicle: RecentActivityEfficientVehicle?

    public init(
        totalDrives: Int,
        totalChargingSessions: Int,
        totalCost: Double,
        totalEnergyKwh: Double,
        mostEfficientVehicle: RecentActivityEfficientVehicle?
    ) {
        self.totalDrives = totalDrives
        self.totalChargingSessions = totalChargingSessions
        self.totalCost = totalCost
        self.totalEnergyKwh = totalEnergyKwh
        self.mostEfficientVehicle = mostEfficientVehicle
    }
}

/// The user's unit / currency / locale display preferences (web useUnits + useFormatting). The
/// `efficiencyFactor` is the `toEfficiencyDisplay` multiplier (Wh/km → Wh/{unit}); `1.609344` for
/// miles, `1` for kilometers — exactly the web dashboard's converter.
public struct RecentActivityUnits: Equatable, Sendable {
    public let distanceUnit: String
    public let efficiencyUnit: String
    public let efficiencyFactor: Double
    public let currencySymbol: String
    public let localeIdentifier: String?

    public init(
        distanceUnit: String,
        efficiencyUnit: String,
        efficiencyFactor: Double,
        currencySymbol: String,
        localeIdentifier: String?
    ) {
        self.distanceUnit = distanceUnit
        self.efficiencyUnit = efficiencyUnit
        self.efficiencyFactor = efficiencyFactor
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
    }
}

// MARK: - Output value types (the three panels' view models)

/// Whether a feed row is a drive or a charge (web `item.type`), driving the row glyph + tint.
public enum RecentActivityKind: String, Sendable, Equatable, CaseIterable {
    case drive
    case charge
}

/// One unified activity-feed row (web `activityItems` entry): a pre-formatted title + subtitle,
/// the resolved relative time, and the raw timestamp (kept for ordering + the a11y alternate).
public struct RecentActivityItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: RecentActivityKind
    public let title: String
    public let subtitle: String
    public let timeAgo: String
    public let timestamp: Date?

    public init(
        id: String,
        kind: RecentActivityKind,
        title: String,
        subtitle: String,
        timeAgo: String,
        timestamp: Date?
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.timeAgo = timeAgo
        self.timestamp = timestamp
    }
}

/// One battery-trend point (web `{ i, v }`). `position` is the plot order after the web
/// `.reverse()`; `label` is the original drive index the web keeps as the x tick.
public struct RecentActivityBatteryPoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let position: Int
    public let label: String
    public let value: Double

    public init(id: String, position: Int, label: String, value: Double) {
        self.id = id
        self.position = position
        self.label = label
        self.value = value
    }
}

/// The value tone for a performance row (web Tailwind value color): amber for cost, emerald for
/// CO₂, primary for the two counts.
public enum RecentActivityTone: String, Sendable, Equatable, CaseIterable {
    case primary
    case warning
    case success
}

/// One fleet-performance row (web label + bold value).
public struct RecentActivityMetric: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let tone: RecentActivityTone

    public init(id: String, labelKey: String, labelFallback: String, value: String, tone: RecentActivityTone) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.tone = tone
    }
}

/// The most-efficient highlight card (web `most_efficient_vehicle` block).
public struct RecentActivityEfficientHighlight: Equatable, Sendable {
    public let name: String
    public let value: String

    public init(name: String, value: String) {
        self.name = name
        self.value = value
    }
}

/// The fleet-performance panel view model: the four rows + the optional highlight.
public struct RecentActivityPerformance: Equatable, Sendable {
    public let metrics: [RecentActivityMetric]
    public let mostEfficient: RecentActivityEfficientHighlight?

    public init(metrics: [RecentActivityMetric], mostEfficient: RecentActivityEfficientHighlight?) {
        self.metrics = metrics
        self.mostEfficient = mostEfficient
    }
}

// MARK: - Render phase + load envelope

/// What the surface should render. The web component always shows its three panels (each with its
/// own internal empty); the loading / error / stale / offline envelope around it (prompt P4
/// states) is supplied by the bound source, mirroring the parent dashboard's lifecycle.
public enum RecentActivityPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the dashboard query, projected into a phase.
public enum RecentActivityLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner.
public enum RecentActivityConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
