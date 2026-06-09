//
//  CostForecastWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0032 · CostForecastWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/CostForecastWidget.tsx (`buildChartData` + the
//  `nextCost` / `lastCost` / `trendUp` derivations). The number formatting
//  mirrors the web `fmtNumber` (`Intl.NumberFormat` with fixed fraction digits)
//  that backs `formatCurrency`. No SwiftUI / transport here — this is the
//  unit-tested core.
//

import Foundation

// MARK: - Number formatting (web `fmtNumber` → Intl.NumberFormat)

/// Locale-aware fixed-decimal number formatting that mirrors the web `fmtNumber`
/// used by `formatCurrency`: `safeNumber(v).toLocaleString(locale, {
/// minimumFractionDigits: d, maximumFractionDigits: d })`.
public enum CostForecastWidgetFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0 (the
    /// web feeds every value through `safeNumber` first).
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals)` — fixed fraction digits, grouped, rounding half
    /// away from zero to match `Intl.NumberFormat`'s default `halfExpand`.
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
}

// MARK: - Projection builder (port of the web buildChartData / stat derivations)

/// Pure adapter that turns the cached historical + forecast months into the
/// rendered projection, faithfully reproducing the web component's data prep.
public enum CostForecastWidgetBuilder {
    /// Builds the projection: concatenate historical (oldest→newest) then
    /// forecast months into bars, keep the last six (web `slice(-6)`), then
    /// derive the next-month / last-month costs, the trend direction + absolute
    /// delta, and the most-recent `cost_per_kwh`. `hasData` mirrors the web
    /// `chartData.length > 0`.
    public static func buildProjection(
        historical: [CostForecastWidgetHistoricalMonth],
        forecast: [CostForecastWidgetForecastMonth]
    ) -> CostForecastWidgetProjection {
        var all: [CostForecastWidgetBar] = []
        all.reserveCapacity(historical.count + forecast.count)

        for month in historical {
            all.append(
                CostForecastWidgetBar(
                    plotKey: String(format: "%04d", all.count),
                    month: month.month ?? "—",
                    cost: month.cost ?? 0,
                    isForecast: false
                )
            )
        }
        for month in forecast {
            all.append(
                CostForecastWidgetBar(
                    plotKey: String(format: "%04d", all.count),
                    month: month.month ?? "—",
                    cost: month.cost ?? 0,
                    isForecast: true
                )
            )
        }

        let bars = Array(all.suffix(6))
        let nextCost = forecast.first?.cost ?? 0
        let lastCost = historical.last?.cost ?? 0
        let trendUp = nextCost >= lastCost
        let trendDelta = abs(nextCost - lastCost)
        let avgCostPerKwh: Double? = historical.last.map { $0.costPerKwh ?? 0 }

        return CostForecastWidgetProjection(
            bars: bars,
            nextCost: nextCost,
            lastCost: lastCost,
            trendUp: trendUp,
            trendDelta: trendDelta,
            avgCostPerKwh: avgCostPerKwh,
            hasData: !bars.isEmpty
        )
    }
}
