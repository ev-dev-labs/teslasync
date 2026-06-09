//
//  TripPlannerMap.Labels.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  The pure label + VoiceOver builders the map renders, the `{{token}}`
//  interpolation helper (native parity of i18next `t(key, { value })`), and the
//  marker callout display model (web Leaflet `Popup`). Each builder takes the P1/S10
//  `localize` facade so the view holds no literals and the spoken content is
//  unit-tested without rendering a map.
//

import Foundation

// MARK: - Token interpolation (web `t(key, { value })` parity)

/// Fills `{{token}}` slots in a localized template, keeping the catalog values
/// byte-identical to the web fallbacks.
public enum TripPlannerMapText {
    public static func fill(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }
}

// MARK: - Visible + spoken labels (consumed by the view)

/// Builds the map's visible/spoken strings from the `localize` facade. Each builder
/// mirrors a web `t()` call, template literal, or popup branch.
public enum TripPlannerMapLabels {
    /// The map container accessibility label (native chrome — the web map has no title).
    public static func mapLabel(localize: (String, String) -> String) -> String {
        localize("tripPlanner.map.mapLabel", "Trip route map")
    }

    /// The origin marker title — the raw name, or the localized "Origin" fallback
    /// when it is absent/blank (web `origin.name || t('tripPlanner.map.origin', 'Origin')`,
    /// where JS treats an empty string as falsy).
    public static func originName(_ rawName: String, localize: (String, String) -> String) -> String {
        nonBlank(rawName) ?? localize("tripPlanner.map.origin", "Origin")
    }

    /// The destination marker title — the raw name, or the localized "Destination"
    /// fallback (web `destination.name || t('tripPlanner.map.destination', 'Destination')`).
    public static func destinationName(_ rawName: String, localize: (String, String) -> String) -> String {
        nonBlank(rawName) ?? localize("tripPlanner.map.destination", "Destination")
    }

    /// The charge-stop title — the raw name (web `stop.name`), or the localized
    /// "Charge stop" fallback when it is absent/blank (native robustness so the
    /// callout is never title-less).
    public static func chargeStopName(_ rawName: String, localize: (String, String) -> String) -> String {
        nonBlank(rawName) ?? localize("tripPlanner.map.chargeStop", "Charge stop")
    }

    /// The charge-stop SOC range line (web `` `${round(from)}% → ${round(to)}% (${round(dur/60)} min)` ``).
    public static func chargeRange(
        fromSoc: Double,
        toSoc: Double,
        durationS: Double,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        TripPlannerMapText.fill(
            localize("tripPlanner.map.stopRange", "{{from}}% → {{to}}% ({{minutes}} min)"),
            [
                "from": TripPlannerMapFormat.soc(fromSoc, locale: locale),
                "to": TripPlannerMapFormat.soc(toSoc, locale: locale),
                "minutes": TripPlannerMapFormat.minutes(fromSeconds: durationS, locale: locale)
            ]
        )
    }

    private static func nonBlank(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Whether a raw location name carries content (web JS truthiness of `name`).
    public static func hasName(_ raw: String) -> Bool {
        nonBlank(raw) != nil
    }
}

// MARK: - Callout display model (web Leaflet `Popup`)

/// The marker callout's resolved, display-ready content — the native parity of the
/// web Leaflet popup. Endpoints render just a title (web origin/destination popup);
/// a charge stop adds the SOC-range detail line (web charge-stop popup). Pure +
/// `Equatable` so the popup is covered without rendering a map.
public struct TripPlannerMarkerDisplay: Identifiable, Equatable, Sendable {
    public var id: String
    public var kind: TripPlannerMarkerKind
    /// The callout title (origin/destination/charge-stop name with its fallback).
    public var title: String
    /// The charge-stop SOC-range detail line; `nil` for endpoints.
    public var detail: String?
    /// The combined VoiceOver phrase for the marker.
    public var accessibilityLabel: String

    public init(
        id: String,
        kind: TripPlannerMarkerKind,
        title: String,
        detail: String?,
        accessibilityLabel: String
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.detail = detail
        self.accessibilityLabel = accessibilityLabel
    }

    /// Builds the callout content + VoiceOver label from a marker, reproducing the
    /// web popup branches: endpoints show only their (fallback-resolved) name; a
    /// charge stop shows its name plus the `from% → to% (min)` range line.
    public static func make(
        marker: TripPlannerMarker,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> TripPlannerMarkerDisplay {
        switch marker.kind {
        case .origin:
            endpoint(
                marker,
                title: TripPlannerMapLabels.originName(marker.name, localize: localize),
                a11yKey: "tripPlanner.map.originA11y",
                a11yFallback: "Origin: {{name}}",
                localize: localize
            )
        case .destination:
            endpoint(
                marker,
                title: TripPlannerMapLabels.destinationName(marker.name, localize: localize),
                a11yKey: "tripPlanner.map.destinationA11y",
                a11yFallback: "Destination: {{name}}",
                localize: localize
            )
        case .chargeStop:
            chargeStop(marker, localize: localize, locale: locale)
        }
    }

    /// An endpoint callout (origin / destination): a title-only popup whose VoiceOver
    /// is "Role: {name}" when named, or just the role word when unnamed (so an unnamed
    /// origin is not spoken "Origin: Origin").
    private static func endpoint(
        _ marker: TripPlannerMarker,
        title: String,
        a11yKey: String,
        a11yFallback: String,
        localize: (String, String) -> String
    ) -> TripPlannerMarkerDisplay {
        let spoken = TripPlannerMapLabels.hasName(marker.name)
            ? TripPlannerMapText.fill(localize(a11yKey, a11yFallback), ["name": title])
            : title
        return TripPlannerMarkerDisplay(
            id: marker.id,
            kind: marker.kind,
            title: title,
            detail: nil,
            accessibilityLabel: spoken
        )
    }

    /// A charge-stop callout: the stop name plus the `from% → to% (min)` range line
    /// (web charge-stop popup), with the SOC range spelled out for VoiceOver.
    private static func chargeStop(
        _ marker: TripPlannerMarker,
        localize: (String, String) -> String,
        locale: Locale
    ) -> TripPlannerMarkerDisplay {
        let title = TripPlannerMapLabels.chargeStopName(marker.name, localize: localize)
        let from = marker.chargeFromSoc ?? 0
        let to = marker.chargeToSoc ?? 0
        let duration = marker.chargeDurationS ?? 0
        let detail = TripPlannerMapLabels.chargeRange(
            fromSoc: from,
            toSoc: to,
            durationS: duration,
            localize: localize,
            locale: locale
        )
        let spoken = TripPlannerMapText.fill(
            localize("tripPlanner.map.stopA11y", "{{name}}, {{from}}% to {{to}}%, {{minutes}} minutes"),
            [
                "name": title,
                "from": TripPlannerMapFormat.soc(from, locale: locale),
                "to": TripPlannerMapFormat.soc(to, locale: locale),
                "minutes": TripPlannerMapFormat.minutes(fromSeconds: duration, locale: locale)
            ]
        )
        return TripPlannerMarkerDisplay(
            id: marker.id,
            kind: .chargeStop,
            title: title,
            detail: detail,
            accessibilityLabel: spoken
        )
    }
}
