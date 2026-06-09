//
//  TeslaChargingSessionsMap.Labels.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The pure label + VoiceOver builders the map renders, the `{{token}}`
//  interpolation helper (native parity of i18next `t(key, { value })`), and the
//  callout display model the marker popup is built from (web `popupHtml`). Each
//  builder takes the P1/S10 `localize` facade so the view holds no literals and
//  the spoken content is unit-tested without rendering a map.
//

import Foundation

// MARK: - Token interpolation (web `t(key, { value })` parity)

/// Fills `{{token}}` slots in a localized template, keeping the catalog values
/// byte-identical to the web fallbacks.
public enum TeslaChargingSessionsMapText {
    public static func fill(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - Visible labels (consumed by the view)

/// Builds the map's visible/spoken strings from the `localize` facade. Each
/// builder mirrors a web `t()` call or template literal.
public enum TeslaChargingSessionsMapLabels {
    /// The map container label (web `aria-label={t('tesla_sessions.mapLabel', …)}`).
    public static func mapLabel(localize: (String, String) -> String) -> String {
        localize("tesla_sessions.mapLabel", "Charging sessions map")
    }

    /// The "Unknown" site fallback (web `t('tesla_sessions.unknown', 'Unknown')`).
    public static func unknownSite(localize: (String, String) -> String) -> String {
        localize("tesla_sessions.unknown", "Unknown")
    }

    /// The resolved site name — the raw value, or the localized "Unknown" fallback
    /// when it is absent/blank (web `s.site_location_name || t('…unknown', 'Unknown')`,
    /// where JS treats an empty string as falsy).
    public static func siteName(
        _ rawName: String?,
        localize: (String, String) -> String
    ) -> String {
        if let trimmed = rawName?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty {
            return trimmed
        }
        return unknownSite(localize: localize)
    }

    /// The marker accessibility label (web `ariaLabel: t('tesla_sessions.markerLabel',
    /// '{{name}} charging session', { name })`).
    public static func markerAccessibilityLabel(
        siteName: String,
        localize: (String, String) -> String
    ) -> String {
        TeslaChargingSessionsMapText.fill(
            localize("tesla_sessions.markerLabel", "{{name}} charging session"),
            ["name": siteName]
        )
    }

    /// "{value} kWh" (web `` `${fmtNumber(convertEnergyFromSI(wh,'kWh'),1)} kWh` ``).
    public static func energy(valueText: String, localize: (String, String) -> String) -> String {
        TeslaChargingSessionsMapText.fill(localize("marker.energy", "{{value}} kWh"), ["value": valueText])
    }

    /// The plotted-count chip (web `MarkerCluster` count — native chrome).
    public static func count(_ count: Int, localize: (String, String) -> String) -> String {
        TeslaChargingSessionsMapText.fill(localize("map.count", "{{count}} sessions"), ["count": "\(count)"])
    }

    /// The plotted-count accessibility label (native chrome).
    public static func countAccessibility(_ count: Int, localize: (String, String) -> String) -> String {
        TeslaChargingSessionsMapText.fill(
            localize("map.countA11y", "{{count}} charging sessions on the map"),
            ["count": "\(count)"]
        )
    }
}

// MARK: - Callout display model (web `popupHtml`)

/// The marker callout's resolved, display-ready content — the native parity of
/// the web `popupHtml` (site name + start date-time + optional energy / cost /
/// charger). Pure + `Equatable` so the popup is covered without rendering a map.
public struct TeslaChargingSessionCalloutDisplay: Identifiable, Equatable, Sendable {
    public var id: Int
    public var siteName: String
    public var dateText: String
    public var energyText: String?
    public var costText: String?
    public var chargerText: String?
    public var accessibilityLabel: String

    public init(
        id: Int,
        siteName: String,
        dateText: String,
        energyText: String?,
        costText: String?,
        chargerText: String?,
        accessibilityLabel: String
    ) {
        self.id = id
        self.siteName = siteName
        self.dateText = dateText
        self.energyText = energyText
        self.costText = costText
        self.chargerText = chargerText
        self.accessibilityLabel = accessibilityLabel
    }

    /// Builds the callout content from a marker, reproducing the web `popupHtml`
    /// branches exactly: energy shows only when `total_energy_added_wh != null`,
    /// cost only when `total_cost != null`, charger only when `charger_type` is
    /// a non-blank string.
    public static func make(
        marker: TeslaChargingSessionMarker,
        formatting: any TeslaChargingSessionsMapFormatting,
        localize: (String, String) -> String
    ) -> TeslaChargingSessionCalloutDisplay {
        let resolvedName = TeslaChargingSessionsMapLabels.siteName(marker.siteLocationName, localize: localize)
        let energyText = marker.energyWh.map { wattHours in
            TeslaChargingSessionsMapLabels.energy(
                valueText: formatting.formatEnergyKwh(wattHours: wattHours),
                localize: localize
            )
        }
        let costText = marker.cost.map { formatting.formatCurrency($0, decimals: 2) }
        return TeslaChargingSessionCalloutDisplay(
            id: marker.id,
            siteName: resolvedName,
            dateText: formatting.formatDateTime(marker.startedAt),
            energyText: energyText,
            costText: costText,
            chargerText: TeslaChargerTypeDisplay.uppercased(marker.chargerType),
            accessibilityLabel: TeslaChargingSessionsMapLabels.markerAccessibilityLabel(
                siteName: resolvedName,
                localize: localize
            )
        )
    }

    /// The combined VoiceOver phrase for the callout — the ordered, present parts
    /// joined into one element so the popup is announced coherently.
    public var accessibilitySummary: String {
        [siteName, dateText, energyText, costText, chargerText]
            .compactMap(\.self)
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
