//
//  MotorPerformanceWidget.Support.swift
//  TeslaSync — P4 dashboard widget · 0067 · MotorPerformanceWidget (Apple)
//
//  The pure (network-free, render-free) support layer for the surface: the registry metadata + size
//  clamp, the P1/S10 i18n facade, the web `fmtInt`/`fmtNumber` number formatting, the `torqueColor` zone
//  mapping, the display-boundary `MotorProjection` adapter (cached SI → render-ready), and the testable
//  accessibility summary. Split out of the model so each file stays within the lint budget.
//

import Foundation
import SwiftUI

// MARK: - Registry metadata (canonical: registry/vehicle.ts → "motor-performance")

/// A dashboard grid size in (columns × rows), matching the web `WidgetSize`.
public struct DashboardWidgetSize: Sendable, Equatable {
    public var cols: Int
    public var rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// The dashboard registration for a draggable widget surface (web `WidgetDef`).
public struct DashboardWidgetRegistration: Sendable {
    public let id: String
    public let nameKey: String
    public let descriptionKey: String
    public let category: String
    public let defaultSize: DashboardWidgetSize
    public let minSize: DashboardWidgetSize
    public let maxSize: DashboardWidgetSize

    public init(
        id: String,
        nameKey: String,
        descriptionKey: String,
        category: String,
        defaultSize: DashboardWidgetSize,
        minSize: DashboardWidgetSize,
        maxSize: DashboardWidgetSize
    ) {
        self.id = id
        self.nameKey = nameKey
        self.descriptionKey = descriptionKey
        self.category = category
        self.defaultSize = defaultSize
        self.minSize = minSize
        self.maxSize = maxSize
    }

    /// Clamps a requested grid size into the surface's `min…max` envelope, so the native grid honors the
    /// same constraints as the web registry.
    public func clamp(_ size: DashboardWidgetSize) -> DashboardWidgetSize {
        DashboardWidgetSize(
            cols: min(max(size.cols, minSize.cols), maxSize.cols),
            rows: min(max(size.rows, minSize.rows), maxSize.rows)
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "MotorPerformanceWidget" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time.
public enum MotorPerformanceStrings {
    public static let table = "MotorPerformanceWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Number formatting (web `fmtInt` / `fmtNumber`)

/// Locale-aware decimal formatting matching the web `numberFormat.ts` helpers (grouping separators, fixed
/// fraction digits, NaN/Inf coerced to zero).
public enum MotorFormat {
    /// Integer formatting with grouping (web `fmtInt`).
    public static func int(_ value: Double, locale: Locale = .motorDefault) -> String {
        number(value, decimals: 0, locale: locale)
    }

    /// Fixed-fraction formatting with grouping (web `fmtNumber`).
    public static func number(_ value: Double, decimals: Int, locale: Locale = .motorDefault) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(decimals)f", safe)
    }
}

public extension Locale {
    /// The web default formatting locale (`en-US`) so native numbers match the web golden output.
    static let motorDefault = Locale(identifier: "en_US")
}

// MARK: - Torque zone (web `torqueColor` thresholds)

/// The torque-magnitude band that colors the gauge (web `torqueColor`: <200 green, <400 amber, else red),
/// mapped onto the SI design-token status colors so it tracks light/dark/high-contrast themes.
public enum MotorTorqueZone: String, Sendable, Equatable {
    case low
    case medium
    case high

    /// Classifies an absolute torque magnitude (Nm) into its band.
    public static func classify(magnitude: Double) -> MotorTorqueZone {
        if magnitude < 200 { return .low }
        if magnitude < 400 { return .medium }
        return .high
    }

    /// The design-token color for the band.
    public var color: Color {
        switch self {
        case .low: Color.TS.statusSuccess
        case .medium: Color.TS.statusWarning
        case .high: Color.TS.statusDanger
        }
    }
}

// MARK: - Display-boundary projection (adapter: cached SI → render-ready)

/// The render-ready projection of a `MotorSnapshotInput`, computed at the display boundary. Pure + public
/// so the SI → display mapping (web data derivations + `convertTempFromSI` + `fmtInt`/`fmtNumber`) is
/// unit-tested without rendering the view.
public struct MotorProjection: Sendable, Equatable {
    /// Whether a snapshot was present (web `hasData = !!data`).
    public var hasData: Bool
    /// The signed drive torque in Nm (web `torque = di_torque ?? 0`).
    public var torque: Double
    /// The clamped absolute torque driving the gauge fill (0…`torqueMax`).
    public var torqueMagnitude: Double
    /// The gauge fill fraction (0…1).
    public var gaugeFraction: Double
    /// The gauge's centered magnitude readout (web `RadialGauge` value text).
    public var gaugeValueText: String
    /// The signed torque integer shown under the gauge (web `label={fmtInt(torque)}`).
    public var torqueLabelText: String
    /// The torque band that colors the gauge.
    public var torqueZone: MotorTorqueZone
    /// The converted stator-temperature readout, or `nil` when unavailable (→ renders "—").
    public var statorTempText: String?
    /// The temperature unit suffix, present only when `statorTempText` is.
    public var statorTempUnit: String?
    /// The gear / shift-state readout (web `gear ?? shift_state ?? '—'`).
    public var gearText: String
    /// The lateral g-force readout, or `nil` when unavailable.
    public var lateralGText: String?
    /// The longitudinal g-force readout, or `nil` when unavailable.
    public var longitudinalGText: String?

    /// The web `TORQUE_MAX` gauge ceiling.
    public static let torqueMax: Double = 600

    /// The g-force unit suffix (web `unit="g"`).
    public static let gForceUnit = "g"

    /// The empty projection used before data resolves and while the body shows its empty state.
    public static let empty = MotorProjection(
        hasData: false,
        torque: 0,
        torqueMagnitude: 0,
        gaugeFraction: 0,
        gaugeValueText: "0",
        torqueLabelText: "0",
        torqueZone: .low,
        statorTempText: nil,
        statorTempUnit: nil,
        gearText: "—",
        lateralGText: nil,
        longitudinalGText: nil
    )

    /// Builds the projection from a cached snapshot, applying the user's temperature unit + locale at the
    /// display boundary. `nil` yields `.empty` (web renders the `EmptyState`).
    public static func make(
        from snapshot: MotorSnapshotInput?,
        temperatureUnit: MotorTemperatureUnit,
        locale: Locale = .motorDefault
    ) -> MotorProjection {
        guard let snapshot else { return .empty }

        let torque = snapshot.diTorque ?? 0
        let magnitude = min(max(abs(torque), 0), torqueMax)
        let isWhole = magnitude == magnitude.rounded(.towardZero)
        let gaugeDecimals = isWhole ? 0 : 2

        let statorCelsius = snapshot.diStatorTemp ?? snapshot.motorTempCFront
        let statorText = statorCelsius.map { celsius in
            MotorFormat.number(temperatureUnit.convert(fromCelsius: celsius), decimals: 0, locale: locale)
        }

        return MotorProjection(
            hasData: true,
            torque: torque,
            torqueMagnitude: magnitude,
            gaugeFraction: torqueMax > 0 ? magnitude / torqueMax : 0,
            gaugeValueText: MotorFormat.number(magnitude, decimals: gaugeDecimals, locale: locale),
            torqueLabelText: MotorFormat.int(torque, locale: locale),
            torqueZone: .classify(magnitude: magnitude),
            statorTempText: statorText,
            statorTempUnit: statorCelsius == nil ? nil : temperatureUnit.label,
            gearText: resolveGear(snapshot),
            lateralGText: snapshot.lateralAccel.map { MotorFormat.number($0, decimals: 2, locale: locale) },
            longitudinalGText: snapshot.longitudinalAccel.map {
                MotorFormat.number($0, decimals: 2, locale: locale)
            }
        )
    }

    /// Web `gear ?? shift_state ?? '—'`, also treating blank strings as missing for null-safety.
    private static func resolveGear(_ snapshot: MotorSnapshotInput) -> String {
        if let gear = snapshot.gear?.trimmingCharacters(in: .whitespacesAndNewlines), !gear.isEmpty {
            return gear
        }
        if let shift = snapshot.shiftState?.trimmingCharacters(in: .whitespacesAndNewlines), !shift.isEmpty {
            return shift
        }
        return "—"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the motor content. Pure + public so the a11y label content can be
/// unit-tested without rendering the view.
public enum MotorPerformanceAccessibility {
    public static func summary(for projection: MotorProjection) -> String {
        guard projection.hasData else {
            return MotorPerformanceStrings.string("widget.motorPerformance.noData", "No motor data")
        }
        var parts: [String] = []
        let nmUnit = MotorPerformanceStrings.string("widget.motorPerformance.nm", "Nm")
        parts.append(
            "\(MotorPerformanceStrings.string("widget.motorPerformance.torque", "Torque")): "
                + "\(projection.torqueLabelText) \(nmUnit)"
        )
        parts.append(
            "\(MotorPerformanceStrings.string("widget.motorPerformance.gearState", "Gear State")): "
                + projection.gearText
        )
        if let temp = projection.statorTempText {
            let label = MotorPerformanceStrings.string("widget.motorPerformance.statorTemp", "Stator Temp")
            parts.append("\(label): \(temp)\(projection.statorTempUnit ?? "")")
        }
        if let lateral = projection.lateralGText {
            let label = MotorPerformanceStrings.string("widget.motorPerformance.lateralG", "Lateral G")
            parts.append("\(label): \(lateral) \(MotorProjection.gForceUnit)")
        }
        if let longitudinal = projection.longitudinalGText {
            let label = MotorPerformanceStrings.string("widget.motorPerformance.longitudinalG", "Longitudinal G")
            parts.append("\(label): \(longitudinal) \(MotorProjection.gForceUnit)")
        }
        return parts.joined(separator: ". ")
    }
}
