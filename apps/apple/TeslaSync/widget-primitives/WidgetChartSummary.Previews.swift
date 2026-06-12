//
//  WidgetChartSummary.Previews.swift
//  TeslaSync — P4 widget primitive · 0002 · WidgetChartSummary (Apple)
//
//  Xcode previews for every render branch of the primitive: content (grid + wide row), the
//  stats-only compact variant, the no-stats chart-only branch, and the empty state. DEBUG-only.
//  The chart slot is filled with a real Swift Charts trend (`TSSparkline`) to exercise composition.
//

import Foundation
import SwiftUI

#if DEBUG
    private let widgetChartSummarySampleStats: [ChartSummaryStat] = [
        ChartSummaryStat(label: "Distance", value: 12450, unit: "km"),
        ChartSummaryStat(label: "Efficiency", value: 152, unit: "Wh/km"),
        ChartSummaryStat(label: "Energy", value: 1897.3, unit: "kWh", fractionDigits: 1),
        ChartSummaryStat(label: "Cost", value: "$482.17")
    ]

    private let widgetChartSummarySampleTrend: [Double] = [320, 410, 280, 505, 460, 610, 540]

    #Preview("Content — standard (grid)") {
        WidgetChartSummary(stats: widgetChartSummarySampleStats) {
            TSSparkline(values: widgetChartSummarySampleTrend, colorIndex: 0)
        }
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — wide (row)") {
        WidgetChartSummary(stats: widgetChartSummarySampleStats) {
            TSSparkline(values: widgetChartSummarySampleTrend, colorIndex: 0)
        }
        .frame(width: 560, height: 240)
        .padding()
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact — stats only") {
        WidgetChartSummary(stats: widgetChartSummarySampleStats, compact: true) {
            TSSparkline(values: widgetChartSummarySampleTrend, colorIndex: 0)
        }
        .frame(width: 180, height: 120)
        .padding()
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Chart only — no stats") {
        WidgetChartSummary(stats: []) {
            TSSparkline(values: widgetChartSummarySampleTrend, colorIndex: 0)
        }
        .frame(width: 320, height: 200)
        .padding()
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        WidgetChartSummary(stats: [], isEmpty: true) {
            TSSparkline(values: widgetChartSummarySampleTrend, colorIndex: 0)
        }
        .frame(width: 320, height: 220)
        .padding()
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .padding()
        .background(Color.TS.bg)
    }
#endif
