//
//  SummaryStats.Adapter.swift
//  TeslaSync — P4 feature view · 0175 · SummaryStats (Apple)
//
//  The testable projection core for the driving-dynamics summary stats grid — the
//  SwiftUI parity of features/driving/components/driving-dynamics/SummaryStats.tsx
//  plus the two web helpers it leans on: `fmtNumber` (lib/numberFormat.ts) and
//  `convertTempFromSI` / the parent's `toTemperatureDisplay` + `tempUnit`
//  (lib/unitConversion.ts). Everything here is pure + dependency-free (no store, no
//  bundle, no rendered view) so the number formatting, the Celsius→display
//  conversion, the six-tile model, the responsive column math, and the VoiceOver
//  summaries are all unit tested in isolation.
//
//  Units note: the web component renders the power/torque symbols "Nm" / "kW" as
//  literal suffixes WITHOUT unit conversion (the parent page already supplies kW /
//  Nm), and converts ONLY temperature (SI Celsius → the user's °C / °F). Native must
//  hold no English literals, so the power/torque symbols are carried as i18n keys +
//  fallbacks resolved at the display boundary (P1/S10), and the temperature symbol is
//  the user's injected preference. The numeric values are locale-stable
//  pre-formatted strings, rendered verbatim.
//
//  Parity nuance: `Total Readings` is the web `value={motorStats?.totalReadings ?? 0}`
//  raw number — React renders it via `Number.toString()`, i.e. WITHOUT grouping
//  separators — so the count formatter is intentionally ungrouped, unlike the grouped
//  `fmtNumber` used for the torque / power / temperature tiles.
//

import Foundation

// MARK: - Source values (web `MotorStats` prop, the fields SummaryStats reads)

/// The six metrics the web `SummaryStats` reads off `MotorStats`. Power / torque are
/// already in display units (kW / Nm) exactly as the web receives them — so no unit
/// conversion applies to them. `avgMotorTempCelsius` is SI Celsius, converted to the
/// user's unit at the display boundary (the web `toTemperatureDisplay`).
public struct DynamicsSummaryStatsValues: Sendable, Equatable {
    public var totalReadings: Int
    public var avgTorque: Double
    public var peakPower: Double
    public var peakRegen: Double
    public var avgPower: Double
    public var avgMotorTempCelsius: Double

    public init(
        totalReadings: Int = 0,
        avgTorque: Double = 0,
        peakPower: Double = 0,
        peakRegen: Double = 0,
        avgPower: Double = 0,
        avgMotorTempCelsius: Double = 0
    ) {
        self.totalReadings = totalReadings
        self.avgTorque = avgTorque
        self.peakPower = peakPower
        self.peakRegen = peakRegen
        self.avgPower = avgPower
        self.avgMotorTempCelsius = avgMotorTempCelsius
    }

    /// The all-zero values the web renders for a null `motorStats` on the numeric
    /// tiles (`stats?.x ?? 0`). The temperature tile is special-cased to the em-dash.
    public static let zero = DynamicsSummaryStatsValues()
}

// MARK: - Temperature unit (web `TemperatureUnitPref` + `convertTempFromSI`)

/// The user's temperature display preference — the native mirror of the web
/// `TemperatureUnitPref` (`'°C' | '°F'`). Carries both the SI→display conversion
/// (web `convertTempFromSI`) and the unit symbol routed through the i18n facade.
public enum DynamicsSummaryStatsTemperatureUnit: Sendable, Equatable {
    case celsius
    case fahrenheit

    /// Web `convertTempFromSI(celsius, to)`: identity for °C, `c * 9/5 + 32` for °F.
    public func convert(_ celsius: Double) -> Double {
        switch self {
        case .celsius: celsius
        case .fahrenheit: celsius * 9 / 5 + 32
        }
    }

    /// The i18n key for the unit symbol (resolved at the display boundary).
    public var symbolKey: String {
        switch self {
        case .celsius: "dynamics.unit.celsius"
        case .fahrenheit: "dynamics.unit.fahrenheit"
        }
    }

    /// The English fallback symbol (web `tempUnit`, already including the degree sign).
    public var symbolFallback: String {
        switch self {
        case .celsius: "°C"
        case .fahrenheit: "°F"
        }
    }
}

// MARK: - Number formatting (port of numberFormat.ts)

/// Pure locale number formatting, ported from the web `fmtNumber` so the grouping,
/// fraction digits, and non-finite coercion match the source exactly, plus the
/// ungrouped `count` used for the raw `Total Readings` number.
public enum DynamicsSummaryStatsFormat {
    /// Locale decimal with grouping separators and a fixed fraction width — the
    /// native port of `fmtNumber(v, digits)`: non-finite coerces to 0 (web
    /// `safeNumber`), rounds half away from zero (web `toLocaleString` default), and
    /// pads to exactly `fractionDigits` decimals.
    public static func decimal(_ value: Double, fractionDigits: Int, locale: Locale) -> String {
        let safe = value.isFinite ? value : 0
        let digits = max(0, fractionDigits)
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }

    /// The raw `Total Readings` count — web `value={…totalReadings ?? 0}` rendered by
    /// React as `Number.toString()`, i.e. WITHOUT grouping separators or locale digit
    /// shaping. Kept distinct from `decimal` so the parity distinction is explicit.
    public static func count(_ value: Int) -> String {
        String(value)
    }

    /// The web em-dash sentinel for the temperature tile when `motorStats` is null
    /// (`motorStats ? … : '—'`). A typographic, language-neutral marker.
    public static let emptyValue = "—"
}

/// The native mirror of the web display preferences SummaryStats is fed: the active
/// locale backing the grouping/decimal separators and the temperature unit. Drives the
/// two web formatters the grid uses — `fmtNumber(v, 1)` (one decimal, grouped) and the
/// temperature conversion + 1-decimal format.
public struct DynamicsSummaryStatsFormatting: Sendable, Equatable {
    /// The number of fraction digits the web passes everywhere on this surface
    /// (`fmtNumber(v, 1)`).
    public static let fractionDigits = 1

    /// The BCP-47 locale backing the grouping/decimal separators (web global locale).
    public var locale: Locale
    /// The user's temperature display unit (web `tempUnit`).
    public var temperatureUnit: DynamicsSummaryStatsTemperatureUnit

    public init(locale: Locale = .current, temperatureUnit: DynamicsSummaryStatsTemperatureUnit = .celsius) {
        self.locale = locale
        self.temperatureUnit = temperatureUnit
    }

    /// Web `fmtNumber(v, 1)` — one decimal, grouped, non-finite→0.
    public func number(_ value: Double) -> String {
        DynamicsSummaryStatsFormat.decimal(value, fractionDigits: Self.fractionDigits, locale: locale)
    }

    /// Web `value={…totalReadings ?? 0}` — ungrouped raw count.
    public func count(_ value: Int) -> String {
        DynamicsSummaryStatsFormat.count(value)
    }

    /// Web `fmtNumber(toTemperatureDisplay(c), 1)` — convert SI Celsius to the user's
    /// unit, then format to one decimal. The unit symbol is appended by the view.
    public func temperatureValue(_ celsius: Double) -> String {
        number(temperatureUnit.convert(celsius))
    }

    /// The resolved-at-display unit descriptor for the active temperature preference.
    public var temperatureUnitDescriptor: DynamicsSummaryStatsUnit {
        DynamicsSummaryStatsUnit(key: temperatureUnit.symbolKey, fallback: temperatureUnit.symbolFallback)
    }
}

// MARK: - Unit symbol (web literal suffix → i18n key + fallback)

/// One unit suffix carried as an i18n key + English fallback so the view resolves it
/// through the P1/S10 facade rather than embedding the literal symbol in Swift.
public struct DynamicsSummaryStatsUnit: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(key: String, fallback: String) {
        self.key = key
        self.fallback = fallback
    }
}

/// The power / torque unit suffixes the web bakes into the tile value strings, carried
/// as i18n keys + fallbacks so the Swift sources hold no literal symbols.
public enum DynamicsSummaryStatsUnits {
    public static let newtonMeter = DynamicsSummaryStatsUnit(key: "dynamics.unit.nm", fallback: "Nm")
    public static let kilowatt = DynamicsSummaryStatsUnit(key: "dynamics.unit.kw", fallback: "kW")
}

// MARK: - Card value (web StatCard value: skeleton / em-dash / formatted)

/// The render branch a single tile's value resolves under — the native mirror of the
/// three shapes the web StatCard value takes on this surface: the in-flight skeleton
/// (loading), the em-dash sentinel (web temperature `: '—'`), and a pre-formatted,
/// locale-stable numeric string.
public enum DynamicsSummaryStatsCardValue: Sendable, Equatable {
    case loading
    case empty
    case value(String)
}

// MARK: - Card model (web `<StatCard label value icon>`)

/// One resolved summary tile — the native mirror of a single web `<StatCard>`. The
/// label is carried as an i18n key + English fallback (resolved in the view); `value`
/// is the render branch; `unit` is the optional resolved-at-display suffix (nil for the
/// ungrouped count tile and for the em-dash temperature branch); `symbol` is the SF
/// Symbol that mirrors the web lucide icon (rendered muted, as the web StatCard does).
public struct DynamicsSummaryStatsCard: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: DynamicsSummaryStatsCardValue
    public let unit: DynamicsSummaryStatsUnit?
    public let symbol: String

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: DynamicsSummaryStatsCardValue,
        unit: DynamicsSummaryStatsUnit?,
        symbol: String
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
        self.symbol = symbol
    }
}

// MARK: - Responsive layout (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`)

/// The responsive column math, ported from the web Tailwind grid so it is unit testable
/// and identical across iPhone / iPad / Mac widths. Tailwind breakpoints are CSS
/// pixels: `md` = 768, `lg` = 1024.
public enum DynamicsSummaryStatsLayout {
    public static let mdBreakpoint: CGFloat = 768
    public static let lgBreakpoint: CGFloat = 1024

    /// Columns for an available width: 2 below `md`, 3 below `lg`, 6 at/above `lg`
    /// (web `grid-cols-2` / `md:grid-cols-3` / `lg:grid-cols-6`).
    public static func columnCount(forWidth width: CGFloat) -> Int {
        if width >= lgBreakpoint { return 6 }
        if width >= mdBreakpoint { return 3 }
        return 2
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the combined VoiceOver string for a tile ("{label}, {value} {unit}") so the
/// spoken content is asserted without rendering the view.
public enum DynamicsSummaryStatsAccessibility {
    public static func cardLabel(label: String, value: String, unit: String?) -> String {
        if let unit, !unit.isEmpty {
            return "\(label), \(value) \(unit)"
        }
        return "\(label), \(value)"
    }
}
