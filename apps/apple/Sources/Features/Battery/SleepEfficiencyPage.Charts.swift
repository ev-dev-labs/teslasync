import SwiftUI

// The two native Swift Charts on the Sleep Efficiency surface (web `SleepEfficiencyPage`),
// built on the P3 wrappers (never a WKWebView): the State-Distribution donut (web
// `ChartContainer` + `PieChart`) with its hours legend, and the Sentry-vs-No-Sentry
// grouped bars (web `ChartContainer` + `BarChart`) with a series legend + category axis.
// Each renders its own empty state (never a blank region) and an accessible summary; the
// series legend is shared with the sibling Battery charts (`BatteryChartLegend`).

// MARK: - State distribution (web State-Distribution — ChartContainer + PieChart, panel 5)

/// The state-distribution donut (web GlassPanel + `PieChart`): a `TSChartContainer`
/// framing the native `TSPieChart` of per-state dwell time, with a custom legend that
/// announces each state's hours beneath it (web legend). Renders the no-state-data empty
/// state when there are no slices.
struct SleepStateDistributionSection: View {
    let sleep: SleepEfficiencyData

    var body: some View {
        TSChartContainer("sleep.stateDistribution", summary: "sleep.stateDistribution.aria") {
            if sleep.hasStateDistribution {
                VStack(spacing: TSSpacing.md) {
                    TSPieChart(slices: slices, showsLegend: false)
                        .frame(height: 200)
                        .accessibilityLabel(Text("sleep.stateDistribution.aria"))
                    SleepStateLegend(slices: sleep.stateDistribution)
                }
            } else {
                TSEmptyState(title: "sleep.noStateData", systemImage: "moon.zzz")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    private var slices: [TSChartSlice] {
        sleep.stateDistribution.map { slice in
            TSChartSlice(
                id: slice.state,
                name: LocalizedStringKey(SleepStateMeta.labelKey(slice.state) ?? slice.state),
                nameText: SleepStateMeta.englishLabel(slice.state),
                value: slice.roundedMinutes,
                colorIndex: SleepStateMeta.colorIndex(slice.state)
            )
        }
    }
}

/// The donut legend (web custom legend): a wrapping row of state swatches, each with the
/// localized state name and its per-state hours.
struct SleepStateLegend: View {
    let slices: [SleepStateShare]

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.sm)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(slices) { slice in
                HStack(spacing: TSSpacing.xs) {
                    Circle()
                        .fill(TSChartPalette.color(at: SleepStateMeta.colorIndex(slice.state)))
                        .frame(width: 9, height: 9)
                    stateName(slice.state)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: "\(SleepEfficiencyFormat.number(slice.hours, decimals: 1))h")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .monospacedDigit()
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private func stateName(_ state: String) -> some View {
        if let key = SleepStateMeta.labelKey(state) {
            Text(LocalizedStringKey(key))
        } else {
            Text(verbatim: state)
        }
    }
}

// MARK: - Sentry comparison (web Sentry-vs-No-Sentry — ChartContainer + BarChart, panel 6)

/// The Sentry comparison bars (web GlassPanel + `BarChart`): a `TSChartContainer` framing
/// the native `TSBarChart` grouping the Sentry-on vs Sentry-off drain rate + battery loss,
/// with a series legend + a category axis caption. Renders the no-sentry-data empty state
/// when every bar is zero.
struct SleepSentryComparisonSection: View {
    let sleep: SleepEfficiencyData

    var body: some View {
        TSChartContainer("sleep.sentryComparison", summary: "sleep.sentryComparison.aria") {
            if sleep.hasSentryComparison {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSBarChart(series: series)
                        .frame(height: 200)
                        .accessibilityLabel(Text("sleep.sentryComparison.aria"))
                    BatteryChartLegend(items: legend)
                    categoryAxis
                }
            } else {
                TSEmptyState(title: "sleep.noSentryData", systemImage: "eye.slash")
                    .frame(maxWidth: .infinity, minHeight: 200)
            }
        }
    }

    private var series: [TSChartSeries] {
        let onPoints = sleep.comparisonBars.map { bar in
            TSChartPoint(x: Double(bar.index), y: bar.sentryOn, id: "on-\(bar.index)")
        }
        let offPoints = sleep.comparisonBars.map { bar in
            TSChartPoint(x: Double(bar.index), y: bar.sentryOff, id: "off-\(bar.index)")
        }
        return [
            TSChartSeries(id: "on", name: "sleep.sentryOn", nameText: "Sentry On", points: onPoints, colorIndex: 1),
            TSChartSeries(id: "off", name: "sleep.sentryOff", nameText: "Sentry Off", points: offPoints, colorIndex: 6)
        ]
    }

    private var legend: [BatteryLegendItem] {
        [
            BatteryLegendItem(id: "on", name: "sleep.sentryOn", color: TSChartPalette.color(at: 1)),
            BatteryLegendItem(id: "off", name: "sleep.sentryOff", color: TSChartPalette.color(at: 6))
        ]
    }

    /// The two grouped-bar categories (web X-axis ticks: Drain Rate, Avg Battery Lost).
    private var categoryAxis: some View {
        HStack {
            Text(LocalizedStringKey(SleepComparisonMetric.drainRate.i18nKey))
            Spacer()
            Text(LocalizedStringKey(SleepComparisonMetric.batteryLost.i18nKey))
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityHidden(true)
    }
}
