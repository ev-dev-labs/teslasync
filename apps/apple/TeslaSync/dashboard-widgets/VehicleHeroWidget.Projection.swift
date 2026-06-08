//
//  VehicleHeroWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  The view-ready projections built from the cached SI inputs: the context-aware
//  radial-gauge list, the charging-detail block, and the context stat-grid (web
//  `VehicleHero`'s gauge array + `buildStatCards` + the charging panel). All pure +
//  testable: the same numbers the web renders, computed once here and switched over
//  by the SwiftUI views.
//

import SwiftUI

// MARK: - Gauge spec (web `RadialGauge`)

/// One radial gauge — value/max/unit/color, the pre-formatted value text, and the
/// clamped 0…1 arc fraction (web `RadialGauge` clamps value into `0…max`).
public struct VehicleHeroGauge: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let valueText: String
    public let unit: String
    public let fraction: Double
    public let color: Color
    public let accessibilityValue: String
}

// MARK: - Charging detail (web `is_charging` panel)

/// The charging-detail block shown only while charging (web `state.is_charging`).
public struct VehicleHeroChargingDetail: Equatable {
    public let powerText: String
    public let rateText: String
    public let timeToFullText: String
    /// Hours until full when > 0 (the view renders the wall-clock "Done ~hh:mm").
    public let doneInHours: Double?
}

// MARK: - Stat card (web `buildStatCards`)

/// One stat-grid cell — SF Symbol + localized label + value + tint (web stat card).
public struct VehicleHeroStatCard: Identifiable, Equatable {
    public let id: String
    public let systemImage: String
    public let label: String
    public let value: String
    public let color: Color
}

// MARK: - Projection

/// The full view model the hero renders, projected from the cached vehicle + SI
/// state + unit prefs. `hasState == false` is the web "asleep" branch (gauges /
/// charging / cards are empty; the view shows the wake panel instead).
public struct VehicleHeroProjection: Equatable {
    public let vehicleId: Int64
    public let title: String
    public let subtitle: String
    public let status: VehicleHeroStatusVisual
    public let batteryText: String
    public let hasState: Bool
    public let gauges: [VehicleHeroGauge]
    public let charging: VehicleHeroChargingDetail?
    public let statCards: [VehicleHeroStatCard]
    public let accessibilitySummary: String

    public static func build(
        vehicle: VehicleInput,
        state: VehicleStateInput?,
        firmware: String,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> VehicleHeroProjection {
        let statusKey = state?.state ?? "offline"
        let status = VehicleHeroStatusCatalog.visual(for: statusKey, localize: localize)
        let title = vehicle.displayName.isEmpty ? vehicle.vin : vehicle.displayName
        let gauges = state.map { buildGauges(state: $0, status: statusKey, prefs: prefs, localize: localize) } ?? []
        let battery = gauges.first?.valueText ?? "—"
        return VehicleHeroProjection(
            vehicleId: vehicle.id,
            title: title,
            subtitle: subtitle(for: vehicle),
            status: status,
            batteryText: battery,
            hasState: state != nil,
            gauges: gauges,
            charging: state.flatMap { chargingDetail(state: $0, prefs: prefs) },
            statCards: state.map {
                buildStatCards(state: $0, status: statusKey, firmware: firmware, prefs: prefs, localize: localize)
            } ?? [],
            accessibilitySummary: summary(
                title: title, status: status, battery: battery, hasState: state != nil, localize: localize
            )
        )
    }
}

// MARK: - Header helpers

extension VehicleHeroProjection {
    /// Web `{model} {trim_badging} · {vin}` with empty parts dropped.
    static func subtitle(for vehicle: VehicleInput) -> String {
        let lead = [vehicle.model, vehicle.trimBadging]
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return lead.isEmpty ? vehicle.vin : "\(lead) · \(vehicle.vin)"
    }

    static func summary(
        title: String,
        status: VehicleHeroStatusVisual,
        battery: String,
        hasState: Bool,
        localize: (String, String) -> String
    ) -> String {
        guard hasState else { return "\(title). \(status.label)" }
        return VehicleHeroAccessibility.headerSummary(
            name: title,
            stateLabel: status.label,
            batteryText: battery,
            percentWord: localize("hero.a11y.percent", "percent")
        )
    }
}

// MARK: - Gauges

extension VehicleHeroProjection {
    static func buildGauges(
        state: VehicleStateInput,
        status: String,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroGauge] {
        let tempMax: Double = prefs.isFahrenheit ? 122 : 50
        let batteryColor = state.batteryLevel > 50 ? VehicleHeroPalette.green : VehicleHeroPalette.amber
        var gauges = [
            gauge(GaugeBuild(
                id: "battery", label: localize("hero.battery", "Battery"), rawValue: state.batteryLevel,
                maxValue: 100, unit: "%", color: batteryColor, decimals: nil
            ), prefs: prefs),
            gauge(GaugeBuild(
                id: "range", label: localize("hero.range", "Range"),
                rawValue: VehicleHeroConvert.distance(state.ratedRangeM, prefs.distanceUnit).rounded(),
                maxValue: 600, unit: prefs.distanceUnit, color: VehicleHeroPalette.cyan, decimals: 0
            ), prefs: prefs)
        ]
        if status == "driving" || state.speedMps > 0 {
            gauges.append(gauge(GaugeBuild(
                id: "speed", label: localize("hero.speed", "Speed"),
                rawValue: VehicleHeroConvert.speed(state.speedMps, prefs.speedUnit).rounded(),
                maxValue: 250, unit: prefs.speedUnit, color: VehicleHeroPalette.purple, decimals: 0
            ), prefs: prefs))
        }
        if state.isCharging {
            gauges.append(gauge(GaugeBuild(
                id: "power", label: localize("hero.power", "Power"), rawValue: state.chargerPowerKw.rounded(),
                maxValue: 250, unit: "kW", color: VehicleHeroPalette.green, decimals: 0
            ), prefs: prefs))
        }
        gauges.append(contentsOf: tempGauges(state: state, tempMax: tempMax, prefs: prefs, localize: localize))
        return gauges
    }

    private static func tempGauges(
        state: VehicleStateInput,
        tempMax: Double,
        prefs: UnitDisplayPrefs,
        localize: (String, String) -> String
    ) -> [VehicleHeroGauge] {
        [
            gauge(GaugeBuild(
                id: "inside", label: localize("hero.inside", "Inside"),
                rawValue: VehicleHeroConvert.temperature(state.insideTempC ?? 0, prefs.tempUnit).rounded(),
                maxValue: tempMax, unit: prefs.tempUnit, color: VehicleHeroPalette.orange, decimals: 0
            ), prefs: prefs),
            gauge(GaugeBuild(
                id: "outside", label: localize("hero.outside", "Outside"),
                rawValue: VehicleHeroConvert.temperature(state.outsideTempC ?? 0, prefs.tempUnit).rounded(),
                maxValue: tempMax, unit: prefs.tempUnit, color: VehicleHeroPalette.blue, decimals: 0
            ), prefs: prefs)
        ]
    }

    private static func gauge(_ build: GaugeBuild, prefs: UnitDisplayPrefs) -> VehicleHeroGauge {
        let clamped = min(max(build.rawValue, 0), build.maxValue)
        let dec = build.decimals ?? (clamped.rounded() == clamped ? 0 : prefs.precision)
        let valueText = VehicleHeroFormat.number(clamped, decimals: dec, locale: prefs.locale)
        return VehicleHeroGauge(
            id: build.id,
            label: build.label,
            valueText: valueText,
            unit: build.unit,
            fraction: build.maxValue > 0 ? clamped / build.maxValue : 0,
            color: build.color,
            accessibilityValue: VehicleHeroAccessibility.gaugeValue(
                label: build.label, valueText: valueText, unit: build.unit
            )
        )
    }
}

/// The inputs for one gauge, bundled so the builder stays within the parameter
/// budget (`decimals == nil` applies the web `RadialGauge` integer-or-precision rule).
private struct GaugeBuild {
    let id: String
    let label: String
    let rawValue: Double
    let maxValue: Double
    let unit: String
    let color: Color
    var decimals: Int?
}

// MARK: - Charging detail

extension VehicleHeroProjection {
    static func chargingDetail(state: VehicleStateInput, prefs: UnitDisplayPrefs) -> VehicleHeroChargingDetail? {
        guard state.isCharging else { return nil }
        let rate = VehicleHeroConvert.distance(state.chargeRateMph ?? 0, prefs.distanceUnit)
        let ttf = state.timeToFullChargeH
        let power = VehicleHeroFormat.number(state.chargerPowerKw, decimals: prefs.precision, locale: prefs.locale)
        return VehicleHeroChargingDetail(
            powerText: "\(power) kW",
            rateText: "\(VehicleHeroFormat.int(rate, locale: prefs.locale)) \(prefs.distanceUnit)/h",
            timeToFullText: ttf > 0 ? "\(VehicleHeroFormat.number(ttf, decimals: 1, locale: prefs.locale))h" : "—",
            doneInHours: ttf > 0 ? ttf : nil
        )
    }
}
