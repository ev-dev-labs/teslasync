//
//  CostHeatmap.Previews.swift
//  TeslaSync — P4 feature view · 0100 · CostHeatmap (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale
//  / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The sample heatmap here is shaped like the web
//  `weekly_heatmap` slice (`OptimizerHeatmapEntry`), kept in lock-step with it.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative heatmap data for previews/tests (no network). Off-peak slots
    /// are cheap (green), evening peaks are expensive (red). Shaped like the web
    /// `weekly_heatmap` (`{ day, hour, sessions, avg_cost_per_kwh }`).
    enum CostHeatmapSample {
        static let data = CostHeatmapData(entries: entries, peakCostPerKwh: 0.48)

        private static let entries: [CostHeatmapEntry] = [
            CostHeatmapEntry(day: 0, hour: 1, sessions: 3, avgCostPerKwh: 0.11),
            CostHeatmapEntry(day: 0, hour: 2, sessions: 2, avgCostPerKwh: 0.10),
            CostHeatmapEntry(day: 0, hour: 18, sessions: 4, avgCostPerKwh: 0.42),
            CostHeatmapEntry(day: 0, hour: 19, sessions: 5, avgCostPerKwh: 0.47),
            CostHeatmapEntry(day: 1, hour: 0, sessions: 2, avgCostPerKwh: 0.09),
            CostHeatmapEntry(day: 1, hour: 7, sessions: 3, avgCostPerKwh: 0.21),
            CostHeatmapEntry(day: 1, hour: 17, sessions: 4, avgCostPerKwh: 0.39),
            CostHeatmapEntry(day: 1, hour: 20, sessions: 3, avgCostPerKwh: 0.44),
            CostHeatmapEntry(day: 2, hour: 2, sessions: 4, avgCostPerKwh: 0.10),
            CostHeatmapEntry(day: 2, hour: 8, sessions: 2, avgCostPerKwh: 0.23),
            CostHeatmapEntry(day: 2, hour: 18, sessions: 6, avgCostPerKwh: 0.48),
            CostHeatmapEntry(day: 2, hour: 22, sessions: 2, avgCostPerKwh: 0.16),
            CostHeatmapEntry(day: 3, hour: 1, sessions: 3, avgCostPerKwh: 0.11),
            CostHeatmapEntry(day: 3, hour: 9, sessions: 2, avgCostPerKwh: 0.25),
            CostHeatmapEntry(day: 3, hour: 17, sessions: 5, avgCostPerKwh: 0.41),
            CostHeatmapEntry(day: 3, hour: 19, sessions: 4, avgCostPerKwh: 0.46),
            CostHeatmapEntry(day: 4, hour: 3, sessions: 2, avgCostPerKwh: 0.09),
            CostHeatmapEntry(day: 4, hour: 12, sessions: 3, avgCostPerKwh: 0.30),
            CostHeatmapEntry(day: 4, hour: 18, sessions: 5, avgCostPerKwh: 0.45),
            CostHeatmapEntry(day: 4, hour: 21, sessions: 3, avgCostPerKwh: 0.20),
            CostHeatmapEntry(day: 5, hour: 0, sessions: 4, avgCostPerKwh: 0.10),
            CostHeatmapEntry(day: 5, hour: 10, sessions: 2, avgCostPerKwh: 0.27),
            CostHeatmapEntry(day: 5, hour: 16, sessions: 3, avgCostPerKwh: 0.36),
            CostHeatmapEntry(day: 5, hour: 19, sessions: 4, avgCostPerKwh: 0.43),
            CostHeatmapEntry(day: 6, hour: 2, sessions: 5, avgCostPerKwh: 0.10),
            CostHeatmapEntry(day: 6, hour: 11, sessions: 3, avgCostPerKwh: 0.28),
            CostHeatmapEntry(day: 6, hour: 14, sessions: 2, avgCostPerKwh: 0.33),
            CostHeatmapEntry(day: 6, hour: 20, sessions: 3, avgCostPerKwh: 0.40)
        ]
    }

    @MainActor
    private func previewModel(_ snapshot: CostHeatmapSnapshot) -> CostHeatmapModel {
        let source = InMemoryCostHeatmapSource(initial: snapshot)
        let model = CostHeatmapModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewShell(_ surface: CostHeatmap) -> some View {
        ScrollView {
            surface.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 720)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            CostHeatmap(
                model: previewModel(
                    CostHeatmapSnapshot(status: .loaded, data: CostHeatmapSample.data, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Empty (loaded, no sessions)") {
        previewShell(
            CostHeatmap(
                model: previewModel(
                    CostHeatmapSnapshot(
                        status: .empty,
                        data: CostHeatmapData(entries: [], peakCostPerKwh: 0.30),
                        updatedAt: Date()
                    )
                )
            )
        )
    }

    #Preview("Loading") {
        previewShell(CostHeatmap(model: previewModel(CostHeatmapSnapshot(status: .loading))))
    }

    #Preview("Error") {
        previewShell(
            CostHeatmap(model: previewModel(CostHeatmapSnapshot(status: .failed("Network unavailable"))))
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            CostHeatmap(
                model: previewModel(
                    CostHeatmapSnapshot(
                        status: .loaded,
                        connection: .stale,
                        data: CostHeatmapSample.data,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            CostHeatmap(
                model: previewModel(
                    CostHeatmapSnapshot(
                        status: .loaded,
                        connection: .offline,
                        data: CostHeatmapSample.data,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
