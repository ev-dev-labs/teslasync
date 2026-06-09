//
//  HealthRecommendations.Previews.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  Xcode previews for each surface state (content good / warning / critical / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: HealthRecommendationsUpdate) -> HealthRecommendationsModel {
        let source = InMemoryHealthRecommendationsSource(initial: update)
        let model = HealthRecommendationsModel(source: source)
        model.start()
        return model
    }

    private func loadedUpdate(
        connection: HealthRecommendationsConnection = .live,
        health: HealthRecommendationsHealthStatus = .good
    ) -> HealthRecommendationsUpdate {
        HealthRecommendationsUpdate(
            status: .loaded,
            connection: connection,
            data: HealthRecommendationsInput(overallHealth: health),
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: HealthRecommendationsUpdate) -> some View {
        ScrollView {
            HealthRecommendations(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (good)") {
        previewSurface(loadedUpdate(health: .good))
    }

    #Preview("Content (warning)") {
        previewSurface(loadedUpdate(health: .warning))
    }

    #Preview("Content (critical)") {
        previewSurface(loadedUpdate(health: .critical))
    }

    #Preview("Empty") {
        previewSurface(HealthRecommendationsUpdate(status: .empty, data: nil))
    }

    #Preview("Loading") {
        previewSurface(HealthRecommendationsUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(HealthRecommendationsUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale, health: .warning))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline, health: .critical))
    }
#endif
