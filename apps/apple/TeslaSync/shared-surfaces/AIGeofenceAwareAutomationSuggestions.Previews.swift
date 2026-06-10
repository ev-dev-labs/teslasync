//
//  AIGeofenceAwareAutomationSuggestions.Previews.swift
//  TeslaSync — P4 shared surface · 0020 · AIGeofenceAwareAutomationSuggestions (Apple)
//
//  Xcode previews for each surface state (idle / streaming / proposal ok / proposal
//  rejected / stream-error / gate-loading / gate-error / stale / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: GeofenceAutomationInputSnapshot,
        prompt: String = "",
        configure: ((GeofenceAutomationModel, InMemoryGeofenceAutomationSource) -> Void)? = nil
    ) -> GeofenceAutomationModel {
        let source = InMemoryGeofenceAutomationSource(initial: input)
        let model = GeofenceAutomationModel(source: source, onApply: { _ in })
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 42)
    private let samplePrompt = "When I arrive home on a weekday after sunset, enable cabin overheat protection"

    #Preview("Idle / invite") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal (ok)") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushDraft(
                name: "Home arrival overheat guard",
                description: "Enables cabin overheat protection when you park at Home after sunset.",
                vehicleID: 42,
                triggers: 1,
                conditions: 2,
                actions: 1,
                status: "ok"
            )
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal (rejected)") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushDraft(
                name: "",
                vehicleID: 42,
                triggers: 0,
                conditions: 0,
                actions: 0,
                status: "invalid",
                validationError: "No geofence matched “Home” for this vehicle."
            )
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(
            GeofenceAutomationInputSnapshot(gate: .loading, vehicleID: 42)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(
            GeofenceAutomationInputSnapshot(gate: .loading, vehicleID: 42, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(
            GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 42, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIGeofenceAwareAutomationSuggestions(model: previewModel(
            GeofenceAutomationInputSnapshot(gate: .on, vehicleID: 42, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
