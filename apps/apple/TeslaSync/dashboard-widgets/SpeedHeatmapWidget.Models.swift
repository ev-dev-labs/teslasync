//
//  SpeedHeatmapWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0094 · SpeedHeatmapWidget (Apple)
//
//  Shared-free domain value types for the SpeedHeatmapWidget surface: the user's
//  speed preference, the cached drive input, one heatmap cell, the normalized
//  cell colour, the minimal vehicle reference, and the locale-aware integer
//  formatter. No SwiftUI / transport here — these are the pure, unit-tested
//  inputs/outputs of the cached → heatmap adapter (port of the web
//  SpeedHeatmapWidget.tsx data types).
//

import Foundation

// MARK: - Speed unit preference (port of web `SpeedUnitPref`)

/// The user's speed display unit, mirroring the web `SpeedUnitPref`
/// (`'km/h' | 'mph'`). Carries the SI divisor used by `convertSpeedFromSI`
/// (`mps * 3600 / metersPerUnit`) so the heatmap math agrees with the web.
public enum SpeedHeatmapWidgetUnit: String, Sendable, Equatable, CaseIterable {
    case kilometersPerHour = "km/h"
    case milesPerHour = "mph"

    /// Resolves a stored preference label (`"km/h"`, `"mph"`) to a unit,
    /// defaulting to km/h (metric) for unknown labels — matching the metric
    /// default the shared `UnitPref` falls back to.
    public static func fromLabel(_ label: String?) -> SpeedHeatmapWidgetUnit {
        guard let label else { return .kilometersPerHour }
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return SpeedHeatmapWidgetUnit(rawValue: trimmed) ?? .kilometersPerHour
    }

    /// Meters per one distance unit of the speed (`METERS_PER_KM` /
    /// `METERS_PER_MILE`) — the divisor in `mps * 3600 / metersPerUnit`.
    public var metersPerUnit: Double {
        switch self {
        case .kilometersPerHour: 1000
        case .milesPerHour: 1609.344
        }
    }

    /// The short unit symbol shown next to values (`km/h` / `mph`).
    public var symbol: String {
        rawValue
    }
}

// MARK: - Cached drive input (subset of web `Drive`)

/// The cached `/drives` fields this surface consumes, in SI. Mirrors the three
/// `Drive` members the web widget reads (`start_ts`, `avg_speed_mps`,
/// `max_speed_mps`). The start instant buckets the drive into a day×hour slot;
/// the effective speed (avg, falling back to max) feeds the cell average.
public struct SpeedHeatmapDrive: Sendable, Equatable {
    public var startDate: Date?
    public var avgSpeedMps: Double?
    public var maxSpeedMps: Double?

    public init(startDate: Date? = nil, avgSpeedMps: Double? = nil, maxSpeedMps: Double? = nil) {
        self.startDate = startDate
        self.avgSpeedMps = avgSpeedMps
        self.maxSpeedMps = maxSpeedMps
    }

    /// `avg_speed_mps ?? max_speed_mps` (web): the average speed when present,
    /// otherwise the max speed; `nil` when neither is known.
    public var effectiveSpeedMps: Double? {
        avgSpeedMps ?? maxSpeedMps
    }
}

// MARK: - Heatmap cell (port of web `HeatCell`)

/// One cell of the 7×24 grid: its day (0=Mon … 6=Sun), hour (0–23), the mean
/// speed in the user's display unit, and how many drives contributed. The
/// adapter output the view renders — already converted, so the view only maps
/// it to a colour.
public struct HeatCell: Sendable, Equatable {
    public var day: Int
    public var hour: Int
    public var avgSpeed: Double
    public var driveCount: Int

    public init(day: Int, hour: Int, avgSpeed: Double, driveCount: Int) {
        self.day = day
        self.hour = hour
        self.avgSpeed = avgSpeed
        self.driveCount = driveCount
    }
}

// MARK: - Normalized cell colour (port of web `speedToColor` output)

/// A normalized sRGB colour (each channel 0…1) produced by the gradient adapter,
/// kept SwiftUI-free so the colour math is unit-testable. The view maps it to a
/// SwiftUI `Color` at the render boundary.
public struct RGBAColor: Sendable, Equatable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }
}

// MARK: - Vehicle reference (web `useVehicles()[0]` fallback)

/// The minimal vehicle reference the widget needs to scope its query, mirroring
/// the `useVehicles()[0]` fallback the web widget uses to pick a default id.
public struct SpeedHeatmapVehicleRef: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Number formatting (port of web `fmtNumber`)

/// Locale-aware integer formatting mirroring the web `fmtNumber(v, 0)`
/// (`toLocaleString` with no fraction digits + grouping, ties rounded away from
/// zero to match the JS `halfExpand` default). The web global default locale is
/// `en-US`; callers may override per-call.
public enum SpeedNumberFormat {
    /// Formats with grouping separators and no fraction digits (web `fmtNumber(v, 0)`).
    public static func integer(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.usesGroupingSeparator = true
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.0f", safe)
    }
}
