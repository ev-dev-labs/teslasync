//
//  AINLAutomationBuilder.Previews.swift
//  TeslaSync — P4 shared surface · 0030 · AINLAutomationBuilder (Apple)
//
//  Xcode previews for each surface state (idle invite / prompt entered / streaming / streamed
//  narrative / stream-error / gate-loading / gate-error / stale / offline / gated-off). DEBUG-
//  only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: NLAutomationBuilderInputSnapshot,
        prompt: String = "",
        configure: ((NLAutomationBuilderModel, InMemoryNLAutomationBuilderSource) -> Void)? = nil
    ) -> NLAutomationBuilderModel {
        let source = InMemoryNLAutomationBuilderSource(initial: input)
        let model = NLAutomationBuilderModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42)
    private let samplePrompt = "Precondition the cabin to 22°C when I leave work on weekdays"
    private let sampleNarrative = [
        "Drafting an automation graph:\n",
        "• Trigger: weekday departure from Work geofence\n",
        "• Action: set climate keeper to 22°C\n",
        "Review and save below."
    ]

    #Preview("Idle / invite") {
        AINLAutomationBuilder(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AINLAutomationBuilder(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty / no vehicle") {
        AINLAutomationBuilder(model: previewModel(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: nil),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AINLAutomationBuilder(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Streamed narrative") {
        AINLAutomationBuilder(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushNarrative(sampleNarrative)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AINLAutomationBuilder(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AINLAutomationBuilder(model: previewModel(
            NLAutomationBuilderInputSnapshot(gate: .loading, vehicleID: 42)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AINLAutomationBuilder(model: previewModel(
            NLAutomationBuilderInputSnapshot(gate: .loading, vehicleID: 42, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AINLAutomationBuilder(model: previewModel(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AINLAutomationBuilder(model: previewModel(
            NLAutomationBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
