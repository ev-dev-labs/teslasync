//
//  VehicleCharts.Tiles.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The two metric grids' display models — the native parity of the web
//  `vehicleConfigData` / `userPrefData` `MetricCard` arrays in
//  features/vehicles/components/VehicleCharts.tsx. Each builder reproduces its web
//  array verbatim (same tiles, same order, same value derivation: `cleanNil`
//  fallbacks, boolean → token, percentage suffixes, `parseSettingEnum`), with
//  every label + token routed through the P1/S10 facade. Pure + `Equatable`, so
//  every value branch unit-tests without a rendered grid.
//

import Foundation

// MARK: - Tile model

/// One label / value tile in a metric grid (web `<MetricCard label value />`).
/// `value` is pre-resolved (localized tokens or verbatim data) and rendered
/// verbatim by the view, so the grid holds no string keys.
public struct VehicleChartsTile: Identifiable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

// MARK: - Percentage helper (web `${pct}%`)

private enum VehicleChartsPercent {
    /// Formats a percentage the way a JS template literal does (`${num}%`): no
    /// grouping, trailing zeros trimmed (`45` → "45%", `45.5` → "45.5%").
    static func string(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 6
        let number = formatter.string(from: NSNumber(value: value)) ?? "0"
        return "\(number)%"
    }
}

// MARK: - Vehicle configuration grid

/// Builds the configuration grid tiles — a faithful port of the web
/// `vehicleConfigData` `MetricCard` array (18 tiles, in source order).
public enum VehicleChartsConfigTiles {
    public typealias Localize = (String, String) -> String

    private static func clean(_ value: String?) -> String {
        VehicleChartsCleanNil.clean(value) ?? VehicleChartsDisplay.emDash
    }

    /// The full 18-tile grid, in web source order, assembled from the focused
    /// sub-builders (kept small so each stays within the lint body-length budget).
    public static func make(
        config: VehicleChartsConfig,
        localize: Localize
    ) -> [VehicleChartsTile] {
        coreTiles(config: config, localize: localize)
            + detailTiles(config: config, localize: localize)
            + featureTiles(config: config, localize: localize)
            + softwareTiles(config: config, localize: localize)
    }

    /// Tiles 1–6: the identity fields (web `Model`…`Firmware`), all `cleanNil`.
    private static func coreTiles(config: VehicleChartsConfig, localize: Localize) -> [VehicleChartsTile] {
        [
            VehicleChartsTile(
                id: "model",
                label: localize("vehicles.config.model", "Model"),
                value: clean(config.carType)
            ),
            VehicleChartsTile(id: "trim", label: localize("vehicles.config.trim", "Trim"), value: clean(config.trim)),
            VehicleChartsTile(
                id: "color",
                label: localize("vehicles.config.color", "Color"),
                value: clean(config.exteriorColor)
            ),
            VehicleChartsTile(
                id: "roof",
                label: localize("vehicles.config.roof", "Roof"),
                value: clean(config.roofColor)
            ),
            VehicleChartsTile(
                id: "wheels",
                label: localize("vehicles.config.wheels", "Wheels"),
                value: clean(config.wheelType)
            ),
            VehicleChartsTile(
                id: "firmware",
                label: localize("vehicles.config.firmware", "Firmware"),
                value: clean(config.version)
            )
        ]
    }

    /// Tiles 7–11: the descriptive fields (web `Name`…`Sunroof`).
    private static func detailTiles(config: VehicleChartsConfig, localize: Localize) -> [VehicleChartsTile] {
        [
            VehicleChartsTile(
                id: "name",
                label: localize("vehicles.config.name", "Name"),
                value: clean(config.vehicleName)
            ),
            VehicleChartsTile(
                id: "chargePort",
                label: localize("vehicles.config.chargePort", "Charge Port"),
                value: clean(config.chargePort)
            ),
            VehicleChartsTile(
                id: "rearHeaters",
                label: localize("vehicles.config.rearHeaters", "Rear Heaters"),
                value: clean(config.rearSeatHeaters)
            ),
            VehicleChartsTile(
                id: "efficiency",
                label: localize("vehicles.config.efficiency", "Efficiency"),
                value: clean(config.efficiencyPackage)
            ),
            VehicleChartsTile(
                id: "sunroof",
                label: localize("vehicles.config.sunroof", "Sunroof"),
                value: VehicleChartsCleanNil.clean(config.sunroofInstalled)
                    ?? localize("vehicles.config.notInstalled", "Not Installed")
            )
        ]
    }

    /// Tiles 12–15: the boolean feature flags (web `Europe Vehicle`…`Offroad Lightbar`).
    private static func featureTiles(config: VehicleChartsConfig, localize: Localize) -> [VehicleChartsTile] {
        let emDash = VehicleChartsDisplay.emDash
        return [
            VehicleChartsTile(
                id: "europeVehicle",
                label: localize("vehicles.detail.europeVehicle", "Europe Vehicle"),
                value: config.europeVehicle.map { VehicleChartsLabels.yesNo($0, localize: localize) } ?? emDash
            ),
            VehicleChartsTile(
                id: "rhd",
                label: localize("vehicles.detail.rhd", "Right-Hand Drive"),
                value: config.rightHandDrive.map { VehicleChartsLabels.yesNo($0, localize: localize) } ?? emDash
            ),
            VehicleChartsTile(
                id: "remoteStart",
                label: localize("vehicles.config.remoteStart", "Remote Start"),
                value: config.remoteStartEnabled.map {
                    $0 ? localize("vehicles.config.active", "Active") : localize("vehicles.config.off", "Off")
                } ?? emDash
            ),
            VehicleChartsTile(
                id: "offroadLightbar",
                label: localize("vehicles.config.offroadLightbar", "Offroad Lightbar"),
                value: config.offroadLightbarPresent.map {
                    $0 ? localize("vehicles.config.present", "Present") : localize("common.no", "No")
                } ?? emDash
            )
        ]
    }

    /// Tiles 16–18: the software-update fields (web `SW Update`…`SW Install`).
    private static func softwareTiles(config: VehicleChartsConfig, localize: Localize) -> [VehicleChartsTile] {
        let emDash = VehicleChartsDisplay.emDash
        return [
            VehicleChartsTile(
                id: "swUpdate",
                label: localize("vehicles.config.swUpdate", "SW Update"),
                value: VehicleChartsCleanNil.clean(config.softwareUpdateVersion)
                    ?? localize("vehicles.config.none", "None")
            ),
            VehicleChartsTile(
                id: "swDownload",
                label: localize("vehicles.config.swDownload", "SW Download"),
                value: config.softwareUpdateDownloadPct.map(VehicleChartsPercent.string) ?? emDash
            ),
            VehicleChartsTile(
                id: "swInstall",
                label: localize("vehicles.config.swInstall", "SW Install"),
                value: config.softwareUpdateInstallPct.map(VehicleChartsPercent.string) ?? emDash
            )
        ]
    }
}

// MARK: - Car display preferences grid

/// Builds the preferences grid tiles — a faithful port of the web `userPrefData`
/// `MetricCard` array (5 tiles, in source order, via `parseSettingEnum`).
public enum VehicleChartsPreferenceTiles {
    public typealias Localize = (String, String) -> String

    private static func setting(
        _ value: String?,
        _ category: VehicleChartsSettingEnum.Category,
        localize: Localize
    ) -> String {
        VehicleChartsLabels.settingLabel(
            VehicleChartsSettingEnum.parse(value, category: category),
            localize: localize
        )
    }

    public static func make(
        preferences: VehicleChartsPreferences,
        localize: Localize
    ) -> [VehicleChartsTile] {
        [
            VehicleChartsTile(
                id: "distance",
                label: localize("vehicles.prefs.distance", "Distance"),
                value: setting(preferences.settingDistanceUnit, .distance, localize: localize)
            ),
            VehicleChartsTile(
                id: "temperature",
                label: localize("vehicles.prefs.temperature", "Temperature"),
                value: setting(preferences.settingTemperatureUnit, .temperature, localize: localize)
            ),
            VehicleChartsTile(
                id: "chargeUnit",
                label: localize("vehicles.prefs.chargeUnit", "Charge Unit"),
                value: setting(preferences.settingChargeUnit, .charge, localize: localize)
            ),
            VehicleChartsTile(
                id: "tirePressure",
                label: localize("vehicles.prefs.tirePressure", "Tire Pressure"),
                value: setting(preferences.settingTirePressureUnit, .pressure, localize: localize)
            ),
            VehicleChartsTile(
                id: "time24h",
                label: localize("vehicles.prefs.time24h", "24h Time"),
                value: preferences.setting24hrTime.map { VehicleChartsLabels.yesNo($0, localize: localize) }
                    ?? VehicleChartsDisplay.emDash
            )
        ]
    }
}
