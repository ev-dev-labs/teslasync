//
//  BrowserCompatBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  Xcode previews for each surface state (warning / empty-compatible / empty-acknowledged / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum BrowserCompatPreviewData {
        static let missing: [RequiredCapability] = [
            BrowserCompatCapabilities.swiftCharts,
            BrowserCompatCapabilities.mapKit,
            BrowserCompatCapabilities.liveActivities
        ]
    }

    @MainActor
    private func previewModel(_ input: BrowserCompatInput) -> BrowserCompatBannerModel {
        let source = InMemoryBrowserCompatBannerSource(initial: input)
        let model = BrowserCompatBannerModel(source: source)
        model.start()
        return model
    }

    #Preview("Warning — missing capabilities") {
        BrowserCompatBanner(model: previewModel(BrowserCompatInput(
            missing: BrowserCompatPreviewData.missing
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — compatible") {
        BrowserCompatBanner(model: previewModel(BrowserCompatInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — acknowledged") {
        BrowserCompatBanner(model: previewModel(BrowserCompatInput(
            missing: BrowserCompatPreviewData.missing,
            dismissed: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BrowserCompatBanner(model: previewModel(BrowserCompatInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        BrowserCompatBanner(model: previewModel(BrowserCompatInput(
            errorMessage: "The capability probe failed to complete"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        BrowserCompatBanner(model: previewModel(BrowserCompatInput(
            missing: BrowserCompatPreviewData.missing,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        BrowserCompatBanner(model: previewModel(BrowserCompatInput(
            missing: BrowserCompatPreviewData.missing,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
