//
//  VehicleHero.Stats.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The context-aware stat grid — the native port of the web `buildStatCards`. Pure +
//  SwiftUI-free; cards are built directly so the view renders a pure function of them.
//

import Foundation

// MARK: - Stat card model (web `StatItem`)

/// One context-aware stat card — the native mirror of the web `StatItem`. The label is
/// an i18n key + fallback; the value is either a pre-formatted measurement or its own
/// i18n key (lock / sentry words), both resolved in the view.
public struct VehicleHeroPanelStatCard: Identifiable, Equatable, Sendable {
    /// The card value — a verbatim measurement, or a localized word (web lock/sentry).
    public enum Value: Equatable, Sendable {
        case text(String)
        case localized(key: String, fallback: String)
    }

    public let id: String
    public let icon: String
    public let labelKey: String
    public let labelFallback: String
    public let value: Value
    public let accent: VehicleHeroPanelAccent

    public init(
        id: String,
        icon: String,
        labelKey: String,
        labelFallback: String,
        value: Value,
        accent: VehicleHeroPanelAccent
    ) {
        self.id = id
        self.icon = icon
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.accent = accent
    }
}

// MARK: - Stat grid builder (web `buildStatCards`)

/// Builds the context-aware stat grid — a driving / charging / idle leading group, then
/// the four always-visible cards (status · sentry · firmware · power).
public enum VehicleHeroPanelStats {
    public static func cards(
        for state: VehicleHeroPanelState,
        firmware: String,
        system: VehicleHeroPanelUnitSystem,
        locale: Locale = .current
    ) -> [VehicleHeroPanelStatCard] {
        leadingCards(state, system, locale) + alwaysVisibleCards(state, firmware, locale)
    }

    private static func leadingCards(
        _ state: VehicleHeroPanelState,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> [VehicleHeroPanelStatCard] {
        if state.isDriving {
            return [
                speedCard(state, system, locale),
                powerCard(state, "power-lead", locale),
                odometerCard(state, system, locale),
                idealRangeCard(state, system, locale)
            ]
        }
        if state.isCharging {
            return [
                chargeRateCard(state, system, locale),
                timeToFullCard(state, locale),
                idealRangeCard(state, system, locale),
                odometerCard(state, system, locale)
            ]
        }
        return [
            tempCard(inside: true, celsius: state.insideTempC, system: system, locale: locale),
            tempCard(inside: false, celsius: state.outsideTempC, system: system, locale: locale),
            odometerCard(state, system, locale),
            idealRangeCard(state, system, locale)
        ]
    }

    private static func alwaysVisibleCards(
        _ state: VehicleHeroPanelState,
        _ firmware: String,
        _ locale: Locale
    ) -> [VehicleHeroPanelStatCard] {
        [
            statusCard(state),
            sentryCard(state),
            firmwareCard(firmware),
            powerCard(state, "power-fixed", locale)
        ]
    }

    // MARK: Card builders (direct construction; the init is param-count exempt)

    private static func speedCard(
        _ state: VehicleHeroPanelState,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> VehicleHeroPanelStatCard {
        let value = VehicleHeroPanelFormat.measurement(
            VehicleHeroPanelUnits.speed(state.speedMps, system), 0, system.speedUnit, locale
        )
        return VehicleHeroPanelStatCard(
            id: "speed", icon: VehicleHeroPanelIcon.gauge, labelKey: "hero.speed", labelFallback: "Speed",
            value: .text(value), accent: .speed
        )
    }

    private static func powerCard(
        _ state: VehicleHeroPanelState,
        _ id: String,
        _ locale: Locale
    ) -> VehicleHeroPanelStatCard {
        let value = VehicleHeroPanelFormat.number(state.powerKw, locale: locale) + " kW"
        return VehicleHeroPanelStatCard(
            id: id, icon: VehicleHeroPanelIcon.zap, labelKey: "hero.power", labelFallback: "Power",
            value: .text(value), accent: powerAccent(state.powerKw)
        )
    }

    private static func odometerCard(
        _ state: VehicleHeroPanelState,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> VehicleHeroPanelStatCard {
        let value = VehicleHeroPanelFormat.measurement(
            VehicleHeroPanelUnits.distance(state.odometerMeters, system), nil, system.distanceUnit, locale
        )
        return VehicleHeroPanelStatCard(
            id: "odometer", icon: VehicleHeroPanelIcon.navigation, labelKey: "hero.odometer", labelFallback: "Odometer",
            value: .text(value), accent: .odometer
        )
    }

    private static func idealRangeCard(
        _ state: VehicleHeroPanelState,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> VehicleHeroPanelStatCard {
        let value = VehicleHeroPanelFormat.measurement(
            VehicleHeroPanelUnits.distance(state.idealRangeMeters, system), 0, system.distanceUnit, locale
        )
        return VehicleHeroPanelStatCard(
            id: "idealRange", icon: VehicleHeroPanelIcon.activity, labelKey: "hero.idealRange",
            labelFallback: "Ideal Range",
            value: .text(value), accent: .idealRange
        )
    }

    private static func chargeRateCard(
        _ state: VehicleHeroPanelState,
        _ system: VehicleHeroPanelUnitSystem,
        _ locale: Locale
    ) -> VehicleHeroPanelStatCard {
        let rate = VehicleHeroPanelUnits.distance(state.chargeRateMeters ?? 0, system)
        let value = VehicleHeroPanelFormat.int(rate, locale: locale) + " " + system.distanceUnit + "/h"
        return VehicleHeroPanelStatCard(
            id: "chargeRate", icon: VehicleHeroPanelIcon.zap, labelKey: "hero.statChargeRate",
            labelFallback: "Charge Rate",
            value: .text(value), accent: .chargeRate
        )
    }

    private static func timeToFullCard(_ state: VehicleHeroPanelState, _ locale: Locale) -> VehicleHeroPanelStatCard {
        let value = state.timeToFullHours > 0
            ? VehicleHeroPanelFormat.number(state.timeToFullHours, decimals: 1, locale: locale) + "h"
            : VehicleHeroPanelFormat.dash
        return VehicleHeroPanelStatCard(
            id: "timeToFull", icon: VehicleHeroPanelIcon.clock, labelKey: "hero.timeToFull",
            labelFallback: "Time to Full",
            value: .text(value), accent: .timeToFull
        )
    }

    private static func tempCard(
        inside: Bool,
        celsius: Double?,
        system: VehicleHeroPanelUnitSystem,
        locale: Locale
    ) -> VehicleHeroPanelStatCard {
        let value: String = if let celsius {
            VehicleHeroPanelFormat.number(
                VehicleHeroPanelUnits.temperature(celsius, system), decimals: 1, locale: locale
            ) + system.temperatureUnit
        } else {
            VehicleHeroPanelFormat.dash
        }
        return VehicleHeroPanelStatCard(
            id: inside ? "inside" : "outside",
            icon: VehicleHeroPanelIcon.thermometer,
            labelKey: inside ? "hero.inside" : "hero.outside",
            labelFallback: inside ? "Inside" : "Outside",
            value: .text(value),
            accent: inside ? .tempInside : .tempOutside
        )
    }

    private static func statusCard(_ state: VehicleHeroPanelState) -> VehicleHeroPanelStatCard {
        VehicleHeroPanelStatCard(
            id: "status",
            icon: state.isLocked ? VehicleHeroPanelIcon.lock : VehicleHeroPanelIcon.unlock,
            labelKey: "common.status",
            labelFallback: "Status",
            value: state.isLocked
                ? .localized(key: "common.locked", fallback: "Locked")
                : .localized(key: "common.unlocked", fallback: "Unlocked"),
            accent: state.isLocked ? .locked : .unlocked
        )
    }

    private static func sentryCard(_ state: VehicleHeroPanelState) -> VehicleHeroPanelStatCard {
        VehicleHeroPanelStatCard(
            id: "sentry",
            icon: VehicleHeroPanelIcon.shield,
            labelKey: "common.sentry",
            labelFallback: "Sentry",
            value: state.sentryMode
                ? .localized(key: "common.active", fallback: "Active")
                : .localized(key: "common.off", fallback: "Off"),
            accent: state.sentryMode ? .sentryOn : .sentryOff
        )
    }

    private static func firmwareCard(_ firmware: String) -> VehicleHeroPanelStatCard {
        VehicleHeroPanelStatCard(
            id: "firmware",
            icon: VehicleHeroPanelIcon.gauge,
            labelKey: "hero.firmware",
            labelFallback: "Firmware",
            value: .text(firmware.isEmpty ? VehicleHeroPanelFormat.dash : firmware),
            accent: .firmware
        )
    }

    /// Web `power > 0 ? amber : power < 0 ? green : grey` — the regen / draw / idle tone.
    static func powerAccent(_ kilowatts: Double) -> VehicleHeroPanelAccent {
        if kilowatts > 0 { return .power }
        if kilowatts < 0 { return .powerRegen }
        return .powerIdle
    }
}
