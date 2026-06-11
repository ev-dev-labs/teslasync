//
//  NewVersionBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  Xcode previews for each surface state (available / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The previews
//  drive the in-memory source so every branch renders without a network or real time.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ snapshot: NewVersionWatcherSnapshot) -> NewVersionBannerModel {
        let source = InMemoryNewVersionBannerSource(initial: snapshot)
        let model = NewVersionBannerModel(source: source, onReload: {})
        model.start()
        return model
    }

    #Preview("Available — new version") {
        NewVersionBanner(model: previewModel(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1",
            latestVersion: "2026.6.2"
        )))
        .padding()
        .frame(maxWidth: 420)
        .background(Color.TS.bg)
    }

    #Preview("Empty — up to date") {
        NewVersionBanner(model: previewModel(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.2",
            latestVersion: "2026.6.2"
        )))
        .padding()
        .frame(maxWidth: 420)
        .background(Color.TS.bg)
    }

    #Preview("Loading — boot probe") {
        NewVersionBanner(model: previewModel(NewVersionWatcherSnapshot(isLoading: true)))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Error — boot probe failed") {
        NewVersionBanner(model: previewModel(NewVersionWatcherSnapshot(
            errorMessage: "The /system/version request timed out"
        )))
        .padding()
        .frame(maxWidth: 420)
        .background(Color.TS.bg)
    }

    #Preview("Stale — poll failed") {
        NewVersionBanner(model: previewModel(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1",
            latestVersion: "2026.6.2",
            connection: .stale
        )))
        .padding()
        .frame(maxWidth: 420)
        .background(Color.TS.bg)
    }

    #Preview("Offline — last known") {
        NewVersionBanner(model: previewModel(NewVersionWatcherSnapshot(
            bootVersion: "2026.6.1",
            latestVersion: "2026.6.2",
            connection: .offline
        )))
        .padding()
        .frame(maxWidth: 420)
        .background(Color.TS.bg)
    }
#endif
