//
//  TemperatureGauges.Adapter.swift
//  TeslaSync — P4 feature view · 0160 · TemperatureGauges (Apple)
//
//  The testable projection core: a `[TempSensorInput]` + `TemperatureGaugesUnitPrefs` → the
//  view-ready radial gauges (centre value, ceiling label, ring fill, severity tone), reproducing
//  the web source's numeric + string pipeline VERBATIM so the native surface shows the exact same
//  values as features/driving/components/drivetrain-health/TemperatureGauges.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the conversion + formatting + projection +
//  accessibility compile and run on a plain host and are pinned by unit tests. The severity →
//  token tint mapping lives in TemperatureGauges.Views.swift; here a gauge's label is resolved
//  lazily through the P1/S10 facade so the projector itself holds no SwiftUI.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber`/`fmtInt`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), used by the gauge centre
/// (web `RadialGauge`'s `fmtNumber(clamped, d)`) and the ceiling line (`fmtNumber(max, 0)`).
public enum TemperatureGaugesFormat {
    /// The web global decimal precision default (`numberFormat.ts` `_globalPrecision = 2`), used by
    /// the gauge centre when the clamped display temperature is not an integer
    /// (web `getGlobalPrecision()`).
    public static let defaultPrecision = 2

    /// `safeNumber` from numberFormat.ts (and the charts `safe`): non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Number.toLocaleString`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
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

    /// `fmtInt(v)` — `fmtNumber(v, 0)`, the grouped whole-number formatter the web uses for the
    /// gauge ceiling line (`Max: …`). Accepts a `Double` because the web feeds it the converted
    /// (fractional) ceiling before flooring to whole degrees.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - SI → display converter (ported 1:1 from web lib/unitConversion.ts)

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in `lib/unitConversion.ts`:
/// `°C` passes through, `°F` is `celsius * 9 / 5 + 32`.
func convertTemperatureGaugeFromSI(_ celsius: Double, to unit: TemperatureUnit) -> Double {
    switch unit {
    case .celsius:
        celsius
    case .fahrenheit:
        celsius * 9 / 5 + 32
    }
}

// MARK: - Severity (ported from web helpers.ts `tempSeverityColor`)

/// The per-sensor severity, computed from the SI reading + SI ceiling exactly like the web
/// `tempSeverityColor(celsius, max)`: a missing reading is `.unknown` (web gray `#6b7280`); the
/// ratio thresholds are `≥ 0.85` critical, `≥ 0.65` warning, else normal. The non-finite ratios a
/// degenerate ceiling can produce follow JS comparison semantics (`+∞ ≥ 0.85` → critical; `NaN`
/// comparisons are false → normal), matching the web one-to-one.
public enum TempSeverity: Sendable, Equatable {
    case normal
    case warning
    case critical
    case unknown

    public static func from(valueCelsius: Double?, maxCelsius: Double) -> TempSeverity {
        guard let valueCelsius else { return .unknown }
        let ratio = valueCelsius / maxCelsius
        if ratio >= 0.85 { return .critical }
        if ratio >= 0.65 { return .warning }
        return .normal
    }
}

// MARK: - Projected radial gauge (web `RadialGauge` + ceiling line)

/// One projected temperature gauge: the localized label, the formatted centre value, the unit
/// suffix, the 0...1 ring fill (clamped display value / display ceiling), the severity that tints
/// the arc, and the formatted ceiling line. Mirrors one web
/// `<RadialGauge value=… max=… unit=tempUnit color=tempSeverityColor /> + <p>Max: …</p>`.
public struct TempGaugeProjection: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let valueText: String
    public let unit: String
    public let fraction: Double
    public let severity: TempSeverity
    public let maxText: String
    public let hasReading: Bool

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        valueText: String,
        unit: String,
        fraction: Double,
        severity: TempSeverity,
        maxText: String,
        hasReading: Bool
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueText = valueText
        self.unit = unit
        self.fraction = fraction
        self.severity = severity
        self.maxText = maxText
        self.hasReading = hasReading
    }

    /// The resolved (localized) label for display + accessibility (P1/S10 facade).
    public var label: String {
        TemperatureGaugesStrings.string(labelKey, labelFallback)
    }

    /// The centre readout spoken by VoiceOver — value plus unit suffix (e.g. "95°C").
    public var spokenValue: String {
        "\(valueText)\(unit)"
    }

    /// The ceiling readout spoken by VoiceOver — ceiling value plus unit suffix (e.g. "150°C").
    public var spokenMax: String {
        "\(maxText)\(unit)"
    }
}

// MARK: - Projection

/// The fully-projected surface content: one gauge per sensor, in the web render order.
public struct TemperatureGaugesProjection: Equatable, Sendable {
    public let gauges: [TempGaugeProjection]

    public init(gauges: [TempGaugeProjection]) {
        self.gauges = gauges
    }

    /// Whether there are any gauges to render.
    public var isEmpty: Bool {
        gauges.isEmpty
    }
}

// MARK: - Projector (pure, web-parity)

/// Pure projector: `[TempSensorInput]` + `TemperatureGaugesUnitPrefs` → `TemperatureGaugesProjection`.
/// Every value is computed with the exact same arithmetic + formatting as the web component so the
/// web and native surfaces show identical strings side by side.
public enum TemperatureGaugesProjector {
    public static func project(
        sensors: [TempSensorInput],
        units: TemperatureGaugesUnitPrefs
    ) -> TemperatureGaugesProjection {
        TemperatureGaugesProjection(gauges: sensors.map { gauge(for: $0, units: units) })
    }

    /// One gauge, reproducing the web `RadialGauge` pipeline exactly:
    ///   • `value = sensor.value !== null ? convertTempFromSI(value) : 0` (a missing reading
    ///     renders a zeroed centre, matching the web literal `0`);
    ///   • `max = convertTempFromSI(maxTemp)`;
    ///   • `clamped = Math.max(0, Math.min(value, max))`, centre `fmtNumber(clamped, d)` with
    ///     `d = Number.isInteger(clamped) ? 0 : globalPrecision(2)`;
    ///   • ring fill `clamped / max`;
    ///   • colour `tempSeverityColor(sensor.value, sensor.maxTemp)` from the SI reading + ceiling;
    ///   • ceiling line `fmtNumber(max, 0)`.
    private static func gauge(for sensor: TempSensorInput, units: TemperatureGaugesUnitPrefs) -> TempGaugeProjection {
        let locale = units.localeIdentifier
        let displayMax = convertTemperatureGaugeFromSI(sensor.maxTempCelsius, to: units.temperature)
        let hasReading = sensor.valueCelsius != nil
        let displayValue = hasReading
            ? convertTemperatureGaugeFromSI(sensor.valueCelsius ?? 0, to: units.temperature)
            : 0
        let clamped = max(0, min(displayValue, displayMax))
        let decimals = clamped == clamped.rounded() ? 0 : defaultPrecision
        let fraction = displayMax != 0 ? min(max(clamped / displayMax, 0), 1) : 0
        return TempGaugeProjection(
            id: sensor.id,
            labelKey: sensor.labelKey,
            labelFallback: sensor.labelFallback,
            valueText: TemperatureGaugesFormat.number(clamped, decimals: decimals, localeIdentifier: locale),
            unit: units.temperature.symbol,
            fraction: fraction,
            severity: TempSeverity.from(valueCelsius: sensor.valueCelsius, maxCelsius: sensor.maxTempCelsius),
            maxText: TemperatureGaugesFormat.integer(displayMax, localeIdentifier: locale),
            hasReading: hasReading
        )
    }

    private static let defaultPrecision = TemperatureGaugesFormat.defaultPrecision
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summaries spoken for the surface. Pure + public so the spoken content can
/// be unit-tested without rendering the view. The "Max" label is resolved through the P1/S10
/// facade so the summary holds no English literal of its own.
public enum TemperatureGaugesAccessibility {
    /// One spoken phrase for one gauge, e.g. "Front Motor 95°C, Max 150°C".
    public static func gaugeSummary(for gauge: TempGaugeProjection, maxLabel: String) -> String {
        "\(gauge.label) \(gauge.spokenValue), \(maxLabel) \(gauge.spokenMax)"
    }

    /// The full surface summary: every gauge phrase joined, e.g.
    /// "Front Motor 95°C, Max 150°C. Rear Motor 110°C, Max 150°C. …".
    public static func summary(for projection: TemperatureGaugesProjection) -> String {
        let maxLabel = TemperatureGaugesStrings.string("drivetrain.maxLabel", "Max")
        return projection.gauges
            .map { gaugeSummary(for: $0, maxLabel: maxLabel) }
            .joined(separator: ". ")
    }
}
