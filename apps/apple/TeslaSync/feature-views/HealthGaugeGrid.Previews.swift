//
//  HealthGaugeGrid.Previews.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  Xcode previews for each surface state (content / content-loading-stats / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: HealthGaugeGridUpdate) -> HealthGaugeGridModel {
        let source = InMemoryHealthGaugeGridSource(initial: update)
        let model = HealthGaugeGridModel(source: source)
        model.start()
        return model
    }

    private func previewStats() -> DriveStatsInput {
        DriveStatsInput(
            totalDrives: 1284,
            totalDistanceMeters: 18_540_000,
            avgSpeedMetersPerSecond: 12.5,
            topSpeedMetersPerSecond: 38.9
        )
    }

    private func previewData(
        health: DrivetrainHealthStatus = .good,
        score: Double = 95,
        includeStats: Bool = true
    ) -> DrivetrainHealthInput {
        DrivetrainHealthInput(
            overallHealth: health,
            healthScore: score,
            motorStatus: "Optimal",
            activeSensorCount: 6,
            stats: includeStats ? previewStats() : nil
        )
    }

    private func loadedUpdate(
        connection: HealthGaugeConnection = .live,
        health: DrivetrainHealthStatus = .good,
        score: Double = 95,
        includeStats: Bool = true,
        units: HealthGaugeUnitPrefs = HealthGaugeUnitPrefs()
    ) -> HealthGaugeGridUpdate {
        HealthGaugeGridUpdate(
            status: .loaded,
            connection: connection,
            data: previewData(health: health, score: score, includeStats: includeStats),
            units: units,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: HealthGaugeGridUpdate) -> some View {
        ScrollView {
            HealthGaugeGrid(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (warning, miles)") {
        previewSurface(
            loadedUpdate(
                health: .warning,
                score: 60,
                units: HealthGaugeUnitPrefs(distance: .miles, speed: .milesPerHour)
            )
        )
    }

    #Preview("Content (stats loading)") {
        previewSurface(loadedUpdate(includeStats: false))
    }

    #Preview("Empty") {
        previewSurface(HealthGaugeGridUpdate(status: .empty, data: nil))
    }

    #Preview("Loading") {
        previewSurface(HealthGaugeGridUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(HealthGaugeGridUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale, health: .critical, score: 25))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
