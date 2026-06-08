//
//  TirePressureVisualWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0102 · TirePressureVisualWidget (Apple)
//
//  The testable projection core: cached TPMS readings → the view-ready
//  `TirePressureVisualWidgetProjection` (four corner readings + aggregate status + latest
//  reading time), the green/amber/red thresholding (1:1 port of the web
//  `getPressureStatus`), the SI→preference pressure conversion (port of
//  `convertPressureFromSI`), the 1-decimal value formatter (port of
//  `fmtNumber(toPressureValue(val), 1)`), the relative reading-time formatter
//  (port of `formatTimestamp`), and the VoiceOver summary builder. All pure +
//  dependency-free so the adapter unit-tests without a store, bundle, or view.
//
//  PARITY NOTE (web-source unit defect, reproduced as INTENT, not verbatim):
//  the web `THRESHOLD` table is documented "in bar" (2.068…3.103 bar ≈ 30…45
//  psi) yet `getPressureStatus` is fed `TirePressureSnapshot.front_left`, which
//  the API serves in SI (Tesla TPMS bar → ToSI Pascals; `internal/tesla/units`).
//  Comparing an SI magnitude against bar boundaries colors every healthy tire
//  red — a latent web defect. This port preserves the AUTHOR'S INTENT: the seam
//  carries kilopascals (the app's documented SI base for pressure), the bar
//  thresholds are applied after a kPa→bar reduction, so a healthy ~2.4 bar tire
//  reads green exactly as the "in bar" comment intends. The display path mirrors
//  the web structure (`toPressureValue` → 1 decimal + unit chip) faithfully.
//

import Foundation
import SwiftUI

// MARK: - Status (web `'green' | 'amber' | 'red'`)

/// The per-tire pressure status, mapped to a shared `TSTone` for value tinting
/// and to the exact web diagram hex for the silhouette fill. Mirrors the web
/// `getPressureStatus` result + `STATUS_COLORS`.
public enum TirePressureStatus: Sendable, Equatable {
    case green
    case amber
    case red

    /// Theme-aware tone for the value text / status chip (light theme safe).
    public var tone: TSTone {
        switch self {
        case .green: .success
        case .amber: .warning
        case .red: .danger
        }
    }

    /// Exact web `STATUS_COLORS.fill` hex for the car-diagram tire fill
    /// (#22c55e / #f59e0b / #ef4444) so the silhouette reads identically.
    public var diagramFill: Color {
        switch self {
        case .green: Color(red: 0.133, green: 0.773, blue: 0.369)
        case .amber: Color(red: 0.961, green: 0.620, blue: 0.043)
        case .red: Color(red: 0.937, green: 0.267, blue: 0.267)
        }
    }
}

// MARK: - Thresholds (web `THRESHOLD`, bar)

/// Pressure thresholds in bar for color coding — verbatim web `THRESHOLD`
/// (2.068 / 2.275 / 2.896 / 3.103 bar). Kept as named constants so the adapter,
/// the tests, and any future spec audit stay in lock-step.
public enum TirePressureThresholds {
    public static let dangerLowBar = 2.068
    public static let warnLowBar = 2.275
    public static let warnHighBar = 2.896
    public static let dangerHighBar = 3.103

    /// 1 bar = 100 kPa (BIPM) — the app's SI base for pressure is kilopascals.
    public static let kilopascalsPerBar = 100.0
}

/// The color-coding rules. `pressureStatus(bar:)` is the literal port of the web
/// `getPressureStatus`; `status(forKilopascals:)` is the SI wrapper the
/// projection uses (the seam carries kPa — see the file-level parity note).
public enum TirePressureClassifier {
    /// Literal port of the web `getPressureStatus(bar)`.
    public static func pressureStatus(bar: Double?) -> TirePressureStatus {
        guard let bar, bar.isFinite else { return .red }
        if bar < TirePressureThresholds.dangerLowBar || bar > TirePressureThresholds.dangerHighBar {
            return .red
        }
        if bar < TirePressureThresholds.warnLowBar || bar > TirePressureThresholds.warnHighBar {
            return .amber
        }
        return .green
    }

    /// SI wrapper: reduces kilopascals to bar, then applies the web thresholds.
    public static func status(forKilopascals kpa: Double?) -> TirePressureStatus {
        guard let kpa, kpa.isFinite else { return .red }
        return pressureStatus(bar: kpa / TirePressureThresholds.kilopascalsPerBar)
    }
}

// MARK: - Unit preference (web `PressureUnitPref` + `convertPressureFromSI`)

/// The user's pressure display preference, mirroring the shared
/// `PressureUnitPref` (`'kPa' | 'psi' | 'bar'`). `convert(fromKilopascals:)`
/// reproduces `convertPressureFromSI` with the same NIST/BIPM constants so the
/// number shown matches the web byte-for-byte.
public enum TirePressureVisualWidgetUnit: String, Sendable, CaseIterable {
    case kilopascals
    case psi
    case bar

    /// 1 psi = 6.894757 kPa (NIST SP 811).
    private static let kilopascalsPerPsi = 6.894757

    /// The unit suffix shown in the footer chip (web `pressureUnit`).
    public var label: String {
        switch self {
        case .kilopascals: "kPa"
        case .psi: "psi"
        case .bar: "bar"
        }
    }

    /// Converts the SI (kPa) source value to this preference as a NUMBER (web
    /// `toPressureValue`). Returns `nil` for a missing / non-finite source.
    public func convert(fromKilopascals kpa: Double?) -> Double? {
        guard let kpa, kpa.isFinite else { return nil }
        switch self {
        case .kilopascals: return kpa
        case .psi: return kpa / Self.kilopascalsPerPsi
        case .bar: return kpa / TirePressureThresholds.kilopascalsPerBar
        }
    }

    /// Maps a shared `UnitPreferences.pressure` label to this enum, defaulting to
    /// bar (the backend `unit_of_pressure` default) for unknown labels.
    public static func from(label: String) -> TirePressureVisualWidgetUnit {
        switch label.lowercased() {
        case "kpa": .kilopascals
        case "psi": .psi
        default: .bar
        }
    }
}

// MARK: - Corner identity (web tire labels FL / FR / RL / RR)

/// One of the four wheel positions, carrying its i18n key + English fallback so
/// the view localizes the corner abbreviation through the P1/S10 facade.
public enum TirePressureVisualWidgetCorner: String, Sendable, CaseIterable {
    case frontLeft
    case frontRight
    case rearLeft
    case rearRight

    public var key: String {
        switch self {
        case .frontLeft: "widget.tireFL"
        case .frontRight: "widget.tireFR"
        case .rearLeft: "widget.tireRL"
        case .rearRight: "widget.tireRR"
        }
    }

    public var fallback: String {
        switch self {
        case .frontLeft: "FL"
        case .frontRight: "FR"
        case .rearLeft: "RL"
        case .rearRight: "RR"
        }
    }
}

// MARK: - Reading + projection (web `TireInfo` + the widget body derivation)

/// One corner's projected reading — the native port of the web `TireInfo`,
/// carrying the SI value (kPa), the derived status, and its corner identity.
public struct TireReading: Identifiable, Equatable, Sendable {
    public let corner: TirePressureVisualWidgetCorner
    public let kilopascals: Double?
    public let status: TirePressureStatus

    public var id: String {
        corner.rawValue
    }

    public init(corner: TirePressureVisualWidgetCorner, kilopascals: Double?) {
        self.corner = corner
        self.kilopascals = kilopascals
        status = TirePressureClassifier.status(forKilopascals: kilopascals)
    }
}

/// The view-ready projection: the four readings in FL/FR/RL/RR order, the
/// aggregate `allNormal` / `hasWarning` flags (web `tires.every` / `tires.some`),
/// and the most recent reading time across the four corners (web `latestReading`).
public struct TirePressureVisualWidgetProjection: Equatable, Sendable {
    public let frontLeft: TireReading
    public let frontRight: TireReading
    public let rearLeft: TireReading
    public let rearRight: TireReading
    public let latestReading: Date?

    public init(
        frontLeft: TireReading,
        frontRight: TireReading,
        rearLeft: TireReading,
        rearRight: TireReading,
        latestReading: Date?
    ) {
        self.frontLeft = frontLeft
        self.frontRight = frontRight
        self.rearLeft = rearLeft
        self.rearRight = rearRight
        self.latestReading = latestReading
    }

    /// The four readings in the canonical FL, FR, RL, RR order.
    public var readings: [TireReading] {
        [frontLeft, frontRight, rearLeft, rearRight]
    }

    /// Web `tires.every(t => t.status === 'green')`.
    public var allNormal: Bool {
        readings.allSatisfy { $0.status == .green }
    }

    /// Web `tires.some(t => t.status !== 'green')`.
    public var hasWarning: Bool {
        readings.contains { $0.status != .green }
    }

    /// Projects the cached corner DTO into the view projection.
    public static func project(from reading: TirePressureReading) -> TirePressureVisualWidgetProjection {
        let candidates = [
            reading.lastSeenFrontLeft,
            reading.lastSeenFrontRight,
            reading.lastSeenRearLeft,
            reading.lastSeenRearRight
        ].compactMap(\.self)
        return TirePressureVisualWidgetProjection(
            frontLeft: TireReading(corner: .frontLeft, kilopascals: reading.frontLeftKilopascals),
            frontRight: TireReading(corner: .frontRight, kilopascals: reading.frontRightKilopascals),
            rearLeft: TireReading(corner: .rearLeft, kilopascals: reading.rearLeftKilopascals),
            rearRight: TireReading(corner: .rearRight, kilopascals: reading.rearRightKilopascals),
            latestReading: candidates.max()
        )
    }
}

// MARK: - Value formatting (web `formatPressure` = fmtNumber(toPressureValue(val), 1))

/// Formats a per-tire SI value as the user's preferred-unit NUMBER at one
/// decimal place (no suffix — the unit shows once in the footer), exactly as the
/// web `formatPressure`. The em-dash sentinel matches the web `'—'` fallback.
public enum TirePressureFormatter {
    public static let missingValue = "—"

    public static func format(
        kilopascals kpa: Double?,
        unit: TirePressureVisualWidgetUnit,
        locale: Locale = .current
    ) -> String {
        guard let value = unit.convert(fromKilopascals: kpa) else { return missingValue }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? missingValue
    }
}

// MARK: - Relative reading time (web `formatTimestamp`)

/// Relative "Just now / Nm ago / Nh ago / Nd ago" reading time — a faithful port
/// of the web `formatTimestamp` bucketing (minute / hour / day rounding) with the
/// same i18n keys, resolved through the injected localizer so it is bundle-free
/// in tests. `now` is injectable for deterministic assertions.
public enum TireReadingTime {
    public static func string(
        for date: Date?,
        now: Date = Date(),
        localize: (String, String) -> String
    ) -> String {
        guard let date else { return localize("widget.tireNoReading", "No reading") }
        let ago = localize("widget.ago", "ago")
        let diffMin = Int((now.timeIntervalSince(date) / 60).rounded())
        if diffMin < 1 { return localize("widget.tireJustNow", "Just now") }
        if diffMin < 60 { return "\(diffMin)m \(ago)" }
        let diffHrs = Int((Double(diffMin) / 60).rounded())
        if diffHrs < 24 { return "\(diffHrs)h \(ago)" }
        let diffDays = Int((Double(diffHrs) / 24).rounded())
        return "\(diffDays)d \(ago)"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the diagram + footer. Pure + public so the
/// spoken content unit-tests without rendering the view.
public enum TirePressureAccessibility {
    public static func summary(
        for projection: TirePressureVisualWidgetProjection,
        unit: TirePressureVisualWidgetUnit,
        locale: Locale = .current,
        localize: (String, String) -> String
    ) -> String {
        var parts = [localize("widget.tirePressure", "Tire Pressure")]
        for reading in projection.readings {
            let corner = localize(reading.corner.key, reading.corner.fallback)
            let value = TirePressureFormatter.format(kilopascals: reading.kilopascals, unit: unit, locale: locale)
            parts.append("\(corner) \(value) \(unit.label)")
        }
        parts.append(
            projection.allNormal
                ? localize("widget.tireAllNormal", "All Normal")
                : localize("widget.tireWarning", "Check Pressure")
        )
        return parts.joined(separator: ". ")
    }
}
