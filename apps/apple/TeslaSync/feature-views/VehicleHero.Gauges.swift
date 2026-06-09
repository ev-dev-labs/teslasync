//
//  VehicleHero.Gauges.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The context-aware radial-gauge set and the charging summary — the native port of
//  the web `<RadialGauge>` block and the `is_charging` detail. Pure + SwiftUI-free; the
//  gauges are built directly so the view renders a pure function of these values.
//

import Foundation

// MARK: - Context-aware radial gauge (web `RadialGauge`, value + unit centre)

/// One resolved radial gauge — the native mirror of a web `<RadialGauge>` instance.
/// `valueText` is the pre-formatted centre number, `unit` its suffix, and `fraction`
/// the clamped fill (web `clamped / max`). Colour comes from `accent`.
public struct VehicleHeroPanelGauge: Identifiable, Equatable, Sendable {
    public enum Kind: String, Sendable {
        case battery
        case range
        case speed
        case power
        case inside
        case outside
    }

    public let kind: Kind
    public let labelKey: String
    public let labelFallback: String
    public let valueText: String
    public let unit: String
    public let fraction: Double
    public let accent: VehicleHeroPanelAccent

    public var id: String {
        kind.rawValue
    }

    public init(
        kind: Kind,
        labelKey: String,
        labelFallback: String,
        valueText: String,
        unit: String,
        fraction: Double,
        accent: VehicleHeroPanelAccent
    ) {
        self.kind = kind
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueText = valueText
        self.unit = unit
        self.fraction = fraction
        self.accent = accent
    }
}

/// Builds the context-aware gauge set — battery + range always, speed while driving,
/// power while charging, then inside + outside (web gauge block order).
public enum VehicleHeroPanelGauges {
    public static func gauges(
        for state: VehicleHeroPanelState,
        system: VehicleHeroPanelUnitSystem,
        locale: Locale = .current
    ) -> [VehicleHeroPanelGauge] {
        var gauges = [battery(state, locale), range(state, system, locale)]
        if state.isDriving {
            gauges.append(speed(state, system, locale))
        }
        if state.isCharging {
            gauges.append(power(state, locale))
        }
        gauges.append(temperature(.inside, state.insideTempC, system, locale))
        gauges.append(temperature(.outside, state.outsideTempC, system, locale))
        return gauges
    }

    private static func battery(_ state: VehicleHeroPanelState, _ locale: Locale) -> VehicleHeroPanelGauge {
        let value = state.batteryLevel
        return VehicleHeroPanelGauge(
            kind: .battery,
            labelKey: "hero.battery",
            labelFallback: "Battery",
            valueText: VehicleHeroPanelFormat.gauge(value, locale: locale),
            unit: "%",
            fraction: clampFraction(value, 100),
            accent: value > 50 ? .battery : .batteryLow
        )
    }

    private static func range(
        _ state: VehicleHeroPanelState,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> VehicleHeroPanelGauge {
        let value = VehicleHeroPanelUnits.distance(state.ratedRangeMeters, system).rounded()
        return VehicleHeroPanelGauge(
            kind: .range,
            labelKey: "hero.range",
            labelFallback: "Range",
            valueText: VehicleHeroPanelFormat.gauge(value, locale: locale),
            unit: system.distanceUnit,
            fraction: clampFraction(value, 600),
            accent: .range
        )
    }

    private static func speed(
        _ state: VehicleHeroPanelState,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> VehicleHeroPanelGauge {
        let value = VehicleHeroPanelUnits.speed(state.speedMps, system).rounded()
        return VehicleHeroPanelGauge(
            kind: .speed,
            labelKey: "hero.speed",
            labelFallback: "Speed",
            valueText: VehicleHeroPanelFormat.gauge(value, locale: locale),
            unit: system.speedUnit,
            fraction: clampFraction(value, 250),
            accent: .speed
        )
    }

    private static func power(_ state: VehicleHeroPanelState, _ locale: Locale) -> VehicleHeroPanelGauge {
        let value = (state.chargerPowerKw ?? 0).rounded()
        return VehicleHeroPanelGauge(
            kind: .power,
            labelKey: "hero.power",
            labelFallback: "Power",
            valueText: VehicleHeroPanelFormat.gauge(value, locale: locale),
            unit: "kW",
            fraction: clampFraction(value, 250),
            accent: .chargePower
        )
    }

    private static func temperature(
        _ kind: VehicleHeroPanelGauge.Kind,
        _ celsius: Double?,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> VehicleHeroPanelGauge {
        let isInside = kind == .inside
        let value = VehicleHeroPanelUnits.temperature(celsius ?? 0, system).rounded()
        return VehicleHeroPanelGauge(
            kind: kind,
            labelKey: isInside ? "hero.inside" : "hero.outside",
            labelFallback: isInside ? "Inside" : "Outside",
            valueText: VehicleHeroPanelFormat.gauge(value, locale: locale),
            unit: system.temperatureUnit,
            fraction: clampFraction(value, system.isFahrenheit ? 122 : 50),
            accent: isInside ? .tempInside : .tempOutside
        )
    }

    /// Web `(clamped / max)` with `clamped = max(0, min(value, max))`, guarded for the
    /// non-finite / non-positive-max branch (renders an empty ring).
    static func clampFraction(_ value: Double, _ max: Double) -> Double {
        guard value.isFinite, max > 0 else { return 0 }
        let clamped = Swift.max(0, Swift.min(value, max))
        return clamped / max
    }
}

// MARK: - Charging summary (web `is_charging` detail block)

/// The charging-detail summary — power / charge rate / time-to-full plus the projected
/// completion time, shown only while charging (web `state.is_charging` block).
public struct VehicleHeroPanelChargingDetail: Equatable, Sendable {
    public let powerText: String
    public let rateText: String
    public let timeToFullText: String
    public let doneAt: Date?

    public init(powerText: String, rateText: String, timeToFullText: String, doneAt: Date?) {
        self.powerText = powerText
        self.rateText = rateText
        self.timeToFullText = timeToFullText
        self.doneAt = doneAt
    }

    /// Builds the summary from state, honouring the web `time_to_full > 0` branch for
    /// the value + the projected done-at time (`now + hours`).
    public static func make(
        from state: VehicleHeroPanelState,
        system: VehicleHeroPanelUnitSystem,
        now: Date,
        locale: Locale = .current
    ) -> VehicleHeroPanelChargingDetail {
        let hours = state.timeToFullHours
        let hasETA = hours > 0
        let rate = VehicleHeroPanelUnits.distance(state.chargeRateMeters ?? 0, system)
        return VehicleHeroPanelChargingDetail(
            powerText: VehicleHeroPanelFormat.number(state.chargerPowerKw ?? 0, locale: locale) + " kW",
            rateText: VehicleHeroPanelFormat.int(rate, locale: locale) + " " + system.distanceUnit + "/h",
            timeToFullText: hasETA
                ? VehicleHeroPanelFormat.number(hours, decimals: 1, locale: locale) + "h"
                : VehicleHeroPanelFormat.dash,
            doneAt: hasETA ? now.addingTimeInterval(hours * 3600) : nil
        )
    }
}
