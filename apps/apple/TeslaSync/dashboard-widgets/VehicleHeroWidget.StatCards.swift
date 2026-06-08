//
//  VehicleHeroWidget.StatCards.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  The context stat-grid projection (web `buildStatCards`): the driving / charging
//  / idle context cards plus the always-visible lock / sentry / firmware / power
//  cards. Pure + testable, split from the Projection core to honor the house
//  file-length budget.
//

import SwiftUI

// MARK: - Stat cards

extension VehicleHeroProjection {
    static func buildStatCards(
        state: VehicleStateInput,
        status: String,
        firmware: String,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroStatCard] {
        contextCards(state: state, status: status, prefs: prefs, localize: localize)
            + alwaysCards(state: state, firmware: firmware, prefs: prefs, localize: localize)
    }

    private static func contextCards(
        state: VehicleStateInput,
        status: String,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroStatCard] {
        if status == "driving" || state.speedMps > 0 {
            return drivingCards(state: state, prefs: prefs, localize: localize)
        } else if state.isCharging {
            return chargingCards(state: state, prefs: prefs, localize: localize)
        }
        return idleCards(state: state, prefs: prefs, localize: localize)
    }

    private static func drivingCards(
        state: VehicleStateInput,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroStatCard] {
        let speed = VehicleHeroConvert.speed(state.speedMps, prefs.speedUnit)
        return [
            card(
                "ctx-speed",
                "gauge.medium",
                localize("hero.speed", "Speed"),
                "\(VehicleHeroFormat.number(speed, decimals: 0, locale: prefs.locale)) \(prefs.speedUnit)",
                VehicleHeroPalette.purple
            ),
            powerCard(state.powerKw, prefs: prefs, localize: localize, id: "ctx-power"),
            odometerCard(state: state, prefs: prefs, localize: localize, id: "ctx-odometer"),
            idealRangeCard(state: state, prefs: prefs, localize: localize, id: "ctx-ideal")
        ]
    }

    private static func chargingCards(
        state: VehicleStateInput,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroStatCard] {
        let rate = VehicleHeroConvert.distance(state.chargeRateMph ?? 0, prefs.distanceUnit)
        let ttf = state.timeToFullChargeH
        let rateText = "\(VehicleHeroFormat.int(rate, locale: prefs.locale)) \(prefs.distanceUnit)/h"
        return [
            card(
                "ctx-rate",
                "bolt.fill",
                localize("hero.chargeRateLong", "Charge Rate"),
                rateText,
                VehicleHeroPalette.green
            ),
            card(
                "ctx-ttf",
                "clock.fill",
                localize("hero.timeToFull", "Time to Full"),
                ttf > 0 ? "\(VehicleHeroFormat.number(ttf, decimals: 1, locale: prefs.locale))h" : "—",
                VehicleHeroPalette.amber
            ),
            idealRangeCard(state: state, prefs: prefs, localize: localize, id: "ctx-ideal"),
            odometerCard(state: state, prefs: prefs, localize: localize, id: "ctx-odometer")
        ]
    }

    private static func idleCards(
        state: VehicleStateInput,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroStatCard] {
        [
            tempCard(
                "ctx-inside",
                localize("hero.inside", "Inside"),
                state.insideTempC,
                VehicleHeroPalette.orange,
                prefs: prefs
            ),
            tempCard(
                "ctx-outside",
                localize("hero.outside", "Outside"),
                state.outsideTempC,
                VehicleHeroPalette.blue,
                prefs: prefs
            ),
            odometerCard(state: state, prefs: prefs, localize: localize, id: "ctx-odometer"),
            idealRangeCard(state: state, prefs: prefs, localize: localize, id: "ctx-ideal")
        ]
    }

    private static func alwaysCards(
        state: VehicleStateInput,
        firmware: String,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroStatCard] {
        [
            card(
                "always-status",
                state.isLocked ? "lock.fill" : "lock.open.fill",
                localize("common.status", "Status"),
                state.isLocked ? localize("common.locked", "Locked") : localize("common.unlocked", "Unlocked"),
                state.isLocked ? VehicleHeroPalette.green : VehicleHeroPalette.amber
            ),
            card(
                "always-sentry",
                "shield.fill",
                localize("common.sentry", "Sentry"),
                state.sentryMode ? localize("common.active", "Active") : localize("common.off", "Off"),
                state.sentryMode ? VehicleHeroPalette.red : VehicleHeroPalette.slate
            ),
            card(
                "always-firmware",
                "gauge.medium",
                localize("hero.firmware", "Firmware"),
                firmware,
                VehicleHeroPalette.indigo
            ),
            powerCard(state.powerKw, prefs: prefs, localize: localize, id: "always-power")
        ]
    }
}

// MARK: - Stat-card helpers

extension VehicleHeroProjection {
    private static func card(
        _ id: String, _ image: String, _ label: String, _ value: String, _ color: Color
    ) -> VehicleHeroStatCard {
        VehicleHeroStatCard(id: id, systemImage: image, label: label, value: value, color: color)
    }

    /// Web power tint: `power > 0 ? amber : power < 0 ? green : slate`.
    static func powerColor(_ power: Double) -> Color {
        if power > 0 { return VehicleHeroPalette.amber }
        if power < 0 { return VehicleHeroPalette.green }
        return VehicleHeroPalette.slate
    }

    private static func powerCard(
        _ power: Double, prefs: UnitDisplayPrefs, localize: (String, String) -> String, id: String
    ) -> VehicleHeroStatCard {
        card(
            id,
            "bolt.fill",
            localize("hero.power", "Power"),
            "\(VehicleHeroFormat.number(power, decimals: prefs.precision, locale: prefs.locale)) kW",
            powerColor(power)
        )
    }

    private static func odometerCard(
        state: VehicleStateInput, prefs: UnitDisplayPrefs, localize: (String, String) -> String, id: String
    ) -> VehicleHeroStatCard {
        let value = VehicleHeroConvert.distance(state.odometerM, prefs.distanceUnit)
        let text = "\(VehicleHeroFormat.int(value, locale: prefs.locale)) \(prefs.distanceUnit)"
        return card(id, "location.north.fill", localize("hero.odometer", "Odometer"), text, VehicleHeroPalette.purple)
    }

    private static func idealRangeCard(
        state: VehicleStateInput, prefs: UnitDisplayPrefs, localize: (String, String) -> String, id: String
    ) -> VehicleHeroStatCard {
        let value = VehicleHeroConvert.distance(state.idealRangeM, prefs.distanceUnit)
        return card(
            id,
            "waveform.path.ecg",
            localize("hero.idealRange", "Ideal Range"),
            "\(VehicleHeroFormat.number(value, decimals: 0, locale: prefs.locale)) \(prefs.distanceUnit)",
            VehicleHeroPalette.cyan
        )
    }

    private static func tempCard(
        _ id: String, _ label: String, _ celsius: Double?, _ color: Color, prefs: UnitDisplayPrefs
    ) -> VehicleHeroStatCard {
        let value: String
        if let celsius {
            let display = VehicleHeroConvert.temperature(celsius, prefs.tempUnit)
            value = "\(VehicleHeroFormat.number(display, decimals: 1, locale: prefs.locale))\(prefs.tempUnit)"
        } else {
            value = "—"
        }
        return card(id, "thermometer.medium", label, value, color)
    }
}
