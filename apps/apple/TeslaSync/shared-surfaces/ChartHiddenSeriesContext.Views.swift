//
//  ChartHiddenSeriesContext.Views.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  The presentational pieces of the hidden-series bridge: a tappable legend chip that consumes the
//  context (the native parity of how the web `<ChartLegend>` reads `useChartHiddenSeries()` — tap to
//  toggle, dim + strike-through the hidden ones) and a DEBUG-only sample that wires a chart whose marks
//  drop for hidden series (web `<Line hide={state.isHidden(key)} />`) plus a standalone (no-provider)
//  legend so the previews + the view-composition tests have a concrete reference implementation. All
//  copy resolves through P1/S10; all chrome is token-driven (P1/S9); the toggle dim respects Reduce
//  Motion; no raw hex, no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Legend chip (web `<ChartLegend>` entry consuming `useChartHiddenSeries`)

/// A single tappable legend entry bound to the hidden-series context — the native parity of a web
/// `<ChartLegend>` item. It reads the context from the environment (web `useChartHiddenSeries()`),
/// toggles its series on tap (web `if (key) resolved.toggle(key)`), and dims + strikes through when
/// hidden (web `data-series-hidden` / dimmed styling). Outside a provider the context is `nil`, so the
/// chip renders as shown and the tap is a no-op (web `resolved?.isHidden(key) ?? false`).
public struct ChartHiddenSeriesLegendChip: View {
    private let seriesID: String
    private let nameText: String
    private let colorIndex: Int

    @Environment(\.chartHiddenSeries) private var context
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(seriesID: String, nameText: String, colorIndex: Int) {
        self.seriesID = seriesID
        self.nameText = nameText
        self.colorIndex = colorIndex
    }

    /// Convenience initializer from the shared ``TSChartSeries`` model.
    public init(series: TSChartSeries) {
        self.init(seriesID: series.id, nameText: series.nameText, colorIndex: series.colorIndex)
    }

    private var isHidden: Bool {
        context?.isHidden(seriesID) ?? false
    }

    public var body: some View {
        Button {
            context?.toggle(seriesID)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(TSChartPalette.color(at: colorIndex))
                    .frame(width: 10, height: 10)
                    .opacity(isHidden ? 0.4 : 1)
                Text(verbatim: nameText)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .strikethrough(isHidden)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .opacity(isHidden ? 0.55 : 1)
        }
        .buttonStyle(.plain)
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: isHidden)
        .accessibilityLabel(Text(verbatim: nameText))
        .accessibilityValue(Text(verbatim: visibilityValue))
        .accessibilityHint(Text(verbatim: toggleHint))
        .accessibilityAddTraits(.isButton)
    }

    private var visibilityValue: String {
        isHidden
            ? ChartHiddenSeriesStrings.string("chartHiddenSeries.legend.hidden", "Hidden")
            : ChartHiddenSeriesStrings.string("chartHiddenSeries.legend.shown", "Shown")
    }

    private var toggleHint: String {
        ChartHiddenSeriesStrings.string("chartHiddenSeries.legend.hint", "Double tap to toggle this series")
    }
}

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    @MainActor
    enum ChartHiddenSeriesSampleData {
        static let series: [TSChartSeries] = [
            TSChartSeries(
                id: "health",
                name: "Health",
                nameText: "Health",
                points: ramp(base: 100, slope: -0.4),
                colorIndex: 0
            ),
            TSChartSeries(
                id: "projected",
                name: "Projected",
                nameText: "Projected",
                points: ramp(base: 99, slope: -0.6),
                colorIndex: 5
            ),
            TSChartSeries(
                id: "fleet",
                name: "Fleet average",
                nameText: "Fleet average",
                points: ramp(base: 96, slope: -0.3),
                colorIndex: 2
            )
        ]

        private static func ramp(base: Double, slope: Double) -> [TSChartPoint] {
            (0 ..< 24).map { step in
                TSChartPoint(x: Double(step), y: base + slope * Double(step), id: "p\(step)")
            }
        }
    }

    // MARK: - Sample chart (web `<Line hide={state.isHidden(key)} />`)

    /// A sample multi-series chart that drops the marks for any hidden series — the native parity of
    /// the web `<Line hide={state.isHidden(key)} />`. It reads the shared context from the environment
    /// (web `useChartHiddenSeries()`); outside a provider every series renders (context `nil`).
    struct ChartHiddenSeriesSampleChart: View {
        @Environment(\.chartHiddenSeries) private var context

        private var visibleSeries: [TSChartSeries] {
            ChartHiddenSeriesSampleData.series.filter { context?.isHidden($0.id) != true }
        }

        var body: some View {
            Chart {
                ForEach(visibleSeries) { series in
                    ForEach(series.points) { point in
                        LineMark(
                            x: .value(xAxisLabel, point.xValue),
                            y: .value(yAxisLabel, point.yValue)
                        )
                    }
                    .foregroundStyle(series.color)
                    .interpolationMethod(.monotone)
                }
            }
            .chartLegend(.hidden)
            .frame(height: 140)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: chartAria))
            .accessibilityValue(Text(verbatim: visibilityAccessibilityValue))
        }

        private var xAxisLabel: String {
            ChartHiddenSeriesStrings.string("chartHiddenSeries.sample.axis.x", "Week")
        }

        private var yAxisLabel: String {
            ChartHiddenSeriesStrings.string("chartHiddenSeries.sample.axis.y", "Percent")
        }

        private var chartAria: String {
            ChartHiddenSeriesStrings.string("chartHiddenSeries.sample.chart.aria", "Battery health sample chart")
        }

        /// VoiceOver readout of how many series are shown, so the toggled state is announced.
        private var visibilityAccessibilityValue: String {
            let shown = visibleSeries.count
            let total = ChartHiddenSeriesSampleData.series.count
            let template = ChartHiddenSeriesStrings.string(
                "chartHiddenSeries.sample.chart.value",
                "%1$d of %2$d series shown"
            )
            return String(format: template, shown, total)
        }
    }

    // MARK: - Sample composite (previews + tests)

    /// The DEBUG sample composite: a chart + a legend row inside one ``ChartHiddenSeriesProvider`` (so
    /// tapping a chip hides that series in the chart and persists the toggle) plus a second legend row
    /// outside any provider (the faithful "no context" branch — inert, never dimmed). Drives a fresh
    /// ``HiddenSeriesStore`` so it never touches global state.
    struct ChartHiddenSeriesContextSample: View {
        let chartKey: String?
        @State private var store: HiddenSeriesStore

        init(chartKey: String? = "battery-degradation-trend") {
            self.chartKey = chartKey
            _store = State(initialValue: HiddenSeriesStore())
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                ChartHiddenSeriesProvider(chartKey: chartKey, store: store) {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        ChartHiddenSeriesSampleChart()
                        legendRow
                    }
                }
                Divider().overlay(Color.TS.border)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: ChartHiddenSeriesStrings.string(
                        "chartHiddenSeries.sample.standalone",
                        "No provider (toggling disabled)"
                    ))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    legendRow
                }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }

        private var legendRow: some View {
            HStack(spacing: TSSpacing.sm) {
                ForEach(ChartHiddenSeriesSampleData.series) { series in
                    ChartHiddenSeriesLegendChip(series: series)
                }
            }
        }
    }
#endif
