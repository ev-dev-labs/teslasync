//
//  LiveTelemetryPanels.Adapter.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The testable formatting + presentation core for the Live Telemetry section — the
//  SwiftUI parity of features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx
//  and the seven panels it composes. Reproduces the web numeric pipeline VERBATIM so the
//  native panels show the same values:
//    • web lib/numberFormat `fmtNumber` / `fmtInt` / `fmtWithUnit` (grouped, locale-aware),
//    • web lib/unitConversion `convert*FromSI` + `format*` (distance / speed / temperature
//      / pressure), with the same per-quantity default precision + the °unit no-space rule,
//    • web cleanNil (Go "<nil>" / "nil" / "null" scrubbing),
//    • the tire-pressure Pascal thresholds (vehicle-detail/helpers `TIRE_PRESSURE_PA`),
//    • the freshness age label (web refetch freshness treatment).
//  Plus the Foundation presentation primitives (rows / chips / tiles / tones) the seven
//  panel projections build and the SwiftUI panels render.
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + projection compile
//  and run on a plain host and are pinned by unit tests; the SwiftUI chrome layers on top
//  in the other LiveTelemetryPanels.* files.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware decimal formatting mirroring web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away
/// from zero to match `Intl.NumberFormat`'s default `halfExpand`. `fmtInt` is the 0-digit
/// case; `fmtWithUnit` appends a space + unit token. The global `fmtNumber` precision (web
/// default 2) is carried on `LTPUnitPrefs.numberPrecision`.
public enum LTPFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` core — fixed fraction digits, grouped, half-up.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// Web `fmtNumber(v)` — uses the global precision (`numberPrecision`, default 2) unless
    /// a per-call `decimals` override is given.
    public static func fmtNumber(_ value: Double, _ units: LTPUnitPrefs, decimals: Int? = nil) -> String {
        number(value, decimals: decimals ?? units.numberPrecision, localeIdentifier: units.localeIdentifier)
    }

    /// Web `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func fmtInt(_ value: Double, _ units: LTPUnitPrefs) -> String {
        number(value, decimals: 0, localeIdentifier: units.localeIdentifier)
    }

    /// Web `fmtWithUnit(v, unit)` — `"{fmtNumber(v)} {unit}"`.
    public static func fmtWithUnit(_ value: Double, _ unit: String, _ units: LTPUnitPrefs) -> String {
        "\(fmtNumber(value, units)) \(unit)"
    }

    /// `fmtNumber` of an optional, or the web `—` fallback when nil (web
    /// `x != null ? fmtNumber(x) : '—'`).
    public static func numberOrDash(_ value: Double?, _ units: LTPUnitPrefs) -> String {
        value.map { fmtNumber($0, units) } ?? LTPUnits.emptyDisplay
    }

    /// `fmtInt` of an optional, or the web `—` fallback when nil.
    public static func intOrDash(_ value: Double?, _ units: LTPUnitPrefs) -> String {
        value.map { fmtInt($0, units) } ?? LTPUnits.emptyDisplay
    }
}

// MARK: - SI converters + unit formatters (ported from web lib/unitConversion.ts)

/// SI→display conversion + formatting matching the web `convert*FromSI` + `format*` the
/// panels use through `useUnits`. Constants are byte-for-byte the web
/// `METERS_PER_*` / `KPA_PER_*`. Each formatter returns the web `—` fallback for
/// nil / non-finite input and applies the web per-quantity default precision (distance 1,
/// speed 0, temperature 1, pressure 1) unless `units.unitPrecision` overrides it.
public enum LTPUnits {
    static let metersPerKm = 1000.0
    static let metersPerMile = 1609.344
    static let metersPerFoot = 0.3048
    static let kpaPerPsi = 6.894757
    static let kpaPerBar = 100.0
    static let secondsPerHour = 3600.0
    static let emptyDisplay = "—"

    // MARK: numeric converters

    public static func distanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKm
        }
    }

    public static func speedFromSI(_ mps: Double, to unit: String) -> Double {
        switch unit {
        case "mph": (mps * secondsPerHour) / metersPerMile
        default: (mps * secondsPerHour) / metersPerKm
        }
    }

    public static func temperatureFromSI(_ celsius: Double, to unit: String) -> Double {
        switch unit {
        case "°F": (celsius * 9) / 5 + 32
        default: celsius
        }
    }

    public static func pressureFromSI(_ kpa: Double, to unit: String) -> Double {
        switch unit {
        case "psi": kpa / kpaPerPsi
        case "kPa": kpa
        default: kpa / kpaPerBar
        }
    }

    // MARK: string formatters

    private static func precision(_ units: LTPUnitPrefs, fallback: Int) -> Int {
        if let override = units.unitPrecision, override >= 0 { return override }
        return fallback
    }

    /// Web `formatDistance` — `"{num} {km|mi|ft}"`, default precision 1.
    public static func formatDistance(_ meters: Double?, _ units: LTPUnitPrefs) -> String {
        guard let meters, meters.isFinite else { return emptyDisplay }
        let num = LTPFormat.number(
            distanceFromSI(meters, to: units.distance),
            decimals: precision(units, fallback: 1),
            localeIdentifier: units.localeIdentifier
        )
        return "\(num) \(units.distance)"
    }

    /// Web `formatSpeed` — `"{num} {km/h|mph}"`, default precision 0.
    public static func formatSpeed(_ mps: Double?, _ units: LTPUnitPrefs) -> String {
        guard let mps, mps.isFinite else { return emptyDisplay }
        let num = LTPFormat.number(
            speedFromSI(mps, to: units.speed),
            decimals: precision(units, fallback: 0),
            localeIdentifier: units.localeIdentifier
        )
        return "\(num) \(units.speed)"
    }

    /// Web `formatTemperature` — `"{num}{°C|°F}"` (no space), default precision 1.
    public static func formatTemperature(_ celsius: Double?, _ units: LTPUnitPrefs) -> String {
        guard let celsius, celsius.isFinite else { return emptyDisplay }
        let num = LTPFormat.number(
            temperatureFromSI(celsius, to: units.temperature),
            decimals: precision(units, fallback: 1),
            localeIdentifier: units.localeIdentifier
        )
        return "\(num)\(units.temperature)"
    }

    /// Web `formatPressure` — `"{num} {kPa|psi|bar}"`, default precision 1.
    public static func formatPressure(_ kpa: Double?, _ units: LTPUnitPrefs) -> String {
        guard let kpa, kpa.isFinite else { return emptyDisplay }
        let num = LTPFormat.number(
            pressureFromSI(kpa, to: units.pressure),
            decimals: precision(units, fallback: 1),
            localeIdentifier: units.localeIdentifier
        )
        return "\(num) \(units.pressure)"
    }
}

// MARK: - Nil scrubbing (ported from web lib/cleanNil.ts)

/// Filters Go nil string representations from API data (web `cleanNil`): Go's
/// `fmt.Sprintf("%v", nil)` yields `"<nil>"`, which the API can echo back as a literal.
public enum LTPClean {
    public static func cleanNil(_ value: String?) -> String? {
        guard let value, !value.isEmpty, value != "<nil>", value != "nil", value != "null" else {
            return nil
        }
        return value
    }
}

// MARK: - Tire-pressure thresholds (ported from vehicle-detail/helpers.ts)

/// The Pascal tire-pressure bands (web `TIRE_PRESSURE_PA`) shared by the corner color +
/// the overall status chip, plus the Pa→kPa step the renderer feeds `formatPressure`.
public enum LTPTirePressure {
    public static let lowCritical = 206_800.0
    public static let lowWarning = 241_300.0
    public static let highWarning = 310_300.0
    public static let highCritical = 344_700.0

    /// Web `paToKpa` — `1 kPa = 1000 Pa`; nil / non-finite → nil.
    public static func paToKpa(_ pa: Double?) -> Double? {
        guard let pa, pa.isFinite else { return nil }
        return pa / 1000
    }

    /// The per-corner tone (web `getColor` / `getBorder`).
    public static func cornerTone(_ pa: Double?) -> LTPTone {
        guard let pa else { return .neutral }
        if pa < lowCritical || pa > highCritical { return .danger }
        if pa < lowWarning || pa > highWarning { return .warning }
        return .success
    }
}

// MARK: - Relative time (web freshness age label)

/// Relative-time helper for the freshness chip. The strings resolve through the P1/S10
/// facade so the native surface holds no hardcoded English.
public enum LTPRelativeTime {
    /// Freshness `formatAge(age)` — the stale-chip / freshness-chip age label.
    public static func formatAge(_ date: Date?, now: Date = Date()) -> String {
        guard let date else {
            return LiveTelemetryPanelsStrings.string("liveTelemetry.age.unknown", "—")
        }
        let age = Int(max(0, now.timeIntervalSince(date)))
        if age < 10 {
            return LiveTelemetryPanelsStrings.string("liveTelemetry.age.justNow", "just now")
        }
        if age < 60 {
            return LiveTelemetryPanelsStrings.format("liveTelemetry.age.seconds", "%ds ago", age)
        }
        if age < 3600 {
            return LiveTelemetryPanelsStrings.format("liveTelemetry.age.minutes", "%dm ago", age / 60)
        }
        return LiveTelemetryPanelsStrings.format("liveTelemetry.age.hours", "%dh ago", age / 3600)
    }
}

// MARK: - Presentation primitives (the panel projections build these)

/// Semantic tone for a row value, chip, or corner — mapped to design tokens in the view
/// layer (web Tailwind `text-green-400` / `-red-400` / `-amber-400` / `-cyan-300` /
/// `-blue-400` / `-purple-400` / muted).
public enum LTPTone: String, Sendable, Equatable {
    case neutral
    case success
    case warning
    case danger
    case accent
    case info
    case purple
}

/// One label / value row inside a panel (web `flex items-center justify-between` row). The
/// value renders monospaced; `valueTone` tints it; `icon` is an optional leading SF Symbol
/// on the label.
public struct LTPInfoRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let valueTone: LTPTone
    public let icon: String?

    public init(id: String, label: String, value: String, valueTone: LTPTone = .neutral, icon: String? = nil) {
        self.id = id
        self.label = label
        self.value = value
        self.valueTone = valueTone
        self.icon = icon
    }

    /// The spoken "label value" phrase for VoiceOver.
    public var spoken: String {
        "\(label) \(value)"
    }
}

/// A tinted pill (web status badge): shift state, sentry, charging state, climate mode,
/// tire status, place, playback. `filled` selects the bordered tinted background vs a plain
/// tinted label.
public struct LTPChip: Identifiable, Equatable, Sendable {
    public let id: String
    public let text: String
    public let tone: LTPTone
    public let icon: String?
    public let filled: Bool

    public init(id: String, text: String, tone: LTPTone = .neutral, icon: String? = nil, filled: Bool = true) {
        self.id = id
        self.text = text
        self.tone = tone
        self.icon = icon
        self.filled = filled
    }
}

/// A boxed metric tile (web `MetricCard`): a label, a big value, and an optional unit
/// caption (RPM / Nm / V / A).
public struct LTPMetricTile: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String?

    public init(id: String, label: String, value: String, unit: String? = nil) {
        self.id = id
        self.label = label
        self.value = value
        self.unit = unit
    }
}
