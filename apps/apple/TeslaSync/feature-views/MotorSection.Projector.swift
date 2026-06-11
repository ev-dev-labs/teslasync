//
//  MotorSection.Projector.swift
//  TeslaSync — P4 feature view · 0293 · MotorSection (Apple)
//
//  The pure (Foundation-only) computational core for the vehicle-detail "Powertrain"
//  surface: the `fmtNumber` / `fmtInt` ports (lib/numberFormat.ts), the SI °C
//  `formatTemperature` port (lib/unitConversion.ts), and the SI→display projector that
//  builds the eight view-ready cards. Split out of MotorSection.Adapter.swift (which holds
//  the value types) to keep each file within the lint budget; both are dependency-free so
//  every number can be pinned by unit tests without a bundle or a rendered view.
//

import Foundation

// MARK: - Number / temperature formatting (ports of numberFormat.ts + unitConversion.ts)

/// Pure formatting ported from the web so the rounding, the grouping separators, the
/// unit-suffix rules, and the SI temperature conversion match the source exactly. The
/// number tiles port `fmtNumber` / `fmtInt` (`safeNumber` clamps a non-finite input to
/// 0, then `Intl.NumberFormat`); the temperature tile ports `formatTemperature` (a
/// non-finite / missing input renders the empty sentinel).
public enum MotorSectionFormat {
    /// The em-dash sentinel the web renders for a missing value (`'—'`).
    public static let dash = "—"
    /// The web `fmtNumber` global precision default.
    public static let defaultNumberPrecision = 2
    /// The web `fmtInt` precision.
    public static let integerPrecision = 0
    /// Web `DEFAULT_PRECISION.temperature` (the temperature tile's fraction digits).
    public static let defaultTemperaturePrecision = 1

    /// Native port of `formatNumber(value, locale, digits)`: locale grouping, fixed
    /// fraction digits, half-away-from-zero rounding (the `Intl.NumberFormat` default).
    public static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        let digits = max(0, decimals)
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }

    /// One tile's `fmtNumber`-with-unit value (web `value != null ? \`${fmtNumber(v)} ${unit}\` : '—'`):
    /// the empty sentinel for a `nil` reading, else the grouped number at the global
    /// precision followed by a space and the unit (e.g. "388.50 V"). The web guards only
    /// null at the call site; a present-but-non-finite value clamps to 0 via `safeNumber`.
    public static func measurement(_ value: Double?, unit: String, units: MotorSectionUnits) -> String {
        guard let value else { return units.resolvedEmpty }
        let text = number(value, decimals: units.numberPrecision, locale: units.resolvedLocale)
        return unit.isEmpty ? text : "\(text) \(unit)"
    }

    /// One tile's `fmtInt` value (web `value != null ? fmtInt(v) : '—'`): the empty
    /// sentinel for a `nil` reading, else the grouped integer (no unit), e.g. "12,500".
    public static func integer(_ value: Double?, units: MotorSectionUnits) -> String {
        guard let value else { return units.resolvedEmpty }
        return number(value, decimals: integerPrecision, locale: units.resolvedLocale)
    }

    /// The peak-temperature tile value — the port of `formatTemperature(maxMotorTemp)`:
    /// the empty sentinel for a `nil` / non-finite input, else the SI °C reading
    /// converted to the display unit at the temperature precision with the unit symbol
    /// appended directly (no space), e.g. "78.0°C".
    public static func temperature(celsius: Double?, units: MotorSectionUnits) -> String {
        guard let celsius, celsius.isFinite else { return units.resolvedEmpty }
        let value = units.temperature.fromCelsius(celsius)
        return number(value, decimals: units.temperaturePrecision, locale: units.resolvedLocale)
            + units.temperature.symbol
    }
}

// MARK: - Projection (web render values for the eight `MetricCard`s)

/// The resolved, view-ready set of the eight tiles — a pure function of one reading + the
/// user's unit preferences, reproducing each web `MetricCard`'s value expression and
/// `color` prop. The view iterates `cards` so it holds no formatting logic.
public struct MotorSectionProjection: Equatable, Sendable {
    public let cards: [MotorSectionCard]

    public init(cards: [MotorSectionCard]) {
        self.cards = cards
    }

    /// Builds the eight tiles from a reading + unit preferences — the native port of the
    /// web component's per-card expressions (shift state verbatim, the pack-voltage /
    /// front-current / front+rear torque `fmtNumber` tiles with units, the two `fmtInt`
    /// RPM tiles, and the peak-temperature tile).
    public static func make(reading: MotorSectionReading, units: MotorSectionUnits) -> MotorSectionProjection {
        func measurement(_ value: Double?, _ unit: String) -> String {
            MotorSectionFormat.measurement(value, unit: unit, units: units)
        }

        let cards: [MotorSectionCard] = [
            MotorSectionCard(
                kind: .shiftState,
                valueText: reading.shiftState ?? units.resolvedEmpty,
                accent: MotorSectionMetricKind.shiftState.accent
            ),
            MotorSectionCard(
                kind: .packVoltage,
                valueText: measurement(reading.resolvedVbat, "V"),
                accent: MotorSectionMetricKind.packVoltage.accent
            ),
            MotorSectionCard(
                kind: .motorCurrentFront,
                valueText: measurement(reading.motorCurrentFront, "A"),
                accent: MotorSectionMetricKind.motorCurrentFront.accent
            ),
            MotorSectionCard(
                kind: .torqueFront,
                valueText: measurement(reading.torqueNmFront, "Nm"),
                accent: MotorSectionMetricKind.torqueFront.accent
            ),
            MotorSectionCard(
                kind: .torqueRear,
                valueText: measurement(reading.torqueNmRear, "Nm"),
                accent: MotorSectionMetricKind.torqueRear.accent
            ),
            MotorSectionCard(
                kind: .rpmFront,
                valueText: MotorSectionFormat.integer(reading.motorRpmFront, units: units),
                accent: MotorSectionMetricKind.rpmFront.accent
            ),
            MotorSectionCard(
                kind: .rpmRear,
                valueText: MotorSectionFormat.integer(reading.motorRpmRear, units: units),
                accent: MotorSectionMetricKind.rpmRear.accent
            ),
            MotorSectionCard(
                kind: .motorTemp,
                valueText: MotorSectionFormat.temperature(celsius: reading.maxMotorTempC, units: units),
                accent: MotorSectionMetricKind.motorTemp.accent
            )
        ]
        return MotorSectionProjection(cards: cards)
    }
}
