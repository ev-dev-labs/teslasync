//
//  HealthOverview.Previews.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  Xcode previews for each surface state (content-good / content-warning / content-critical /
//  empty / loading / error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: HealthOverviewUpdate) -> HealthOverviewModel {
        let source = InMemoryHealthOverviewSource(initial: update)
        let model = HealthOverviewModel(source: source)
        model.start()
        return model
    }

    private func previewData(
        health: HealthOverviewHealthStatus = .good,
        score: Double = 95,
        motorStatus: String = "Optimal"
    ) -> HealthOverviewInput {
        HealthOverviewInput(overallHealth: health, healthScore: score, motorStatus: motorStatus)
    }

    private func loadedUpdate(
        connection: HealthOverviewConnection = .live,
        health: HealthOverviewHealthStatus = .good,
        score: Double = 95,
        motorStatus: String = "Optimal"
    ) -> HealthOverviewUpdate {
        HealthOverviewUpdate(
            status: .loaded,
            connection: connection,
            data: previewData(health: health, score: score, motorStatus: motorStatus),
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: HealthOverviewUpdate) -> some View {
        ScrollView {
            HealthOverview(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (good)") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (warning)") {
        previewSurface(loadedUpdate(health: .warning, score: 60, motorStatus: "Degraded"))
    }

    #Preview("Content (critical)") {
        previewSurface(loadedUpdate(health: .critical, score: 25, motorStatus: "Throttled"))
    }

    #Preview("Empty") {
        previewSurface(HealthOverviewUpdate(status: .empty, data: nil))
    }

    #Preview("Loading") {
        previewSurface(HealthOverviewUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(HealthOverviewUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale, health: .warning, score: 60, motorStatus: "Degraded"))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
