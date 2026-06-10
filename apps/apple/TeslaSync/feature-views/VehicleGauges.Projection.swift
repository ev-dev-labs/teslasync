//
//  VehicleGauges.Projection.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The pure content projection for the vehicle-detail gauges cluster — the native port of
//  the web component's JSX (the car visualization, the four `RadialGauge`s, the two-or-three
//  `MetricBar`s, and the four status chips) built from a vehicle state + vehicle + the active
//  unit preferences, in web source order. Split out of the adapter to keep each file focused
//  and each function inside the lint budget; it depends only on `VehicleGaugesFormat`, the
//  tint rules, and the unit types, so the gauge value/max pairing, the bar fractions, the
//  charge-rate conditional, and the chip wording stay unit tested without a store or a view.
//

import Foundation

// MARK: - One radial gauge (web `<RadialGauge>`)

/// One resolved radial gauge — the native mirror of a web `<RadialGauge value max label unit
/// color>`. The centre value is pre-formatted and the fill `fraction` pre-clamped so the view
/// is a pure function of this model. The label is carried as i18n key + English fallback.
public struct VehicleGaugesGauge: Identifiable, Sendable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let valueText: String
    public let unit: String
    public let fraction: Double
    public let tint: VehicleGaugesTint

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        valueText: String,
        unit: String,
        fraction: Double,
        tint: VehicleGaugesTint
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.valueText = valueText
        self.unit = unit
        self.fraction = fraction
        self.tint = tint
    }
}

// MARK: - One metric bar (web `<MetricBar>`)

/// One resolved metric bar — the native mirror of a web `<MetricBar value max color label
/// sublabel>`. The fill `fraction` is pre-clamped to `0...1` and the trailing readout
/// pre-formatted (web `sublabel`); the label is carried as i18n key + English fallback.
public struct VehicleGaugesBar: Identifiable, Sendable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let sublabel: String
    public let fraction: Double
    public let tint: VehicleGaugesTint

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        sublabel: String,
        fraction: Double,
        tint: VehicleGaugesTint
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.sublabel = sublabel
        self.fraction = fraction
        self.tint = tint
    }
}

// MARK: - One status chip (web quick-info chip)

/// One resolved status chip — the native mirror of a web quick-info chip (icon + tinted
/// label). Either a localized `labelKey`/`labelFallback` pair (lock / sentry / climate) or a
/// `verbatim` value (the software version) is set; the view renders whichever is present.
public struct VehicleGaugesChip: Identifiable, Sendable, Equatable {
    public let id: String
    public let iconSystemName: String
    public let tint: VehicleGaugesTint
    public let labelKey: String?
    public let labelFallback: String?
    public let verbatim: String?

    public init(
        id: String,
        iconSystemName: String,
        tint: VehicleGaugesTint,
        labelKey: String? = nil,
        labelFallback: String? = nil,
        verbatim: String? = nil
    ) {
        self.id = id
        self.iconSystemName = iconSystemName
        self.tint = tint
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.verbatim = verbatim
    }
}

// MARK: - Car visualization model (web `<TeslaCarViz>`)

/// The resolved inputs for the car visualization — the native mirror of the web
/// `<TeslaCarViz batteryLevel isCharging isLocked isClimateOn sentryMode speed model>`. The
/// battery fill `fraction` + `batteryText` + `batteryTint` are pre-computed so the view stays
/// a pure function of this value.
public struct VehicleGaugesCarVizModel: Sendable, Equatable {
    public let modelKey: VehicleGaugesModelKey
    public let batteryFraction: Double
    public let batteryText: String
    public let batteryTint: VehicleGaugesTint
    public let isCharging: Bool
    public let isLocked: Bool
    public let isClimateOn: Bool
    public let sentryMode: Bool
    public let isMoving: Bool
}

// MARK: - The resolved content bundle

/// The full resolved render — the car viz, the four gauges, the two-or-three bars, and the
/// four chips, in web source order. The view switches on this; nothing here renders.
public struct VehicleGaugesContent: Sendable, Equatable {
    public let carViz: VehicleGaugesCarVizModel
    public let gauges: [VehicleGaugesGauge]
    public let bars: [VehicleGaugesBar]
    public let chips: [VehicleGaugesChip]
}

// MARK: - Content projection (web render, in source order)

/// Builds the resolved content from a vehicle state + vehicle + the active unit preferences —
/// the native port of the web component's render. Pure + public so the gauge/bar/chip values
/// and the charge-rate conditional are unit tested without a view.
public enum VehicleGaugesContentProjection {
    public static func build(
        state: VehicleGaugesState,
        vehicle: VehicleGaugesVehicle?,
        units: VehicleGaugesUnits
    ) -> VehicleGaugesContent {
        VehicleGaugesContent(
            carViz: carViz(state, vehicle: vehicle, units: units),
            gauges: gauges(state, units: units),
            bars: bars(state, units: units),
            chips: chips(state)
        )
    }

    /// Clamp a fill ratio to `0...1` (web `Math.min(value / max, 100%)` plus a non-negative floor).
    static func fraction(_ value: Double, _ max: Double) -> Double {
        guard max > 0, value.isFinite else { return 0 }
        return Swift.min(Swift.max(value / max, 0), 1)
    }

    private static func clamp(_ value: Double, _ max: Double) -> Double {
        Swift.min(Swift.max(value, 0), max)
    }
}

// MARK: - Car viz

private extension VehicleGaugesContentProjection {
    static func carViz(
        _ state: VehicleGaugesState,
        vehicle: VehicleGaugesVehicle?,
        units: VehicleGaugesUnits
    ) -> VehicleGaugesCarVizModel {
        VehicleGaugesCarVizModel(
            modelKey: VehicleGaugesModelKey.parse(vehicle?.model),
            batteryFraction: fraction(state.batteryLevel, 100),
            batteryText: "\(VehicleGaugesFormat.fmtNumber(state.batteryLevel, decimals: 0, locale: units.locale))%",
            batteryTint: VehicleGaugesTintRules.battery(level: state.batteryLevel),
            isCharging: state.isCharging,
            isLocked: state.isLocked,
            isClimateOn: state.isClimateOn,
            sentryMode: state.sentryMode,
            isMoving: state.isMoving
        )
    }
}

// MARK: - Gauges (web order: Battery, Range, Speed, Power)

private extension VehicleGaugesContentProjection {
    static func gauges(_ state: VehicleGaugesState, units: VehicleGaugesUnits) -> [VehicleGaugesGauge] {
        [
            batteryGauge(state, locale: units.locale),
            rangeGauge(state, units: units),
            speedGauge(state, units: units),
            powerGauge(state, locale: units.locale)
        ]
    }

    static func batteryGauge(_ state: VehicleGaugesState, locale: Locale) -> VehicleGaugesGauge {
        let clamped = clamp(state.batteryLevel, 100)
        return VehicleGaugesGauge(
            id: "battery",
            labelKey: "common.battery",
            labelFallback: "Battery",
            valueText: VehicleGaugesFormat.gaugeValue(clamped, locale: locale),
            unit: "%",
            fraction: fraction(state.batteryLevel, 100),
            tint: VehicleGaugesTintRules.battery(level: state.batteryLevel)
        )
    }

    static func rangeGauge(_ state: VehicleGaugesState, units: VehicleGaugesUnits) -> VehicleGaugesGauge {
        let value = VehicleGaugesFormat.convertDistance(state.ratedRange, to: units.distance).rounded()
        let max = VehicleGaugesFormat.convertDistance(VehicleGaugesFormat.maxRangeMeters, to: units.distance).rounded()
        let clamped = clamp(value, max)
        return VehicleGaugesGauge(
            id: "range",
            labelKey: "common.range",
            labelFallback: "Range",
            valueText: VehicleGaugesFormat.gaugeValue(clamped, decimals: 0, locale: units.locale),
            unit: units.distance.rawValue,
            fraction: fraction(value, max),
            tint: .accent
        )
    }

    static func speedGauge(_ state: VehicleGaugesState, units: VehicleGaugesUnits) -> VehicleGaugesGauge {
        let value = VehicleGaugesFormat.convertSpeed(state.speed, to: units.speed).rounded()
        let max = VehicleGaugesFormat.convertSpeed(VehicleGaugesFormat.maxSpeedMetersPerSecond, to: units.speed)
            .rounded()
        let clamped = clamp(value, max)
        return VehicleGaugesGauge(
            id: "speed",
            labelKey: "common.speed",
            labelFallback: "Speed",
            valueText: VehicleGaugesFormat.gaugeValue(clamped, decimals: 0, locale: units.locale),
            unit: units.speed.rawValue,
            fraction: fraction(value, max),
            tint: VehicleGaugesTintRules.speed(moving: state.isMoving)
        )
    }

    static func powerGauge(_ state: VehicleGaugesState, locale: Locale) -> VehicleGaugesGauge {
        let clamped = clamp(state.chargerPower, 250)
        return VehicleGaugesGauge(
            id: "power",
            labelKey: "common.power",
            labelFallback: "Power",
            valueText: VehicleGaugesFormat.gaugeValue(clamped, locale: locale),
            unit: "kW",
            fraction: fraction(state.chargerPower, 250),
            tint: VehicleGaugesTintRules.power(isCharging: state.isCharging)
        )
    }
}

// MARK: - Bars (web order: Battery Level, Estimated Range, [Charge Rate when charging])

private extension VehicleGaugesContentProjection {
    static func bars(_ state: VehicleGaugesState, units: VehicleGaugesUnits) -> [VehicleGaugesBar] {
        var bars = [batteryBar(state, units: units), rangeBar(state, units: units)]
        if state.isCharging {
            bars.append(chargeRateBar(state, units: units))
        }
        return bars
    }

    static func batteryBar(_ state: VehicleGaugesState, units: VehicleGaugesUnits) -> VehicleGaugesBar {
        VehicleGaugesBar(
            id: "batteryLevel",
            labelKey: "common.batteryLevel",
            labelFallback: "Battery Level",
            sublabel: "\(VehicleGaugesFormat.fmtNumber(state.batteryLevel, decimals: 0, locale: units.locale))%",
            fraction: fraction(state.batteryLevel, 100),
            tint: VehicleGaugesTintRules.battery(level: state.batteryLevel)
        )
    }

    static func rangeBar(_ state: VehicleGaugesState, units: VehicleGaugesUnits) -> VehicleGaugesBar {
        let value = VehicleGaugesFormat.convertDistance(state.ratedRange, to: units.distance)
        let max = VehicleGaugesFormat.convertDistance(VehicleGaugesFormat.maxRangeMeters, to: units.distance)
        return VehicleGaugesBar(
            id: "estimatedRange",
            labelKey: "common.estimatedRange",
            labelFallback: "Estimated Range",
            sublabel: VehicleGaugesFormat.formatDistance(
                state.ratedRange,
                unit: units.distance,
                precision: units.precision,
                locale: units.locale
            ),
            fraction: fraction(value, max),
            tint: .accent
        )
    }

    static func chargeRateBar(_ state: VehicleGaugesState, units: VehicleGaugesUnits) -> VehicleGaugesBar {
        let value = VehicleGaugesFormat.convertDistance(state.chargeRate, to: units.distance)
        let max = VehicleGaugesFormat.convertDistance(
            VehicleGaugesFormat.maxChargeRateMetersPerHour,
            to: units.distance
        )
        let distance = VehicleGaugesFormat.formatDistance(
            state.chargeRate,
            unit: units.distance,
            precision: units.precision,
            locale: units.locale
        )
        return VehicleGaugesBar(
            id: "chargeRate",
            labelKey: "common.chargeRate",
            labelFallback: "Charge Rate",
            sublabel: "\(distance)/h",
            fraction: fraction(value, max),
            tint: .success
        )
    }
}

// MARK: - Chips (web order: lock, sentry, climate, software)

private extension VehicleGaugesContentProjection {
    static func chips(_ state: VehicleGaugesState) -> [VehicleGaugesChip] {
        [
            VehicleGaugesChip(
                id: "lock",
                iconSystemName: state.isLocked ? "lock.fill" : "lock.open.fill",
                tint: VehicleGaugesTintRules.lock(isLocked: state.isLocked),
                labelKey: state.isLocked ? "common.locked" : "common.unlocked",
                labelFallback: state.isLocked ? "Locked" : "Unlocked"
            ),
            VehicleGaugesChip(
                id: "sentry",
                iconSystemName: "shield.fill",
                tint: VehicleGaugesTintRules.sentry(enabled: state.sentryMode),
                labelKey: state.sentryMode ? "common.sentryOn" : "common.sentryOff",
                labelFallback: state.sentryMode ? "Sentry ON" : "Sentry OFF"
            ),
            VehicleGaugesChip(
                id: "climate",
                iconSystemName: "wind",
                tint: VehicleGaugesTintRules.climate(enabled: state.isClimateOn),
                labelKey: state.isClimateOn ? "common.climateOn" : "common.climateOff",
                labelFallback: state.isClimateOn ? "Climate ON" : "Climate OFF"
            ),
            softwareChip(state)
        ]
    }

    /// Web `state.software_version || 'N/A'`: the version verbatim when present, else the
    /// localized not-available sentinel (routed through i18n rather than a hardcoded literal).
    static func softwareChip(_ state: VehicleGaugesState) -> VehicleGaugesChip {
        let version = state.softwareVersion?.trimmingCharacters(in: .whitespaces)
        if let version, !version.isEmpty {
            return VehicleGaugesChip(id: "software", iconSystemName: "cpu", tint: .power, verbatim: version)
        }
        return VehicleGaugesChip(
            id: "software",
            iconSystemName: "cpu",
            tint: .power,
            labelKey: "common.notAvailable",
            labelFallback: "N/A"
        )
    }
}
