//
//  OptimizerSection.Previews.swift
//  TeslaSync — P4 feature view · 0104 · OptimizerSection (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The sample optimizer here mirrors the web
//  `ChargingOptimizerData` shape and is also reused by the unit tests' fixtures.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative optimizer data for previews/tests (no network). Values are
    /// shaped like the web `ChargingOptimizerData` slice.
    enum OptimizerSample {
        static let optimizer = ChargingOptimizer(
            schedule: OptimizerSchedule(
                mostCommonStartHour: 22,
                mostCommonDay: "Saturday",
                avgSessionsPerWeek: 4.2,
                homeChargingPct: 78,
                avgChargeToPct: 82
            ),
            costAnalysis: OptimizerCostAnalysis(
                peakHours: [16, 17, 18, 19, 20],
                offpeakHours: [0, 1, 2, 3, 4, 5],
                peakCostPerKwh: 0.42,
                offpeakCostPerKwh: 0.11,
                sessionsDuringPeakPct: 36,
                potentialMonthlySavings: 24
            ),
            batteryHealthScore: 82,
            recommendations: [
                OptimizerRecommendation(
                    id: 0,
                    type: "schedule",
                    priority: .high,
                    title: "Shift charging to off-peak hours",
                    detail: "Many sessions start during peak pricing; scheduling later avoids the higher rate.",
                    estimatedSavings: 18
                ),
                OptimizerRecommendation(
                    id: 1,
                    type: "target",
                    priority: .medium,
                    title: "Lower your daily charge target",
                    detail: "Charging to 82% daily adds wear. 70% covers your typical commute with margin.",
                    estimatedSavings: 6
                ),
                OptimizerRecommendation(
                    id: 2,
                    type: "home",
                    priority: .low,
                    title: "Keep favouring home charging",
                    detail: "78% of your charging is at home — the cheapest option. Nicely done.",
                    estimatedSavings: nil
                )
            ],
            weeklyHeatmap: OptimizerSample.heatmap
        )

        static let heatmap: [OptimizerHeatmapEntry] = [
            OptimizerHeatmapEntry(day: 0, hour: 22, sessions: 3, avgCostPerKwh: 0.12),
            OptimizerHeatmapEntry(day: 1, hour: 8, sessions: 2, avgCostPerKwh: 0.39),
            OptimizerHeatmapEntry(day: 1, hour: 18, sessions: 4, avgCostPerKwh: 0.42),
            OptimizerHeatmapEntry(day: 3, hour: 19, sessions: 5, avgCostPerKwh: 0.41),
            OptimizerHeatmapEntry(day: 5, hour: 23, sessions: 2, avgCostPerKwh: 0.10),
            OptimizerHeatmapEntry(day: 6, hour: 14, sessions: 1, avgCostPerKwh: 0.28)
        ]
    }

    @MainActor
    private func previewModel(_ update: ChargingOptimizerUpdate) -> OptimizerModel {
        let source = InMemoryOptimizerSource(initial: update)
        let model = OptimizerModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewShell(_ section: OptimizerSection) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 980)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(
            OptimizerSection(
                model: previewModel(
                    ChargingOptimizerUpdate(status: .loaded, optimizer: OptimizerSample.optimizer, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Empty (loaded, no data)") {
        previewShell(
            OptimizerSection(
                model: previewModel(
                    ChargingOptimizerUpdate(status: .empty, optimizer: ChargingOptimizer(), updatedAt: Date())
                )
            )
        )
    }

    #Preview("Loading") {
        previewShell(
            OptimizerSection(model: previewModel(ChargingOptimizerUpdate(status: .loading)))
        )
    }

    #Preview("Error") {
        previewShell(
            OptimizerSection(
                model: previewModel(ChargingOptimizerUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            OptimizerSection(
                model: previewModel(
                    ChargingOptimizerUpdate(
                        status: .loaded,
                        connection: .stale,
                        optimizer: OptimizerSample.optimizer,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            OptimizerSection(
                model: previewModel(
                    ChargingOptimizerUpdate(
                        status: .loaded,
                        connection: .offline,
                        optimizer: OptimizerSample.optimizer,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
