//
//  CostForecastSection.Adapter.swift
//  TeslaSync — P4 feature view · 0109 · CostForecastSection (Apple)
//
//  The testable projection core for the cost-forecast section: the decoded domain
//  models (parity with the web `CostForecastData` — `historical` + `forecast`), the
//  `safe()` numeric guard (port of the web `safe` from `@/components/charts`), the
//  two `hasForecast` / `hasCostPerKwhTrend` gates (web L24/L25), the combined
//  forecast-chart projection (web `ComposedChart` — the actual-cost area, the
//  projected-cost line, and the 95%-confidence band), the cost-per-kWh trend series
//  (web `LineChart`), and the VoiceOver summary builders. Everything here is pure +
//  dependency-free (Foundation only) so it can be unit-tested without a store or a
//  rendered view.
//

import Foundation

// MARK: - Numeric guard (port of the web `safe`)

/// Numeric helpers shared by the projection. `safe` is the native port of the web
/// `safe = (v) => typeof v === 'number' && isFinite(v) ? v : 0`, used everywhere a
/// cost / rate feeds an axis, a band, or a label so a `NaN` / `Infinity` never
/// reaches the chart.
public enum CostNumeric {
    /// Returns the value when it is finite, else `0` (web `safe`).
    public static func safe(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return 0 }
        return value
    }

    /// Abbreviated magnitude (no currency symbol); non-finite input renders an em
    /// dash. Used by the dollar axis (web `YAxis unit="$"`) — the view prefixes the
    /// currency symbol so the label reads "$1.2k".
    public static func axisLabel(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        let magnitude = abs(value)
        switch magnitude {
        case 1_000_000...:
            return String(format: "%.1fM", value / 1_000_000)
        case 1000...:
            return String(format: "%.1fk", value / 1000)
        case 0 ..< 10:
            // Cost-per-kWh lives here ($0.12–$0.40); keep the cents.
            return String(format: "%.2f", value)
        default:
            return String(format: "%.0f", value)
        }
    }
}

// MARK: - Domain models (port of `CostForecastData`)

/// One historical month (web `CostHistoricalMonth`). The section plots `cost`
/// (actual-cost area) and `costPerKwh` (trend line); `kwh` / `sessions` are carried
/// so the accessible summary and downstream reuse stay faithful to the web shape.
public struct CostHistoricalMonth: Identifiable, Equatable, Sendable {
    public var month: String
    public var cost: Double
    public var kwh: Double
    public var sessions: Double
    public var costPerKwh: Double

    public var id: String {
        month
    }

    public init(month: String, cost: Double, costPerKwh: Double, kwh: Double = 0, sessions: Double = 0) {
        self.month = month
        self.cost = cost
        self.costPerKwh = costPerKwh
        self.kwh = kwh
        self.sessions = sessions
    }
}

/// One forecast month (web `CostForecastMonth`). The section plots `cost`
/// (projected-cost dashed line) and the `[costLow, costHigh]` 95%-confidence band;
/// `kwh` is carried for completeness.
public struct CostForecastMonth: Identifiable, Equatable, Sendable {
    public var month: String
    public var cost: Double
    public var costLow: Double
    public var costHigh: Double
    public var kwh: Double

    public var id: String {
        month
    }

    public init(month: String, cost: Double, costLow: Double, costHigh: Double, kwh: Double = 0) {
        self.month = month
        self.cost = cost
        self.costLow = costLow
        self.costHigh = costHigh
        self.kwh = kwh
    }
}

/// The cost-forecast slice the section renders (web `forecastData`). `historical`
/// backs the actual-cost area + the cost-per-kWh trend; `forecast` backs the
/// projected-cost line + the confidence band. Optional upstream (web
/// `forecastData: CostForecastData | undefined`) — the model owns that.
public struct CostForecastData: Equatable, Sendable {
    public var historical: [CostHistoricalMonth]
    public var forecast: [CostForecastMonth]

    public init(historical: [CostHistoricalMonth] = [], forecast: [CostForecastMonth] = []) {
        self.historical = historical
        self.forecast = forecast
    }

    /// Whether the slice carries nothing to plot in either chart.
    public var isEmpty: Bool {
        historical.isEmpty && forecast.isEmpty
    }
}

// MARK: - Chart series (the view models the two charts render)

/// One actual-cost point (web historical `actual` area datum).
public struct ForecastActualPoint: Identifiable, Equatable, Sendable {
    public var month: String
    public var cost: Double

    public var id: String {
        month
    }

    public init(month: String, cost: Double) {
        self.month = month
        self.cost = cost
    }
}

/// One projected-cost point (web forecast `forecast` dashed-line datum).
public struct ForecastProjectedPoint: Identifiable, Equatable, Sendable {
    public var month: String
    public var cost: Double

    public var id: String {
        month
    }

    public init(month: String, cost: Double) {
        self.month = month
        self.cost = cost
    }
}

/// One 95%-confidence band point (web forecast `ci_low` + `ci_band`). Swift Charts
/// draws a band natively from `low…high`, so the web's stacked transparent-base +
/// visible-band trick collapses to a single `AreaMark(yStart:yEnd:)`.
public struct ForecastBandPoint: Identifiable, Equatable, Sendable {
    public var month: String
    public var low: Double
    public var high: Double

    public var id: String {
        month
    }

    public init(month: String, low: Double, high: Double) {
        self.month = month
        self.low = low
        self.high = high
    }
}

/// One cost-per-kWh trend point (web historical `cost_per_kwh` line datum).
public struct CostPerKwhPoint: Identifiable, Equatable, Sendable {
    public var month: String
    public var costPerKwh: Double

    public var id: String {
        month
    }

    public init(month: String, costPerKwh: Double) {
        self.month = month
        self.costPerKwh = costPerKwh
    }
}

/// The fully-projected forecast chart (web `ComposedChart` data array + axis). The
/// view renders `actual` (area), `projected` (dashed line), and `band` (area), all
/// ordered along `orderedMonths` with a `0…domainUpperBound` dollar axis.
public struct ForecastChartModel: Equatable, Sendable {
    public var actual: [ForecastActualPoint]
    public var projected: [ForecastProjectedPoint]
    public var band: [ForecastBandPoint]
    public var orderedMonths: [String]
    public var domainUpperBound: Double

    public init(
        actual: [ForecastActualPoint] = [],
        projected: [ForecastProjectedPoint] = [],
        band: [ForecastBandPoint] = [],
        orderedMonths: [String] = [],
        domainUpperBound: Double = 1
    ) {
        self.actual = actual
        self.projected = projected
        self.band = band
        self.orderedMonths = orderedMonths
        self.domainUpperBound = domainUpperBound
    }
}

// MARK: - Projection (port of the web gates + chart data assembly)

/// The pure projection from the decoded `CostForecastData` to the two charts' view
/// models. Each function mirrors a web computation exactly.
public enum CostForecastProjection {
    /// Web `hasForecast = historicalData.length >= 3 && forecast.length > 0` — the
    /// gate that swaps the forecast chart for its empty state.
    public static func hasForecast(_ data: CostForecastData) -> Bool {
        data.historical.count >= 3 && !data.forecast.isEmpty
    }

    /// Web `hasCostPerKwhTrend = historicalData.length > 1` — the gate that swaps
    /// the cost-per-kWh chart for its empty state.
    public static func hasCostPerKwhTrend(_ data: CostForecastData) -> Bool {
        data.historical.count > 1
    }

    /// The combined forecast chart (web `ComposedChart`): the historical months
    /// become the `actual` area, the forecast months become the `projected` line
    /// and the `[costLow, costHigh]` `band`, the x-axis order is historical-then-
    /// forecast (de-duplicated, preserving first appearance), and the dollar axis
    /// tops out a little above the largest of any actual / projected / band-high
    /// value so the band and the top mark are never clipped.
    public static func forecastChart(_ data: CostForecastData) -> ForecastChartModel {
        let actual = data.historical.map {
            ForecastActualPoint(month: $0.month, cost: CostNumeric.safe($0.cost))
        }
        let projected = data.forecast.map {
            ForecastProjectedPoint(month: $0.month, cost: CostNumeric.safe($0.cost))
        }
        let band = data.forecast.map { month -> ForecastBandPoint in
            let low = CostNumeric.safe(month.costLow)
            let high = CostNumeric.safe(month.costHigh)
            // Guard against an inverted band (web `Math.max(0, high - low)`).
            return ForecastBandPoint(month: month.month, low: Swift.min(low, high), high: Swift.max(low, high))
        }

        var ordered: [String] = []
        var seen = Set<String>()
        for month in data.historical.map(\.month) + data.forecast.map(\.month) where seen.insert(month).inserted {
            ordered.append(month)
        }

        var upper = 0.0
        for point in actual {
            upper = Swift.max(upper, point.cost)
        }
        for point in projected {
            upper = Swift.max(upper, point.cost)
        }
        for point in band {
            upper = Swift.max(upper, point.high)
        }

        return ForecastChartModel(
            actual: actual,
            projected: projected,
            band: band,
            orderedMonths: ordered,
            domainUpperBound: Swift.max(upper * 1.1, 1)
        )
    }

    /// The cost-per-kWh trend points (web `LineChart data={historicalData}` plotting
    /// `cost_per_kwh`), each `safe`-guarded.
    public static func costPerKwhPoints(_ data: CostForecastData) -> [CostPerKwhPoint] {
        data.historical.map {
            CostPerKwhPoint(month: $0.month, costPerKwh: CostNumeric.safe($0.costPerKwh))
        }
    }

    /// Upper bound for the cost-per-kWh dollar axis (largest rate, with headroom,
    /// never zero so an all-zero series still renders a sane axis).
    public static func costPerKwhUpperBound(_ points: [CostPerKwhPoint]) -> Double {
        let maxRate = points.reduce(0.0) { Swift.max($0, CostNumeric.safe($1.costPerKwh)) }
        return Swift.max(maxRate * 1.15, 0.1)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// The forecast chart's three series labels, bundled so the summary stays a small
/// function. All values are pre-localized.
public struct ForecastSeriesLabels: Equatable, Sendable {
    public var title: String
    public var actual: String
    public var projected: String
    public var confidence: String

    public init(title: String, actual: String, projected: String, confidence: String) {
        self.title = title
        self.actual = actual
        self.projected = projected
        self.confidence = confidence
    }
}

/// Builds the VoiceOver strings for the two charts so the spoken content can be
/// unit-tested without rendering a view. Each builder takes pre-resolved labels +
/// a currency formatter, so no literal is hardcoded.
public enum CostForecastAccessibility {
    /// "Cost Forecast, Actual Cost Jan–Mar $37.90…$52.40. Projected Cost Apr–Jun
    /// $47.10…$55.00, 95% Confidence $42.00…$62.00." — a concise spoken description
    /// of the composed chart so VoiceOver is not handed an opaque image.
    public static func forecastSummary(
        _ chart: ForecastChartModel,
        labels: ForecastSeriesLabels,
        formatCurrency: (Double) -> String
    ) -> String {
        var parts = [labels.title]

        if let first = chart.actual.first, let last = chart.actual.last {
            let costs = chart.actual.map(\.cost)
            let span = monthSpan(first.month, last.month)
            let low = formatCurrency(costs.min() ?? 0)
            let high = formatCurrency(costs.max() ?? 0)
            parts.append("\(labels.actual) \(span) \(low)…\(high).")
        }

        if let first = chart.projected.first, let last = chart.projected.last {
            let costs = chart.projected.map(\.cost)
            let span = monthSpan(first.month, last.month)
            let low = formatCurrency(costs.min() ?? 0)
            let high = formatCurrency(costs.max() ?? 0)
            parts.append("\(labels.projected) \(span) \(low)…\(high).")
        }

        if !chart.band.isEmpty {
            let low = formatCurrency(chart.band.map(\.low).min() ?? 0)
            let high = formatCurrency(chart.band.map(\.high).max() ?? 0)
            parts.append("\(labels.confidence) \(low)…\(high).")
        }

        return parts.joined(separator: " ")
    }

    /// "Cost per kWh Trend, Jan–Jun, $0.12 to $0.18." — the trend's month span plus
    /// the rate range, spoken as one element.
    public static func costPerKwhSummary(
        _ points: [CostPerKwhPoint],
        title: String,
        formatCurrency: (Double) -> String
    ) -> String {
        guard let first = points.first, let last = points.last else { return title }
        let rates = points.map { CostNumeric.safe($0.costPerKwh) }
        let span = monthSpan(first.month, last.month)
        return "\(title), \(span), \(formatCurrency(rates.min() ?? 0)) … \(formatCurrency(rates.max() ?? 0))."
    }

    private static func monthSpan(_ first: String, _ last: String) -> String {
        first == last ? first : "\(first)–\(last)"
    }
}
