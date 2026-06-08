//
//  DriveAnalyticsSection.Projection.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  The projected output types for the "Drive Analytics" section (the speed-distribution buckets, the
//  acceleration scatter points, the power-profile dual-area series, and the whole-section projection),
//  the diagnostics surface slug, and the VoiceOver summary builders. Foundation-only so it executes on
//  a plain host and is pinned by tests.
//

import Foundation

// MARK: - Projected pieces

/// One speed-distribution bar (web `SpeedBucket`): the bucket label (`"{range} {speedUnit}"`) and the
/// number of drives whose average speed falls in the bucket.
public struct DriveAnalyticsSectionSpeedBucket: Sendable, Equatable, Identifiable {
    /// The bucket label, chart x value (web `range`, e.g. "30–60 km/h").
    public var range: String
    /// The number of drives in the bucket (web `count`).
    public var count: Int

    public var id: String {
        range
    }

    public init(range: String, count: Int) {
        self.range = range
        self.count = count
    }
}

/// One acceleration-patterns scatter point (web `AccelPoint`): the drive's display distance (x) and its
/// peak power in kilowatts (y).
public struct DriveAnalyticsSectionAccelPoint: Sendable, Equatable, Identifiable {
    /// Stable plot identity (the source drive's array position).
    public var id: Int
    /// Trip distance in the user's display unit, rounded (web `distance`).
    public var distance: Double
    /// Peak power in kilowatts (web `powerMax`).
    public var powerMax: Double

    public init(id: Int, distance: Double, powerMax: Double) {
        self.id = id
        self.distance = distance
        self.powerMax = powerMax
    }
}

/// One power-profile sample (web `PowerPoint`): the short-date label plus the peak and regen power in
/// kilowatts for one of the recent drives.
public struct DriveAnalyticsSectionPowerPoint: Sendable, Equatable, Identifiable {
    /// 1-based position within the recent-drives window (web `index`).
    public var index: Int
    /// The short-date label, chart x value (web `label`, e.g. "Apr 4").
    public var label: String
    /// Peak power in kilowatts (web `powerMax`).
    public var powerMax: Double
    /// Regen power in kilowatts (web `powerMin`, always 0 for the per-drive average source).
    public var powerMin: Double

    public var id: Int {
        index
    }

    public init(index: Int, label: String, powerMax: Double, powerMin: Double) {
        self.index = index
        self.label = label
        self.powerMax = powerMax
        self.powerMin = powerMin
    }
}

/// The whole projected section: the speed-distribution buckets, the acceleration scatter points (plus
/// their mean peak power for the web `ReferenceLine`), and the power-profile series. Each empty
/// collection reproduces the corresponding web chart's inner `EmptyState`.
public struct DriveAnalyticsSectionProjection: Sendable, Equatable {
    public var speedDistribution: [DriveAnalyticsSectionSpeedBucket]
    public var accelPatterns: [DriveAnalyticsSectionAccelPoint]
    /// Mean of the scatter points' peak power (web `ReferenceLine` y), or `nil` when there are none.
    public var accelAverage: Double?
    public var powerProfile: [DriveAnalyticsSectionPowerPoint]
    /// The distance unit glyph for the scatter x axis (web `unit={` ${distanceUnit}`}`).
    public var distanceUnit: String
    /// The kilowatt unit glyph for the power axes (web inline `" kW"`).
    public var kilowattUnit: String

    public init(
        speedDistribution: [DriveAnalyticsSectionSpeedBucket],
        accelPatterns: [DriveAnalyticsSectionAccelPoint],
        accelAverage: Double?,
        powerProfile: [DriveAnalyticsSectionPowerPoint],
        distanceUnit: String = "",
        kilowattUnit: String = "kW"
    ) {
        self.speedDistribution = speedDistribution
        self.accelPatterns = accelPatterns
        self.accelAverage = accelAverage
        self.powerProfile = powerProfile
        self.distanceUnit = distanceUnit
        self.kilowattUnit = kilowattUnit
    }

    /// Whether any speed bucket has a non-zero count (web bars render but the section has data).
    public var hasSpeedData: Bool {
        totalSpeedDrives > 0
    }

    /// Whether the acceleration scatter has any point (web `accelPatterns.length > 0`).
    public var hasAccelData: Bool {
        !accelPatterns.isEmpty
    }

    /// Whether the power profile has any sample.
    public var hasPowerData: Bool {
        !powerProfile.isEmpty
    }

    /// Total drives counted across the speed buckets (chart-level VoiceOver value).
    public var totalSpeedDrives: Int {
        speedDistribution.reduce(0) { $0 + $1.count }
    }

    public static let empty = DriveAnalyticsSectionProjection(
        speedDistribution: [],
        accelPatterns: [],
        accelAverage: nil,
        powerProfile: []
    )
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core
/// so it is reachable from the projection's unit tests.
public enum DriveAnalyticsSectionSurface {
    public static let slug = "DriveAnalyticsSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum DriveAnalyticsSectionAccessibility {
    /// The speed-distribution chart summary: title + bucket count + total drives.
    public static func speedSummary(
        for projection: DriveAnalyticsSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("dynamics.speedDistribution", "Speed Distribution")
        guard projection.hasSpeedData else {
            return "\(title): \(localize("dynamics.noData", "No data"))"
        }
        let buckets = localize("dynamics.a11yBuckets", "speed ranges")
        let drives = localize("dynamics.drives", "Drives")
        return "\(title): \(projection.speedDistribution.count) \(buckets), "
            + "\(projection.totalSpeedDrives) \(drives)"
    }

    /// The acceleration scatter summary: title + point count.
    public static func accelSummary(
        for projection: DriveAnalyticsSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("dynamics.accelPatterns", "Acceleration Patterns")
        guard projection.hasAccelData else {
            return "\(title): \(localize("dynamics.noData", "No data"))"
        }
        let drives = localize("dynamics.drives", "Drives")
        return "\(title): \(projection.accelPatterns.count) \(drives)"
    }

    /// The power-profile summary: title + sample count.
    public static func powerSummary(
        for projection: DriveAnalyticsSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("dynamics.powerProfile", "Power Profile")
        guard projection.hasPowerData else {
            return "\(title): \(localize("dynamics.noData", "No data"))"
        }
        let drives = localize("dynamics.drives", "Drives")
        return "\(title): \(projection.powerProfile.count) \(drives)"
    }

    /// The section-level summary spoken for the whole surface: the "Drive Analytics" title followed by
    /// each chart's spoken summary.
    public static func sectionSummary(
        for projection: DriveAnalyticsSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("dynamics.driveAnalytics", "Drive Analytics")
        let parts = [
            title,
            speedSummary(for: projection, localize: localize),
            accelSummary(for: projection, localize: localize),
            powerSummary(for: projection, localize: localize)
        ]
        return parts.joined(separator: ". ")
    }
}
