//
//  DrivingSection.Projection.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  The projected output types for the "Driving" section (the chart bars, the four mini-stat tiles,
//  the Top Drive card, and the whole-section projection), the diagnostics surface slug, and the
//  VoiceOver summary builder. Foundation-only so it executes on a plain host and is pinned by tests.
//

import Foundation

// MARK: - Projected pieces

/// One plotted daily-distance bar — the chart x/y plus a formatted value + per-bar VoiceOver value.
public struct DrivingDistanceBar: Sendable, Equatable, Identifiable {
    /// The weekday label (chart x value, stable order).
    public var day: String
    /// Kilometres (chart y value).
    public var distanceKm: Double
    /// The formatted `"{n} km"` shown in the tooltip / spoken for the bar.
    public var valueText: String

    public var id: String {
        day
    }

    public init(day: String, distanceKm: Double, valueText: String) {
        self.day = day
        self.distanceKm = distanceKm
        self.valueText = valueText
    }
}

/// Which of the four driving stats a tile represents (fixes order + the SF Symbol the view picks).
public enum DrivingStatKind: String, Sendable, Equatable, CaseIterable {
    case avgEfficiency
    case totalDrivingTime
    case efficiencyChange
    case drives
}

/// One projected mini-stat tile (web `MiniStat`): a label, a formatted value, and — for the
/// efficiency-change tile only — the trend arrow direction + tone.
public struct DrivingSectionStat: Sendable, Equatable, Identifiable {
    public var kind: DrivingStatKind
    public var label: String
    public var value: String
    /// Present only for `.efficiencyChange` (drives the up/down arrow + emerald/red tint).
    public var trend: DrivingTrendDirection?
    public var trendTone: DrivingTrendTone?
    public var accessibilityLabel: String

    public var id: DrivingStatKind {
        kind
    }

    public init(
        kind: DrivingStatKind,
        label: String,
        value: String,
        trend: DrivingTrendDirection? = nil,
        trendTone: DrivingTrendTone? = nil,
        accessibilityLabel: String
    ) {
        self.kind = kind
        self.label = label
        self.value = value
        self.trend = trend
        self.trendTone = trendTone
        self.accessibilityLabel = accessibilityLabel
    }
}

/// One labelled row in the Top Drive card (Date / Distance / Duration / Efficiency).
public struct DrivingTopDriveRow: Sendable, Equatable, Identifiable {
    public var label: String
    public var value: String

    public var id: String {
        label
    }

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

/// The fully projected Top Drive card content (web `metrics.topDrive` branch): the badge text + the
/// four labelled rows + a combined VoiceOver summary.
public struct DrivingTopDriveCard: Sendable, Equatable {
    public var badge: String
    public var rows: [DrivingTopDriveRow]
    public var accessibilityLabel: String

    public init(badge: String, rows: [DrivingTopDriveRow], accessibilityLabel: String) {
        self.badge = badge
        self.rows = rows
        self.accessibilityLabel = accessibilityLabel
    }
}

/// The whole projected section: the daily-distance bars, the four stats, and the optional Top Drive
/// card. Empty bars reproduce the web chart `EmptyState`; a `nil` card reproduces the Top Drive
/// `EmptyState`.
public struct DrivingSectionProjection: Sendable, Equatable {
    public var bars: [DrivingDistanceBar]
    public var stats: [DrivingSectionStat]
    public var topDrive: DrivingTopDriveCard?

    public init(bars: [DrivingDistanceBar], stats: [DrivingSectionStat], topDrive: DrivingTopDriveCard?) {
        self.bars = bars
        self.stats = stats
        self.topDrive = topDrive
    }

    /// Web `dailyDistanceData.length > 0` — whether the bar chart renders (vs its empty state).
    public var hasDailyDistance: Bool {
        !bars.isEmpty
    }

    /// The summed kilometres across the week (chart-level VoiceOver value).
    public var totalDistanceKm: Double {
        bars.reduce(0) { $0 + $1.distanceKm }
    }

    public static let empty = DrivingSectionProjection(bars: [], stats: [], topDrive: nil)
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free
/// core so it is reachable from the projection's unit tests.
public enum DrivingSectionSurface {
    public static let slug = "DrivingSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade.
public enum DrivingSectionAccessibility {
    /// The chart-level summary: title + day count + total kilometres.
    public static func chartSummary(
        for projection: DrivingSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("analytics.weeklyDigest.dailyDistance", "Daily Distance (km)")
        guard projection.hasDailyDistance else {
            let empty = localize(
                "analytics.weeklyDigest.noDailyDistance",
                "No driving distance data is available for this week."
            )
            return "\(title): \(empty)"
        }
        let days = localize("analytics.weeklyDigest.driving.days", "days")
        let total = DrivingFormat.number(projection.totalDistanceKm, decimals: 1)
        let unit = localize("analytics.weeklyDigest.driving.kmUnit", "km")
        return "\(title): \(projection.bars.count) \(days), \(total) \(unit)"
    }

    /// The section-level summary spoken for the whole surface: the "Driving" title followed by each
    /// stat tile's spoken label.
    public static func sectionSummary(
        for projection: DrivingSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("analytics.weeklyDigest.drivingSection", "Driving")
        let parts = [title] + projection.stats.map(\.accessibilityLabel)
        return parts.joined(separator: ". ")
    }
}
