//
//  DrivingTab.Previews.swift
//  TeslaSync — P4 feature view · 0056 · DrivingTab (Apple)
//
//  Xcode previews for each surface state (content metric / content imperial / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DriveAnalyticsUpdate) -> DrivingTabModel {
        let source = InMemoryDriveAnalyticsSource(initial: update)
        let model = DrivingTabModel(source: source)
        model.start()
        return model
    }

    private func sampleAnalytics() -> DriveAnalyticsInput {
        DriveAnalyticsInput(
            speedDistribution: [
                DriveDistributionBinInput(range: "0–20", count: 18),
                DriveDistributionBinInput(range: "20–40", count: 42),
                DriveDistributionBinInput(range: "40–60", count: 65),
                DriveDistributionBinInput(range: "60–80", count: 37),
                DriveDistributionBinInput(range: "80+", count: 12)
            ],
            distanceDistribution: [
                DriveDistributionBinInput(range: "0–5", count: 51),
                DriveDistributionBinInput(range: "5–15", count: 44),
                DriveDistributionBinInput(range: "15–30", count: 23),
                DriveDistributionBinInput(range: "30–60", count: 14),
                DriveDistributionBinInput(range: "60+", count: 6)
            ],
            hourlyPattern: (0 ..< 24).map { hour in
                let intensity = Double(max(0, 12 - abs(hour - 17)))
                return DriveHourlyPointInput(
                    hour: hour,
                    drives: intensity,
                    distance: intensity * 8.5
                )
            },
            tempVsEfficiency: [
                DriveTempEfficiencyInput(temp: -8, efficiency: 0.205, distance: 12),
                DriveTempEfficiencyInput(temp: 2, efficiency: 0.178, distance: 24),
                DriveTempEfficiencyInput(temp: 12, efficiency: 0.151, distance: 38),
                DriveTempEfficiencyInput(temp: 21, efficiency: 0.142, distance: 55),
                DriveTempEfficiencyInput(temp: 31, efficiency: 0.166, distance: 19)
            ],
            dailyTrend: [
                DriveDailyTrendInput(date: "2024-04-01", drives: 4, distance: 42, efficiency: 0.158),
                DriveDailyTrendInput(date: "2024-04-02", drives: 6, distance: 71, efficiency: 0.149),
                DriveDailyTrendInput(date: "2024-04-03", drives: 3, distance: 28, efficiency: 0.171),
                DriveDailyTrendInput(date: "2024-04-04", drives: 7, distance: 88, efficiency: 0.146),
                DriveDailyTrendInput(date: "2024-04-05", drives: 5, distance: 53, efficiency: 0.155),
                DriveDailyTrendInput(date: "2024-04-06", drives: 2, distance: 17, efficiency: 0.182),
                DriveDailyTrendInput(date: "2024-04-07", drives: 5, distance: 49, efficiency: 0.152)
            ],
            durationDistribution: [
                DriveDistributionBinInput(range: "0–10", count: 33),
                DriveDistributionBinInput(range: "10–30", count: 58),
                DriveDistributionBinInput(range: "30–60", count: 29),
                DriveDistributionBinInput(range: "60+", count: 11)
            ]
        )
    }

    private func loadedUpdate(
        units: UnitPreferences = .metric,
        connection: DriveAnalyticsConnection = .live
    ) -> DriveAnalyticsUpdate {
        DriveAnalyticsUpdate(
            status: .loaded,
            analytics: sampleAnalytics(),
            units: units,
            connection: connection,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: DriveAnalyticsUpdate) -> some View {
        ScrollView {
            DrivingTab(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (metric)") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (imperial)") {
        previewSurface(loadedUpdate(units: .imperial))
    }

    #Preview("Empty") {
        previewSurface(DriveAnalyticsUpdate(status: .loaded, analytics: DriveAnalyticsInput()))
    }

    #Preview("Loading") {
        previewSurface(DriveAnalyticsUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(DriveAnalyticsUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
