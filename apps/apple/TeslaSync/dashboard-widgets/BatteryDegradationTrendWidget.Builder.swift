//
//  BatteryDegradationTrendWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0012 · BatteryDegradationTrendWidget (Apple)
//
//  Pure cached→projection adapter — a faithful Swift port of the data prep in
//  features/dashboard/widgets/BatteryDegradationTrendWidget.tsx (the `chartData`
//  memo + the SoH / degradation-rate / cycles stat derivations) plus the
//  `fmtNumber` number formatting. State-of-health, degradation rate and cycle
//  count are unitless, so there is no SI→display conversion here (unlike the
//  distance/energy widgets). No SwiftUI / transport — this is the unit-tested core.
//

import Foundation

// MARK: - Number formatting (web `fmtNumber` / `lib/numberFormat.ts`)

/// Grouped decimal formatting matching the web `fmtNumber(value, digits)`.
/// Non-finite input renders an em dash (never "nan").
public enum BatteryDegradationTrendFormat {
    /// U+2212 MINUS SIGN — the exact glyph the web prefixes the degradation rate
    /// with (`−${fmtNumber(rate, 2)}%`), not an ASCII hyphen.
    public static let minusSign = "\u{2212}"
    /// U+2014 EM DASH — the web fallback glyph for a missing stat value.
    public static let emDash = "\u{2014}"

    private static func formatter(fractionDigits: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.usesGroupingSeparator = true
        return formatter
    }

    /// `digits`-decimal, grouped (web `fmtNumber(value, digits)`).
    public static func number(_ value: Double, digits: Int) -> String {
        guard value.isFinite else { return emDash }
        return formatter(fractionDigits: digits).string(from: NSNumber(value: value)) ?? emDash
    }

    /// SoH stat value: `"92.5%"`, or `"—"` when absent (web `currentHealth`).
    public static func healthValue(_ health: Double?) -> String {
        guard let health, health.isFinite else { return emDash }
        return "\(number(health, digits: 1))%"
    }

    /// Degradation stat value: `"−0.42%"` (web `−${fmtNumber(rate, 2)}%`). Only
    /// shown by the view when the rate is present and positive.
    public static func degradationValue(_ rate: Double) -> String {
        guard rate.isFinite else { return emDash }
        return "\(minusSign)\(number(rate, digits: 2))%"
    }

    /// Cycles stat value: grouped integer, or `"—"` when absent (web
    /// `totalCycles != null ? fmtNumber(totalCycles, 0) : '—'`).
    public static func cyclesValue(_ cycles: Double?) -> String {
        guard let cycles, cycles.isFinite else { return emDash }
        return number(cycles, digits: 0)
    }

    /// A whole-percent axis tick (web `tickFormatter={(v) => `${v}%`}`).
    public static func axisPercent(_ value: Double) -> String {
        guard value.isFinite else { return emDash }
        return "\(number(value, digits: 0))%"
    }
}

// MARK: - Projection builder (port of the web `chartData` memo + stat values)

/// Pure adapter that turns the cached monthly-trend rows + degradation summary
/// into the rendered projection, faithfully reproducing the web component's
/// `useMemo` pipeline and the derived stat values.
public enum BatteryDegradationTrendBuilder {
    private static let monthAbbreviations = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ]

    /// Formats `"2026-04"` → `"Apr"` for the native axis tick. Falls back to the
    /// raw value when the input is malformed or the month index is out of range
    /// (so an unexpected backend label is shown verbatim, never dropped).
    public static func shortMonth(_ iso: String) -> String {
        let parts = iso.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count >= 2, let month = Int(parts[1]) else { return iso }
        let index = month - 1
        guard monthAbbreviations.indices.contains(index) else { return iso }
        return monthAbbreviations[index]
    }

    /// Builds the projection: map each trend row to a chart point (web
    /// `chartData`), derive the stat values, compute the chart's lower health
    /// bound (web y-domain `dataMin − 2`), and resolve the `hasTrend` / `isEmpty`
    /// flags exactly as the web component does.
    public static func buildProjection(
        rows: [DegradationTrendRow],
        summary: DegradationSummary
    ) -> BatteryDegradationProjection {
        let points = rows.map { row in
            DegradationTrendPoint(
                month: row.month,
                monthLabel: shortMonth(row.month),
                health: row.avgHealth,
                range: row.avgRange
            )
        }
        let resolvedHealth = summary.resolvedHealth
        let healthFloor = floor(forHealthValues: points.map(\.health))
        return BatteryDegradationProjection(
            points: points,
            currentHealth: resolvedHealth,
            degradationRate: summary.degradationRatePctPerMonth,
            cycles: summary.currentCycles,
            healthFloor: healthFloor,
            hasTrend: points.count > 1,
            isEmpty: resolvedHealth == nil && points.isEmpty
        )
    }

    /// Whether the degradation-rate stat should render (web
    /// `degradationRate != null && degradationRate > 0`).
    public static func showsDegradationRate(_ rate: Double?) -> Bool {
        guard let rate, rate.isFinite else { return false }
        return rate > 0
    }

    /// The chart's lower y bound — `min(health) − 2`, clamped to ≥ 0 (web
    /// `domain={['dataMin - 2', 100]}`). Defaults to the 80% threshold when there
    /// are no points so an empty chart still frames the warranty marker.
    private static func floor(forHealthValues values: [Double]) -> Double {
        let finite = values.filter(\.isFinite)
        guard let minimum = finite.min() else {
            return BatteryDegradationProjection.healthThreshold
        }
        return max(0, minimum - 2)
    }
}
