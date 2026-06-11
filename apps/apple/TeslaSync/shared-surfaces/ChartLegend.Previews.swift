//
//  ChartLegend.Previews.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  Xcode previews for each surface state (loading / error / empty / withdrawn / populated-interactive
//  / populated-with-hidden / populated-passive / populated-stale / populated-offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ChartLegendPreviewData {
        static let series: [ChartLegendItem] = [
            ChartLegendItem(id: "speed", label: "Speed", colorHex: "#3b82f6", paletteIndex: 0),
            ChartLegendItem(id: "power", label: "Power", colorHex: "#a855f7", paletteIndex: 1),
            ChartLegendItem(id: "battery", label: "Battery", colorHex: "#22c55e", paletteIndex: 2),
            ChartLegendItem(id: "regen", label: "Regen", colorHex: "#06b6d4", paletteIndex: 3),
            ChartLegendItem(id: "temperature", label: "Temperature", colorHex: "#ef4444", paletteIndex: 4)
        ]
    }

    @MainActor
    private func previewModel(_ input: ChartLegendInput, initialHidden: Set<String> = []) -> ChartLegendModel {
        let source = InMemoryChartLegendSource(initial: input)
        let model = ChartLegendModel(source: source, onToggle: { _ in }, initialHidden: initialHidden)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: ChartLegendModel) -> some View {
        ChartLegend(model: model)
            .padding()
            .frame(maxWidth: 420, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(ChartLegendInput(availability: .loading)))
    }

    #Preview("Error") {
        staged(previewModel(ChartLegendInput(availability: .failed("Network timed out"))))
    }

    #Preview("Empty (shown)") {
        staged(previewModel(ChartLegendInput(availability: .resolved([]), emptyBehavior: .emptyState)))
    }

    #Preview("Withdrawn (empty payload)") {
        staged(previewModel(ChartLegendInput(availability: .resolved([]), emptyBehavior: .withdraw)))
    }

    #Preview("Populated interactive") {
        staged(previewModel(ChartLegendInput(
            availability: .resolved(ChartLegendPreviewData.series),
            connection: .live,
            interactivity: .interactive
        )))
    }

    #Preview("Populated with hidden") {
        staged(previewModel(
            ChartLegendInput(
                availability: .resolved(ChartLegendPreviewData.series),
                connection: .live,
                interactivity: .interactive
            ),
            initialHidden: ["power", "regen"]
        ))
    }

    #Preview("Populated passive") {
        staged(previewModel(ChartLegendInput(
            availability: .resolved(ChartLegendPreviewData.series),
            connection: .live,
            interactivity: .passive
        )))
    }

    #Preview("Populated stale") {
        staged(previewModel(ChartLegendInput(
            availability: .resolved(ChartLegendPreviewData.series),
            connection: .stale,
            interactivity: .interactive
        )))
    }

    #Preview("Populated offline") {
        staged(previewModel(ChartLegendInput(
            availability: .resolved(ChartLegendPreviewData.series),
            connection: .offline,
            interactivity: .interactive
        )))
    }
#endif
