//
//  TirePressurePanel.Adapter.swift
//  TeslaSync — P4 feature view · 0286 · TirePressurePanel (Apple)
//
//  Pure (Foundation-only) value types + conversion + band classification for the
//  telemetry-panels "Tire Pressure" surface — the faithful port of
//  web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx
//  (+ its sibling ../vehicle-detail/helpers.ts and hooks/useUnits.ts → lib/unitConversion.ts).
//
//  The web leaf receives a `TirePressureSnapshot` (four corner pressures, SI pascals) and
//  renders one tile per corner: a short label (FL/FR/RL/RR), the value through
//  `formatPressure(paToKpa(value))`, and a band-driven color/border (web `getColor`/
//  `getBorder`). A single status chip below the grid summarizes the four corners
//  (`allGood → All Normal`, `anyBad → Attention Needed`, else `Check Pressure`). Those
//  pure rules are ported here 1:1 so the native tiles show the exact same numbers, tones,
//  and summary. Dependency-free so every value can be pinned by unit tests without a
//  bundle or a rendered view (the SwiftUI chrome layers on top in the .swift / .Views.swift
//  files; the projector + phase live in TirePressurePanel.Projector.swift).
//
//  All public symbols carry the `TPPanel` prefix so they never collide with the sibling
//  vehicle-detail surface (`TPSection*`), the LiveTelemetry composite (`LTPPanel*`), or the
//  dashboard tire widgets (`TirePressure*Widget`).
//

import Foundation

// MARK: - Pressure unit + conversion (ported 1:1 from lib/unitConversion.ts)

/// The user's pressure display preference. Mirrors the web `unitPrefs.pressure`
/// (`useUnits()` → `'kPa' | 'psi' | 'bar'`), stored as the symbol the web converter
/// switches on and the suffix `formatPressure` appends after the number.
public enum TPPanelUnit: String, Sendable, Equatable, CaseIterable {
    case kpa = "kPa"
    case psi
    case bar

    /// `1 psi = 6.894757 kPa` (NIST SP 811, web `KPA_PER_PSI`).
    private static let kpaPerPsi = 6.894757
    /// `1 bar = 100 kPa` (BIPM definition, web `KPA_PER_BAR`).
    private static let kpaPerBar = 100.0
    /// `1 kPa = 1000 Pa` — the SI floor (Pa) → kilopascal step the web `paToKpa` performs.
    private static let pascalsPerKpa = 1000.0

    /// The symbol appended to the tile value (web `${formatNumber(...)} ${pressure}`).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'kPa'` / `'psi'` / `'bar'`),
    /// defaulting to kilopascals (the SI display floor) for any unknown value.
    public static func from(symbol: String) -> TPPanelUnit {
        TPPanelUnit(rawValue: symbol) ?? .kpa
    }

    /// Converts a SI pascal reading to this display unit — the 1:1 port of
    /// `convertPressureFromSI(paToKpa(pa), to)`: the corner pressure arrives in pascals
    /// (the SI floor stored by Phase-42), is divided by 1000 to SI kilopascals, then kPa
    /// passes through, psi is `kPa / 6.894757`, and bar is `kPa / 100`.
    public func convert(fromSI pascals: Double) -> Double {
        let kpa = pascals / Self.pascalsPerKpa
        switch self {
        case .kpa:
            return kpa
        case .psi:
            return kpa / Self.kpaPerPsi
        case .bar:
            return kpa / Self.kpaPerBar
        }
    }
}

// MARK: - Tire-pressure thresholds (ported 1:1 from helpers.ts `TIRE_PRESSURE_PA`)

/// Backend tire-pressure SI baseline is pascals (UnitKindPressure ToSI). All band
/// comparisons live in Pa to keep one canonical source of truth, exactly as the web
/// `TIRE_PRESSURE_PA` does (display conversion happens only when formatting the value).
public enum TPPanelThresholdsPa {
    /// Below this is critical-low (≈ 30.0 psi / 2.068 bar).
    public static let lowCritical: Double = 206_800
    /// Below this is warning-low (≈ 35.0 psi / 2.413 bar).
    public static let lowWarning: Double = 241_300
    /// Above this is warning-high (≈ 45.0 psi / 3.103 bar).
    public static let highWarning: Double = 310_300
    /// Above this is critical-high (≈ 50.0 psi / 3.447 bar).
    public static let highCritical: Double = 344_700
}

// MARK: - Per-corner band tone (ported 1:1 from helpers.ts `getColor` / `getBorder`)

/// The four band tones a single corner value resolves to — the union of the web
/// `getColor` / `getBorder` ladders (which share the same band cut-points): `neutral`
/// for an unknown value (muted), `danger` outside the critical band (red), `warning`
/// inside the soft band (amber), `success` inside the safe band (green). Foundation-only
/// and mapped to the design-system colors at the view boundary so the classifier stays
/// testable.
public enum TPPanelVariant: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case danger
    case neutral

    /// Classify a corner's SI pascal reading into a band tone — the 1:1 port of the web
    /// `getColor`/`getBorder` ladder. `nil`/non-finite → neutral; outside the critical
    /// band → danger; outside the soft band → warning; otherwise success.
    public static func classify(_ pascals: Double?) -> TPPanelVariant {
        guard let pascals, pascals.isFinite else { return .neutral }
        if pascals < TPPanelThresholdsPa.lowCritical || pascals > TPPanelThresholdsPa.highCritical {
            return .danger
        }
        if pascals < TPPanelThresholdsPa.lowWarning || pascals > TPPanelThresholdsPa.highWarning {
            return .warning
        }
        return .success
    }
}

// MARK: - Overall status chip (ported 1:1 from the web `allGood`/`anyBad` summary)

/// The single status chip below the grid — the 1:1 port of the web summary ternary:
/// `allGood ? 'All Normal' : anyBad ? 'Attention Needed' : 'Check Pressure'`, where
/// `allGood` requires every corner present and inside `[LOW_WARNING, HIGH_WARNING]` and
/// `anyBad` is any present corner outside `[LOW_CRITICAL, HIGH_CRITICAL]`.
public enum TPPanelOverallStatus: String, Sendable, Equatable, CaseIterable {
    case allNormal
    case attention
    case check

    /// Summarize the four corner pressures — the web `allGood`/`anyBad` evaluation in the
    /// same precedence (all-good wins, then any-bad, else the soft middle). A `nil`
    /// corner fails the all-good test and never counts as bad, so a snapshot with a
    /// missing reading lands on `check` (the web "⚠ Check Pressure" branch).
    public static func classify(_ pressures: [Double?]) -> TPPanelOverallStatus {
        let allGood = pressures.allSatisfy { pascals in
            guard let pascals, pascals.isFinite else { return false }
            return pascals >= TPPanelThresholdsPa.lowWarning && pascals <= TPPanelThresholdsPa.highWarning
        }
        if allGood {
            return .allNormal
        }
        let anyBad = pressures.contains { pascals in
            guard let pascals, pascals.isFinite else { return false }
            return pascals < TPPanelThresholdsPa.lowCritical || pascals > TPPanelThresholdsPa.highCritical
        }
        return anyBad ? .attention : .check
    }

    /// The chip tone — the web `border/bg/text` color family (green/red/amber).
    public var variant: TPPanelVariant {
        switch self {
        case .allNormal: .success
        case .attention: .danger
        case .check: .warning
        }
    }

    /// The leading SF Symbol standing in for the web glyph (✓ / ✗ / ⚠).
    public var symbolName: String {
        switch self {
        case .allNormal: "checkmark.circle.fill"
        case .attention: "xmark.circle.fill"
        case .check: "exclamationmark.triangle.fill"
        }
    }

    /// The i18n key for the chip label (web literal text, localized in the native catalog).
    public var labelKey: String {
        switch self {
        case .allNormal: "tirePanel.allNormal"
        case .attention: "tirePanel.attention"
        case .check: "tirePanel.checkPressure"
        }
    }

    /// The web English text for `labelKey` (the glyph is rendered separately as a symbol).
    public var labelFallback: String {
        switch self {
        case .allNormal: "All Normal"
        case .attention: "Attention Needed"
        case .check: "Check Pressure"
        }
    }
}

// MARK: - Corner (web four tiles FL / FR / RL / RR)

/// The four tire positions, mirroring the web `tires` array order (FL → FR → RL → RR)
/// and the `TirePressureSnapshot.{front_left,…}` fields. The web panel labels each tile
/// with the short code (not the long "Front Left" the vehicle-detail section uses).
public enum TPPanelCorner: String, Sendable, Equatable, CaseIterable, Identifiable {
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

    /// The i18n key for this corner's short tile label (web literal `'FL'`/`'FR'`/…).
    public var labelKey: String {
        switch self {
        case .frontLeft: "tirePanel.cornerFl"
        case .frontRight: "tirePanel.cornerFr"
        case .rearLeft: "tirePanel.cornerRl"
        case .rearRight: "tirePanel.cornerRr"
        }
    }

    /// The web short code for `labelKey`.
    public var labelFallback: String {
        switch self {
        case .frontLeft: "FL"
        case .frontRight: "FR"
        case .rearLeft: "RL"
        case .rearRight: "RR"
        }
    }

    /// The spoken corner name for VoiceOver (the short code reads poorly letter-by-letter).
    public var accessibilityKey: String {
        switch self {
        case .frontLeft: "tirePanel.cornerFlLong"
        case .frontRight: "tirePanel.cornerFrLong"
        case .rearLeft: "tirePanel.cornerRlLong"
        case .rearRight: "tirePanel.cornerRrLong"
        }
    }

    /// The web English fallback for `accessibilityKey`.
    public var accessibilityFallback: String {
        switch self {
        case .frontLeft: "Front Left"
        case .frontRight: "Front Right"
        case .rearLeft: "Rear Left"
        case .rearRight: "Rear Right"
        }
    }

    /// The four corners in tile order.
    public static var ordered: [TPPanelCorner] {
        allCases.sorted { $0.order < $1.order }
    }
}

// MARK: - Snapshot input (web `TirePressureSnapshot`)

/// One coalesced tire-pressure reading, the subset of the web `TirePressureSnapshot` the
/// surface reads (`front_left` / `front_right` / `rear_left` / `rear_right`, SI pascals;
/// `nil` for a corner with no reading, web `number | null`).
public struct TPPanelSnapshot: Sendable, Equatable {
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
    public func pascals(for corner: TPPanelCorner) -> Double? {
        switch corner {
        case .frontLeft: frontLeftPa
        case .frontRight: frontRightPa
        case .rearLeft: rearLeftPa
        case .rearRight: rearRightPa
        }
    }

    /// The four corner pressures in tile order (the input to the overall-status summary).
    public var orderedPressures: [Double?] {
        TPPanelCorner.ordered.map { pascals(for: $0) }
    }
}

// MARK: - Projected reading (one converted tile)

/// One view-ready tile: its corner, the raw SI pascals (kept for accessibility/tests), the
/// formatted display value (web `formatPressure(paToKpa(value))`), and the band tone (web
/// `getColor`/`getBorder`). All numeric/string and bundle-free.
public struct TPPanelReading: Sendable, Equatable, Identifiable {
    public var corner: TPPanelCorner
    public var pascals: Double?
    public var valueText: String
    public var variant: TPPanelVariant

    public var id: String {
        corner.rawValue
    }

    public init(corner: TPPanelCorner, pascals: Double?, valueText: String, variant: TPPanelVariant) {
        self.corner = corner
        self.pascals = pascals
        self.valueText = valueText
        self.variant = variant
    }
}

// MARK: - Projection (the view-ready model)

/// The fully-projected surface content: the four converted tiles, the overall summary
/// chip, whether a snapshot was present at all (web `tireData ? grid : empty`), and the
/// display-unit symbol.
public struct TPPanelProjection: Sendable, Equatable {
    public var readings: [TPPanelReading]
    public var overall: TPPanelOverallStatus
    public var hasSnapshot: Bool
    public var unitSymbol: String

    public init(
        readings: [TPPanelReading],
        overall: TPPanelOverallStatus,
        hasSnapshot: Bool,
        unitSymbol: String
    ) {
        self.readings = readings
        self.overall = overall
        self.hasSnapshot = hasSnapshot
        self.unitSymbol = unitSymbol
    }

    /// The web content gate: `tireData != null`. When false the surface shows the
    /// "No tire pressure data available" empty state instead of the tile grid — even when
    /// every individual corner is null, a present snapshot still renders the grid.
    public var hasContent: Bool {
        hasSnapshot
    }

    /// The zero-value projection the model holds before any snapshot resolves — drives the
    /// loading skeleton until data arrives.
    public static var empty: TPPanelProjection {
        TPPanelProjection(
            readings: [],
            overall: .check,
            hasSnapshot: false,
            unitSymbol: TPPanelUnit.kpa.symbol
        )
    }
}
