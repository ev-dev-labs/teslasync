//
//  TirePressureSection.Adapter.swift
//  TeslaSync — P4 feature view · 0299 · TirePressureSection (Apple)
//
//  Pure (Foundation-only) value types + conversion + classification for the
//  vehicle-detail "Tire Pressure" surface — the faithful port of
//  web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx
//  (+ its sibling ./helpers.ts and hooks/useUnits.ts → lib/unitConversion.ts).
//
//  The web leaf receives a `TirePressureSnapshot` (four corner pressures, SI pascals)
//  and renders one tile per corner: the value through `formatPressure(paToKpa(value))`
//  and a `Badge` whose tone + text come from `tirePressureVariant` / the band ternary
//  in helpers.ts. Those pure rules are ported here 1:1 so the native tiles show the
//  exact same numbers, tones, and status words. Dependency-free so every value can be
//  pinned by unit tests without a bundle or a rendered view (the SwiftUI chrome layers
//  on top in the .swift / .Views.swift files; the projector + phase live in
//  TirePressureSection.Projector.swift).
//

import Foundation

// MARK: - Pressure unit + conversion (ported 1:1 from lib/unitConversion.ts)

/// `1 psi = 6.894757 kPa` (NIST SP 811, web `KPA_PER_PSI`).
private let tpSectionKpaPerPsi = 6.894757
/// `1 bar = 100 kPa` (BIPM definition, web `KPA_PER_BAR`).
private let tpSectionKpaPerBar = 100.0
/// `1 kPa = 1000 Pa` — the SI floor (Pa) → SI kilopascal step the web `paToKpa` does
/// (`pa / 1000`) before `convertPressureFromSI`.
private let tpSectionPascalsPerKpa = 1000.0

/// The user's pressure display preference. Mirrors the web `unitPrefs.pressure`
/// (`useUnits()` → `'kPa' | 'psi' | 'bar'`), stored as the symbol the web converter
/// switches on and the suffix `formatPressure` appends after the number.
public enum TPSectionUnit: String, Sendable, Equatable, CaseIterable {
    case kpa = "kPa"
    case psi
    case bar

    /// The symbol appended to the tile value (web `${formatNumber(...)} ${pressure}`).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'kPa'` / `'psi'` / `'bar'`),
    /// defaulting to kilopascals (the SI display floor) for any unknown value.
    public static func from(symbol: String) -> TPSectionUnit {
        TPSectionUnit(rawValue: symbol) ?? .kpa
    }
}

/// Pressure converter ported 1:1 from `convertPressureFromSI(paToKpa(pa), to)`: the
/// corner pressure arrives in pascals (the SI floor stored by Phase-42), is divided by
/// 1000 to SI kilopascals, then kPa passes through, psi is `kPa / 6.894757` and bar is
/// `kPa / 100`.
public func convertTirePressureFromSI(_ pascals: Double, to unit: TPSectionUnit) -> Double {
    let kpa = pascals / tpSectionPascalsPerKpa
    switch unit {
    case .kpa:
        return kpa
    case .psi:
        return kpa / tpSectionKpaPerPsi
    case .bar:
        return kpa / tpSectionKpaPerBar
    }
}

// MARK: - Tire-pressure thresholds (ported 1:1 from helpers.ts `TIRE_PRESSURE_PA`)

/// Backend tire-pressure SI baseline is pascals (UnitKindPressure ToSI). All band
/// comparisons live in Pa to keep one canonical source of truth, exactly as the web
/// `TIRE_PRESSURE_PA` does (display conversion happens only when formatting the value).
public enum TirePressureThresholdsPa {
    /// Below this is critical-low (≈ 30.0 psi / 2.068 bar).
    public static let lowCritical: Double = 206_800
    /// Below this is warning-low (≈ 35.0 psi / 2.413 bar).
    public static let lowWarning: Double = 241_300
    /// Above this is warning-high (≈ 45.0 psi / 3.103 bar).
    public static let highWarning: Double = 310_300
    /// Above this is critical-high (≈ 50.0 psi / 3.447 bar).
    public static let highCritical: Double = 344_700
}

// MARK: - Badge tone (ported 1:1 from helpers.ts `tirePressureVariant`)

/// The four `Badge` tones the web `tirePressureVariant` returns
/// (`'success' | 'warning' | 'danger' | 'neutral'`). Kept Foundation-only and mapped to
/// the design-system `TSTone` at the view boundary so the classifier stays testable.
public enum TPSectionVariant: String, Sendable, Equatable {
    case success
    case warning
    case danger
    case neutral
}

/// Map a backend SI pressure value (Pa) to a tire-pressure badge tone — the 1:1 port of
/// the web `tirePressureVariant`: `neutral` for unknown values, `danger` outside the
/// critical band, `warning` inside the soft band, `success` inside the safe band.
public func tirePressureVariant(_ pascals: Double?) -> TPSectionVariant {
    guard let pascals, pascals.isFinite else { return .neutral }
    if pascals < TirePressureThresholdsPa.lowCritical || pascals > TirePressureThresholdsPa.highCritical {
        return .danger
    }
    if pascals < TirePressureThresholdsPa.lowWarning || pascals > TirePressureThresholdsPa.highWarning {
        return .warning
    }
    return .success
}

// MARK: - Badge status text (ported 1:1 from the web Badge ternary)

/// The status word shown inside each tile's `Badge`, the 1:1 port of the web ternary:
/// `Normal` inside `[LOW_WARNING, HIGH_WARNING]`, else `Low` inside
/// `[LOW_CRITICAL, HIGH_CRITICAL]`, else `Critical`; `No Data` when the value is null.
/// Band-isomorphic with `tirePressureVariant` (proved by the adapter tests).
public enum TPSectionStatus: String, Sendable, Equatable, CaseIterable {
    case normal
    case low
    case critical
    case noData

    /// The web band ternary: classify a corner's SI pascal reading into a status word.
    public static func classify(_ pascals: Double?) -> TPSectionStatus {
        guard let pascals, pascals.isFinite else { return .noData }
        if pascals >= TirePressureThresholdsPa.lowWarning, pascals <= TirePressureThresholdsPa.highWarning {
            return .normal
        }
        if pascals >= TirePressureThresholdsPa.lowCritical, pascals <= TirePressureThresholdsPa.highCritical {
            return .low
        }
        return .critical
    }

    /// The badge tone for this status — the value `tirePressureVariant` returns for any
    /// reading in this status's band (Normal→success, Low→warning, Critical→danger,
    /// No Data→neutral).
    public var variant: TPSectionVariant {
        switch self {
        case .normal: .success
        case .low: .warning
        case .critical: .danger
        case .noData: .neutral
        }
    }

    /// The i18n key for the badge text (web `t('common.normal', 'Normal')`, …).
    public var labelKey: String {
        switch self {
        case .normal: "common.normal"
        case .low: "common.low"
        case .critical: "common.critical"
        case .noData: "common.noData"
        }
    }

    /// The web English fallback for `labelKey`.
    public var labelFallback: String {
        switch self {
        case .normal: "Normal"
        case .low: "Low"
        case .critical: "Critical"
        case .noData: "No Data"
        }
    }
}

// MARK: - Corner (web four tiles FL / FR / RL / RR)

/// The four tire positions, mirroring the web `tirePressures` array order
/// (FL → FR → RL → RR) and the `TirePressureSnapshot.{front_left,…}` fields.
public enum TPSectionCorner: String, Sendable, Equatable, CaseIterable, Identifiable {
    case frontLeft
    case frontRight
    case rearLeft
    case rearRight

    public var id: String {
        rawValue
    }

    /// Tile order (web renders the corners in this order).
    public var order: Int {
        switch self {
        case .frontLeft: 0
        case .frontRight: 1
        case .rearLeft: 2
        case .rearRight: 3
        }
    }

    /// The i18n key for this corner's tile label (web `t('vehicles.detail.tireFl', …)`).
    public var labelKey: String {
        switch self {
        case .frontLeft: "vehicles.detail.tireFl"
        case .frontRight: "vehicles.detail.tireFr"
        case .rearLeft: "vehicles.detail.tireRl"
        case .rearRight: "vehicles.detail.tireRr"
        }
    }

    /// The web English fallback for `labelKey`.
    public var labelFallback: String {
        switch self {
        case .frontLeft: "Front Left"
        case .frontRight: "Front Right"
        case .rearLeft: "Rear Left"
        case .rearRight: "Rear Right"
        }
    }

    /// The four corners in tile order.
    public static var ordered: [TPSectionCorner] {
        allCases.sorted { $0.order < $1.order }
    }
}

// MARK: - Snapshot input (web `TirePressureSnapshot`)

/// One coalesced tire-pressure reading, the subset of the web `TirePressureSnapshot`
/// the surface reads (`front_left` / `front_right` / `rear_left` / `rear_right`, SI
/// pascals; `nil` for a corner with no reading, web `number | null`).
public struct TPSectionSnapshot: Sendable, Equatable {
    public var frontLeftPa: Double?
    public var frontRightPa: Double?
    public var rearLeftPa: Double?
    public var rearRightPa: Double?

    public init(
        frontLeftPa: Double? = nil,
        frontRightPa: Double? = nil,
        rearLeftPa: Double? = nil,
        rearRightPa: Double? = nil
    ) {
        self.frontLeftPa = frontLeftPa
        self.frontRightPa = frontRightPa
        self.rearLeftPa = rearLeftPa
        self.rearRightPa = rearRightPa
    }

    /// The SI pascal reading for one corner (web `tireData.front_left`, …).
    public func pascals(for corner: TPSectionCorner) -> Double? {
        switch corner {
        case .frontLeft: frontLeftPa
        case .frontRight: frontRightPa
        case .rearLeft: rearLeftPa
        case .rearRight: rearRightPa
        }
    }
}

// MARK: - Projected reading (one converted tile)

/// One view-ready tile: its corner, the raw SI pascals (kept for accessibility/tests),
/// the formatted display value (web `formatPressure(paToKpa(value))`), and the status
/// word + tone (web `Badge`). All numeric/string and bundle-free.
public struct TPSectionReading: Sendable, Equatable, Identifiable {
    public var corner: TPSectionCorner
    public var pascals: Double?
    public var valueText: String
    public var status: TPSectionStatus

    public var id: String {
        corner.rawValue
    }

    public init(corner: TPSectionCorner, pascals: Double?, valueText: String, status: TPSectionStatus) {
        self.corner = corner
        self.pascals = pascals
        self.valueText = valueText
        self.status = status
    }
}

// MARK: - Projection (the view-ready model)

/// The fully-projected surface content: the four converted tiles, whether a snapshot
/// was present at all (web `tireData ? grid : empty`), and the display-unit symbol.
public struct TPSectionProjection: Sendable, Equatable {
    public var readings: [TPSectionReading]
    public var hasSnapshot: Bool
    public var unitSymbol: String

    public init(readings: [TPSectionReading], hasSnapshot: Bool, unitSymbol: String) {
        self.readings = readings
        self.hasSnapshot = hasSnapshot
        self.unitSymbol = unitSymbol
    }

    /// The web content gate: `tireData != null`. When false the surface shows the
    /// "No tire pressure data available" empty state instead of the tile grid — even
    /// when every individual corner is null, a present snapshot still renders the grid.
    public var hasContent: Bool {
        hasSnapshot
    }

    /// The zero-value projection the model holds before any snapshot resolves — drives
    /// the loading skeleton until data arrives.
    public static var empty: TPSectionProjection {
        TPSectionProjection(readings: [], hasSnapshot: false, unitSymbol: TPSectionUnit.kpa.symbol)
    }
}
