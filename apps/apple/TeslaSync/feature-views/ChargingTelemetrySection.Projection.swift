//
//  ChargingTelemetrySection.Projection.swift
//  TeslaSync — P4 feature view · 0290 · ChargingTelemetrySection (Apple)
//
//  The pure projection half of the ChargingTelemetrySection adapter (split out so each
//  file stays within the lint budget). Holds the tile accent, the eight metric tiles
//  (web `MetricCard` rows in source order), the render phase, the projection that maps
//  raw telemetry + unit preferences into formatted tiles + a phase, the diagnostics
//  surface slug, and the VoiceOver summaries. Still pure + dependency-free (Foundation
//  only) so it is unit tested without a bundle or a rendered view. The number / SI
//  formatting it leans on lives in `ChargingTelemetrySection.Adapter.swift`.
//

import Foundation

// MARK: - Tile accent (web `MetricCard` `color`)

/// The accent the web passes to each `MetricCard` (`green` / `cyan` / `purple`). It
/// tints the icon chip only; the value text stays primary. Mapped to platform tokens
/// in the view (P1/S9).
public enum ChargingTelemetrySectionTint: String, Sendable, Equatable {
    case green
    case cyan
    case purple
}

// MARK: - Metric tile (web `MetricCard` row)

/// The eight metric tiles the web renders, in source order. Each carries its web i18n
/// key + English fallback, the `MetricCard` accent, and the lucide-mapped glyph; the
/// formatted value is supplied by the projection so the kind stays presentation-free.
public enum ChargingTelemetrySectionMetricKind: String, Sendable, CaseIterable, Identifiable {
    case chargerPower
    case voltage
    case current
    case energyAdded
    case chargingState
    case batteryLevel
    case chargeRate
    case rangeAdded

    public var id: String {
        rawValue
    }

    /// The i18n key the label resolves (web `t(key, default)`).
    public var localizationKey: String {
        switch self {
        case .chargerPower: "vehicles.detail.chargerPower"
        case .voltage: "vehicles.detail.voltage"
        case .current: "vehicles.detail.current"
        case .energyAdded: "vehicles.detail.energyAdded"
        case .chargingState: "vehicles.detail.chargingState"
        case .batteryLevel: "vehicles.detail.batteryLevel"
        case .chargeRate: "vehicles.detail.chargeRate"
        case .rangeAdded: "vehicles.detail.rangeAdded"
        }
    }

    /// The web English fallback for `localizationKey`.
    public var fallback: String {
        switch self {
        case .chargerPower: "Charger Power"
        case .voltage: "Voltage"
        case .current: "Current"
        case .energyAdded: "Energy Added"
        case .chargingState: "Charging State"
        case .batteryLevel: "Battery Level"
        case .chargeRate: "Charge Rate"
        case .rangeAdded: "Range Added"
        }
    }

    /// The web `MetricCard` `color` prop for this tile.
    public var tint: ChargingTelemetrySectionTint {
        switch self {
        case .chargerPower, .energyAdded, .batteryLevel: .green
        case .voltage, .chargingState, .chargeRate: .cyan
        case .current, .rangeAdded: .purple
        }
    }
}

/// A resolved metric tile — its kind plus the already-formatted display value.
public struct ChargingTelemetrySectionMetric: Sendable, Equatable, Identifiable {
    public var kind: ChargingTelemetrySectionMetricKind
    public var value: String

    public var id: String {
        kind.rawValue
    }

    public init(kind: ChargingTelemetrySectionMetricKind, value: String) {
        self.kind = kind
        self.value = value
    }
}

// MARK: - Render phase (web render branches + P4 leaf contract)

/// What the surface should render. The web component is `chargingTelemetry ? grid :
/// EmptyState`; the native surface reproduces that plus the P4 leaf load envelope so
/// every prompt state renders here.
public enum ChargingTelemetrySectionPhase: Sendable, Equatable {
    case loading
    case data
    case empty
    case error(String)
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw telemetry + unit preferences to the
/// formatted metric tiles and the render phase.
public enum ChargingTelemetrySectionProjection {
    /// The eight formatted tiles, in web source order. Each numeric tile renders its
    /// formatted value or the em-dash sentinel for a missing field; Charging State is
    /// the raw string (web `charging_state ?? '—'`).
    public static func metrics(
        from data: ChargingTelemetrySectionData,
        prefs: ChargingTelemetrySectionUnitPrefs
    ) -> [ChargingTelemetrySectionMetric] {
        let locale = prefs.locale
        let dash = ChargingTelemetrySectionFormat.dash

        func scalar(_ value: Double?, unit: String, spaced: Bool = true) -> String {
            guard let value else { return dash }
            let formatted = ChargingTelemetrySectionFormat.number(
                value,
                decimals: ChargingTelemetrySectionFormat.resolvePrecision(
                    prefs.decimalPrecision,
                    fallback: ChargingTelemetrySectionFormat.defaultNumberPrecision
                ),
                locale: locale
            )
            return spaced ? "\(formatted) \(unit)" : "\(formatted)\(unit)"
        }

        let chargeRateMps = data.rangeAddedMetersPerHour.map { $0 / ChargingTelemetrySectionFormat.secondsPerHour }

        return [
            metric(.chargerPower, scalar(data.chargerPowerW, unit: "kW")),
            metric(.voltage, scalar(data.chargerVoltage, unit: "V")),
            metric(.current, scalar(data.chargerActualCurrent, unit: "A")),
            metric(.energyAdded, scalar(data.chargeEnergyAddedWh, unit: "kWh")),
            metric(.chargingState, data.chargingState ?? dash),
            metric(.batteryLevel, scalar(data.batteryLevel, unit: "%", spaced: false)),
            metric(.chargeRate, ChargingTelemetrySectionFormat.speed(
                chargeRateMps,
                unit: prefs.speed,
                precision: prefs.decimalPrecision,
                locale: locale
            )),
            metric(.rangeAdded, ChargingTelemetrySectionFormat.distance(
                data.rangeAddedMeters,
                unit: prefs.distance,
                precision: prefs.decimalPrecision,
                locale: locale
            ))
        ]
    }

    private static func metric(
        _ kind: ChargingTelemetrySectionMetricKind,
        _ value: String
    ) -> ChargingTelemetrySectionMetric {
        ChargingTelemetrySectionMetric(kind: kind, value: value)
    }

    /// Resolves the render phase from the bound load envelope. A non-empty error wins;
    /// an in-flight initial fetch is `loading`; otherwise the web ternary applies —
    /// telemetry present ⇒ the grid (`data`), absent ⇒ the `EmptyState` (`empty`).
    public static func resolvePhase(
        isLoading: Bool,
        errorMessage: String?,
        hasData: Bool
    ) -> ChargingTelemetrySectionPhase {
        if let errorMessage, !errorMessage.isEmpty {
            return .error(errorMessage)
        }
        if isLoading {
            return .loading
        }
        return hasData ? .data : .empty
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum ChargingTelemetrySectionSurface {
    public static let slug = "ChargingTelemetrySection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings from already-localised parts so the spoken
/// content is asserted without rendering the view. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`), exactly like the view's P1/S10 facade.
public enum ChargingTelemetrySectionAccessibility {
    /// The section-level summary: the "Charging Telemetry" title + each tile
    /// label/value, joined for the container element.
    public static func sectionSummary(
        metrics: [ChargingTelemetrySectionMetric],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("vehicles.detail.chargingTelemetry", "Charging Telemetry")
        guard !metrics.isEmpty else { return title }
        let parts = metrics.map { "\(localize($0.kind.localizationKey, $0.kind.fallback)) \($0.value)" }
        return "\(title): " + parts.joined(separator: ", ")
    }

    /// One tile's VoiceOver value: "{label} {value}".
    public static func metricLabel(
        _ metric: ChargingTelemetrySectionMetric,
        localize: (String, String) -> String
    ) -> String {
        "\(localize(metric.kind.localizationKey, metric.kind.fallback)) \(metric.value)"
    }
}
