//
//  MoreDetailsPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  The testable projection core: the cached drive aggregate (`DriveStats`-equivalent display
//  values + the two battery percentages) + the user's display-unit preferences → the two
//  view-ready tile groups the web `MoreDetailsPanel` renders. Reproduces the web source
//  (features/driving/components/drive-detail/MoreDetailsPanel.tsx) exactly:
//
//    • the `fmtNumber` / `fmtInt` locale-aware grouped formatting at the global precision
//      (`numberFormat.ts`),
//    • the single `toEfficiencyDisplay` conversion (Wh/km → Wh/mi when the distance unit is
//      miles) and the `efficiencyUnit` label,
//    • the `> 1000 ? kWh : Wh` energy thresholding (`fmtWithUnit`),
//    • the odometer truthy guard (`start && end ? … : '—'`), the range `start != null ? … : '—'`
//      with the inner `end != null ? … : '?'`, and the battery `start != null && end != null`
//      raw `${start - end}%` subtraction,
//    • the per-tile color + which tiles render the unit muted-and-separate vs. embedded in the
//      colored value, and the two conditional temperature tiles.
//
//  All pure + dependency-free (value types only) so the projection can be unit-tested without a
//  store, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Render phase (native state shell around the web presentational panel)

/// The mutually-exclusive render branches the surface switches over. The web `MoreDetailsPanel`
/// is purely presentational (its parent owns loading/error); the native surface reproduces the
/// full state contract required by the P4 prompt: the initial-fetch skeleton, the resolved
/// content, a resolved-but-empty rendering (the panel still shows its tiles with the em-dash /
/// zero fallbacks), and a retryable fetch failure.
public enum MoreDetailsPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Accent palette (web Tailwind text-* colors → design tokens)

/// The decorative accent a tile's value carries, mapped from the web `text-{color}-400` classes
/// to the shared P1/S9 design tokens so the values stay theme- and contrast-correct.
public enum MoreDetailsAccent: Equatable, Sendable, CaseIterable {
    case cyan
    case green
    case red
    case amber
    case purple
    case blue
    case orange
    case neutral

    /// The design-token color for the accent.
    ///
    /// `cyan`/`green`/`red`/`amber` map to the theme-adaptive semantic tokens; `purple` and
    /// `blue` map to the brand chart-series tokens (the canonical equivalents of the web
    /// `purple-400` / `blue-400`, which have no dedicated semantic token). `orange` (web
    /// `orange-400`, the warm cabin-temperature accent) maps to the Wong-palette orange — there
    /// is no semantic orange token, and reusing `amber` here would collapse the web's warm/cool
    /// distinction between the inside- and outside-temperature tiles. `neutral` is the
    /// secondary-text token the web uses for the Min Speed value (`text-[var(--text-secondary)]`).
    public var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .red: Color.TS.statusDanger
        case .amber: Color.TS.statusWarning
        case .purple: Color.TS.chartSeriesPower
        case .blue: Color.TS.chartSeriesSpeed
        case .orange: TSChartPalette.color(at: 5)
        case .neutral: Color.TS.textSecondary
        }
    }
}

// MARK: - Tile value shapes (web rendering nuances)

/// How a tile's value renders, reproducing the three distinct web treatments:
///   • `mutedUnit` — the colored value followed by a smaller, muted unit span
///     (web Odometer / Range / Consumption / Avg Power).
///   • `plain` — the whole string rendered in the accent color, with the unit embedded
///     (web Energy Consumed / Recovered / Net Consumption / the temperatures / Min Speed).
///   • `elevation` — the two-line gain (green, ↑) / loss (red, ↓) block, each suffixed `m`.
public enum MoreDetailsTileValue: Equatable, Sendable {
    case mutedUnit(value: String, unit: String)
    case plain(String)
    case elevation(gain: String, loss: String)
}

/// One projected tile (web stat cell): its identity + localized label key + accent + value shape.
/// The value strings are pre-formatted and rendered verbatim (a localized number, an em-dash
/// sentinel, or a unit symbol — never prose).
public struct MoreDetailsTile: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let accent: MoreDetailsAccent
    public let value: MoreDetailsTileValue

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        accent: MoreDetailsAccent,
        value: MoreDetailsTileValue
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.accent = accent
        self.value = value
    }
}

/// The two tile groups the web renders, separated by a divider: the primary 6-up grid and the
/// secondary grid (whose two temperature tiles are present only when their reading is known —
/// web `stats.avgOutsideTemp !== null && …` / `stats.avgInsideTemp !== null && …`).
public struct MoreDetailsTiles: Equatable, Sendable {
    public let primary: [MoreDetailsTile]
    public let secondary: [MoreDetailsTile]

    public init(primary: [MoreDetailsTile], secondary: [MoreDetailsTile]) {
        self.primary = primary
        self.secondary = secondary
    }
}

// MARK: - Cached input (mirrors the web `drive` + `stats` props)

/// The display-unit aggregate the web `MoreDetailsPanel` receives. The upstream
/// `useDriveDetailData` hook has already converted every field to the user's display unit (per
/// ADR-004 the repository boundary exposes SI; the page hook applies `convertXFromSI`), so the
/// panel itself converts only the efficiency value. `nil` optionals reproduce the web `null`
/// guards; the battery percentages are integers (`*int16` in the Go model).
public struct MoreDetailsInput: Sendable, Equatable {
    public var odometerStart: Double
    public var odometerEnd: Double
    public var startRange: Double?
    public var endRange: Double?
    /// Elevation gain / loss in meters (always rendered with the literal `m` unit).
    public var elevGain: Double
    public var elevLoss: Double
    /// Energy used / recovered in watt-hours (thresholded to kWh above 1000 Wh).
    public var energyWh: Double
    public var regenWh: Double
    /// Consumption in Wh/km — the one value the panel itself converts (→ Wh/mi for miles).
    public var consumptionWhKm: Double
    /// Average power in kilowatts.
    public var avgPower: Double
    public var avgOutsideTemp: Double?
    public var avgInsideTemp: Double?
    /// Minimum moving speed in the display speed unit (rendered as an integer).
    public var minSpd: Double
    public var startBatteryPct: Int?
    public var endBatteryPct: Int?

    public init(
        odometerStart: Double = 0,
        odometerEnd: Double = 0,
        startRange: Double? = nil,
        endRange: Double? = nil,
        elevGain: Double = 0,
        elevLoss: Double = 0,
        energyWh: Double = 0,
        regenWh: Double = 0,
        consumptionWhKm: Double = 0,
        avgPower: Double = 0,
        avgOutsideTemp: Double? = nil,
        avgInsideTemp: Double? = nil,
        minSpd: Double = 0,
        startBatteryPct: Int? = nil,
        endBatteryPct: Int? = nil
    ) {
        self.odometerStart = odometerStart
        self.odometerEnd = odometerEnd
        self.startRange = startRange
        self.endRange = endRange
        self.elevGain = elevGain
        self.elevLoss = elevLoss
        self.energyWh = energyWh
        self.regenWh = regenWh
        self.consumptionWhKm = consumptionWhKm
        self.avgPower = avgPower
        self.avgOutsideTemp = avgOutsideTemp
        self.avgInsideTemp = avgInsideTemp
        self.minSpd = minSpd
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
    }
}

/// The user's display-unit preferences for this surface (web `useUnits().unitPrefs`). The labels
/// are the unit symbols the web renders verbatim (`"km"`, `"mph"`, `"°C"`, …). `precision` is the
/// global decimal precision the web `fmtNumber` reads (default 2); `locale` is the BCP-47 tag the
/// `toLocaleString` grouping uses (default en-US).
public struct MoreDetailsUnitPrefs: Sendable, Equatable {
    /// Distance unit symbol — `"km"` or `"mi"`. Selects the efficiency conversion + label.
    public var distance: String
    public var speed: String
    public var temperature: String
    public var precision: Int
    public var locale: String?

    public init(
        distance: String = "km",
        speed: String = "km/h",
        temperature: String = "°C",
        precision: Int = 2,
        locale: String? = nil
    ) {
        self.distance = distance
        self.speed = speed
        self.temperature = temperature
        self.precision = precision
        self.locale = locale
    }
}

// MARK: - Number formatting + the one unit conversion (web parity)

/// Pure formatting helpers reproducing the web `lib/numberFormat.ts` (`safeNumber` + the
/// `toLocaleString` grouping) and the panel's single inline conversion (`toEfficiencyDisplay`),
/// so every platform shows identical strings.
public enum MoreDetailsFormat {
    /// 1 mile = 1609.344 m exactly (international yard, NIST) — the web efficiency factor.
    public static let metersPerMile = 1609.344
    /// The em-dash the web renders for an absent value (`… : '—'`).
    public static let emDash = "—"

    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity`).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `fmtNumber(v, decimals, locale)`: locale-aware grouped formatting at a fixed number of
    /// fraction digits, with half-away-from-zero rounding and the `safeNumber` non-finite → 0
    /// guard. `locale` defaults to en-US (the web default).
    public static func fmtNumber(
        _ value: Double,
        decimals: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        let number = NSNumber(value: safe(value))
        return formatter.string(from: number) ?? String(format: "%.\(decimals)f", safe(value))
    }

    /// Web `toEfficiencyDisplay(whPerKm)`: `distance == 'mi' ? whPerKm * 1.609344 : whPerKm`.
    public static func toEfficiencyDisplay(_ whPerKm: Double, distance: String) -> Double {
        distance == "mi" ? whPerKm * metersPerMile / 1000 : whPerKm
    }

    /// Web `efficiencyUnit`: `distance == 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyUnit(distance: String) -> String {
        distance == "mi" ? "Wh/mi" : "Wh/km"
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for a tile. Pure + public so the spoken content can be unit-tested
/// without rendering. The label resolves through the injected localizer (bundle-free in tests),
/// then the value is read after it (web reads the label, then the value + unit).
public enum MoreDetailsAccessibility {
    public static func tileSummary(_ tile: MoreDetailsTile, localize: (String, String) -> String) -> String {
        let label = localize(tile.labelKey, tile.labelFallback)
        switch tile.value {
        case let .mutedUnit(value, unit):
            return "\(label), \(value) \(unit)"
        case let .plain(text):
            return "\(label), \(text)"
        case let .elevation(gain, loss):
            let gainLabel = localize("driveDetail.moreDetails.elevGain", "Gain")
            let lossLabel = localize("driveDetail.moreDetails.elevLoss", "Loss")
            return "\(label), \(gainLabel) \(gain), \(lossLabel) \(loss)"
        }
    }
}
