//
//  MetricSwitcherChart.Previews.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  Xcode previews for each branch the web source renders plus the P4 leaf contract: the bar / area /
//  line chart kinds, the interactive metric switch, the empty state (active series empty), and the
//  loading / error / stale / offline chrome. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum MetricSwitcherChartSample {
        static let dates = ["Apr 13", "Apr 20", "Apr 27", "May 4", "May 11", "May 18", "May 25"]

        static let metrics: [MetricSwitcherMetricSpec] = [
            MetricSwitcherMetricSpec(
                id: "drives",
                label: .verbatim("Drives"),
                kind: .bar,
                colorIndex: 0,
                valueFormat: .integer
            ),
            MetricSwitcherMetricSpec(
                id: "distance",
                label: .verbatim("Distance"),
                kind: .area,
                colorIndex: 2,
                valueFormat: .suffixed(unit: "mi", places: 0)
            ),
            MetricSwitcherMetricSpec(
                id: "score",
                label: .verbatim("Efficiency"),
                kind: .line,
                colorIndex: 5,
                valueFormat: .decimal(places: 1)
            )
        ]

        static func series(driveScale: Double = 1) -> [String: [MetricSwitcherPoint]] {
            let drives = [2, 4, 3, 6, 5, 7, 4]
            let distance = [18, 42, 31, 64, 58, 73, 49]
            let score = [3.8, 4.1, 3.9, 4.4, 4.2, 4.6, 4.3]
            return [
                "drives": zip(dates, drives).map { MetricSwitcherPoint(dateLabel: $0, value: Double($1) * driveScale) },
                "distance": zip(dates, distance).map { MetricSwitcherPoint(dateLabel: $0, value: Double($1)) },
                "score": zip(dates, score).map { MetricSwitcherPoint(dateLabel: $0, value: $1) }
            ]
        }

        static var dataset: MetricSwitcherDataset {
            MetricSwitcherDataset(metrics: metrics, series: series())
        }
    }

    private struct MetricSwitcherChartPreviewFrame<Content: View>: View {
        @ViewBuilder let content: Content

        var body: some View {
            content
                .padding()
                .background(Color.TS.bg)
        }
    }

    #Preview("Interactive (bar / area / line)") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Activity over time"),
                metrics: MetricSwitcherChartSample.metrics,
                series: MetricSwitcherChartSample.series(),
                activeMetric: "drives"
            )
        }
    }

    #Preview("Area — Distance") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Distance over time"),
                metrics: MetricSwitcherChartSample.metrics,
                series: MetricSwitcherChartSample.series(),
                activeMetric: "distance"
            )
        }
    }

    #Preview("Line — Efficiency") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Efficiency over time"),
                metrics: MetricSwitcherChartSample.metrics,
                series: MetricSwitcherChartSample.series(),
                activeMetric: "score"
            )
        }
    }

    #Preview("Empty (active series empty)") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Drives over time"),
                metrics: MetricSwitcherChartSample.metrics,
                series: ["drives": [], "distance": [], "score": []],
                activeMetric: "drives",
                emptyMessage: .verbatim("No drives recorded in this period.")
            )
        }
    }

    #Preview("Loading") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Activity over time"),
                state: .loading(cached: nil, stale: false),
                activeMetric: "drives"
            )
        }
    }

    #Preview("Error (retry)") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Activity over time"),
                state: .failed(.network(message: "offline"), cached: nil, stale: false),
                activeMetric: "drives",
                onRetry: {}
            )
        }
    }

    #Preview("Stale (cached behind refresh)") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Activity over time"),
                state: .loaded(MetricSwitcherChartSample.dataset, stale: true),
                activeMetric: "distance",
                onRetry: {}
            )
        }
    }

    #Preview("Offline (cached)") {
        MetricSwitcherChartPreviewFrame {
            MetricSwitcherChart(
                title: .verbatim("Activity over time"),
                state: .failed(.offline, cached: MetricSwitcherChartSample.dataset, stale: true),
                activeMetric: "drives",
                onRetry: {}
            )
        }
    }
#endif
