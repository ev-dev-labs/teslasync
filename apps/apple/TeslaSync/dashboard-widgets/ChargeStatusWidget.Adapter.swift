//
//  ChargeStatusWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0021 · ChargeStatusWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `ChargeStateDTO` + `ChargeUnitPrefs`
//  → display strings, reproducing the web source's numeric pipeline VERBATIM so the
//  native surface shows the exact same values as
//  features/dashboard/widgets/ChargeStatusWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be
//  compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Distance conversion (ported 1:1 from web lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// `lib/unitConversion.ts` — a divide by the unit's metres-per-unit factor. The web
/// widget feeds it `state.charge_rate` (metres·h⁻¹, per the SI-floor note in the
/// source) and `state.rated_range` (metres), so this is a straight SI → display
/// conversion. Non-finite inputs collapse to 0 to match the web `safeNumber` guard.
func convertChargeDistanceFromSI(_ meters: Double, to unit: ChargeDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware decimal + integer formatting that mirrors the web `fmtNumber` /
/// `fmtInt` (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`),
/// rounding half away from zero to match `Intl.NumberFormat`'s default `halfExpand`.
public enum ChargeStatusFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
    public static func number(
        _ value: Double,
        decimals: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
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

    /// `fmtInt(v)` from numberFormat.ts — `fmtNumber(v, 0)`: grouped, zero fraction digits.
    public static func integer(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// Raw JS-number interpolation parity for `{state.battery_level}` — a bare integer
    /// with no grouping separator (React renders `String(number)`, not a localized form).
    public static func plainInteger(_ value: Double) -> String {
        String(Int(safeNumber(value).rounded()))
    }
}

// MARK: - Projected metric (web charging-grid `<div>` block)

/// Color emphasis for a metric value, the native parity of the web treatment:
/// `.positive` ⇒ `text-emerald-300` (charger power), `.primary` ⇒ `text-[var(--text-primary)]`.
public enum ChargeMetricTone: Equatable {
    case positive
    case primary
}

/// One projected charging metric: a localized label, a formatted value, an optional
/// unit suffix and a color tone. Mirrors the four `<div>` blocks in the web charging
/// grid (Power / Rate / Battery / Time to Full).
public struct ChargeMetric: Identifiable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unit: String
    public let tone: ChargeMetricTone

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        unit: String,
        tone: ChargeMetricTone
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
        self.tone = tone
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        ChargeStatusStrings.string(labelKey, labelFallback)
    }

    /// `value` + `unit` joined for accessibility, skipping an empty unit.
    public var spokenValue: String {
        unit.isEmpty ? value : "\(value) \(unit)"
    }
}

// MARK: - Charging projection (web `is_charging` branch)

/// The four-metric charging grid: Power, Rate, Battery, Time to Full — in source order.
public struct ChargingProjection: Equatable {
    public let power: ChargeMetric
    public let rate: ChargeMetric
    public let battery: ChargeMetric
    public let timeToFull: ChargeMetric

    public init(power: ChargeMetric, rate: ChargeMetric, battery: ChargeMetric, timeToFull: ChargeMetric) {
        self.power = power
        self.rate = rate
        self.battery = battery
        self.timeToFull = timeToFull
    }

    /// The four metrics in the web grid's reading order.
    public var metrics: [ChargeMetric] {
        [power, rate, battery, timeToFull]
    }
}

// MARK: - Idle projection (web not-charging branch)

/// The not-charging summary: `{battery_level}% · {rated_range} {unit}`. Carries the
/// component strings (for accessibility) plus the joined summary line the web renders.
public struct IdleProjection: Equatable {
    public let batteryPercent: String
    public let rangeValue: String
    public let rangeUnit: String

    public init(batteryPercent: String, rangeValue: String, rangeUnit: String) {
        self.batteryPercent = batteryPercent
        self.rangeValue = rangeValue
        self.rangeUnit = rangeUnit
    }

    /// `{battery}% · {range} {unit}` — the single line the web idle branch renders.
    public var summary: String {
        "\(batteryPercent)% · \(rangeValue) \(rangeUnit)"
    }
}

// MARK: - Projection

/// The fully-projected widget content. The web source renders one of two bodies when a
/// vehicle state exists (the third, no-state, branch is the model's `.empty` phase):
/// the charging grid or the not-charging summary.
public enum ChargeStatusProjection: Equatable {
    case charging(ChargingProjection)
    case idle(IdleProjection)
}

/// Pure projector: `ChargeStateDTO` + `ChargeUnitPrefs` → `ChargeStatusProjection`. Every
/// value is computed with the exact same arithmetic + formatting as the web widget.
public enum ChargeStatusProjector {
    public static func project(state: ChargeStateDTO, units: ChargeUnitPrefs) -> ChargeStatusProjection {
        state.isCharging ? .charging(charging(state, units)) : .idle(idle(state, units))
    }

    /// The `is_charging` branch: `fmtNumber(charger_power)` kW, `fmtInt(convertDistanceFromSI(
    /// charge_rate ?? 0)) {unit}/h`, `{battery_level}%`, `time_to_full > 0 ? fmtNumber(_,1)+"h" : "—"`.
    private static func charging(_ state: ChargeStateDTO, _ units: ChargeUnitPrefs) -> ChargingProjection {
        let locale = units.localeIdentifier
        let symbol = units.distance.symbol

        let power = ChargeMetric(
            id: "power",
            labelKey: "widget.power",
            labelFallback: "Power",
            value: ChargeStatusFormat.number(
                state.chargerPowerKw ?? 0,
                decimals: units.decimalPrecision,
                localeIdentifier: locale
            ),
            unit: "kW",
            tone: .positive
        )

        let rateDisplay = convertChargeDistanceFromSI(state.chargeRateMetersPerHour ?? 0, to: units.distance)
        let rate = ChargeMetric(
            id: "rate",
            labelKey: "widget.rate",
            labelFallback: "Rate",
            value: ChargeStatusFormat.integer(rateDisplay, localeIdentifier: locale),
            unit: "\(symbol)/h",
            tone: .primary
        )

        let battery = ChargeMetric(
            id: "battery",
            labelKey: "widget.battery",
            labelFallback: "Battery",
            value: ChargeStatusFormat.plainInteger(state.batteryLevelPercent ?? 0),
            unit: "%",
            tone: .primary
        )

        let hours = state.timeToFullChargeHours ?? 0
        let timeValue = hours > 0
            ? "\(ChargeStatusFormat.number(hours, decimals: 1, localeIdentifier: locale))h"
            : "—"
        let timeToFull = ChargeMetric(
            id: "time-to-full",
            labelKey: "widget.timeToFull",
            labelFallback: "Time to Full",
            value: timeValue,
            unit: "",
            tone: .primary
        )

        return ChargingProjection(power: power, rate: rate, battery: battery, timeToFull: timeToFull)
    }

    /// The not-charging branch: `{battery_level}% · {fmtNumber(convertDistanceFromSI(
    /// rated_range ?? 0), 0)} {unit}`.
    private static func idle(_ state: ChargeStateDTO, _ units: ChargeUnitPrefs) -> IdleProjection {
        let rangeDisplay = convertChargeDistanceFromSI(state.ratedRangeMeters ?? 0, to: units.distance)
        return IdleProjection(
            batteryPercent: ChargeStatusFormat.plainInteger(state.batteryLevelPercent ?? 0),
            rangeValue: ChargeStatusFormat.number(rangeDisplay, decimals: 0, localeIdentifier: units.localeIdentifier),
            rangeUnit: units.distance.symbol
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum ChargeStatusAccessibility {
    /// One spoken clause per state, e.g.
    /// "Charge Status. Charging. Power 11.00 kW. Rate 30 mi/h. Battery 72 %. Time to Full 1.5h"
    /// or "Charge Status. Not Charging. 72% · 405 km".
    public static func summary(for projection: ChargeStatusProjection) -> String {
        let title = ChargeStatusStrings.string("widget.chargeStatus.title", "Charge Status")
        switch projection {
        case let .charging(charging):
            var parts = [title, ChargeStatusStrings.string("widget.charging", "Charging")]
            for metric in charging.metrics {
                parts.append("\(metric.label) \(metric.spokenValue)")
            }
            return parts.joined(separator: ". ")
        case let .idle(idle):
            let notCharging = ChargeStatusStrings.string("widget.notCharging", "Not Charging")
            return "\(title). \(notCharging). \(idle.summary)"
        }
    }
}
