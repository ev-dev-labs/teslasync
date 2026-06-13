//
//  TeslaReauthBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  Xcode previews for each surface state (disconnected, connected/empty, checking/loading, error,
//  stale, offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: TeslaReauthInput) -> TeslaReauthBannerModel {
        let source = InMemoryTeslaReauthSource(initial: input)
        let model = TeslaReauthBannerModel(source: source, onReconnect: {}, onRecovered: {})
        model.start()
        return model
    }

    #Preview("Disconnected") {
        TeslaReauthBanner(model: previewModel(TeslaReauthInput(status: .expired)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Connected (empty)") {
        TeslaReauthBanner(model: previewModel(TeslaReauthInput(status: .connected)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Checking (loading)") {
        TeslaReauthBanner(model: previewModel(TeslaReauthInput(status: .unknown, isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TeslaReauthBanner(model: previewModel(TeslaReauthInput(
            errorMessage: "The Tesla auth status is unavailable"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TeslaReauthBanner(model: previewModel(TeslaReauthInput(status: .expired, connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TeslaReauthBanner(model: previewModel(TeslaReauthInput(status: .expired, connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }
#endif
