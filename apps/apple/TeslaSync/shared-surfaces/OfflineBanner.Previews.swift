//
//  OfflineBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  Xcode previews for each surface state (offline, stale, online, loading, error). DEBUG-only; compiled
//  by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: OfflineBannerInput) -> OfflineBannerModel {
        let source = InMemoryOfflineBannerSource(initial: input)
        let model = OfflineBannerModel(source: source)
        model.start()
        return model
    }

    #Preview("Offline") {
        OfflineBanner(model: previewModel(OfflineBannerInput(status: .offline)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        OfflineBanner(model: previewModel(OfflineBannerInput(status: .offline, freshness: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Online") {
        OfflineBanner(model: previewModel(OfflineBannerInput(status: .online)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        OfflineBanner(model: previewModel(OfflineBannerInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        OfflineBanner(model: previewModel(OfflineBannerInput(
            errorMessage: "The connectivity monitor is unavailable"
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
