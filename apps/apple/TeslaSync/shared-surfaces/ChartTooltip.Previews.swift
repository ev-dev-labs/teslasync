//
//  ChartTooltip.Previews.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ChartTooltipPreviewData {
        /// A representative hovered point — a timestamp label over a small spread of series, the
        /// native mirror of a Recharts payload (battery %, speed, power) at one x position.
        static let series: [ChartTooltipSeries] = [
            ChartTooltipSeries(
                id: "soc", name: "Battery", value: .number(72.4), unit: "%", colorIndex: 0
            ),
            ChartTooltipSeries(
                id: "speed", name: "Speed", value: .number(96.0), unit: "km/h", colorIndex: 2
            ),
            ChartTooltipSeries(
                id: "power", name: "Power", value: .number(18.6), unit: "kW", colorIndex: 5
            )
        ]

        static let activeInput = ChartTooltipInput(
            isActive: true,
            label: .text("2026-04-04T14:30:00Z"),
            series: series
        )
    }

    @MainActor
    private func previewModel(_ input: ChartTooltipInput) -> ChartTooltipModel {
        let source = InMemoryChartTooltipSource(initial: input)
        let model = ChartTooltipModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        ChartTooltip(model: previewModel(ChartTooltipPreviewData.activeInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChartTooltip(model: previewModel(ChartTooltipInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChartTooltip(model: previewModel(ChartTooltipInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChartTooltip(model: previewModel(ChartTooltipInput(
            errorMessage: "The chart feed timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ChartTooltip(model: previewModel(ChartTooltipInput(
            isActive: true,
            label: ChartTooltipPreviewData.activeInput.label,
            series: ChartTooltipPreviewData.series,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ChartTooltip(model: previewModel(ChartTooltipInput(
            isActive: true,
            label: ChartTooltipPreviewData.activeInput.label,
            series: ChartTooltipPreviewData.series,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
