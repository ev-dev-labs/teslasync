//
//  TemperatureMetricCards.Projection.swift
//  TeslaSync — P4 feature view · 0161 · TemperatureMetricCards (Apple)
//
//  The pure six-card projection: a cached `TemperatureMetricsInput` + the user's temperature
//  preference → the six view-ready `TemperatureMetricCardModel`s, in the exact web order with
//  the exact readings, ceilings, icons, accents, and value/subtitle expressions
//  features/driving/components/drivetrain-health/TemperatureMetricCards.tsx renders. Plus the
//  testable VoiceOver summary. SwiftUI-free so the projection can be pinned by unit tests
//  independent of the rendered grid.
//

import Foundation

// MARK: - Sensor catalog (web `sensors` array, built in DrivetrainHealthPage)

/// One static sensor descriptor — the native mirror of one entry in the web `sensors` array
/// (`{ key, labelKey, defaultLabel, maxTemp, icon }`). Only the °C value is dynamic (read from
/// the bound input); the label, ceiling, icon, and order are fixed, exactly as the web page
/// constructs them.
public struct TemperatureSensorSpec: Identifiable, Sendable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    /// The thermal ceiling (°C) the percent-of-max ratio is taken against (web `maxTemp`).
    public let maxTempC: Double
    public let systemImage: String

    public init(id: String, labelKey: String, labelFallback: String, maxTempC: Double, systemImage: String) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.maxTempC = maxTempC
        self.systemImage = systemImage
    }
}

// MARK: - Projection (pure, web-parity)

/// Pure projection rules shared by the model and the views. Builds the six cards in the exact
/// order, with the exact readings, ceilings, icons, accents, and value/subtitle expressions the
/// web source renders to each `<MetricCard>`. No store, no bundle, no rendered view.
public enum TemperatureMetricsProjection {
    /// The em-dash the web renders for an absent reading / non-positive peak power.
    public static let emDash = TemperatureMetricsMath.emDash

    /// The kilowatt unit symbol the web hardcodes for the Peak Power card (`${…} kW`).
    public static let kilowattSymbol = "kW"

    /// The four sensors in the web page's exact order, with the exact ceilings + icons. The SF
    /// Symbols map the web Lucide icons (`Zap → bolt.fill`, `Cpu → cpu`,
    /// `BatteryCharging → battery.100.bolt`).
    public static let sensors: [TemperatureSensorSpec] = [
        TemperatureSensorSpec(
            id: "frontMotor",
            labelKey: "drivetrain.frontMotor",
            labelFallback: "Front Motor",
            maxTempC: 150,
            systemImage: "bolt.fill"
        ),
        TemperatureSensorSpec(
            id: "rearMotor",
            labelKey: "drivetrain.rearMotor",
            labelFallback: "Rear Motor",
            maxTempC: 150,
            systemImage: "bolt.fill"
        ),
        TemperatureSensorSpec(
            id: "inverter",
            labelKey: "drivetrain.inverter",
            labelFallback: "Inverter",
            maxTempC: 120,
            systemImage: "cpu"
        ),
        TemperatureSensorSpec(
            id: "battery",
            labelKey: "drivetrain.battery",
            labelFallback: "Battery",
            maxTempC: 60,
            systemImage: "battery.100.bolt"
        )
    ]

    /// Web `tempNeonColor(celsius, max)`: `null → green`; ratio `≥ 0.85 → red`; `≥ 0.65 →
    /// amber`; else `green`.
    public static func neonAccent(for celsius: Double?, maxTempC: Double) -> TemperatureCardAccent {
        guard let celsius, maxTempC > 0 else { return .green }
        let ratio = celsius / maxTempC
        if ratio >= 0.85 { return .red }
        if ratio >= 0.65 { return .amber }
        return .green
    }

    /// Reads a sensor's °C value out of the bound input by spec id.
    public static func reading(for sensorID: String, in input: TemperatureMetricsInput?) -> Double? {
        switch sensorID {
        case "frontMotor": input?.frontMotorTempC
        case "rearMotor": input?.rearMotorTempC
        case "inverter": input?.inverterTempC
        case "battery": input?.batteryTempC
        default: nil
        }
    }

    /// Projects one sensor spec + the bound input into its card (web sensor `<MetricCard>`).
    public static func sensorCard(
        _ spec: TemperatureSensorSpec,
        input: TemperatureMetricsInput?,
        prefs: TemperatureMetricsUnitPrefs
    ) -> TemperatureMetricCardModel {
        let celsius = reading(for: spec.id, in: input)
        let value = TemperatureMetricsMath.temperatureInline(
            celsius,
            unit: prefs.temperature,
            precision: prefs.precision,
            localeIdentifier: prefs.localeIdentifier
        )
        let subtitle: TemperatureCardSubtitle = celsius == nil
            ? .noData
            : .percentOfMax(
                TemperatureMetricsMath.percentOfMax(
                    celsius ?? 0,
                    maxTempC: spec.maxTempC,
                    localeIdentifier: prefs.localeIdentifier
                )
            )
        return TemperatureMetricCardModel(
            id: spec.id,
            labelKey: spec.labelKey,
            labelFallback: spec.labelFallback,
            value: value,
            subtitle: subtitle,
            systemImage: spec.systemImage,
            accent: neonAccent(for: celsius, maxTempC: spec.maxTempC)
        )
    }

    /// The Health Score card (web `<MetricCard value={`${healthScore}%`} icon={<Heart/>}
    /// color={good ? 'green' : warning ? 'amber' : 'red'} />`). The score template literal is
    /// ungrouped in the source (0–100), so it is emitted verbatim.
    public static func healthCard(_ input: TemperatureMetricsInput?) -> TemperatureMetricCardModel {
        let health = input?.overallHealth ?? .good
        let score = input?.healthScore ?? health.score
        return TemperatureMetricCardModel(
            id: "healthScore",
            labelKey: "drivetrain.healthScore",
            labelFallback: "Health Score",
            value: "\(score)%",
            subtitle: .none,
            systemImage: "heart.fill",
            accent: health.accent
        )
    }

    /// The Peak Power card (web `<MetricCard value={peakPower > 0 ? `${fmtInt(peakPower)} kW` :
    /// '—'} icon={<Zap/>} color="purple" />`).
    public static func peakPowerCard(
        _ input: TemperatureMetricsInput?,
        prefs: TemperatureMetricsUnitPrefs
    ) -> TemperatureMetricCardModel {
        let peak = input?.peakPowerKw ?? 0
        let value = peak > 0
            ? "\(TemperatureMetricsMath.integer(peak, localeIdentifier: prefs.localeIdentifier)) \(kilowattSymbol)"
            : emDash
        return TemperatureMetricCardModel(
            id: "peakPower",
            labelKey: "drivetrain.peakPower",
            labelFallback: "Peak Power",
            value: value,
            subtitle: .none,
            systemImage: "bolt.fill",
            accent: .purple
        )
    }

    /// Projects the cached input + unit preferences into the six view-ready cards in the exact
    /// web order: the four sensors, then Health Score, then Peak Power. A `nil` input yields the
    /// em-dash sensor values + "No data" subtitles + the default health card, so the grid never
    /// renders blank.
    public static func cards(
        from input: TemperatureMetricsInput?,
        prefs: TemperatureMetricsUnitPrefs
    ) -> [TemperatureMetricCardModel] {
        var cards = sensors.map { sensorCard($0, input: input, prefs: prefs) }
        cards.append(healthCard(input))
        cards.append(peakPowerCard(input, prefs: prefs))
        return cards
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch (no value
    /// yet); a resolved payload renders content; a resolved-but-empty payload renders the em-dash
    /// cards; a failure with cached data stays content (the chip/banner flag staleness), and a
    /// failure with no cached data shows the retryable error.
    public static func resolvePhase(
        _ status: TemperatureMetricsLoadStatus,
        hasValue: Bool
    ) -> TemperatureMetricsPhase {
        switch status {
        case .loading:
            hasValue ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasValue ? .content : .empty
        case let .failed(message):
            hasValue ? .content : .error(message)
        }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver string for a metric card. Pure + public so the spoken content can be
/// unit-tested without rendering. The caller passes a localizer (bundle-free in tests) so the
/// label + the "of max" / "No data" prose resolve through P1/S10 without English literals here.
public enum TemperatureMetricsAccessibility {
    /// e.g. "Front Motor, 72.0°F, 50% of max" or "Inverter, —, No data" or "Health Score, 95%".
    /// Mirrors the web reading order: label, value, then subtitle.
    public static func cardSummary(
        _ card: TemperatureMetricCardModel,
        localize: (String, String) -> String
    ) -> String {
        var parts = ["\(localize(card.labelKey, card.labelFallback)), \(card.value)"]
        switch card.subtitle {
        case .none:
            break
        case let .percentOfMax(percent):
            parts.append("\(percent)% \(localize("drivetrain.ofMax", "of max"))")
        case .noData:
            parts.append(localize("drivetrain.noData", "No data"))
        }
        return parts.joined(separator: ", ")
    }
}
