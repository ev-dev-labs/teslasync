//
//  VehicleCharts.Labels.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The pure label + VoiceOver builders the surface renders, the `{{token}}`
//  interpolation helper (native parity of i18next `t(key, { value })`), the
//  setting-enum value → localized label resolver (web `parseSettingEnum` display
//  text), and a boolean → localized label helper. Each builder takes the P1/S10
//  `localize` facade so the view holds no literals and the spoken/visible content
//  is unit-tested without rendering anything.
//

import Foundation

// MARK: - Token interpolation (web `t(key, { value })` parity)

/// Fills `{{token}}` slots in a localized template, keeping the catalog values
/// byte-identical to the web fallbacks.
public enum VehicleChartsText {
    public static func fill(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - Shared display constants

public enum VehicleChartsDisplay {
    /// The web em-dash fallback (`'—'`) — a symbol, not a localizable literal.
    public static let emDash = "—"
}

// MARK: - Visible / spoken labels (consumed by the view)

/// Builds the surface's visible + spoken strings from the `localize` facade. Each
/// builder mirrors a web `t()` call, template literal, or hardcoded label that the
/// native covenant requires be localized.
public enum VehicleChartsLabels {
    public typealias Localize = (String, String) -> String

    // MARK: Section titles (web `<h3 className="section-title">`)

    /// Web `t('common.location', 'Location')`.
    public static func locationTitle(localize: Localize) -> String {
        localize("common.location", "Location")
    }

    /// Web `t('common.vehicleConfig', 'Vehicle Configuration')`.
    public static func vehicleConfigTitle(localize: Localize) -> String {
        localize("common.vehicleConfig", "Vehicle Configuration")
    }

    /// Web `t('common.carPreferences', 'Car Display Preferences')`.
    public static func carPreferencesTitle(localize: Localize) -> String {
        localize("common.carPreferences", "Car Display Preferences")
    }

    /// Web `t('common.speedHistory', 'Speed History')`.
    public static func speedHistoryTitle(localize: Localize) -> String {
        localize("common.speedHistory", "Speed History")
    }

    /// The preferences helper copy (web paragraph under the title).
    public static func preferencesHelper(localize: Localize) -> String {
        localize(
            "vehicles.prefs.helper",
            "These are your vehicle's display settings — you can sync your app to match them from the Settings page."
        )
    }

    // MARK: Map footer + accessibility (web coordinate readout)

    /// The mono coordinate footer (web `${fmtNumber(lat)}, ${fmtNumber(lng)}`).
    public static func coordinate(
        latitude: String,
        longitude: String
    ) -> String {
        "\(latitude), \(longitude)"
    }

    /// The map container VoiceOver label.
    public static func mapAccessibility(localize: Localize) -> String {
        localize("map.label", "Vehicle location map")
    }

    /// The current-location VoiceOver readout for the map.
    public static func coordinateAccessibility(
        latitude: String,
        longitude: String,
        localize: Localize
    ) -> String {
        VehicleChartsText.fill(
            localize("map.coordinateA11y", "Current location {{lat}}, {{lng}}"),
            ["lat": latitude, "lng": longitude]
        )
    }

    /// The current-position marker label (web `vehicleIcon()` marker).
    public static func mapMarker(localize: Localize) -> String {
        localize("map.marker", "Vehicle")
    }

    // MARK: Speed chart (web Recharts axes + series)

    /// The empty-chart message (web `t('common.positionDataWillAppear', …)`).
    public static func positionDataWillAppear(localize: Localize) -> String {
        localize("common.positionDataWillAppear", "Position data will appear here")
    }

    /// The time x-axis label.
    public static func speedTimeAxis(localize: Localize) -> String {
        localize("chart.speed.axisTime", "Time")
    }

    /// The speed y-axis label, interpolating the active unit.
    public static func speedValueAxis(unit: String, localize: Localize) -> String {
        VehicleChartsText.fill(localize("chart.speed.axisSpeed", "Speed ({{unit}})"), ["unit": unit])
    }

    /// The series name (web `name={`Speed ${speedUnit}`}` → "Speed mph").
    public static func speedSeriesName(unit: String, localize: Localize) -> String {
        VehicleChartsText.fill(localize("chart.speed.series", "Speed {{unit}}"), ["unit": unit])
    }

    /// The chart container VoiceOver label.
    public static func speedChartAccessibility(localize: Localize) -> String {
        localize("chart.speed.aria", "Speed history area chart")
    }

    // MARK: Shared value tokens

    /// Web `t('common.yes', 'Yes')` / `t('common.no', 'No')`.
    public static func yesNo(_ value: Bool, localize: Localize) -> String {
        value ? localize("common.yes", "Yes") : localize("common.no", "No")
    }

    /// Resolves a parsed setting value to its localized display label (web
    /// `parseSettingEnum` output). Unknown raw values echo verbatim (data, not a
    /// literal); a missing value resolves to the em-dash.
    public static func settingLabel(
        _ value: VehicleChartsSettingValue,
        localize: Localize
    ) -> String {
        switch value {
        case .miles: localize("vehicles.units.miles", "Miles")
        case .kilometers: localize("vehicles.units.kilometers", "Kilometers")
        case .celsius: localize("vehicles.units.celsius", "Celsius")
        case .fahrenheit: localize("vehicles.units.fahrenheit", "Fahrenheit")
        case .percent: localize("vehicles.units.percent", "Percent")
        case .psi: localize("vehicles.units.psi", "PSI")
        case .bar: localize("vehicles.units.bar", "Bar")
        case .kpa: localize("vehicles.units.kpa", "kPa")
        case let .raw(original): original
        case .missing: VehicleChartsDisplay.emDash
        }
    }
}
