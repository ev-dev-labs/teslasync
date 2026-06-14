//
//  ChargeStatusLiveWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0020 · ChargeStatusLiveWidget (Apple)
//
//  Pure (Foundation-only) projection: a cached `LiveChargeStateDTO` + latest `LiveChargeSessionDTO` +
//  `LiveChargeUnitPrefs` → display strings, reproducing the web source's numeric pipeline VERBATIM so
//  the native surface shows the exact same values as
//  features/dashboard/widgets/ChargeStatusLiveWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - SI converters (ported 1:1 from web lib/unitConversion.ts)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` — a divide by the unit's
/// metres-per-unit factor. The web widget feeds it `state.charge_rate` (range added per hour, in
/// SI METERS/h), so this is a straight SI → display conversion. Non-finite inputs collapse to 0 to
/// match the `safeNumber` guard upstream.
func convertChargeDistanceFromSI(_ meters: Double, to unit: LiveChargeDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

/// Energy converter ported 1:1 from `convertEnergyFromSI(wh, to)`. The web widget feeds it
/// `total_energy_added_wh` (SI WATT-HOURS) and always targets `'kWh'`. Non-finite inputs collapse
/// to 0 to match the `safeNumber` guard upstream.
func convertChargeEnergyFromSI(_ wh: Double, to unit: ChargeEnergyUnit) -> Double {
    let safe = wh.isFinite ? wh : 0
    switch unit {
    case .wattHours: return safe
    case .kilowattHours: return safe / 1000
    }
}

// MARK: - Formatting (ported from web lib/numberFormat.ts + the widget's local helpers)

/// Numeric + time formatting ported from the web widget. Pure so the value pipeline is pinned by
/// unit tests without rendering.
public enum LiveChargeStatusFormat {
    /// The em-dash placeholder the web widget renders for an absent metric (`'—'`). // parity:allow ui
    public static let emptyDash = "—"

    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero
    /// (`Intl.NumberFormat`'s default `halfExpand`).
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

    /// JS template-literal number rendering (`${value}`): no grouping, integers print without a
    /// decimal, fractions keep their significant digits. Used for the battery percentage, exactly
    /// as the web widget interpolates `${batteryLevel}%`.
    public static func jsNumber(_ value: Double) -> String {
        let safe = safeNumber(value)
        if safe == safe.rounded() {
            return String(format: "%.0f", safe)
        }
        var text = String(format: "%.4f", safe)
        while text.contains("."), text.hasSuffix("0") {
            text.removeLast()
        }
        if text.hasSuffix(".") {
            text.removeLast()
        }
        return text
    }

    /// `formatTime(hours)` ported VERBATIM from the web widget: `'—'` for non-positive input,
    /// otherwise `{h}h {m}m` with the hour-only / minute-only short forms.
    public static func time(hours: Double) -> String {
        let safe = safeNumber(hours)
        if safe <= 0 { return emptyDash }
        let wholeHours = Int(safe.rounded(.down))
        let minutes = Int(((safe - Double(wholeHours)) * 60).rounded())
        if wholeHours == 0 { return "\(minutes)m" }
        if minutes == 0 { return "\(wholeHours)h" }
        return "\(wholeHours)h \(minutes)m"
    }
}

// MARK: - Projected metric (web `MetricCell`)

/// One projected metric cell: an SF Symbol, a localized label, and a value string that already
/// carries its unit symbol (or the em-dash placeholder). Mirrors the web `MetricCell`. // parity:allow ui
public struct LiveChargeMetric: Identifiable, Equatable, Sendable {
    public let id: String
    public let systemImage: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public init(id: String, systemImage: String, labelKey: String, labelFallback: String, value: String) {
        self.id = id
        self.systemImage = systemImage
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        ChargeStatusLiveStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected widget content. Computed once per snapshot by the model so the view stays
/// declarative across every layout branch (compact charging / compact idle / full charging / idle).
public struct LiveChargeStatusProjection: Equatable, Sendable {
    /// `state.is_charging` — selects the charging vs idle layout family.
    public let isCharging: Bool
    /// Raw charger power in kW (`state.charger_power`), kept for the animated value + accessibility.
    public let power: Double
    /// `fmtNumber(power, 1)` — the animated numeric text for the primary power metric.
    public let powerValueText: String
    /// The power unit symbol rendered verbatim next to `powerValueText` (web `" kW"`).
    public let powerUnit: String
    /// `${battery_level}%` — the battery percentage text.
    public let batteryText: String
    /// The 2×2 charging grid: Voltage, Current, Time Left, Added (web `MetricCell` order).
    public let chargingMetrics: [LiveChargeMetric]
    /// The extra row shown only when `isTall`: Rate, Battery.
    public let tallMetrics: [LiveChargeMetric]
    /// The idle "Last Session" line (`+{kWh}`), or `nil` when there is no recorded session.
    public let lastSessionEnergyText: String?
    /// The active distance unit symbol (`km` / `mi` / `ft`).
    public let distanceSymbol: String

    public init(
        isCharging: Bool,
        power: Double,
        powerValueText: String,
        powerUnit: String,
        batteryText: String,
        chargingMetrics: [LiveChargeMetric],
        tallMetrics: [LiveChargeMetric],
        lastSessionEnergyText: String?,
        distanceSymbol: String
    ) {
        self.isCharging = isCharging
        self.power = power
        self.powerValueText = powerValueText
        self.powerUnit = powerUnit
        self.batteryText = batteryText
        self.chargingMetrics = chargingMetrics
        self.tallMetrics = tallMetrics
        self.lastSessionEnergyText = lastSessionEnergyText
        self.distanceSymbol = distanceSymbol
    }
}

/// Pure projector: `LiveChargeStateDTO` + latest `LiveChargeSessionDTO` + `LiveChargeUnitPrefs` →
/// `LiveChargeStatusProjection`. Every value is computed with the exact same arithmetic + formatting
/// as the web widget.
public enum LiveChargeStatusProjector {
    public static func project(
        state: LiveChargeStateDTO,
        session: LiveChargeSessionDTO?,
        units: LiveChargeUnitPrefs
    ) -> LiveChargeStatusProjection {
        let locale = units.localeIdentifier
        let power = state.chargerPowerKw ?? 0
        let batteryText = LiveChargeStatusFormat.jsNumber(state.batteryLevelPercent ?? 0) + "%"

        return LiveChargeStatusProjection(
            isCharging: state.isCharging,
            power: power,
            powerValueText: LiveChargeStatusFormat.number(power, decimals: 1, localeIdentifier: locale),
            powerUnit: "kW",
            batteryText: batteryText,
            chargingMetrics: chargingMetrics(state: state, session: session, locale: locale),
            tallMetrics: tallMetrics(state: state, batteryText: batteryText, units: units),
            lastSessionEnergyText: lastSessionEnergyText(session: session, locale: locale),
            distanceSymbol: units.distance.symbol
        )
    }

    /// The 2×2 charging grid (web `MetricCell` order: Voltage, Current, Time Left, Added). Voltage
    /// and current fall back to the em-dash, mirroring the web `voltage != null ? … : '—'` branch.
    private static func chargingMetrics(
        state: LiveChargeStateDTO,
        session: LiveChargeSessionDTO?,
        locale: String
    ) -> [LiveChargeMetric] {
        let energyKwh = convertChargeEnergyFromSI(session?.totalEnergyAddedWh ?? 0, to: .kilowattHours)
        let voltageValue = state.voltage
            .map { LiveChargeStatusFormat.number($0, decimals: 0, localeIdentifier: locale) + " V" }
            ?? LiveChargeStatusFormat.emptyDash
        let currentValue = state.amps
            .map { LiveChargeStatusFormat.number($0, decimals: 0, localeIdentifier: locale) + " A" }
            ?? LiveChargeStatusFormat.emptyDash
        return [
            LiveChargeMetric(
                id: "voltage",
                systemImage: "gauge.open.with.lines.needle.33percent",
                labelKey: "widget.voltage",
                labelFallback: "Voltage",
                value: voltageValue
            ),
            LiveChargeMetric(
                id: "current",
                systemImage: "bolt.fill",
                labelKey: "widget.amps",
                labelFallback: "Current",
                value: currentValue
            ),
            LiveChargeMetric(
                id: "time-left",
                systemImage: "timer",
                labelKey: "widget.timeRemaining",
                labelFallback: "Time Left",
                value: LiveChargeStatusFormat.time(hours: state.timeToFullHours ?? 0)
            ),
            LiveChargeMetric(
                id: "added",
                systemImage: "bolt.fill",
                labelKey: "widget.energyAdded",
                labelFallback: "Added",
                value: LiveChargeStatusFormat.number(energyKwh, decimals: 1, localeIdentifier: locale) + " kWh"
            )
        ]
    }

    /// The extra row shown only when `isTall` (web: Rate, Battery). `charge_rate` arrives in SI
    /// METERS/h and is converted to the user's distance unit for the `{unit}/h` display.
    private static func tallMetrics(
        state: LiveChargeStateDTO,
        batteryText: String,
        units: LiveChargeUnitPrefs
    ) -> [LiveChargeMetric] {
        let rateDisplay = convertChargeDistanceFromSI(state.chargeRateMeters ?? 0, to: units.distance)
        let rateValue = LiveChargeStatusFormat.number(
            rateDisplay,
            decimals: 0,
            localeIdentifier: units.localeIdentifier
        )
            + " " + units.distance.symbol + "/h"
        return [
            LiveChargeMetric(
                id: "rate",
                systemImage: "gauge.medium",
                labelKey: "widget.chargeRate",
                labelFallback: "Rate",
                value: rateValue
            ),
            LiveChargeMetric(
                id: "battery",
                systemImage: "battery.100.bolt",
                labelKey: "widget.batteryLevel",
                labelFallback: "Battery",
                value: batteryText
            )
        ]
    }

    /// The idle "Last Session" line (`+{kWh}`), or `nil` when there is no recorded session (web
    /// `latestSession && …`). The energy arrives in SI WATT-HOURS and is shown as kWh.
    private static func lastSessionEnergyText(session: LiveChargeSessionDTO?, locale: String) -> String? {
        session.map { recorded in
            let kwh = convertChargeEnergyFromSI(recorded.totalEnergyAddedWh ?? 0, to: .kilowattHours)
            return "+" + LiveChargeStatusFormat.number(kwh, decimals: 1, localeIdentifier: locale) + " kWh"
        }
    }
}

// MARK: - Layout (web `isCompact` / `isTall`)

/// Pure size → layout mapping, mirroring the web `isCompact = size.cols <= 1 && size.rows <= 1`
/// and `isTall = size.rows >= 2`. Kept testable + SwiftUI-free.
public enum ChargeStatusLayout {
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1 && size.rows <= 1
    }

    public static func isTall(_ size: DashboardWidgetSize) -> Bool {
        size.rows >= 2
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget body. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum LiveChargeStatusAccessibility {
    /// A spoken clause per visible datum. Charging surfaces lead with the charging state, battery
    /// and power, then each metric; idle surfaces speak the not-charging state, battery and the
    /// optional last-session energy.
    public static func summary(for projection: LiveChargeStatusProjection) -> String {
        let title = ChargeStatusLiveStrings.string("widget.chargeStatusLive", "Charge Status")
        let batteryLabel = ChargeStatusLiveStrings.string("widget.batteryLevel", "Battery")
        var parts = [title]

        if projection.isCharging {
            parts.append(ChargeStatusLiveStrings.string("widget.charging", "Charging"))
            parts.append("\(batteryLabel) \(projection.batteryText)")
            parts.append("\(projection.powerValueText) \(projection.powerUnit)")
            for metric in projection.chargingMetrics {
                parts.append("\(metric.label) \(metric.value)")
            }
            if let rate = projection.tallMetrics.first(where: { $0.id == "rate" }) {
                parts.append("\(rate.label) \(rate.value)")
            }
        } else {
            parts.append(ChargeStatusLiveStrings.string("widget.notCharging", "Not Charging"))
            parts.append("\(batteryLabel) \(projection.batteryText)")
            if let last = projection.lastSessionEnergyText {
                let lastLabel = ChargeStatusLiveStrings.string("widget.lastSession", "Last Session")
                parts.append("\(lastLabel) \(last)")
            }
        }
        return parts.joined(separator: ". ")
    }
}
