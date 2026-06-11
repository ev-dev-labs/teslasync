//
//  AINLAlertBuilder.Previews.swift
//  TeslaSync — P4 shared surface · 0029 · AINLAlertBuilder (Apple)
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
        _ input: NLAlertBuilderInputSnapshot,
        prompt: String = "",
        configure: ((NLAlertBuilderModel, InMemoryNLAlertBuilderSource) -> Void)? = nil
    ) -> NLAlertBuilderModel {
        let source = InMemoryNLAlertBuilderSource(initial: input)
        let model = NLAlertBuilderModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42)
    private let samplePrompt = "Alert me if the battery cell voltage spread is over 50 mV"
    private let sampleNarrative = [
        "Drafting an AlertRule:\n",
        "• Signal: battery cell voltage spread\n",
        "• Condition: spread > 50 mV for 5 minutes\n",
        "• Severity: warning\n",
        "Review and save below."
    ]

    #Preview("Idle / invite") {
        AINLAlertBuilder(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AINLAlertBuilder(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty / no vehicle") {
        AINLAlertBuilder(model: previewModel(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: nil),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AINLAlertBuilder(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Streamed narrative") {
        AINLAlertBuilder(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushNarrative(sampleNarrative)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AINLAlertBuilder(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AINLAlertBuilder(model: previewModel(
            NLAlertBuilderInputSnapshot(gate: .loading, vehicleID: 42)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AINLAlertBuilder(model: previewModel(
            NLAlertBuilderInputSnapshot(gate: .loading, vehicleID: 42, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AINLAlertBuilder(model: previewModel(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AINLAlertBuilder(model: previewModel(
            NLAlertBuilderInputSnapshot(gate: .on, vehicleID: 42, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
