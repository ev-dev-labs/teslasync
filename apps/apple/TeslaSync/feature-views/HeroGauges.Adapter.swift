//
//  HeroGauges.Adapter.swift
//  TeslaSync — P4 feature view · 0058 · HeroGauges (Apple)
//
//  The testable projection core: cached `HeroAnalyticsDTO` + `HeroUnitPrefs` → the six
//  view-ready `HeroGaugeTileModel`s, reproducing the web source's numeric pipeline VERBATIM so
//  the native surface shows the exact same values as
//  features/analytics/components/analytics/HeroGauges.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the conversion + formatting compile and run
//  on a plain host and are pinned by unit tests. `HeroAccent` carries only the web colour name
//  (cyan/purple/green/amber); the token mapping lives in HeroGauges.Views.swift.
//

import Foundation

// MARK: - Conversion + heuristic constants (ported from the web source)

private enum HeroGaugesConstants {
    /// `KM_PER_MILE` from the web source — the exact factor used to turn the API's Wh/km into the
    /// displayed Wh/mi when the user prefers miles (`avgEffWhPerKm * KM_PER_MILE`).
    static let kmPerMile = 1.609344

    /// Metres in a kilometre — the web passes `total_distance_km * 1000` into `convertDistanceFromSI`.
    static let metersPerKilometer = 1000.0

    /// Gas-savings heuristic, tied to KM regardless of display unit so the dollar output stays
    /// stable for the same trip: `gasSavings = total_distance_km * 0.085 * 1.5 - safe(total_cost)`.
    /// (`0.085` ≈ gallons burned per km by a comparable ICE car; `1.5` ≈ price per gallon.)
    static let gasGallonsPerKilometer = 0.085
    static let gasPricePerGallon = 1.5

    /// CO₂-saved heuristic (kg per km), also KM-tied: `co2Saved = total_distance_km * 0.12`.
    static let co2KilogramsPerKilometer = 0.12
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in
/// lib/unitConversion.ts — a divide by the unit's metres-per-unit factor, with the same
/// non-finite-collapses-to-zero guard the web `safe`/`safeNumber` helpers apply.
func convertHeroDistanceFromSI(_ meters: Double, to unit: HeroDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number / currency formatting (ported from web lib/numberFormat.ts + useFormatting.ts)

/// Locale-aware number + currency formatting that mirrors the web `fmtNumber` / `fmtInt`
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
}

// MARK: - Accent (web `MetricCard color`) — token mapping lives in the view layer

/// The colour name the web `MetricCard` carries for a gauge's icon chip (`cyan` / `purple` /
/// `green` / `amber`). Kept as a pure value here so the projection stays SwiftUI-free; the SwiftUI
/// token mapping is in `HeroGauges.Views.swift`.
public enum HeroAccent: String, Sendable, Equatable {
    case cyan
    case purple
    case green
    case amber
}

// MARK: - Projected gauge tile (web `MetricCard`)

/// One projected gauge: a localized label, a formatted value, an optional unit subtitle, an SF
/// Symbol, and the accent for its icon chip. Mirrors the web `MetricCard` props
/// (`label` / `value` / `subtitle` / `icon` / `color`).
public struct HeroGaugeTileModel: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let subtitle: String?
    public let systemImage: String
    public let accent: HeroAccent

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        subtitle: String?,
        systemImage: String,
        accent: HeroAccent
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.accent = accent
    }

    /// The resolved (localized) label for display + accessibility (P1/S10 facade).
    public var label: String {
        HeroGaugesStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected surface content: the six gauges in the web's render order.
public struct HeroGaugesProjection: Equatable, Sendable {
    public let tiles: [HeroGaugeTileModel]

    public init(tiles: [HeroGaugeTileModel]) {
        self.tiles = tiles
    }
}

/// Pure projector: `HeroAnalyticsDTO` + `HeroUnitPrefs` → `HeroGaugesProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web component so the web and native
/// surfaces show identical numbers side by side.
public enum HeroGaugesProjector {
    public static func project(analytics: HeroAnalyticsDTO, units: HeroUnitPrefs) -> HeroGaugesProjection {
        let context = Context(analytics: analytics, units: units)
        return HeroGaugesProjection(tiles: context.distanceDrivesEnergy() + context.efficiencyGasCo2())
    }

    /// Pure per-projection context bundling the inputs so the six-gauge math splits into two short,
    /// focused builders while keeping every value byte-for-byte identical to the web source.
    private struct Context {
        let analytics: HeroAnalyticsDTO
        let units: HeroUnitPrefs

        private var locale: String {
            units.localeIdentifier
        }

        /// backend `total_distance_km` is SI km — go through the meter-floored helper exactly like the
        /// web source (`convertDistanceFromSI(totalDistKm * 1000, distanceUnit)`).
        func distanceDrivesEnergy() -> [HeroGaugeTileModel] {
            let totalDist = convertHeroDistanceFromSI(
                analytics.totalDistanceKm * HeroGaugesConstants.metersPerKilometer,
                to: units.distance
            )
            return [
                HeroGaugeTileModel(
                    id: "distance",
                    labelKey: "analytics.hero.distance",
                    labelFallback: "Distance",
                    value: HeroGaugesFormat.number(totalDist, decimals: 1, localeIdentifier: locale),
                    subtitle: units.distance.symbol,
                    systemImage: "mappin.and.ellipse",
                    accent: .cyan
                ),
                HeroGaugeTileModel(
                    id: "drives",
                    labelKey: "analytics.hero.drives",
                    labelFallback: "Drives",
                    value: HeroGaugesFormat.integer(analytics.totalDrives, localeIdentifier: locale),
                    subtitle: nil,
                    systemImage: "car.fill",
                    accent: .purple
                ),
                HeroGaugeTileModel(
                    id: "energy",
                    labelKey: "analytics.hero.energy",
                    labelFallback: "Energy",
                    value: HeroGaugesFormat.number(analytics.totalEnergyKwh, decimals: 1, localeIdentifier: locale),
                    subtitle: "kWh",
                    systemImage: "bolt.fill",
                    accent: .green
                )
            ]
        }

        /// Efficiency (Wh/km, or Wh/mi scaled by KM_PER_MILE when miles), plus the KM-tied gas-savings
        /// + CO₂ heuristics whose dollar/kg outputs stay stable for the same trip regardless of unit.
        func efficiencyGasCo2() -> [HeroGaugeTileModel] {
            let avgEffDisplay = units.distance == .miles
                ? analytics.avgEfficiencyWhKm * HeroGaugesConstants.kmPerMile
                : analytics.avgEfficiencyWhKm
            let efficiencyUnit = units.distance == .miles ? "Wh/mi" : "Wh/km"
            let gasSavings = analytics.totalDistanceKm * HeroGaugesConstants.gasGallonsPerKilometer
                * HeroGaugesConstants.gasPricePerGallon
                - HeroGaugesFormat.safeNumber(analytics.totalCost)
            let co2Saved = analytics.totalDistanceKm * HeroGaugesConstants.co2KilogramsPerKilometer
            return [
                HeroGaugeTileModel(
                    id: "efficiency",
                    labelKey: "analytics.hero.efficiency",
                    labelFallback: "Efficiency",
                    value: HeroGaugesFormat.number(avgEffDisplay, decimals: 1, localeIdentifier: locale),
                    subtitle: efficiencyUnit,
                    systemImage: "gauge.medium",
                    accent: .amber
                ),
                HeroGaugeTileModel(
                    id: "gas-savings",
                    labelKey: "analytics.hero.gasSavings",
                    labelFallback: "Gas Savings",
                    value: HeroGaugesFormat.currency(
                        max(gasSavings, 0),
                        symbol: units.currencySymbol,
                        decimals: 0,
                        localeIdentifier: locale
                    ),
                    subtitle: nil,
                    systemImage: "dollarsign.circle.fill",
                    accent: .green
                ),
                HeroGaugeTileModel(
                    id: "co2-saved",
                    labelKey: "analytics.hero.co2Saved",
                    labelFallback: "CO₂ Saved",
                    value: HeroGaugesFormat.number(co2Saved, decimals: 0, localeIdentifier: locale),
                    subtitle: "kg",
                    systemImage: "leaf.fill",
                    accent: .green
                )
            ]
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the gauge grid. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum HeroGaugesAccessibility {
    /// One spoken phrase per gauge, e.g. "Distance 31.0 km. Drives 1,234. Energy 9.5 kWh. …".
    public static func summary(for projection: HeroGaugesProjection) -> String {
        projection.tiles.map { tile in
            if let subtitle = tile.subtitle {
                "\(tile.label) \(tile.value) \(subtitle)"
            } else {
                "\(tile.label) \(tile.value)"
            }
        }
        .joined(separator: ". ")
    }
}
