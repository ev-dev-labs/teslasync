import Foundation

/// Pure, unit-testable derivations for the Projected-Range surface — the SwiftUI port of the web
/// page's `useMemo`s and helper functions (`interpolateRange`, `effColor`, `scenarioIcon`, the
/// `FACTOR_ICONS` map, and the efficiency-gauge color logic). Everything here is value-in /
/// value-out so the model + view stay free of branching logic (ADR-004). All physical quantities
/// are SI: speed in metres-per-second, temperature in Celsius, energy in watt-hours,
/// energy-intensity in watt-hours-per-metre, range in metres.
public enum ProjectedRangeDerivations {
    // MARK: Buckets (web `TEMP_BUCKETS` / `SPEED_BUCKETS`)

    /// The four temperature buckets, coldest-first (web `TEMP_BUCKETS`).
    public static let tempBuckets = ["freezing", "cold", "mild", "hot"]

    /// The three speed buckets, slowest-first (web `SPEED_BUCKETS`).
    public static let speedBuckets = ["city", "suburban", "highway"]

    /// Web `tempBucket`: `< 0 → freezing, < 10 → cold, < 25 → mild, else hot`.
    public static func tempBucket(forCelsius celsius: Double) -> String {
        if celsius < 0 { return "freezing" }
        if celsius < 10 { return "cold" }
        if celsius < 25 { return "mild" }
        return "hot"
    }

    /// Web `speedBucket`: `< 50 → city, < 90 → suburban, else highway` (km·h⁻¹ thresholds applied
    /// to the SI speed converted to km·h⁻¹).
    public static func speedBucket(forMetersPerSecond mps: Double) -> String {
        let kmh = mps * 3.6
        if kmh < 50 { return "city" }
        if kmh < 90 { return "suburban" }
        return "highway"
    }

    // MARK: What-if slider domains (web `<Slider>` min/max/step + defaults)

    /// The what-if speed slider domain in SI m·s⁻¹ (web 30…150 km·h⁻¹).
    public static let speedSliderRangeMps: ClosedRange<Double> = (30.0 / 3.6) ... (150.0 / 3.6)

    /// The what-if temperature slider domain in Celsius (web −20…40 °C).
    public static let tempSliderRangeC: ClosedRange<Double> = -20 ... 40

    /// The default what-if speed in SI m·s⁻¹ (web `useState(80)` km·h⁻¹).
    public static let defaultWhatIfSpeedMps = 80.0 / 3.6

    /// The default what-if temperature in Celsius (web `useState(20)`).
    public static let defaultWhatIfTempC = 20.0

    // MARK: What-if interpolation (web `interpolateRange`)

    /// The result of a what-if calculation: the SI energy-intensity used and the SI range it
    /// yields, both rounded the way the web rounds (Wh/km to 0.1, km to 0.1).
    public struct WhatIfResult: Equatable, Sendable {
        public let efficiencyWhPerM: Double
        public let rangeM: Double

        public init(efficiencyWhPerM: Double, rangeM: Double) {
            self.efficiencyWhPerM = efficiencyWhPerM
            self.rangeM = rangeM
        }
    }

    /// Web `interpolateRange`: looks up the matched (temp × speed) bucket efficiency, falling back
    /// to the deterministic Wh/km heuristic, then projects range from the usable capacity at the
    /// given battery percentage. Computed in the web's km / Wh·km⁻¹ space then converted to SI so
    /// the rounding matches the web exactly.
    public static func interpolate(
        matrix: [EfficiencyBucket],
        speedMps: Double,
        tempC: Double,
        batteryPct: Double,
        capacityWh: Double
    ) -> WhatIfResult {
        let tBucket = tempBucket(forCelsius: tempC)
        let sBucket = speedBucket(forMetersPerSecond: speedMps)
        let speedKmh = speedMps * 3.6

        let match = matrix.first { $0.tempBucket == tBucket && $0.speedBucket == sBucket }
        // Web fallback heuristic is expressed in Wh/km; the matched bucket is SI Wh/m → Wh/km.
        var effWhPerKm = match.map { $0.efficiencyWhPerM * 1000 }
            ?? (155 + (speedKmh - 35) * 0.5 + max(0, 20 - tempC) * 1.5)
        if effWhPerKm <= 0 { effWhPerKm = 170 }

        let rangeKm = capacityWh * (batteryPct / 100) / effWhPerKm
        let roundedEffWhPerKm = (effWhPerKm * 10).rounded() / 10
        let roundedRangeKm = (rangeKm * 10).rounded() / 10
        return WhatIfResult(efficiencyWhPerM: roundedEffWhPerKm / 1000, rangeM: roundedRangeKm * 1000)
    }

    // MARK: Colors (web `effColor` + the efficiency-gauge color)

    /// Web `effColor(whKm)` mapped to a semantic tone: ≤180 Wh/km → success, ≤210 → warning,
    /// else danger. (The web's two green bands collapse to one success tone.)
    public static func efficiencyTone(whPerM: Double) -> TSTone {
        let whPerKm = whPerM * 1000
        if whPerKm <= 180 { return .success }
        if whPerKm <= 210 { return .warning }
        return .danger
    }

    /// Web efficiency-gauge color: `factor ≥ 0.9 → palette 1 (green), ≥ 0.7 → palette 3 (amber),
    /// else palette 5 (red)`.
    public static func gaugeColorIndex(efficiencyFactor: Double) -> Int {
        if efficiencyFactor >= 0.9 { return 1 }
        if efficiencyFactor >= 0.7 { return 3 }
        return 5
    }

    // MARK: Icons (web `scenarioIcon` + `FACTOR_ICONS`)

    /// Web `scenarioIcon`: sentry tag → shield, sub-zero → snowflake, fast → car, else bolt.
    public static func scenarioSymbol(for scenario: RangeScenario) -> String {
        if scenario.extras.contains("sentry") { return "shield.fill" }
        if scenario.tempC < 0 { return "snowflake" }
        if scenario.speedMps * 3.6 > 90 { return "car.fill" }
        return "bolt.fill"
    }

    /// Web `FACTOR_ICONS` keyed by the normalised factor name; unknown factors fall back to a gauge.
    public static func factorSymbol(name: String) -> String {
        switch name.lowercased().replacingOccurrences(of: " ", with: "_") {
        case "temperature": return "thermometer.medium"
        case "speed": return "car.fill"
        case "hvac": return "wind"
        case "elevation": return "mountain.2.fill"
        case "driving_style": return "gauge.with.dots.needle.bottom.50percent"
        default: return "gauge.with.dots.needle.bottom.50percent"
        }
    }
}
