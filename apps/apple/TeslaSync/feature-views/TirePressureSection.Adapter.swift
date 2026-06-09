//
//  TirePressureSection.Adapter.swift
//  TeslaSync — P4 feature view · 0151 · TirePressureSection (Apple)
//
//  Pure (Foundation-only) projection core for the drive-detail "Tire Pressure During
//  Drive" surface — the faithful port of
//  features/driving/components/drive-detail/TirePressureSection.tsx (+ the upstream
//  useDriveDetailData `chartData` / `stats.hasTirePressure` derivation it consumes).
//
//  The web leaf is fed already-converted display values by its parent hook; the
//  native surface instead receives the SI floor the Phase-42 pipeline stores
//  (pascals, ADR-004 "Pa") and converts at the display boundary here, via
//  `convertTirePressureFromSI` — the 1:1 port of the web
//  `convertPressureFromSI(tp.tirePressureFl / 1000, unitPrefs.pressure)`: pascals are
//  divided by 1000 to SI kilopascals, then kPa passes through, psi is `kPa / 6.894757`
//  and bar is `kPa / 100` (lib/unitConversion.ts). The per-wheel min/max range
//  (`tpVals`, filtering `v != null && v > 0`), the per-wheel line-presence gate
//  (`chartData.some(d => d.tireFl !== null)`), and the content/empty split
//  (`stats.hasTirePressure`) are all reproduced VERBATIM so the native surface shows
//  the exact same numbers as the web source. Dependency-free so every value can be
//  pinned by unit tests without a bundle or a rendered view (the SwiftUI chrome layers
//  on top in the .swift / .Views.swift / .Chart.swift files).
//

import Foundation

// MARK: - Pressure unit + conversion (ported 1:1 from lib/unitConversion.ts)

/// `1 psi = 6.894757 kPa` (NIST SP 811, web `KPA_PER_PSI`).
private let tpSectionKpaPerPsi = 6.894757
/// `1 bar = 100 kPa` (BIPM definition, web `KPA_PER_BAR`).
private let tpSectionKpaPerBar = 100.0
/// `1 kPa = 1000 Pa` — the SI floor (Pa) → SI kilopascal step the web does inline
/// (`tp.tirePressureFl / 1000`) before `convertPressureFromSI`.
private let tpSectionPascalsPerKpa = 1000.0

/// The user's pressure display preference. Mirrors the web `pressureUnit`
/// (`unitPrefs.pressure` from `useUnits()` — `'kPa' | 'psi' | 'bar'`), stored as the
/// symbol the web converter switches on and the suffix the tiles / legend append.
public enum TPSectionUnit: String, Sendable, Equatable, CaseIterable {
    case kpa = "kPa"
    case psi
    case bar

    /// The symbol appended to tile values + legend labels (web `pressureUnit`).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'kPa'` / `'psi'` / `'bar'`),
    /// defaulting to kilopascals (the SI display default) for any unknown value.
    public static func from(symbol: String) -> TPSectionUnit {
        TPSectionUnit(rawValue: symbol) ?? .kpa
    }
}

/// Pressure converter ported 1:1 from `convertPressureFromSI(pascals / 1000, to)`:
/// the per-sample telemetry pressures arrive in pascals (the SI floor stored by
/// Phase-42), are divided by 1000 to SI kilopascals, then kPa passes through,
/// psi is `kPa / 6.894757` and bar is `kPa / 100`.
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

// MARK: - Sample input (web `ChartDataPoint` subset)

/// One per-sample telemetry row, narrowed to the fields the web `TirePressureSection`
/// reads off `chartData`. Pressures are SI pascals (converted to the display unit by
/// the projector); `time` is the pre-formatted axis label (web `formatTime(...)`).
public struct TPSectionSample: Sendable, Equatable {
    /// The formatted time-of-day label for this sample (web `time`).
    public var time: String
    /// Front-left tire pressure in pascals (web `tireFl`, pre-conversion).
    public var frontLeftPa: Double?
    /// Front-right tire pressure in pascals (web `tireFr`, pre-conversion).
    public var frontRightPa: Double?
    /// Rear-left tire pressure in pascals (web `tireRl`, pre-conversion).
    public var rearLeftPa: Double?
    /// Rear-right tire pressure in pascals (web `tireRr`, pre-conversion).
    public var rearRightPa: Double?

    public init(
        time: String,
        frontLeftPa: Double? = nil,
        frontRightPa: Double? = nil,
        rearLeftPa: Double? = nil,
        rearRightPa: Double? = nil
    ) {
        self.time = time
        self.frontLeftPa = frontLeftPa
        self.frontRightPa = frontRightPa
        self.rearLeftPa = rearLeftPa
        self.rearRightPa = rearRightPa
    }

    /// The SI pascal reading for one wheel at this sample.
    public func pascals(for wheel: TPSectionWheel) -> Double? {
        switch wheel {
        case .frontLeft: frontLeftPa
        case .frontRight: frontRightPa
        case .rearLeft: rearLeftPa
        case .rearRight: rearRightPa
        }
    }
}

// MARK: - Wheel (web four `<Line>` traces / four stat tiles)

/// The four tire positions, mirroring the web `<Line dataKey>` keys + names. `order`
/// pins the plot / legend / tile sequence (web FL → FR → RL → RR).
public enum TPSectionWheel: String, Sendable, Equatable, CaseIterable, Identifiable {
    case frontLeft
    case frontRight
    case rearLeft
    case rearRight

    public var id: String {
        rawValue
    }

    /// Plot / legend / tile order (web renders the wheels in this order).
    public var order: Int {
        switch self {
        case .frontLeft: 0
        case .frontRight: 1
        case .rearLeft: 2
        case .rearRight: 3
        }
    }

    /// The i18n key for the short line / legend name (web `<Line name>` `FL`/`FR`/…).
    public var shortNameKey: String {
        switch self {
        case .frontLeft: "driveDetail.tireFlShort"
        case .frontRight: "driveDetail.tireFrShort"
        case .rearLeft: "driveDetail.tireRlShort"
        case .rearRight: "driveDetail.tireRrShort"
        }
    }

    /// The web English fallback for `shortNameKey` (web `FL`/`FR`/`RL`/`RR`).
    public var shortNameFallback: String {
        switch self {
        case .frontLeft: "FL"
        case .frontRight: "FR"
        case .rearLeft: "RL"
        case .rearRight: "RR"
        }
    }

    /// The i18n key for this wheel's stat-tile label (web `<p>` caption).
    public var tileLabelKey: String {
        switch self {
        case .frontLeft: "driveDetail.frontLeft"
        case .frontRight: "driveDetail.frontRight"
        case .rearLeft: "driveDetail.rearLeft"
        case .rearRight: "driveDetail.rearRight"
        }
    }

    /// The web English fallback for `tileLabelKey`.
    public var tileLabelFallback: String {
        switch self {
        case .frontLeft: "Front Left"
        case .frontRight: "Front Right"
        case .rearLeft: "Rear Left"
        case .rearRight: "Rear Right"
        }
    }

    /// The four wheels in plot / legend / tile order.
    public static var ordered: [TPSectionWheel] {
        allCases.sorted { $0.order < $1.order }
    }
}

// MARK: - Range (web `tpVals` min/max)

/// One wheel's min/max pressure across the drive, in the display unit (web `tpVals`:
/// `{ min: Math.min(...vals), max: Math.max(...vals) }` over `v != null && v > 0`).
public struct TPSectionRange: Sendable, Equatable {
    public var min: Double
    public var max: Double

    public init(min: Double, max: Double) {
        self.min = min
        self.max = max
    }
}

// MARK: - Projected point (one chart sample, converted)

/// One converted chart sample: the axis label + each wheel's display-unit value (a
/// `nil` component means that trace had no reading at this sample, web `null`).
public struct TPSectionPoint: Sendable, Equatable, Identifiable {
    public var index: Int
    public var time: String
    public var frontLeft: Double?
    public var frontRight: Double?
    public var rearLeft: Double?
    public var rearRight: Double?

    public var id: Int {
        index
    }

    public init(
        index: Int,
        time: String,
        frontLeft: Double? = nil,
        frontRight: Double? = nil,
        rearLeft: Double? = nil,
        rearRight: Double? = nil
    ) {
        self.index = index
        self.time = time
        self.frontLeft = frontLeft
        self.frontRight = frontRight
        self.rearLeft = rearLeft
        self.rearRight = rearRight
    }

    /// The converted value for one wheel at this sample (chart / tooltip / a11y).
    public func value(for wheel: TPSectionWheel) -> Double? {
        switch wheel {
        case .frontLeft: frontLeft
        case .frontRight: frontRight
        case .rearLeft: rearLeft
        case .rearRight: rearRight
        }
    }
}

// MARK: - Projection (the view-ready model)

/// The fully-projected surface content: the converted chart points, which wheels are
/// present (drew a line), each wheel's min/max range, and the display-unit symbol.
/// All numeric, bundle-free, and unit-testable; the view layers localized labels +
/// chrome on top.
public struct TPSectionProjection: Sendable, Equatable {
    public var points: [TPSectionPoint]
    public var presentWheels: [TPSectionWheel]
    public var ranges: [TPSectionWheel: TPSectionRange]
    public var unitSymbol: String

    public init(
        points: [TPSectionPoint],
        presentWheels: [TPSectionWheel],
        ranges: [TPSectionWheel: TPSectionRange],
        unitSymbol: String
    ) {
        self.points = points
        self.presentWheels = presentWheels
        self.ranges = ranges
        self.unitSymbol = unitSymbol
    }

    /// The min/max range for one wheel, or `nil` when that wheel had no positive
    /// reading (web `tp.min != null ? … : '—'`).
    public func range(for wheel: TPSectionWheel) -> TPSectionRange? {
        ranges[wheel]
    }

    /// Web `stats.hasTirePressure`: at least one wheel reported a reading anywhere in
    /// the drive (`chartData.some(d => d.tireFl !== null || …)`).
    public var hasTirePressure: Bool {
        !presentWheels.isEmpty
    }

    /// The number of chart samples (web `chartData.length`).
    public var pointCount: Int {
        points.count
    }

    /// The web content gate: `stats.hasTirePressure`. When false the surface shows the
    /// "No telemetry data available" empty state instead of the tiles + chart.
    public var hasContent: Bool {
        hasTirePressure
    }

    /// Whether one wheel drew a line (web `chartData.some(d => d.tireFl !== null)`).
    public func isPresent(_ wheel: TPSectionWheel) -> Bool {
        presentWheels.contains(wheel)
    }

    /// The four stat tiles to render. The web always renders all four wheels in a
    /// `grid-cols-4`, each showing its range or the `—` placeholder.
    public var tileWheels: [TPSectionWheel] {
        TPSectionWheel.ordered
    }
}
