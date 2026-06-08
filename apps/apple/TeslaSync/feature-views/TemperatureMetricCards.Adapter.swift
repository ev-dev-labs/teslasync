//
//  TemperatureMetricCards.Adapter.swift
//  TeslaSync — P4 feature view · 0161 · TemperatureMetricCards (Apple)
//
//  The value types + the SI conversion / number-formatting core shared by the model, the
//  projection, and the views — the SwiftUI-free half of the adapter for the web source
//  features/driving/components/drivetrain-health/TemperatureMetricCards.tsx. The six-card
//  projection itself lives in TemperatureMetricCards.Projection.swift.
//
//  The web `formatTemperature` is `convertTempFromSI(°C) → fmtNumber(_, 1) + °unit` (no space),
//  `displayTemp` is `value === null ? '—' : formatTemperature(value)`, and the per-sensor
//  subtitle percentage uses the RAW Celsius ratio (never the display unit). All of that is
//  ported here as pure value transforms so every number can be pinned by unit tests without a
//  store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Render phase (web shell loading / content / empty / error branches)

/// The mutually-exclusive render branches the surface switches over. The web component is a
/// presentational leaf (its parent page gates on `health` and renders an `EmptyState`); the
/// native surface owns the full lifecycle, so the parent's loading skeleton, the resolved
/// cards, a resolved-but-empty rendering (em-dash cards + hint), and a fetch failure all
/// surface here.
public enum TemperatureMetricsPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Temperature display unit (web `useUnits().unitPrefs.temperature`)

/// The user's temperature display preference, mirroring the web `TemperatureUnitPref` resolved
/// by `useUnits()` (`unitPrefs.temperature`, derived from `settings.unit_of_temp`). Stored as
/// the symbol the web converter switches on (`'°C'` / `'°F'`).
public enum TempCardsTempUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol appended to the formatted number (web `pref.temperature`, no leading space).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to Celsius (the SI display
    /// floor) for any unrecognized value.
    public static func from(symbol: String) -> TempCardsTempUnit {
        TempCardsTempUnit(rawValue: symbol) ?? .celsius
    }
}

// MARK: - Overall health verdict (web `HealthStatus`)

/// The drivetrain health verdict, mirroring the web `HealthStatus` union
/// (`'good' | 'warning' | 'critical'`). Carries the canonical health score (web `HEALTH_SCORE`)
/// and the Health-Score card accent (web `overallHealth === 'good' ? 'green' : overallHealth
/// === 'warning' ? 'amber' : 'red'`).
public enum TempCardsHealthStatus: String, Sendable, Equatable, CaseIterable {
    case good
    case warning
    case critical

    /// Web `HEALTH_SCORE[status]` — the percentage the Health-Score card shows when the source
    /// does not override it.
    public var score: Int {
        switch self {
        case .good: 95
        case .warning: 60
        case .critical: 25
        }
    }

    /// Web Health-Score card accent (`good → green`, `warning → amber`, else `red`).
    public var accent: TemperatureCardAccent {
        switch self {
        case .good: .green
        case .warning: .amber
        case .critical: .red
        }
    }
}

// MARK: - Card accent (web `MetricCard` NeonColor)

/// The decorative accent a metric card carries, mapped from the web `NeonColor` the source
/// passes to each `MetricCard` (`green` / `amber` / `red` / `purple`). Mapped to a design token
/// at render time so the adapter stays SwiftUI-free.
public enum TemperatureCardAccent: String, Sendable, Equatable, CaseIterable {
    case green
    case amber
    case red
    case purple
}

// MARK: - Subtitle (web `MetricCard` subtitle slot)

/// The secondary line under a card's value. The sensor cards show a "percent of max" line or
/// the "No data" sentinel (web `value !== null ? `${pct}% of max` : 'No data'`); the Health
/// Score and Peak Power cards have no subtitle (`none`). The percent is carried as its
/// already-formatted number string so the View only appends the localized "of max" suffix.
public enum TemperatureCardSubtitle: Equatable, Sendable {
    case none
    case percentOfMax(String)
    case noData
}

// MARK: - Card projection (web `MetricCard`)

/// One projected metric card (web `<MetricCard label value subtitle icon color />`). The
/// `value` is rendered verbatim (a localized inline temperature like `72.0°F`, a `95%`, a
/// `285 kW`, or the em-dash sentinel). The label is carried as a P1/S10 key + web fallback so
/// the View resolves it through the localization facade.
public struct TemperatureMetricCardModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let subtitle: TemperatureCardSubtitle
    public let systemImage: String
    public let accent: TemperatureCardAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        subtitle: TemperatureCardSubtitle,
        systemImage: String,
        accent: TemperatureCardAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.accent = accent
    }
}

// MARK: - Bound input (web props pushed by the source)

/// The cached payload the surface consumes — the native mirror of the four web props. The four
/// sensor readings are the `health.{front,rear}MotorTempC` / `inverterTempC` / `batteryTempC`
/// fields (all degrees Celsius, the SI floor the Phase-42 pipeline stores); a `nil` reading
/// renders the em-dash value + the "No data" subtitle, exactly like the web `value === null`
/// guard.
public struct TemperatureMetricsInput: Sendable, Equatable {
    public var frontMotorTempC: Double?
    public var rearMotorTempC: Double?
    public var inverterTempC: Double?
    public var batteryTempC: Double?
    public var overallHealth: TempCardsHealthStatus
    public var healthScore: Int
    /// Peak drive power in kilowatts (web `peakPower`, already kW — the page divides the SI
    /// watts by 1000 before passing it down).
    public var peakPowerKw: Double

    public init(
        frontMotorTempC: Double? = nil,
        rearMotorTempC: Double? = nil,
        inverterTempC: Double? = nil,
        batteryTempC: Double? = nil,
        overallHealth: TempCardsHealthStatus = .good,
        healthScore: Int = TempCardsHealthStatus.good.score,
        peakPowerKw: Double = 0
    ) {
        self.frontMotorTempC = frontMotorTempC
        self.rearMotorTempC = rearMotorTempC
        self.inverterTempC = inverterTempC
        self.batteryTempC = batteryTempC
        self.overallHealth = overallHealth
        self.healthScore = healthScore
        self.peakPowerKw = peakPowerKw
    }
}

/// The user's display preferences, mirroring `useUnits()`. The view never reads settings
/// directly; the source resolves these and pushes them with each snapshot so the same
/// preference the web `useUnits` hook applies is honored at the native render boundary.
public struct TemperatureMetricsUnitPrefs: Sendable, Equatable {
    public var temperature: TempCardsTempUnit
    public var localeIdentifier: String
    /// Fraction digits for the inline temperature value. `nil` uses the web temperature default
    /// of 1 (web `DEFAULT_PRECISION.temperature`); a value mirrors a user
    /// `settings.decimal_precision` override flowing through `useUnits`.
    public var precision: Int?

    public init(
        temperature: TempCardsTempUnit = .celsius,
        localeIdentifier: String = "en_US",
        precision: Int? = nil
    ) {
        self.temperature = temperature
        self.localeIdentifier = localeIdentifier
        self.precision = precision
    }
}

// MARK: - Temperature conversion + number formatting (web parity)

/// Pure °C → display converter + the `safe()` / `fmtNumber()` helpers, reproducing the web
/// `lib/unitConversion.ts` `convertTempFromSI` and `lib/numberFormat.ts` `fmtNumber` /
/// `safeNumber` so every platform shows identical numbers. SwiftUI-free so the math can be
/// unit-tested on a plain host.
public enum TemperatureMetricsMath {
    /// The em-dash the web renders for an absent / non-finite reading (web `displayTemp`
    /// `: '—'` and `DEFAULT_EMPTY_DISPLAY`).
    public static let emDash = "—"

    /// The web temperature precision default (`DEFAULT_PRECISION.temperature`).
    public static let defaultTemperaturePrecision = 1

    /// Web `convertTempFromSI(celsius, to)`: Celsius passes through; Fahrenheit is
    /// `c * 9 / 5 + 32`.
    public static func convertTemperatureFromSI(
        _ celsius: Double,
        to unit: TempCardsTempUnit
    ) -> Double {
        switch unit {
        case .celsius: celsius
        case .fahrenheit: celsius * 9 / 5 + 32
        }
    }

    /// Web `safeNumber(v)`: a finite number, else `0` (guards `NaN` / `±Infinity` / absent).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Web `fmtNumber(v, decimals, locale)`: locale-grouped formatting at a fixed number of
    /// fraction digits with the non-finite → 0 guard. Half-away-from-zero rounding mirrors
    /// `Intl.NumberFormat`'s default.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
        let digits = max(0, decimals)
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safeValue = safe(value)
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }

    /// Web `formatTemperature(celsius, pref)`: `fmtNumber(convertTempFromSI(°C), digits)` with
    /// the unit symbol appended and NO space (web typographic convention). Returns the em-dash
    /// for an absent / non-finite reading (web `displayTemp` null guard + `isFiniteNumber`).
    public static func temperatureInline(
        _ celsius: Double?,
        unit: TempCardsTempUnit,
        precision: Int?,
        localeIdentifier: String
    ) -> String {
        guard let celsius, celsius.isFinite else { return emDash }
        let digits = precision ?? defaultTemperaturePrecision
        let display = convertTemperatureFromSI(celsius, to: unit)
        return "\(number(display, decimals: digits, localeIdentifier: localeIdentifier))\(unit.symbol)"
    }

    /// Web `fmtInt(peakPower)` — locale-grouped integer (0 fraction digits).
    public static func integer(_ value: Double, localeIdentifier: String) -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// Web `fmtNumber(value / maxTemp * 100, 0)` — the percent-of-max number string. Uses the
    /// RAW Celsius ratio (never the display unit), exactly like the source. A non-positive
    /// `maxTemp` guards to `0` rather than dividing by zero.
    public static func percentOfMax(_ celsius: Double, maxTempC: Double, localeIdentifier: String) -> String {
        let ratio = maxTempC > 0 ? (safe(celsius) / maxTempC) * 100 : 0
        return number(ratio, decimals: 0, localeIdentifier: localeIdentifier)
    }
}
