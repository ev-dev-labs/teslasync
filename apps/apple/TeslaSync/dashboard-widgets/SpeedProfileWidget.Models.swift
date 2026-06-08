//
//  SpeedProfileWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0095 · SpeedProfileWidget (Apple)
//
//  Shared-free domain value types for the SpeedProfileWidget surface: the user's
//  speed display preference, the cached `/analytics/speed-profile` inputs, the
//  computed chart bars + summary projection, and the locale-aware number
//  formatter. No SwiftUI / transport here — these are the pure, unit-tested
//  inputs/outputs of the cached → projection adapter (port of the web
//  SpeedProfileWidget.tsx derive block).
//

import Foundation

// MARK: - Speed display preference (port of web `SpeedUnitPref`)

/// The user's speed display unit, mirroring the web `SpeedUnitPref`
/// (`'km/h' | 'mph'`). The symbol doubles as the trailing unit chip the web
/// renders next to the Most Common / Sweet Spot stats (`unit: unitPrefs.speed`).
public enum SpeedDisplayUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour = "km/h"
    case milesPerHour = "mph"

    /// Resolves a stored preference label to a unit, defaulting to km/h (the
    /// metric/SI-aligned default the shared `UnitPref` falls back to). Accepts a
    /// few common spellings (`"kmh"`, `"kph"`) so feeds that drop the slash still
    /// map correctly.
    public static func fromLabel(_ label: String?) -> SpeedDisplayUnit {
        guard let label else { return .kilometersPerHour }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch trimmed {
        case "mph", "mi/h", "mi": return .milesPerHour
        case "km/h", "kmh", "kph", "km": return .kilometersPerHour
        default: return .kilometersPerHour
        }
    }

    /// The short unit symbol shown next to values (`km/h` / `mph`).
    public var symbol: String {
        rawValue
    }
}

// MARK: - Cached DTO input (subset of web `SpeedProfileData`)

/// One histogram bucket from `/analytics/speed-profile` `distribution`, mirroring
/// the three `SpeedBucket` members the web widget reads. `readings` weights the
/// frequency share and `avgPowerKw` drives the efficiency overlay + Sweet Spot.
public struct SpeedProfileBucketInput: Sendable, Equatable {
    public var speedBucket: String
    public var readings: Double
    public var avgPowerKw: Double

    public init(speedBucket: String, readings: Double = 0, avgPowerKw: Double = 0) {
        self.speedBucket = speedBucket
        self.readings = readings
        self.avgPowerKw = avgPowerKw
    }
}

/// The cached `/analytics/speed-profile` fields this surface consumes: the bucket
/// distribution + the optimal-speed estimate (SI m/s). Mirrors the two
/// `SpeedProfileData` members the web widget reads (`distribution`,
/// `optimalSpeedMps`).
public struct SpeedProfileInput: Sendable, Equatable {
    public var distribution: [SpeedProfileBucketInput]
    public var optimalSpeedMps: Double

    public init(distribution: [SpeedProfileBucketInput] = [], optimalSpeedMps: Double = 0) {
        self.distribution = distribution
        self.optimalSpeedMps = optimalSpeedMps
    }
}

/// The minimal vehicle reference the widget needs to scope its query, mirroring
/// the `useVehicles()[0]` fallback the web widget uses to pick a default id.
public struct SpeedProfileVehicleRef: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Projection (the adapter output the view renders)

/// One composed-chart datum (web `ChartDatum`): the display-unit bucket label,
/// the frequency share (percent), and the efficiency overlay value (avg power).
public struct SpeedProfileBar: Sendable, Equatable, Identifiable {
    public var bucket: String
    public var frequency: Double
    public var efficiency: Double

    public var id: String {
        bucket
    }

    public init(bucket: String, frequency: Double, efficiency: Double) {
        self.bucket = bucket
        self.frequency = frequency
        self.efficiency = efficiency
    }
}

/// The fully-computed projection the view renders. Every value is already in the
/// user's speed `unit` so the SwiftUI layer performs no unit math — it only
/// formats. This is the output asserted by the adapter tests for parity with the
/// web computation.
public struct SpeedProfileProjection: Sendable, Equatable {
    public var unit: SpeedDisplayUnit
    public var bars: [SpeedProfileBar]
    public var peakBucket: String
    public var peakFrequency: Double
    public var sweetSpot: String
    public var hasData: Bool

    public init(
        unit: SpeedDisplayUnit,
        bars: [SpeedProfileBar],
        peakBucket: String,
        peakFrequency: Double,
        sweetSpot: String,
        hasData: Bool
    ) {
        self.unit = unit
        self.bars = bars
        self.peakBucket = peakBucket
        self.peakFrequency = peakFrequency
        self.sweetSpot = sweetSpot
        self.hasData = hasData
    }
}

// MARK: - Number formatting (port of web `fmtNumber` / `fmtInt`)

/// Locale-aware decimal formatting mirroring the web `fmtNumber(v, decimals)`
/// (`toLocaleString` with fixed fraction digits + grouping). Ties round away from
/// zero to match the JS `halfExpand` default. The web global locale default is
/// `en-US`; callers may override per-call.
public enum SpeedProfileNumberFormat {
    /// The em dash the web renders for an absent stat (`'—'`).
    public static let emptyDash = "—"

    /// Formats with a fixed number of fraction digits and grouping separators.
    public static func decimal(
        _ value: Double,
        fractionDigits: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.usesGroupingSeparator = true
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(fractionDigits)f", safe)
    }

    /// Integer formatting with grouping (web `fmtInt`).
    public static func integer(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        decimal(value, fractionDigits: 0, locale: locale)
    }

    /// Percent string at one fraction digit (web `` `${fmtNumber(v, 1)}%` ``).
    public static func percent(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        "\(decimal(value, fractionDigits: 1, locale: locale))%"
    }
}
