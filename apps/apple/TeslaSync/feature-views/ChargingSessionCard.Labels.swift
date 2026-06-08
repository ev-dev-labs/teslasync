//
//  ChargingSessionCard.Labels.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The pure label + VoiceOver builders the view renders, plus the `{{name}}`
//  interpolation helper (native parity of i18next `t(key, { value })`). Each
//  builder takes the P1/S10 `localize` facade so the view holds no literals and
//  the spoken content is unit-tested without rendering.
//

import Foundation

// MARK: - Token interpolation (web `t(key, { value })` parity)

/// Fills `{{name}}` tokens in a localized template, keeping the catalog values
/// byte-identical to the web fallbacks.
public enum ChargingSessionText {
    public static func fill(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - Visible labels (consumed by the view)

/// Builds the card's visible strings from the `localize` facade. Each builder
/// mirrors a web template literal.
public enum ChargingSessionCardLabels {
    /// The charger badge label (web `chargerLabels[cat]`).
    public static func chargerLabel(_ kind: ChargerKind, localize: (String, String) -> String) -> String {
        switch kind {
        case .supercharger: localize("chargerTypes.supercharger", "Supercharger")
        case .dc: localize("chargerTypes.dc", "DC Fast")
        case .home: localize("chargerTypes.home", "Home / AC")
        case .unknown: localize("chargerTypes.unknown", "Charger")
        }
    }

    /// "Free" (web `t('free', 'Free')`).
    public static func free(localize: (String, String) -> String) -> String {
        localize("free", "Free")
    }

    /// "{value} kWh" (web `fmtWithUnit(energyKwh, 'kWh')`).
    public static func energy(valueText: String, localize: (String, String) -> String) -> String {
        ChargingSessionText.fill(localize("metric.energy", "{{value}} kWh"), ["value": valueText])
    }

    /// "{value} kW peak" (web `` `${fmtNumber(peak/1000)} kW peak` ``).
    public static func peak(valueText: String, localize: (String, String) -> String) -> String {
        ChargingSessionText.fill(localize("metric.peak", "{{value}} kW peak"), ["value": valueText])
    }

    /// "~{value} kW avg" (web `` `~${fmtNumber(avgRateKw)} kW avg` ``).
    public static func average(valueText: String, localize: (String, String) -> String) -> String {
        ChargingSessionText.fill(localize("metric.avg", "~{{value}} kW avg"), ["value": valueText])
    }

    /// "({value}/kWh)" (web `` `(${formatCurrency(cpk, 2)}/kWh)` ``).
    public static func costPerKwh(valueText: String, localize: (String, String) -> String) -> String {
        ChargingSessionText.fill(localize("metric.costPerKwh", "({{value}}/kWh)"), ["value": valueText])
    }

    /// "+{value} {unit}" (web `` `+${fmtInt(milesGained)} ${distanceUnit}` ``).
    public static func distanceGained(
        valueText: String,
        unit: String,
        localize: (String, String) -> String
    ) -> String {
        ChargingSessionText.fill(
            localize("metric.distanceGained", "+{{value}} {{unit}}"),
            ["value": valueText, "unit": unit]
        )
    }
}

// MARK: - Accessibility (testable VoiceOver content)

/// Builds the card's VoiceOver strings so the spoken content is unit-tested
/// without a rendered view. The view consumes the same builders, so the two never
/// drift.
public enum ChargingSessionCardAccessibility {
    /// The leading score badge label, overriding the badge default (web
    /// `t('scoreAria', 'Battery-friendly score: {{value}}', { value })`).
    public static func scoreAria(valueText: String, localize: (String, String) -> String) -> String {
        ChargingSessionText.fill(
            localize("scoreAria", "Battery-friendly score: {{value}}"),
            ["value": valueText]
        )
    }

    /// The battery-delta label (web `BatteryDelta` `battery.delta.aria`).
    public static func batteryDelta(
        fromText: String,
        toText: String,
        localize: (String, String) -> String
    ) -> String {
        ChargingSessionText.fill(
            localize("batteryDelta.aria", "Battery {{from}}% to {{to}}%"),
            ["from": fromText, "to": toText]
        )
    }

    /// The battery-delta unknown label (web `battery.delta.unknown`).
    public static func batteryDeltaUnknown(localize: (String, String) -> String) -> String {
        localize("batteryDelta.unknown", "Battery delta unknown")
    }

    /// The selection checkbox label (web `t('selectSession', 'Select charging session')`).
    public static func selectSession(localize: (String, String) -> String) -> String {
        localize("selectSession", "Select charging session")
    }

    /// A combined row summary: the ordered, pre-localized parts joined into one
    /// VoiceOver phrase, dropping any missing/empty part so the card is announced
    /// as one coherent element.
    public static func rowSummary(parts: [String?]) -> String {
        parts.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
