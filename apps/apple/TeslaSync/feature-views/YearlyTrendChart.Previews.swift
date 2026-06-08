//
//  YearlyTrendChart.Previews.swift
//  TeslaSync — P4 feature view · 0095 · YearlyTrendChart (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: YearlyTrendUpdate) -> YearlyTrendChartModel {
        let source = InMemoryYearlyTrendSource(initial: update)
        let model = YearlyTrendChartModel(source: source)
        model.start()
        return model
    }

    private func samplePoints() -> [YearlyTrendPointInput] {
        [
            YearlyTrendPointInput(year: "2021", avg10to80: 42.5, avg20to80: 31.2, count: 18),
            YearlyTrendPointInput(year: "2022", avg10to80: 39.8, avg20to80: 28.6, count: 44),
            YearlyTrendPointInput(year: "2023", avg10to80: 36.1, avg20to80: 26.9, count: 71),
            YearlyTrendPointInput(year: "2024", avg10to80: 34.7, avg20to80: 25.3, count: 58),
            YearlyTrendPointInput(year: "2025", avg10to80: 33.2, avg20to80: 24.1, count: 27)
        ]
    }

    private func loadedUpdate(connection: YearlyTrendConnection = .live) -> YearlyTrendUpdate {
        YearlyTrendUpdate(
            status: .loaded,
            points: samplePoints(),
            connection: connection,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: YearlyTrendUpdate) -> some View {
        ScrollView {
            YearlyTrendChart(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Empty") {
        previewSurface(YearlyTrendUpdate(status: .loaded, points: []))
    }

    #Preview("Loading") {
        previewSurface(YearlyTrendUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(YearlyTrendUpdate(status: .failed("Network unavailable")))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
