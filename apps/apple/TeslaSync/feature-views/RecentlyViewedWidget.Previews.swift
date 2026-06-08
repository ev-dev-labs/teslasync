//
//  RecentlyViewedWidget.Previews.swift
//  TeslaSync — P4 feature view · 0131 · RecentlyViewedWidget (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: RecentlyViewedInput) -> RecentlyViewedModel {
        let source = InMemoryRecentlyViewedSource(initial: input)
        let model = RecentlyViewedModel(source: source)
        model.start()
        return model
    }

    private let previewEntries: [RecentlyViewedEntry] = {
        let now = Date()
        return [
            RecentlyViewedEntry(
                path: "/vehicles/1",
                title: "Model 3 Performance",
                kind: .vehicle,
                refID: "1",
                visitedAt: now.addingTimeInterval(-30)
            ),
            RecentlyViewedEntry(
                path: "/drives/482",
                title: "Morning commute",
                kind: .drive,
                refID: "482",
                visitedAt: now.addingTimeInterval(-8 * 60)
            ),
            RecentlyViewedEntry(
                path: "/charging/77",
                title: "Supercharger — Fremont",
                kind: .charging,
                refID: "77",
                visitedAt: now.addingTimeInterval(-3 * 3600)
            ),
            RecentlyViewedEntry(
                path: "/trips/12",
                title: "Weekend road trip",
                kind: .trip,
                refID: "12",
                visitedAt: now.addingTimeInterval(-26 * 3600)
            ),
            RecentlyViewedEntry(
                path: "/analytics",
                title: "Fleet analytics",
                kind: .page,
                visitedAt: now.addingTimeInterval(-3 * 24 * 3600)
            )
        ]
    }()

    @MainActor
    private func previewSurface(_ input: RecentlyViewedInput) -> some View {
        RecentlyViewedWidget(model: previewModel(input))
            .frame(maxWidth: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        previewSurface(RecentlyViewedInput(entries: previewEntries))
    }

    #Preview("Empty") {
        previewSurface(RecentlyViewedInput(entries: []))
    }

    #Preview("Loading") {
        previewSurface(RecentlyViewedInput(isLoading: true))
    }

    #Preview("Error") {
        previewSurface(RecentlyViewedInput(
            errorMessage: "Recent pages store is unreadable (decode failed)"
        ))
    }

    #Preview("Stale") {
        previewSurface(RecentlyViewedInput(entries: previewEntries, freshness: .stale))
    }

    #Preview("Offline") {
        previewSurface(RecentlyViewedInput(entries: previewEntries, freshness: .offline))
    }
#endif
