//
//  DrivingSection.Models.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  The Foundation-only value types for the weekly-digest "Driving" section: the inbound DTOs (the
//  web `DigestMetrics` slice + `DailyDistanceEntry[]`), the injected pre-localized copy, and the
//  trend / phase / connection enums. Free of SwiftUI so the projection logic compiles and tests on a
//  plain host. Parity target: features/analytics/components/weekly-digest/DrivingSection.tsx.
//

import Foundation

// MARK: - Inbound DTOs (web `DigestMetrics` slice + `DailyDistanceEntry[]`)

/// One day's distance bin — the SwiftUI parity of the web `DailyDistanceEntry`
/// (`{ day, distance }`). `day` is the pre-localized short weekday label the parent
/// builds from `DAY_LABELS` (web hardcodes "Mon"…"Sun"); `distanceKm` is in kilometres.
public struct DrivingDailyDistance: Sendable, Equatable, Identifiable {
    /// The weekday bucket label (web `day`, e.g. "Mon").
    public var day: String
    /// Kilometres driven that weekday (web `distance`).
    public var distanceKm: Double

    public var id: String {
        day
    }

    public init(day: String, distanceKm: Double) {
        self.day = day
        self.distanceKm = distanceKm
    }
}

/// The single "best" drive of the week — the web `metrics.topDrive` (`Drive`). Distance is in
/// kilometres, duration in minutes, efficiency in Wh·km, exactly as the API delivers them to the
/// web digest.
public struct DrivingTopDrive: Sendable, Equatable {
    /// ISO-8601 start timestamp (web `start_date`), rendered via `formatDate`.
    public var startDate: String
    /// Kilometres driven (web `distance`).
    public var distanceKm: Double
    /// Drive duration in minutes (web `duration_min`).
    public var durationMin: Double
    /// Efficiency in Wh·km (web `efficiency_wh_km`).
    public var efficiencyWhKm: Double

    public init(startDate: String, distanceKm: Double, durationMin: Double, efficiencyWhKm: Double) {
        self.startDate = startDate
        self.distanceKm = distanceKm
        self.durationMin = durationMin
        self.efficiencyWhKm = efficiencyWhKm
    }
}

/// The slice of the web `DigestMetrics` the Driving section reads, plus the daily-distance series.
/// Every numeric is optional to mirror the web `?? 0` fallbacks. `nil` (the whole struct absent)
/// reproduces the web parent's "no digest resolved yet" branch (→ the surface empty state).
public struct DrivingDigestDTO: Sendable, Equatable {
    /// Mean Wh·km across the week's drives (web `metrics.avgEfficiency`).
    public var avgEfficiency: Double?
    /// Mean Wh·km across the prior week (web `metrics.prevAvgEfficiency`).
    public var prevAvgEfficiency: Double?
    /// Total driving minutes this week (web `metrics.totalDuration`).
    public var totalDurationMin: Double?
    /// Drive count this week (web `metrics.totalDrives`).
    public var totalDrives: Double?
    /// The week's longest drive, if any (web `metrics.topDrive`).
    public var topDrive: DrivingTopDrive?
    /// The seven weekday distance bins (web `dailyDistanceData`).
    public var dailyDistance: [DrivingDailyDistance]

    public init(
        avgEfficiency: Double? = nil,
        prevAvgEfficiency: Double? = nil,
        totalDurationMin: Double? = nil,
        totalDrives: Double? = nil,
        topDrive: DrivingTopDrive? = nil,
        dailyDistance: [DrivingDailyDistance] = []
    ) {
        self.avgEfficiency = avgEfficiency
        self.prevAvgEfficiency = prevAvgEfficiency
        self.totalDurationMin = totalDurationMin
        self.totalDrives = totalDrives
        self.topDrive = topDrive
        self.dailyDistance = dailyDistance
    }
}

// MARK: - Trend (web `TrendingDown`/`TrendingUp` for the Efficiency Change stat)

/// The arrow direction the efficiency-change stat shows.
public enum DrivingTrendDirection: String, Sendable, Equatable {
    case up
    case down
}

/// The semantic tone of the efficiency-change arrow. Efficiency is lower-is-better, so the web
/// renders an emerald `TrendingDown` when `avg <= prev` (good) and a red `TrendingUp` otherwise (bad).
public enum DrivingTrendTone: String, Sendable, Equatable {
    case positive
    case negative
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector needs: the four metric labels + the "Top Drive" / Date /
/// Distance / Duration / Efficiency labels the web reads via `t()`, plus the unit glyphs the web
/// embeds in its template literals (`Wh/km`, `km`, `min`, `h`, `m`) and the em-dash fallback.
/// Injected so the projection stays Foundation-only and host-testable (the view resolves the real
/// catalog copy through the P1/S10 facade).
public struct DrivingSectionCopy: Sendable, Equatable {
    public var avgEfficiencyLabel: String
    public var totalDrivingTimeLabel: String
    public var efficiencyChangeLabel: String
    public var drivesLabel: String
    public var topDriveBadge: String
    public var dateLabel: String
    public var distanceLabel: String
    public var durationLabel: String
    public var efficiencyLabel: String
    /// Wh·km unit suffix (web literal "Wh/km").
    public var efficiencyUnit: String
    /// Kilometre unit suffix (web literal "km").
    public var distanceUnit: String
    /// Minutes unit suffix (web literal "min").
    public var durationUnit: String
    /// Hours glyph in the driving-time stat (web literal "h").
    public var hoursGlyph: String
    /// Minutes glyph in the driving-time stat (web literal "m").
    public var minutesGlyph: String
    /// Shown for the efficiency-change percent when there is no prior period (web `'—'`).
    public var emDash: String

    public init(
        avgEfficiencyLabel: String = "Avg Efficiency",
        totalDrivingTimeLabel: String = "Total Driving Time",
        efficiencyChangeLabel: String = "Efficiency Change",
        drivesLabel: String = "Drives",
        topDriveBadge: String = "Top Drive",
        dateLabel: String = "Date",
        distanceLabel: String = "Distance",
        durationLabel: String = "Duration",
        efficiencyLabel: String = "Efficiency",
        efficiencyUnit: String = "Wh/km",
        distanceUnit: String = "km",
        durationUnit: String = "min",
        hoursGlyph: String = "h",
        minutesGlyph: String = "m",
        emDash: String = "—"
    ) {
        self.avgEfficiencyLabel = avgEfficiencyLabel
        self.totalDrivingTimeLabel = totalDrivingTimeLabel
        self.efficiencyChangeLabel = efficiencyChangeLabel
        self.drivesLabel = drivesLabel
        self.topDriveBadge = topDriveBadge
        self.dateLabel = dateLabel
        self.distanceLabel = distanceLabel
        self.durationLabel = durationLabel
        self.efficiencyLabel = efficiencyLabel
        self.efficiencyUnit = efficiencyUnit
        self.distanceUnit = distanceUnit
        self.durationUnit = durationUnit
        self.hoursGlyph = hoursGlyph
        self.minutesGlyph = minutesGlyph
        self.emDash = emDash
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = DrivingSectionCopy()
}

// MARK: - Render phase (load envelope around the web content/empty split)

/// What the surface should render. The web `DrivingSection` is a pure presentational component; its
/// parent `WeeklyDigestPage` owns the loading / error / empty envelope. The native surface
/// reproduces that whole envelope so every prompt-required state renders here.
public enum DrivingSectionPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status (web parent `isLoading` / resolved / failure).
public enum DrivingSectionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so cached
/// content is clearly labelled while reconnecting / offline.
public enum DrivingSectionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
