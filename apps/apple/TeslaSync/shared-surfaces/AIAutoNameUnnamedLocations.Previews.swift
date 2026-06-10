//
//  AIAutoNameUnnamedLocations.Previews.swift
//  TeslaSync — P4 shared surface · 0006 · AIAutoNameUnnamedLocations (Apple)
//
//  Xcode previews for each surface state (idle / current-label / streaming / proposal /
//  rejected proposal / stream-error / gate-loading / gate-error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: AINameDraftInput,
        configure: ((AINameDraftModel, InMemoryAINameDraftSource) -> Void)? = nil
    ) -> AINameDraftModel {
        let source = InMemoryAINameDraftSource(initial: input)
        let model = AINameDraftModel(source: source, onApply: { _ in })
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = AINameDraftInput(gate: .on, locationID: 4242, currentName: "37.7749, -122.4194")

    #Preview("Idle / invite") {
        AIAutoNameUnnamedLocations(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AIAutoNameUnnamedLocations(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal (ok)") {
        AIAutoNameUnnamedLocations(model: previewModel(readyInput) { _, source in
            source.pushDraft(locationID: 4242, proposedName: "Ocean Beach Parking", status: "ok")
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal (rejected)") {
        AIAutoNameUnnamedLocations(model: previewModel(readyInput) { _, source in
            source.pushDraft(
                locationID: 4242,
                proposedName: "Home",
                status: "rejected",
                reason: "Name too generic for a shared location."
            )
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AIAutoNameUnnamedLocations(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AIAutoNameUnnamedLocations(model: previewModel(
            AINameDraftInput(gate: .loading, locationID: 4242)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIAutoNameUnnamedLocations(model: previewModel(
            AINameDraftInput(gate: .loading, locationID: 4242, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIAutoNameUnnamedLocations(model: previewModel(
            AINameDraftInput(gate: .on, locationID: 4242, currentName: "37.77, -122.41", connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIAutoNameUnnamedLocations(model: previewModel(
            AINameDraftInput(gate: .on, locationID: 4242, currentName: "37.77, -122.41", connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
