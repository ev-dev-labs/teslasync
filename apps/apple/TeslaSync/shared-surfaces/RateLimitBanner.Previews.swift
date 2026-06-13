//
//  RateLimitBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  Xcode previews for each surface state (rate-limit / upstream countdown, retry-ready, empty,
//  loading, error, stale, offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope. The previews use the manual ticker so the countdown is deterministic.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum RateLimitBannerPreviewData {
        static func rateLimited(retryAfterS: Int) -> RateLimitBannerEvent {
            .rateLimited(scope: "/vehicles", retryAfterS: retryAfterS)
        }

        static func upstream(retryAfterS: Int) -> RateLimitBannerEvent {
            .upstreamDown(upstream: "tesla", retryAfterS: retryAfterS)
        }
    }

    @MainActor
    private func previewModel(_ input: RateLimitBannerInput) -> RateLimitBannerModel {
        let source = InMemoryRateLimitBannerSource(initial: input)
        let model = RateLimitBannerModel(
            source: source,
            ticker: ManualRateLimitBannerTicker()
        )
        model.start()
        return model
    }

    #Preview("Data — rate-limited (counting down)") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput(
            event: RateLimitBannerPreviewData.rateLimited(retryAfterS: 30),
            sequence: 1
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — upstream down (counting down)") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput(
            event: RateLimitBannerPreviewData.upstream(retryAfterS: 20),
            sequence: 1
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — retry ready") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput(
            event: RateLimitBannerPreviewData.rateLimited(retryAfterS: 0),
            sequence: 1
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput(
            errorMessage: "The rate-limit status request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput(
            event: RateLimitBannerPreviewData.upstream(retryAfterS: 15),
            sequence: 1,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        RateLimitBanner(model: previewModel(RateLimitBannerInput(
            event: RateLimitBannerPreviewData.rateLimited(retryAfterS: 10),
            sequence: 1,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
