//
//  HeroGauges.Adapter.swift
//  TeslaSync — P4 feature view · 0103 · HeroGauges (Apple)
//
//  The testable projection core: a computed `ChargingStatsDTO` + `HeroUnitPrefs` → the four
//  view-ready `HeroGaugeTileModel`s plus the Avg $/kWh `HeroCostMetric`, reproducing the web
//  source's numeric pipeline VERBATIM so the native surface shows the exact same values as
//  features/charging/components/charging-list/HeroGauges.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the conversion + formatting compile and run
//  on a plain host and are pinned by unit tests. `HeroAccent` carries only the web colour name
//  (cyan/green/amber/purple); the token mapping lives in HeroGauges.Views.swift.
//

import Foundation

// MARK: - Number / currency formatting (ported from web lib/numberFormat.ts + useFormatting.ts)

/// Locale-aware number + currency formatting that mirrors the web `fmtNumber`
/// (`Number.toLocaleString`) and `useFormatting().formatCurrency` (`symbol + fmtNumber`).
public enum HeroGaugesFormat {
    /// `safeNumber` from numberFormat.ts (and the charts `safe`): non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Number.toLocaleString`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// `formatCurrency(amount, decimals)` — `currencySymbol + fmtNumber(amount, decimals)`.
    public static func currency(
        _ amount: Double,
        symbol: String,
        decimals: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
        symbol + number(amount, decimals: decimals, localeIdentifier: localeIdentifier)
    }

    /// Rounds half away from zero to `places` decimals — the value `parseFloat(fmtNumber(v, places))`
    /// produces before the web hands it to `AnimatedNumber` for the Avg $/kWh readout.
    public static func round(_ value: Double, places: Int) -> Double {
        let factor = pow(10.0, Double(max(0, places)))
        return (safeNumber(value) * factor).rounded(.toNearestOrAwayFromZero) / factor
    }
}

// MARK: - Accent (web `RadialGauge color`) — token mapping lives in the view layer

/// The colour name the web `RadialGauge` carries for a gauge's progress arc (`#00f0ff` cyan /
/// `#10b981` green / `#f59e0b` amber / `#a855f7` purple). Kept as a pure value here so the
/// projection stays SwiftUI-free; the SwiftUI token mapping is in `HeroGauges.Views.swift`.
public enum HeroAccent: String, Sendable, Equatable {
    case cyan
    case green
    case amber
    case purple
}

// MARK: - Projected gauge tile (web `RadialGauge`)

/// One projected radial gauge: a localized label, a formatted centre value, an optional unit
/// suffix, the 0...1 ring fill fraction (`clamped / max`), and the accent for its progress arc.
/// Mirrors the web `RadialGauge` props (`value` / `max` / `label` / `unit` / `color`).
public struct HeroGaugeTileModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unit: String?
    public let fraction: Double
    public let accent: HeroAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        unit: String?,
        fraction: Double,
        accent: HeroAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
        self.fraction = fraction
        self.accent = accent
    }

    /// The resolved (localized) label for display + accessibility (P1/S10 facade).
    public var label: String {
        HeroGaugesStrings.string(labelKey, labelFallback)
    }

    /// The centre readout for VoiceOver — value plus unit suffix when present.
    public var spokenValue: String {
        guard let unit, !unit.isEmpty else { return value }
        return "\(value) \(unit)"
    }
}

// MARK: - Projected cost readout (web Avg $/kWh `AnimatedNumber`)

/// The Avg $/kWh metric the web renders as a plain `$<AnimatedNumber decimals={3}>` instead of a
/// gauge. The value is pre-formatted (currency symbol + 3 fraction digits) so the view only
/// animates the string.
public struct HeroCostMetric: Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String

    public init(id: String, labelKey: String, labelFallback: String, value: String) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
    }

    public var label: String {
        HeroGaugesStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected surface content: the four gauges (web render order) plus the Avg $/kWh
/// readout that closes the row.
public struct HeroGaugesProjection: Equatable, Sendable {
    public let gauges: [HeroGaugeTileModel]
    public let cost: HeroCostMetric

    public init(gauges: [HeroGaugeTileModel], cost: HeroCostMetric) {
        self.gauges = gauges
        self.cost = cost
    }
}

/// The inputs for one web `<RadialGauge value max unit color>` before clamping/formatting.
private struct GaugeSpec {
    let id: String
    let labelKey: String
    let labelFallback: String
    let rawValue: Double
    let maxValue: Double
    let unit: String?
    let accent: HeroAccent
}

/// Pure projector: `ChargingStatsDTO` + `HeroUnitPrefs` → `HeroGaugesProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web component so the web and native
/// surfaces show identical numbers side by side.
public enum HeroGaugesProjector {
    public static func project(stats: ChargingStatsDTO, units: HeroUnitPrefs) -> HeroGaugesProjection {
        let context = Context(stats: stats, units: units)
        return HeroGaugesProjection(gauges: context.gauges(), cost: context.cost())
    }

    /// Pure per-projection context bundling the inputs so the gauge math stays short while keeping
    /// every value byte-for-byte identical to the web source.
    private struct Context {
        let stats: ChargingStatsDTO
        let units: HeroUnitPrefs

        private var locale: String {
            units.localeIdentifier
        }

        /// The four radial gauges in the web's render order (Sessions, Energy, Total Cost,
        /// Avg Power). Each mirrors a web `<RadialGauge value max unit color>`.
        func gauges() -> [HeroGaugeTileModel] {
            specs().map(gauge)
        }

        private func specs() -> [GaugeSpec] {
            let energy = HeroGaugesFormat.safeNumber(stats.totalEnergy).rounded(.toNearestOrAwayFromZero)
            let cost = HeroGaugesFormat.safeNumber(stats.totalCost).rounded(.toNearestOrAwayFromZero)
            let power = HeroGaugesFormat.safeNumber(stats.avgPower).rounded(.toNearestOrAwayFromZero)
            return [
                GaugeSpec(
                    id: "sessions",
                    labelKey: "charging.gauges.sessions",
                    labelFallback: "Sessions",
                    rawValue: Double(stats.count),
                    maxValue: max(Double(stats.count), 50),
                    unit: nil,
                    accent: .cyan
                ),
                GaugeSpec(
                    id: "energy",
                    labelKey: "charging.gauges.energy",
                    labelFallback: "Energy",
                    rawValue: energy,
                    maxValue: max(stats.totalEnergy, 500),
                    unit: "kWh",
                    accent: .green
                ),
                GaugeSpec(
                    id: "total-cost",
                    labelKey: "charging.gauges.totalCost",
                    labelFallback: "Total Cost",
                    rawValue: cost,
                    maxValue: max(stats.totalCost, 100),
                    unit: units.currencySymbol,
                    accent: .amber
                ),
                GaugeSpec(
                    id: "avg-power",
                    labelKey: "charging.gauges.avgPower",
                    labelFallback: "Avg Power",
                    rawValue: power,
                    maxValue: 250,
                    unit: "kW",
                    accent: .purple
                )
            ]
        }

        /// Builds one gauge tile the way the web `RadialGauge` renders: `clamped = max(0, min(value,
        /// max))`, the centre reads `fmtNumber(clamped, decimals)` (0 decimals for the whole values
        /// the web passes, else the global precision), and the arc fills `clamped / max`.
        private func gauge(_ spec: GaugeSpec) -> HeroGaugeTileModel {
            let safeValue = HeroGaugesFormat.safeNumber(spec.rawValue)
            let safeMax = HeroGaugesFormat.safeNumber(spec.maxValue)
            let clamped = min(max(safeValue, 0), safeMax)
            let decimals = clamped == clamped.rounded() ? 0 : 2
            return HeroGaugeTileModel(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                value: HeroGaugesFormat.number(clamped, decimals: decimals, localeIdentifier: locale),
                unit: spec.unit,
                fraction: safeMax <= 0 ? 0 : clamped / safeMax,
                accent: spec.accent
            )
        }

        /// The Avg $/kWh readout: the web pre-rounds to 2 decimals (`parseFloat(fmtNumber(x, 2))`)
        /// then renders it through `AnimatedNumber` at 3 decimals behind a "$" prefix.
        func cost() -> HeroCostMetric {
            let preRounded = HeroGaugesFormat.round(stats.avgCostPerKwh, places: 2)
            return HeroCostMetric(
                id: "avg-cost-per-kwh",
                labelKey: "charging.gauges.avgCostPerKwh",
                labelFallback: "Avg $/kWh",
                value: HeroGaugesFormat.currency(
                    preRounded,
                    symbol: units.currencySymbol,
                    decimals: 3,
                    localeIdentifier: locale
                )
            )
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the gauge grid. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum HeroGaugesAccessibility {
    /// One spoken phrase per gauge plus the cost readout, e.g.
    /// "Sessions 42. Energy 251 kWh. Total Cost 413 $. Avg Power 48 kW. Avg $/kWh $0.160".
    public static func summary(for projection: HeroGaugesProjection) -> String {
        let gaugePhrases = projection.gauges.map { "\($0.label) \($0.spokenValue)" }
        let costPhrase = "\(projection.cost.label) \(projection.cost.value)"
        return (gaugePhrases + [costPhrase]).joined(separator: ". ")
    }
}
