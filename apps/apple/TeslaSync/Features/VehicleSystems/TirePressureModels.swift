//
//  TirePressureModels.swift
//  TeslaSync — P4 feature view · P7 · TirePressure (Apple) — Data Models
//
//  Wire-faithful Swift peers of the web Tire Pressure contract. Field names and
//  JSON keys mirror `web/src/features/vehicle-systems/pages/TirePressurePage.tsx`
//  (`TirePressureReading`) exactly — snake_case on the wire, SI on disk (corner
//  pressures are Pascals). Types are prefixed `TirePressure*` to avoid colliding
//  with the dashboard widget's `TirePressure*Widget` projections.
//
//  The page never computes in display units: pressures live as Pa and are
//  converted only at the render boundary by `TirePressureConvert.fromSI`
//  (the native peer of web `convertPressureFromSI`, P1/S5).
//

import Foundation
import SwiftUI

// MARK: - Pressure thresholds (SI, Pascals)

/// Recommended / soft / critical bands in Pa (web NORMAL_*/SOFT_*/GAUGE_MAX).
/// 1 bar = 100_000 Pa, 1 psi ≈ 6894.757 Pa — see `internal/tesla/units/units.go`.
enum TirePressureThresholds {
    static let normalMinPa: Double = 250_000 // 2.5 bar
    static let normalMaxPa: Double = 350_000 // 3.5 bar
    static let softLowPa: Double = 200_000 // 2.0 bar
    static let softHighPa: Double = 400_000 // 4.0 bar
    static let gaugeMaxPa: Double = 500_000 // 5.0 bar
}

// MARK: - Display pressure unit (web PressureUnitPref)

/// The user's pressure display preference (web `unitPrefs.pressure`). The page
/// stores SI and formats to one of these only at the boundary.
enum TirePressureUnit: String, CaseIterable, Identifiable, Equatable, Sendable {
    case kPa
    case psi
    case bar

    var id: String { rawValue }

    /// The unit suffix shown next to a value (web `pressureUnit`).
    var label: String { rawValue }
}

// MARK: - Tire position (web TIRE_POSITIONS / TIRE_LABELS)

/// One of the four corners. Raw values match the web position tokens so the
/// chart-series identity and sort keys line up with the React page.
enum TirePosition: String, CaseIterable, Identifiable, Equatable, Sendable {
    case fl
    case fr
    case rl
    case rr

    var id: String { rawValue }

    /// Localized corner label (web TIRE_LABELS).
    var label: String {
        switch self {
        case .fl: return String(localized: "translation.Front Left", defaultValue: "Front Left")
        case .fr: return String(localized: "translation.Front Right", defaultValue: "Front Right")
        case .rl: return String(localized: "translation.Rear Left", defaultValue: "Rear Left")
        case .rr: return String(localized: "translation.Rear Right", defaultValue: "Rear Right")
        }
    }
}

// MARK: - Pressure status (web PressureStatus / STATUS_LABELS)

/// The qualitative band a reading falls into (web `pressureStatus`).
enum TirePressureStatus: String, Equatable, Sendable {
    case normal
    case low
    case high
    case critical

    /// Localized status label (web STATUS_LABELS).
    var label: String {
        switch self {
        case .normal: return String(localized: "translation.Normal", defaultValue: "Normal")
        case .low: return String(localized: "translation.Low", defaultValue: "Low")
        case .high: return String(localized: "translation.High", defaultValue: "High")
        case .critical: return String(localized: "translation.Critical", defaultValue: "Critical")
        }
    }

    /// Badge / gauge tone (web `statusVariant`: normal→success, critical→danger, else warning).
    var tone: TirePressureTone {
        switch self {
        case .normal: return .success
        case .critical: return .danger
        case .low, .high: return .warning
        }
    }
}

// MARK: - Badge / status tone → design-token color (P2)

/// Semantic tone mapped to the generated status tokens so light/dark and
/// increased-contrast all resolve correctly (web Badge variants).
enum TirePressureTone: Equatable, Sendable {
    case success
    case warning
    case danger
    case info

    var color: Color {
        switch self {
        case .success: return Color.TS.statusSuccess
        case .warning: return Color.TS.statusWarning
        case .danger: return Color.TS.statusDanger
        case .info: return Color.TS.statusInfo
        }
    }
}

// MARK: - Reading (web TirePressureReading)

/// `GET /tire-pressure` / `/tire-pressure/latest`. Corner pressures are Pa (SI);
/// `tpmsHardWarnings` / `tpmsSoftWarnings` carry the backend's raw JSON booleans.
struct TirePressureReading: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let vehicleID: Int64
    let frontLeft: Double
    let frontRight: Double
    let rearLeft: Double
    let rearRight: Double
    let tpmsHardWarnings: String?
    let tpmsSoftWarnings: String?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case vehicleID = "vehicle_id"
        case frontLeft = "front_left"
        case frontRight = "front_right"
        case rearLeft = "rear_left"
        case rearRight = "rear_right"
        case tpmsHardWarnings = "tpms_hard_warnings"
        case tpmsSoftWarnings = "tpms_soft_warnings"
        case createdAt = "created_at"
    }

    /// Raw corner value (web `getTirePressureValue` map), pre-normalisation.
    func rawValue(for position: TirePosition) -> Double {
        switch position {
        case .fl: return frontLeft
        case .fr: return frontRight
        case .rl: return rearLeft
        case .rr: return rearRight
        }
    }

    /// Corner pressure normalised to Pa (web `getTirePressureValue`).
    func pascals(for position: TirePosition) -> Double {
        TirePressureMath.normaliseToPa(rawValue(for: position))
    }
}

// MARK: - Vehicle identity for the selector (web useSelectedVehicle roster)

/// Minimal vehicle identity for the picker (web `display_name`).
struct TirePressureVehicle: Codable, Identifiable, Equatable, Sendable {
    let id: Int64
    let displayName: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }
}

// MARK: - Date range presets (web RangePicker / PRESET_IDS)

/// History window presets (web PRESET_IDS = 7d / 30d / 90d / mtd / ytd / all).
enum TirePressureRange: String, CaseIterable, Identifiable, Equatable, Sendable {
    case sevenDays = "7d"
    case thirtyDays = "30d"
    case ninetyDays = "90d"
    case monthToDate = "mtd"
    case yearToDate = "ytd"
    case all

    var id: String { rawValue }

    /// Localized menu label.
    var label: String {
        switch self {
        case .sevenDays:
            return String(localized: "translation.tirePressure.range.7d", defaultValue: "Last 7 Days")
        case .thirtyDays:
            return String(localized: "translation.tirePressure.range.30d", defaultValue: "Last 30 Days")
        case .ninetyDays:
            return String(localized: "translation.tirePressure.range.90d", defaultValue: "Last 90 Days")
        case .monthToDate:
            return String(localized: "translation.tirePressure.range.mtd", defaultValue: "Month to Date")
        case .yearToDate:
            return String(localized: "translation.tirePressure.range.ytd", defaultValue: "Year to Date")
        case .all:
            return String(localized: "translation.tirePressure.range.all", defaultValue: "All Time")
        }
    }

    /// The window's start instant relative to `now` (nil = unbounded "all").
    func startDate(now: Date = Date(), calendar: Calendar = .current) -> Date? {
        switch self {
        case .sevenDays: return calendar.date(byAdding: .day, value: -7, to: now)
        case .thirtyDays: return calendar.date(byAdding: .day, value: -30, to: now)
        case .ninetyDays: return calendar.date(byAdding: .day, value: -90, to: now)
        case .monthToDate: return calendar.dateInterval(of: .month, for: now)?.start
        case .yearToDate: return calendar.dateInterval(of: .year, for: now)?.start
        case .all: return nil
        }
    }
}

// MARK: - Pure helpers (web module-scope functions)

/// Numeric coercion + status helpers — the native peers of the web page's
/// module-scope functions. Pure and unit-testable; no display-unit branching.
enum TirePressureMath {
    /// Web `hasTpmsWarning`: a TPMS JSON string contains any `true` value.
    static func hasWarning(_ raw: String?) -> Bool {
        guard let raw, !raw.isEmpty else { return false }
        if let data = raw.data(using: .utf8),
           let parsed = try? JSONDecoder().decode([String: Bool].self, from: data) {
            return parsed.values.contains(true)
        }
        // Fallback: treat non-empty, non-"false" strings as truthy (web parity).
        return raw != "false"
    }

    /// Web `normaliseTpmsToPa`: coerce a raw TPMS value (Pa / kPa / psi / bar) to Pa.
    static func normaliseToPa(_ raw: Double?) -> Double {
        guard let raw, raw.isFinite, raw > 0 else { return 0 }
        if raw >= 50_000 { return raw } // already Pa
        if raw >= 100 { return raw * 1_000 } // kPa
        if raw >= 10 { return raw * 6_894.757 } // psi
        return raw * 100_000 // bar
    }

    /// Web `pressureStatus`: classify a Pa value into a band.
    static func status(forPascals pascals: Double) -> TirePressureStatus {
        if pascals < TirePressureThresholds.softLowPa { return .critical }
        if pascals < TirePressureThresholds.normalMinPa { return .low }
        if pascals > TirePressureThresholds.softHighPa { return .critical }
        if pascals > TirePressureThresholds.normalMaxPa { return .high }
        return .normal
    }

    /// Whether a corner counts toward the "warning" summary (outside the
    /// recommended band — web `summaryStats.warningCount`).
    static func isOutsideRecommended(pascals: Double) -> Bool {
        pascals < TirePressureThresholds.normalMinPa || pascals > TirePressureThresholds.normalMaxPa
    }
}

// MARK: - SI → display conversion (web convertPressureFromSI, P1/S5)

/// Pure SI → display-unit pressure conversion. Mirrors
/// `web/src/lib/unitConversion.ts` `convertPressureFromSI` exactly: the input is
/// kilopascals, so Pa is divided by 1000 first at the boundary.
enum TirePressureConvert {
    /// 1 psi = 6.894757 kPa (NIST SP 811).
    private static let kpaPerPsi: Double = 6.894757
    /// 1 bar = 100 kPa (BIPM).
    private static let kpaPerBar: Double = 100

    /// Convert kilopascals to the display unit (web `convertPressureFromSI`).
    static func fromKilopascals(_ kpa: Double, to unit: TirePressureUnit) -> Double {
        switch unit {
        case .kPa: return kpa
        case .psi: return kpa / kpaPerPsi
        case .bar: return kpa / kpaPerBar
        }
    }

    /// Convert Pascals (on-disk SI) to the display unit (web `pressureDisplayValue`).
    static func fromPascals(_ pascals: Double, to unit: TirePressureUnit) -> Double {
        fromKilopascals(pascals / 1_000, to: unit)
    }
}

// MARK: - Display formatting (web fmtNumber / formatDateTime)

/// Locale-aware number + date formatting at the display boundary (web
/// `fmtNumber` / `formatDateTime`). Kept tiny and dependency-free.
enum TirePressureFormat {
    /// Web `fmtNumber(value, fractionDigits)` — grouped, fixed fraction digits.
    static func number(_ value: Double, fractionDigits: Int = 1) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// A value rendered with its unit suffix, e.g. `36.0 psi` (web `${value} ${unit}`).
    static func valueWithUnit(_ pascals: Double, unit: TirePressureUnit) -> String {
        "\(number(TirePressureConvert.fromPascals(pascals, to: unit))) \(unit.label)"
    }

    /// Web `formatDateTime` — abbreviated date + short time, locale-aware.
    static func dateTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}
