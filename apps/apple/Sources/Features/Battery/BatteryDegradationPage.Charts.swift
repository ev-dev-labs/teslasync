import SwiftUI

// The charts on the Battery Degradation surface, built on the P3 native Swift Charts
// wrappers (never a WKWebView): the state-of-health `RadialGauge`, the health-trend
// projection (web `ChartContainer` + `ComposedChart` → a native multi-series line
// chart with the actual/projected lines + confidence bounds), the range-loss
// `AreaChart`, and the scored risk-factor gauges. Each renders its own empty state
// (never a blank region) and an accessible summary; SI kilometres convert to the
// user's distance unit at this boundary (ADR-005). The chart-chrome helpers
// (`BatteryChartLegend` / `BatteryReferenceRow` / `BatteryAxisCaption`) are shared
// with the sibling Battery Cells charts.

// MARK: - Health gauge (web GlassPanel5 — RadialGauge + band badge)

/// The state-of-health gauge panel (web GlassPanel5): a `TSRadialGauge` of current SOH
/// tinted by the web `sohColor` band (> 90 green / ≥ 80 amber / else red) with the
/// Excellent / Good / Degraded band badge beneath it.
struct BatteryDegradationGaugeSection: View {
    let health: BatteryHealthData

    private var fraction: Double {
        min(max(health.currentSoh / 100, 0), 1)
    }

    /// Web `sohColor`: > 90 green (palette 2), ≥ 80 amber (palette 1), else red (palette 5).
    private var colorIndex: Int {
        if health.currentSoh > 90 { return 2 }
        if health.currentSoh >= 80 { return 1 }
        return 5
    }

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                TSRadialGauge(value: fraction, label: "Battery Health", colorIndex: colorIndex)
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel(Text("Battery Health"))
                TSBadge(LocalizedStringKey(health.sohBandKey), tone: health.sohSeverity.tone)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Health trend projection (web Health-Trend-Projection — ChartContainer + ComposedChart)

/// The health-trend projection (web Health-Trend-Projection): a `TSChartContainer`
/// framing the native port of the web `ComposedChart` — a multi-series line chart of
/// the actual health history, the projected future, and the 95% confidence bounds —
/// with the 80% warranty + 70% threshold reference values surfaced beneath. Renders the
/// not-enough-data empty state when there is nothing to project.
struct BatteryDegradationProjectionSection: View {
    let rows: [BatteryProjectionRow]

    var body: some View {
        TSChartContainer("battery.degradation.trendTitle", summary: "battery.degradation.trendTitle.aria") {
            if rows.isEmpty {
                TSEmptyState(title: "battery.degradation.needMore", systemImage: "chart.line.uptrend.xyaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSLineChart(series: series, smooth: false)
                        .frame(height: 280)
                        .accessibilityLabel(Text("battery.degradation.trendTitle.aria"))
                    BatteryChartLegend(items: legend)
                    BatteryReferenceRow(items: references)
                    BatteryDegradationTimeAxis(labels: rows.map(\.label))
                }
            }
        }
    }

    private var series: [TSChartSeries] {
        [
            lineSeries(id: "health", name: "battery.degradation.actualHealth", text: "Actual Health %", color: 2) {
                $0.health
            },
            lineSeries(id: "projected", name: "battery.degradation.projected", text: "Projected %", color: 6) {
                $0.projected
            },
            lineSeries(id: "ci-low", name: "battery.degradation.confidence", text: "95% Confidence", color: 4) {
                $0.confidenceLow
            },
            lineSeries(id: "ci-high", name: "battery.degradation.confidence", text: "95% Confidence", color: 4) {
                $0.confidenceHigh
            }
        ]
    }

    private func lineSeries(
        id: String,
        name: LocalizedStringKey,
        text: String,
        color: Int,
        value: (BatteryProjectionRow) -> Double?
    ) -> TSChartSeries {
        let points = rows.compactMap { row -> TSChartPoint? in
            guard let yValue = value(row) else { return nil }
            return TSChartPoint(x: Double(row.index), y: yValue, id: "\(id)-\(row.index)")
        }
        return TSChartSeries(id: id, name: name, nameText: text, points: points, colorIndex: color)
    }

    /// One legend entry each for actual, projected, and the (single) confidence band.
    private var legend: [BatteryLegendItem] {
        [
            legendItem("health", "battery.degradation.actualHealth", 2),
            legendItem("projected", "battery.degradation.projected", 6),
            legendItem("ci", "battery.degradation.confidence", 4)
        ]
    }

    private func legendItem(_ id: String, _ name: LocalizedStringKey, _ colorIndex: Int) -> BatteryLegendItem {
        BatteryLegendItem(id: id, name: name, color: TSChartPalette.color(at: colorIndex))
    }

    /// Web `ReferenceLine` labels: the 80% warranty threshold and the 70% critical line.
    private var references: [BatteryReferenceItem] {
        [
            BatteryReferenceItem(
                id: "warranty",
                label: "battery.degradation.warranty",
                value: "80%",
                color: TSChartPalette.color(at: 1)
            ),
            BatteryReferenceItem(id: "critical", label: "Degraded", value: "70%", color: TSChartPalette.color(at: 5))
        ]
    }
}

/// A compact first/last label caption beneath a projection chart (the line wrapper uses
/// a numeric x-axis, so the date span is surfaced here, mirroring the web X-axis ticks).
struct BatteryDegradationTimeAxis: View {
    let labels: [String]

    var body: some View {
        if let first = labels.first, let last = labels.last {
            HStack {
                Text(verbatim: first)
                Spacer()
                Text(verbatim: last)
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Range loss (web GlassPanel12 — AreaChart)

/// The range-loss panel (web GlassPanel12): a `TSAreaChart` of the original vs current
/// range over the history window, or the no-range empty state. SI kilometres convert to
/// the user's distance unit at this boundary.
struct BatteryDegradationRangeLossSection: View {
    let health: BatteryHealthData
    let units: UnitPreferences

    private var rows: [BatteryRangeRow] {
        health.rangeRows
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSubhead("battery.degradation.rangeLoss")
                if rows.isEmpty {
                    TSEmptyState(title: "battery.degradation.noRange", systemImage: "minus.plus.batteryblock")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    TSAreaChart(series: series)
                        .frame(height: 240)
                        .accessibilityLabel(Text("battery.degradation.rangeLoss"))
                    BatteryChartLegend(items: legend)
                    BatteryAxisCaption(yLabel: "Range", xLabel: "Date")
                    BatteryDegradationTimeAxis(labels: rows.map(\.label))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var series: [TSChartSeries] {
        let original = rows.map { rangePoint(index: $0.index, kilometres: $0.originalKm, prefix: "o") }
        let current = rows.map { rangePoint(index: $0.index, kilometres: $0.currentKm, prefix: "c") }
        return [
            TSChartSeries(
                id: "original",
                name: "Original Range",
                nameText: "Original Range",
                points: original,
                colorIndex: 0
            ),
            TSChartSeries(
                id: "current",
                name: "Current Range",
                nameText: "Current Range",
                points: current,
                colorIndex: 2
            )
        ]
    }

    private func rangePoint(index: Int, kilometres: Double, prefix: String) -> TSChartPoint {
        TSChartPoint(x: Double(index), y: Units.convertDistance(kilometres * 1000, units), id: "\(prefix)-\(index)")
    }

    private var legend: [BatteryLegendItem] {
        [
            BatteryLegendItem(id: "original", name: "Original Range", color: TSChartPalette.color(at: 0)),
            BatteryLegendItem(id: "current", name: "Current Range", color: TSChartPalette.color(at: 2))
        ]
    }
}

// MARK: - Risk factors (web GlassPanel13 — scored gauges)

/// The risk-factors panel (web GlassPanel13): a grid of scored risk gauges (web
/// GlassPanel21 cards), or the no-risk-data empty state.
struct BatteryDegradationRiskFactorsSection: View {
    let detail: BatteryDegradationDetail?

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    private var factors: [BatteryRiskFactor] {
        detail?.riskFactors ?? []
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "shield.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    TSSubhead("battery.degradation.riskFactors")
                }
                if factors.isEmpty {
                    TSEmptyState(title: "battery.degradation.noRiskData", systemImage: "shield.fill")
                        .frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                        ForEach(factors) { factor in
                            BatteryRiskFactorCard(factor: factor)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One scored risk-factor gauge (web GlassPanel21 card): the factor icon + humanized
/// name + backend label badge, a scored proportion bar, and the backend detail copy.
struct BatteryRiskFactorCard: View {
    let factor: BatteryRiskFactor

    private var tone: TSTone {
        factor.severity.tone
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: factor.systemImage)
                        .font(.system(size: 13))
                        .foregroundStyle(tone.color)
                        .accessibilityHidden(true)
                    Text(verbatim: factor.humanizedName.capitalized)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.sm)
                    TSBadge(LocalizedStringKey(factor.label), tone: tone)
                }
                HStack(spacing: TSSpacing.sm) {
                    TSMetricBar(fraction: Double(factor.score) / 100, tone: tone)
                    Text(verbatim: "\(factor.score)")
                        .font(Font.TS.bodySm)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(tone.color)
                }
                Text(verbatim: factor.detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
