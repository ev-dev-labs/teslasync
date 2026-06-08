//
//  DriveAnalyticsSection.Models.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  The Foundation-only value types for the driving-dynamics "Drive Analytics" section: the inbound
//  per-drive DTO (the web `Drive[]` slice the section buckets), the user's unit settings (the web
//  `toDistanceDisplay` / `toSpeedDisplay` + `distanceUnit` / `speedUnit` props), the resolved payload,
//  the injected pre-localized copy, and the phase / status / connection enums. Free of SwiftUI so the
//  projection logic compiles and tests on a plain host. Parity target:
//  features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx.
//

import Foundation

// MARK: - Inbound DTO (web `Drive` slice)

/// The slice of the web `Drive` the analytics section reads, in SI canonical units exactly as the API
/// delivers them (Phase-48): distance in meters, average speed in m/s, average power in watts. Speed
/// and power are optional to mirror the web `avgSpeedMps != null` / `avgPowerW != null` guards.
public struct DriveAnalyticsSectionDrive: Sendable, Equatable, Identifiable {
    /// Stable drive identifier (web `Drive.id`).
    public var id: Int
    /// ISO-8601 start timestamp (web `start_ts`), rendered via `formatDateShort` for the power profile.
    public var startTs: String
    /// Distance travelled in meters (web `distance_m`, SI canonical).
    public var distanceM: Double
    /// Average speed in m/s, if recorded (web `avg_speed_mps`, SI canonical).
    public var avgSpeedMps: Double?
    /// Average power in watts, if recorded (web `avg_power_w`, SI canonical).
    public var avgPowerW: Double?

    public init(
        id: Int,
        startTs: String,
        distanceM: Double,
        avgSpeedMps: Double? = nil,
        avgPowerW: Double? = nil
    ) {
        self.id = id
        self.startTs = startTs
        self.distanceM = distanceM
        self.avgSpeedMps = avgSpeedMps
        self.avgPowerW = avgPowerW
    }
}

// MARK: - Unit settings (web `toDistanceDisplay` / `toSpeedDisplay` + unit labels)

/// The user's display-unit settings the section converts at the render boundary — the native parity of
/// the web `toDistanceDisplay` / `toSpeedDisplay` converter props plus the `distanceUnit` / `speedUnit`
/// glyphs. The converters are linear (meters → display distance, m/s → display speed), so they are
/// modelled as Equatable scale factors, keeping the whole DTO host-testable. SI stays on disk;
/// conversion happens only here (ADR-009 / Phase-48).
public struct DriveAnalyticsSectionUnits: Sendable, Equatable {
    /// Distance unit glyph (web `distanceUnit`, e.g. "km" or "mi").
    public var distanceUnit: String
    /// Speed unit glyph (web `speedUnit`, e.g. "km/h" or "mph").
    public var speedUnit: String
    /// Meters → display-distance multiplier (web `toDistanceDisplay`).
    public var distanceFactor: Double
    /// Metres-per-second → display-speed multiplier (web `toSpeedDisplay`).
    public var speedFactor: Double

    public init(
        distanceUnit: String,
        speedUnit: String,
        distanceFactor: Double,
        speedFactor: Double
    ) {
        self.distanceUnit = distanceUnit
        self.speedUnit = speedUnit
        self.distanceFactor = distanceFactor
        self.speedFactor = speedFactor
    }

    /// Metric defaults (km / km/h) — used by previews + tests.
    public static let metric = DriveAnalyticsSectionUnits(
        distanceUnit: "km",
        speedUnit: "km/h",
        distanceFactor: 0.001,
        speedFactor: 3.6
    )

    /// Imperial defaults (mi / mph).
    public static let imperial = DriveAnalyticsSectionUnits(
        distanceUnit: "mi",
        speedUnit: "mph",
        distanceFactor: 0.000_621_371_192,
        speedFactor: 2.236_936_292
    )

    /// Web `toDistanceDisplay(meters)`.
    public func toDistanceDisplay(_ meters: Double) -> Double {
        meters * distanceFactor
    }

    /// Web `toSpeedDisplay(metersPerSecond)`.
    public func toSpeedDisplay(_ metersPerSecond: Double) -> Double {
        metersPerSecond * speedFactor
    }
}

// MARK: - Resolved payload

/// One resolved analytics payload: the filtered drives the section charts (web `filteredDrives`), the
/// active unit settings, and the selected date window the header range picker reflects (web
/// `startDate` / `endDate`). A resolved payload with no drives reproduces the web parent's "no drives
/// in range" branch (→ the surface empty state).
public struct DriveAnalyticsSectionData: Sendable, Equatable {
    /// The drives in the selected window (web `filteredDrives`).
    public var drives: [DriveAnalyticsSectionDrive]
    /// The active display-unit settings.
    public var units: DriveAnalyticsSectionUnits
    /// The start of the selected window (web `startDate`).
    public var rangeStart: Date
    /// The end of the selected window (web `endDate`).
    public var rangeEnd: Date

    public init(
        drives: [DriveAnalyticsSectionDrive],
        units: DriveAnalyticsSectionUnits,
        rangeStart: Date,
        rangeEnd: Date
    ) {
        self.drives = drives
        self.units = units
        self.rangeStart = rangeStart
        self.rangeEnd = rangeEnd
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure projector

/// The pre-localized strings the projector embeds in projected values: the kilowatt glyph the web
/// appends inline (`" kW"`) and the em-dash fallback for an unparseable timestamp (web `formatDateShort`
/// `'—'`). Injected so the projection stays Foundation-only and host-testable (the view resolves the
/// real catalog copy through the P1/S10 facade).
public struct DriveAnalyticsSectionCopy: Sendable, Equatable {
    /// Kilowatt unit glyph (web literal "kW").
    public var kilowattUnit: String
    /// Shown for an empty / unparseable power-profile timestamp (web `formatDateShort` `'—'`).
    public var emDash: String

    public init(kilowattUnit: String = "kW", emDash: String = "—") {
        self.kilowattUnit = kilowattUnit
        self.emDash = emDash
    }

    /// English fallbacks (matches the web source literals) — used by previews + tests.
    public static let fallback = DriveAnalyticsSectionCopy()
}

// MARK: - Render phase (load envelope around the web charts)

/// What the surface should render. The web `DriveAnalyticsSection` is a pure presentational component;
/// its parent owns the loading / error / empty envelope. The native surface reproduces that whole
/// envelope so every prompt-required state renders here.
public enum DriveAnalyticsSectionPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status (web parent `isLoading` / resolved / failure).
public enum DriveAnalyticsSectionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so cached
/// content is clearly labelled while reconnecting / offline.
public enum DriveAnalyticsSectionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}
