//
//  OnboardingGate.Previews.swift
//  TeslaSync — P4 feature view · 0194 · OnboardingGate (Apple)
//
//  Xcode previews for each surface state (redirect / complete / skipped / allow-
//  listed / loading / empty / error / stale / offline). DEBUG-only; skipped by the
//  swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: OnboardingGateUpdate) -> OnboardingGateModel {
        let source = InMemoryOnboardingGateSource(initial: update)
        let model = OnboardingGateModel(source: source)
        model.start()
        return model
    }

    private let incompleteStatus = OnboardingStatus(
        teslaConnected: true,
        vehicleCount: 1,
        dataFlowing: false,
        isComplete: false
    )

    private let freshStatus = OnboardingStatus(
        teslaConnected: false,
        vehicleCount: 0,
        dataFlowing: false,
        isComplete: false
    )

    private let completeStatus = OnboardingStatus(
        teslaConnected: true,
        vehicleCount: 2,
        dataFlowing: true,
        isComplete: true
    )

    @MainActor
    private func gatePreview(_ update: OnboardingGateUpdate) -> some View {
        OnboardingGateView(model: previewModel(update))
            .frame(width: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Redirect") {
        gatePreview(OnboardingGateUpdate(feed: .loaded(freshStatus), isSkipped: false, path: "/"))
    }

    #Preview("Complete") {
        gatePreview(OnboardingGateUpdate(feed: .loaded(completeStatus), path: "/"))
    }

    #Preview("Skipped") {
        gatePreview(OnboardingGateUpdate(feed: .loaded(incompleteStatus), isSkipped: true, path: "/"))
    }

    #Preview("Allow-listed") {
        gatePreview(OnboardingGateUpdate(feed: .loaded(incompleteStatus), path: "/settings"))
    }

    #Preview("Loading") {
        gatePreview(OnboardingGateUpdate(feed: .loading))
    }

    #Preview("Empty") {
        gatePreview(OnboardingGateUpdate(feed: .empty))
    }

    #Preview("Error") {
        gatePreview(OnboardingGateUpdate(feed: .failed(message: "HTTP 503 — onboarding status unavailable")))
    }

    #Preview("Stale (cached)") {
        gatePreview(OnboardingGateUpdate(
            feed: .loaded(incompleteStatus),
            path: "/",
            connection: .stale,
            updatedAt: Date().addingTimeInterval(-120)
        ))
    }

    #Preview("Offline (cached)") {
        gatePreview(OnboardingGateUpdate(
            feed: .loaded(incompleteStatus),
            path: "/",
            connection: .offline,
            updatedAt: Date().addingTimeInterval(-900)
        ))
    }
#endif
