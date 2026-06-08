//
//  RateLimitStatusPanel.Previews.swift
//  TeslaSync — P4 feature view · 0038 · RateLimitStatusPanel (Apple)
//
//  Xcode previews for each surface state (loading / data / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: RateLimitInput) -> RateLimitModel {
        let source = InMemoryRateLimitSource(initial: input)
        let model = RateLimitModel(source: source)
        model.start()
        return model
    }

    private let previewScopes: [RateLimitScope] = [
        RateLimitScope(
            id: "tesla.fleet_api.burst",
            name: "Tesla Fleet API · burst",
            current: 1,
            limit: 5,
            windowSeconds: 0,
            severity: .ok,
            detail: "Token-bucket guard in front of the Tesla Fleet API command proxy."
        ),
        RateLimitScope(
            id: "api.internal.minute",
            name: "Internal API · per minute",
            current: 350,
            limit: 600,
            windowSeconds: 60,
            resetAt: Date().addingTimeInterval(42),
            severity: .warn,
            detail: "Shared rolling-window budget for all authenticated dashboard reads."
        ),
        RateLimitScope(
            id: "api.write.minute",
            name: "Write endpoints · per minute",
            current: 110,
            limit: 120,
            windowSeconds: 60,
            resetAt: Date().addingTimeInterval(8),
            severity: .critical,
            detail: "POST / PUT / DELETE throttle. Approaching the cap."
        )
    ]

    private let previewResponse = RateLimitStatusResponse(
        generatedAt: Date().addingTimeInterval(-90),
        scopes: previewScopes
    )

    private let previewEmpty = RateLimitStatusResponse(
        generatedAt: Date().addingTimeInterval(-5),
        scopes: []
    )

    #Preview("Loading") {
        RateLimitStatusPanel(model: previewModel(RateLimitInput(isLoading: true, isFetching: true)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        RateLimitStatusPanel(model: previewModel(RateLimitInput(response: previewResponse)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        RateLimitStatusPanel(model: previewModel(RateLimitInput(response: previewEmpty)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        RateLimitStatusPanel(model: previewModel(
            RateLimitInput(errorMessage: "Tesla API returned 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        RateLimitStatusPanel(model: previewModel(
            RateLimitInput(isFetching: true, response: previewResponse, isStale: true)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        RateLimitStatusPanel(model: previewModel(
            RateLimitInput(response: previewResponse, isOffline: true)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }
#endif
