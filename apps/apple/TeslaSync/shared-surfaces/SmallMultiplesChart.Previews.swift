//
//  SmallMultiplesChart.Previews.swift
//  TeslaSync — P4 shared surface · 0073 · SmallMultiplesChart (Apple)
//
//  Xcode previews for each surface state (loading / error / empty / withdrawn / populated-adaptive /
//  populated-2-columns / populated-passive / populated-stale / populated-offline). The populated
//  payloads include one series with no finite points so the per-cell `'No data'` fallback renders
//  alongside the charts. DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SmallMultiplesPreviewData {
        static func payload() -> SmallMultiplesData {
            let base = Date(timeIntervalSince1970: 1_700_000_000)
            let samples: [SmallMultiplesSample] = (0 ..< 60).map { index in
                let date = base.addingTimeInterval(Double(index) * 60)
                var values: [String: Double] = [
                    "speed": 40 + 20 * sin(Double(index) / 6),
                    "power": 100 + 60 * cos(Double(index) / 5),
                    "battery": 80 - Double(index) * 0.2,
                    "temperature": 22 + 4 * sin(Double(index) / 9)
                ]
                // A sparse series — only every fifth row has a finite value (web `isFinitePoint`).
                if index % 5 == 0 {
                    values["regen"] = Double(index % 13)
                }
                return SmallMultiplesSample(date: date, values: values)
            }
            let series: [SmallMultiplesSeries] = [
                SmallMultiplesSeries(id: "speed", label: "Speed", colorHex: "#3b82f6", colorIndex: 0),
                SmallMultiplesSeries(id: "power", label: "Power", colorHex: "#a855f7", colorIndex: 1),
                SmallMultiplesSeries(id: "battery", label: "Battery", colorHex: "#22c55e", colorIndex: 2),
                SmallMultiplesSeries(id: "regen", label: "Regen", colorHex: "#06b6d4", colorIndex: 3),
                SmallMultiplesSeries(id: "temperature", label: "Temperature", colorHex: "#ef4444", colorIndex: 4),
                // A series with no rows at all → the per-cell "No data" fallback.
                SmallMultiplesSeries(id: "tirePressure", label: "Tire Pressure", colorIndex: 5)
            ]
            return SmallMultiplesData(samples: samples, series: series)
        }
    }

    @MainActor
    private func previewModel(_ input: SmallMultiplesInput) -> SmallMultiplesChartModel {
        let source = InMemorySmallMultiplesSource(initial: input)
        let model = SmallMultiplesChartModel(source: source, onCellClick: { _ in })
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: SmallMultiplesChartModel) -> some View {
        ScrollView {
            SmallMultiplesChart(model: model)
                .padding()
        }
        .frame(maxWidth: 760)
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(SmallMultiplesInput(availability: .loading)))
    }

    #Preview("Error") {
        staged(previewModel(SmallMultiplesInput(availability: .failed("Network timed out"))))
    }

    #Preview("Empty (shown)") {
        staged(previewModel(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesData()),
            emptyBehavior: .emptyState
        )))
    }

    #Preview("Withdrawn (empty payload)") {
        staged(previewModel(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesData()),
            emptyBehavior: .withdraw
        )))
    }

    #Preview("Populated adaptive") {
        staged(previewModel(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesPreviewData.payload()),
            connection: .live,
            interactivity: .interactive
        )))
    }

    #Preview("Populated 2 columns") {
        staged(previewModel(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesPreviewData.payload()),
            connection: .live,
            interactivity: .interactive,
            columns: 2
        )))
    }

    #Preview("Populated passive") {
        staged(previewModel(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesPreviewData.payload()),
            connection: .live,
            interactivity: .passive
        )))
    }

    #Preview("Populated stale") {
        staged(previewModel(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesPreviewData.payload()),
            connection: .stale,
            interactivity: .interactive
        )))
    }

    #Preview("Populated offline") {
        staged(previewModel(SmallMultiplesInput(
            availability: .resolved(SmallMultiplesPreviewData.payload()),
            connection: .offline,
            interactivity: .interactive
        )))
    }
#endif
