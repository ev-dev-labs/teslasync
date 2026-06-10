//
//  VehicleCharts.Formatting.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The display-boundary seams the surface binds through: the P1/S11 `view.opened`
//  telemetry sink, the `useFormatting` parity the map footer + chart axes need
//  (`formatTime` → HH:mm, `fmtNumber` → grouped fixed-decimal coordinate), and the
//  `useUnits` parity that converts SI speed to the user's display unit at the
//  render boundary (web `convertSpeedFromSI(mps, unitPrefs.speed)`). Production
//  injects settings-backed implementations; previews/tests use the bundle-free
//  defaults. No unit math lives anywhere but here (ADR-009).
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 `view.opened`)

/// Diagnostics seam for the P1/S11 `view.opened` contract. `Sendable` so the view
/// can emit without a main-actor hop and a default sink can be an `init` default.
public protocol VehicleChartsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no VIN, coordinate, speed,
/// or config payload is ever recorded.
public struct OSLogVehicleChartsTelemetry: VehicleChartsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Speed unit (web `SpeedUnitPref`)

/// The user's display speed unit — the native parity of the web `SpeedUnitPref`
/// (`'mph' | 'km/h'`). Owns the SI conversion + its label so no unit math leaks.
public enum VehicleChartsSpeedUnit: String, Sendable, CaseIterable {
    case mph
    case kmh

    private static let secondsPerHour = 3600.0
    private static let metersPerMile = 1609.344
    private static let metersPerKilometer = 1000.0

    /// The chip/series label (web `unitPrefs.speed`: `"mph"` / `"km/h"`).
    public var label: String {
        switch self {
        case .mph: "mph"
        case .kmh: "km/h"
        }
    }

    /// Converts SI metres-per-second to this unit (web `convertSpeedFromSI`).
    public func fromSI(_ mps: Double) -> Double {
        switch self {
        case .mph: (mps * Self.secondsPerHour) / Self.metersPerMile
        case .kmh: (mps * Self.secondsPerHour) / Self.metersPerKilometer
        }
    }
}

// MARK: - Units seam (web `useUnits`)

/// The `useUnits` parity the surface needs: the active speed unit + its SI
/// converter. Kept behind a protocol so production injects the settings-derived
/// preference and previews/tests pin a fixed unit.
public protocol VehicleChartsUnits: Sendable {
    var speed: VehicleChartsSpeedUnit { get }
}

public extension VehicleChartsUnits {
    /// Converts an SI speed to the active display unit.
    func convertSpeedFromSI(_ mps: Double) -> Double {
        speed.fromSI(mps)
    }

    /// The active speed unit's label.
    var speedUnitLabel: String {
        speed.label
    }
}

/// Bundle-free default units (web default speed preference is `mph`).
public struct DefaultVehicleChartsUnits: VehicleChartsUnits {
    public var speed: VehicleChartsSpeedUnit

    public init(speed: VehicleChartsSpeedUnit = .mph) {
        self.speed = speed
    }
}

// MARK: - Formatting seam (web `formatTime` + `fmtNumber`)

/// The display-boundary formatting the surface needs (web `useFormatting` /
/// `lib/dateFormat` / `lib/numberFormat`).
public protocol VehicleChartsFormatting: Sendable {
    /// A short wall-clock time (web `formatTime(ts)` → `HH:mm`). `—` for nil.
    func formatTime(_ date: Date?) -> String
    /// A grouped, fixed-decimal number (web `fmtNumber(value)`, default 2 dp).
    func formatNumber(_ value: Double, decimals: Int) -> String
}

public extension VehicleChartsFormatting {
    /// `fmtNumber` at the web global default precision (2).
    func formatNumber(_ value: Double) -> String {
        formatNumber(value, decimals: 2)
    }
}

/// Bundle-free default formatter: grouped thousands, fixed decimals, rounding
/// half-up — the parity of the web `toLocaleString('en-US')` defaults. Stateless
/// and `Sendable`.
public struct DefaultVehicleChartsFormatting: VehicleChartsFormatting {
    private let localeIdentifier: String

    public init(localeIdentifier: String = "en_US") {
        self.localeIdentifier = localeIdentifier
    }

    public func formatTime(_ date: Date?) -> String {
        guard let date else { return "—" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    public func formatNumber(_ value: Double, decimals: Int) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? "0"
    }
}
