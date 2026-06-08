//
//  ForecastDetails.Adapter.swift
//  TeslaSync — P4 feature view · 0113 · ForecastDetails (Apple)
//
//  The testable projection core for the cost-forecast detail section: the decoded
//  domain models (parity with the web `CostForecastData` slice — the
//  `breakdown` / `gas_comparison` / `insights` the section actually renders), the
//  `safe()` numeric guard (port of the web `safe` from `@/components/charts`), the
//  two-slice charging-breakdown donut projection (web `<Pie data={[home, super]}>`),
//  the gas-vs-EV savings figures (web `gas_comparison`), and the VoiceOver summary
//  builders. Everything here is pure + dependency-free (Foundation only) so it can
//  be unit-tested without a store or a rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safe`)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `safe = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used everywhere a
/// metric feeds arithmetic (a donut angle, a savings figure, a label) so a `NaN` /
/// `Infinity` never reaches a sector, a width, or a formatted string.
public enum ForecastNumeric {
    /// Returns the value when it is finite, else `0` (web `safe`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }
}

// MARK: - Breakdown categories (port of `CostBreakdownData`)

/// The two charging-cost categories the breakdown donut plots (web
/// `breakdown.home` / `breakdown.supercharger`). Stable identity so the view and the
/// donut agree on color + order without leaking SwiftUI into this pure layer.
public enum ForecastCategoryKind: String, CaseIterable, Sendable {
    case home
    case supercharger

    /// The P1/S10 facade key + web English fallback for the category label
    /// (web `t('Home')` / `t('Supercharger')`).
    public var labelKey: (key: String, fallback: String) {
        switch self {
        case .home: ("costAnalysis.forecast.home", "Home")
        case .supercharger: ("costAnalysis.forecast.supercharger", "Supercharger")
        }
    }
}

/// One charging-cost category (web `ChargerCategoryData` — `{ pct, avg_cost_per_kwh,
/// monthly_avg }`). The section reads `pct` (donut angle) and `avgCostPerKwh`
/// (legend `/kWh`); `monthlyAvg` is carried for completeness + the spoken summary.
public struct ForecastCategory: Equatable, Sendable {
    public var pct: Double
    public var avgCostPerKwh: Double
    public var monthlyAvg: Double

    public init(pct: Double, avgCostPerKwh: Double, monthlyAvg: Double = 0) {
        self.pct = pct
        self.avgCostPerKwh = avgCostPerKwh
        self.monthlyAvg = monthlyAvg
    }
}

/// The charging breakdown (web `breakdown` — `{ home, supercharger }`).
public struct ForecastBreakdown: Equatable, Sendable {
    public var home: ForecastCategory
    public var supercharger: ForecastCategory

    public init(home: ForecastCategory, supercharger: ForecastCategory) {
        self.home = home
        self.supercharger = supercharger
    }
}

// MARK: - Gas-vs-EV comparison (port of `GasComparisonData`)

/// The gas-vs-EV savings figures (web `gas_comparison`). `safe()` is applied by the
/// projection so every field is finite before it reaches a formatter.
public struct ForecastGasComparison: Equatable, Sendable {
    public var avgKmPerMonth: Double
    public var gasCostPerMonth: Double
    public var evCostPerMonth: Double
    public var monthlySavings: Double
    public var annualSavings: Double
    public var lifetimeSavings: Double

    public init(
        avgKmPerMonth: Double,
        gasCostPerMonth: Double,
        evCostPerMonth: Double,
        monthlySavings: Double,
        annualSavings: Double,
        lifetimeSavings: Double
    ) {
        self.avgKmPerMonth = avgKmPerMonth
        self.gasCostPerMonth = gasCostPerMonth
        self.evCostPerMonth = evCostPerMonth
        self.monthlySavings = monthlySavings
        self.annualSavings = annualSavings
        self.lifetimeSavings = lifetimeSavings
    }
}

// MARK: - The forecast slice (port of `CostForecastData`, scoped to this surface)

/// The cost-forecast slice this section renders. The web component takes the whole
/// `CostForecastData | undefined` as a prop and reads only `breakdown`,
/// `gas_comparison`, and `insights` (the historical / forecast month series belong
/// to sibling surfaces), so this model carries exactly those three. Optionality is
/// at the `CostForecast?` level — the parity of the web `forecastData ? … : empty`
/// guard the breakdown + savings panels share.
public struct CostForecast: Equatable, Sendable {
    public var breakdown: ForecastBreakdown
    public var gasComparison: ForecastGasComparison
    public var insights: [String]

    public init(breakdown: ForecastBreakdown, gasComparison: ForecastGasComparison, insights: [String]) {
        self.breakdown = breakdown
        self.gasComparison = gasComparison
        self.insights = insights
    }
}

// MARK: - Breakdown donut slices (port of the web `<Pie data={[home, super]}>`)

/// One donut slice — the category kind (color + order), the `pct` angle value (web
/// `value: pct`), and the legend's `avg_cost_per_kwh` (web `<Currency precision=3
/// />/kWh`). `pct` is passed through `safe()` so a non-finite percentage never
/// reaches a `SectorMark` angle.
public struct ForecastBreakdownSlice: Identifiable, Equatable, Sendable {
    public var kind: ForecastCategoryKind
    public var pct: Double
    public var avgCostPerKwh: Double

    public var id: String {
        kind.rawValue
    }

    public init(kind: ForecastCategoryKind, pct: Double, avgCostPerKwh: Double) {
        self.kind = kind
        self.pct = pct
        self.avgCostPerKwh = avgCostPerKwh
    }
}

// MARK: - Projection (port of the web inline data)

/// The pure projection from the decoded `CostForecast` to the view models the three
/// panels render. Each function mirrors a web computation exactly.
public enum ForecastProjection {
    /// The two breakdown donut slices in the web's fixed order: Home (green) then
    /// Supercharger (amber), matching `data={[{ Home }, { Supercharger }]}` and the
    /// `<Cell fill="#22c55e" />` / `<Cell fill="#f59e0b" />` order. Each `pct` and
    /// `avgCostPerKwh` is guarded by `safe()`.
    public static func breakdownSlices(_ breakdown: ForecastBreakdown) -> [ForecastBreakdownSlice] {
        [
            ForecastBreakdownSlice(
                kind: .home,
                pct: ForecastNumeric.safe(breakdown.home.pct),
                avgCostPerKwh: ForecastNumeric.safe(breakdown.home.avgCostPerKwh)
            ),
            ForecastBreakdownSlice(
                kind: .supercharger,
                pct: ForecastNumeric.safe(breakdown.supercharger.pct),
                avgCostPerKwh: ForecastNumeric.safe(breakdown.supercharger.avgCostPerKwh)
            )
        ]
    }

    /// The gas-vs-EV savings figures with `safe()` applied to every field, so the
    /// hero count-up, the annual/lifetime cards, and the cost rows always format a
    /// finite value (web reads the raw `gas_comparison` numbers).
    public static func savings(_ comparison: ForecastGasComparison) -> ForecastGasComparison {
        ForecastGasComparison(
            avgKmPerMonth: ForecastNumeric.safe(comparison.avgKmPerMonth),
            gasCostPerMonth: ForecastNumeric.safe(comparison.gasCostPerMonth),
            evCostPerMonth: ForecastNumeric.safe(comparison.evCostPerMonth),
            monthlySavings: ForecastNumeric.safe(comparison.monthlySavings),
            annualSavings: ForecastNumeric.safe(comparison.annualSavings),
            lifetimeSavings: ForecastNumeric.safe(comparison.lifetimeSavings)
        )
    }

    /// The non-empty insight strings (web `(forecastData?.insights ?? [])` — blank
    /// entries are dropped so an all-whitespace insight never renders an empty row).
    public static func insights(_ insights: [String]) -> [ForecastInsight] {
        insights
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .enumerated()
            .map { ForecastInsight(index: $0.offset, text: $0.element) }
    }
}

/// One insight row (web `insights.map((insight, i) => …)`), carrying its source
/// index for a stable identity + the spoken "n of m" position.
public struct ForecastInsight: Identifiable, Equatable, Sendable {
    public var index: Int
    public var text: String

    public var id: Int {
        index
    }

    public init(index: Int, text: String) {
        self.index = index
        self.text = text
    }
}

// MARK: - Accessibility summaries (testable seam)

/// The legend / savings labels, bundled so the summary builders stay small functions
/// (and avoid wide tuples). All values are pre-localized through the P1/S10 facade.
public struct ForecastSavingsLabels: Equatable, Sendable {
    public var monthly: String
    public var annual: String
    public var lifetime: String
    public var gasCost: String
    public var evCost: String
    public var avgKm: String

    public init(monthly: String, annual: String, lifetime: String, gasCost: String, evCost: String, avgKm: String) {
        self.monthly = monthly
        self.annual = annual
        self.lifetime = lifetime
        self.gasCost = gasCost
        self.evCost = evCost
        self.avgKm = avgKm
    }
}

/// Builds the VoiceOver strings for the section's data so the spoken content can be
/// unit-tested without rendering a view. Each builder takes the P1/S10 `localize`
/// facade plus pre-resolved formatters, so no literal is hardcoded.
public enum ForecastAccessibility {
    /// "Home, 62% — $0.140 per kWh" — the category label, integer percent, and the
    /// per-kWh rate (web legend `<Currency precision=3 />/kWh`).
    public static func sliceSummary(
        _ slice: ForecastBreakdownSlice,
        label: String,
        perKwhWord: String,
        formatCurrency: (Double) -> String
    ) -> String {
        let percent = Int(ForecastNumeric.safe(slice.pct).rounded())
        return "\(label), \(percent)% — \(formatCurrency(slice.avgCostPerKwh)) \(perKwhWord)"
    }

    /// The whole donut spoken as one element: the title plus each slice summary, so
    /// the chart is never an opaque image to VoiceOver.
    public static func donutSummary(
        title: String,
        slices: [ForecastBreakdownSlice],
        label: (ForecastCategoryKind) -> String,
        perKwhWord: String,
        formatCurrency: (Double) -> String
    ) -> String {
        let parts = slices.map {
            sliceSummary($0, label: label($0.kind), perKwhWord: perKwhWord, formatCurrency: formatCurrency)
        }
        return ([title] + parts).joined(separator: ". ")
    }

    /// "Monthly Savings $182. Annual $2,184. Lifetime $32,760. Gas cost/mo $240. EV
    /// cost/mo $58. Avg km/mo 1,450." — the savings panel spoken as one element.
    public static func savingsSummary(
        _ comparison: ForecastGasComparison,
        labels: ForecastSavingsLabels,
        formatCurrency: (Double) -> String,
        formatInt: (Double) -> String
    ) -> String {
        let parts = [
            "\(labels.monthly) \(formatCurrency(comparison.monthlySavings))",
            "\(labels.annual) \(formatCurrency(comparison.annualSavings))",
            "\(labels.lifetime) \(formatCurrency(comparison.lifetimeSavings))",
            "\(labels.gasCost) \(formatCurrency(comparison.gasCostPerMonth))",
            "\(labels.evCost) \(formatCurrency(comparison.evCostPerMonth))",
            "\(labels.avgKm) \(formatInt(comparison.avgKmPerMonth))"
        ]
        return parts.joined(separator: ". ")
    }

    /// "Insight 2 of 4: Charge overnight to cut your blended rate." — one insight row
    /// spoken with its position so the list is navigable.
    public static func insightSummary(_ insight: ForecastInsight, total: Int, prefix: String) -> String {
        "\(prefix) \(insight.index + 1) / \(total): \(insight.text)"
    }
}
