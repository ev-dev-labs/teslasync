//
//  WeekOverWeekSummary.Previews.swift
//  TeslaSync — P4 feature view · 0078 · WeekOverWeekSummary (Apple)
//
//  Xcode previews for each surface state (loading / empty / loaded / loaded-first-week
//  / stale / offline / error / error-with-cache). DEBUG-only; compiled by the app
//  targets and excluded from the shipped-surface definition-of-done gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private enum WeekOverWeekPreviewData {
        static let sample = WeekOverWeekMetrics(
            totalDistance: 312.4,
            prevDistance: 280.1,
            totalDrives: 18,
            prevDriveCount: 15,
            energyUsed: 64.2,
            prevEnergy: 70.5,
            chargingCost: 12.80,
            prevChargingCost: 15.10,
            avgEfficiency: 205.6,
            prevAvgEfficiency: 212.0,
            co2Saved: 22.6,
            prevCo2: 19.8
        )

        static let firstWeek = WeekOverWeekMetrics(
            totalDistance: 42.7,
            prevDistance: 0,
            totalDrives: 3,
            prevDriveCount: 0,
            energyUsed: 9.1,
            prevEnergy: 0,
            chargingCost: 1.80,
            prevChargingCost: 0,
            avgEfficiency: 213.4,
            prevAvgEfficiency: 0,
            co2Saved: 3.1,
            prevCo2: 0
        )

        @MainActor
        static func model(_ update: WeekOverWeekUpdate?) -> WeekOverWeekSummaryModel {
            let source = InMemoryWeekOverWeekSource(initial: update)
            let model = WeekOverWeekSummaryModel(source: source)
            model.start()
            return model
        }
    }

    private struct WeekOverWeekPreviewStage: View {
        let model: WeekOverWeekSummaryModel

        var body: some View {
            ScrollView {
                WeekOverWeekSummary(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg.ignoresSafeArea())
        }
    }

    #Preview("Loaded") {
        WeekOverWeekPreviewStage(
            model: WeekOverWeekPreviewData.model(
                WeekOverWeekUpdate(metrics: WeekOverWeekPreviewData.sample, connection: .online, updatedAt: Date())
            )
        )
    }

    #Preview("Loaded · first week") {
        WeekOverWeekPreviewStage(
            model: WeekOverWeekPreviewData.model(
                WeekOverWeekUpdate(
                    metrics: WeekOverWeekPreviewData.firstWeek,
                    connection: .online,
                    updatedAt: Date()
                )
            )
        )
    }

    #Preview("Loading") {
        WeekOverWeekPreviewStage(model: WeekOverWeekPreviewData.model(nil))
    }

    #Preview("Empty (no activity)") {
        WeekOverWeekPreviewStage(
            model: WeekOverWeekPreviewData.model(WeekOverWeekUpdate(metrics: nil, connection: .online))
        )
    }

    #Preview("Stale") {
        WeekOverWeekPreviewStage(
            model: WeekOverWeekPreviewData.model(
                WeekOverWeekUpdate(
                    metrics: WeekOverWeekPreviewData.sample,
                    connection: .stale,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        WeekOverWeekPreviewStage(
            model: WeekOverWeekPreviewData.model(
                WeekOverWeekUpdate(
                    metrics: WeekOverWeekPreviewData.sample,
                    connection: .offline,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            )
        )
    }

    #Preview("Error") {
        WeekOverWeekPreviewStage(
            model: WeekOverWeekPreviewData.model(WeekOverWeekUpdate(metrics: nil, connection: .online, failed: true))
        )
    }

    #Preview("Error (cached)") {
        WeekOverWeekPreviewStage(
            model: WeekOverWeekPreviewData.model(
                WeekOverWeekUpdate(metrics: WeekOverWeekPreviewData.sample, connection: .online, failed: true)
            )
        )
    }
#endif
