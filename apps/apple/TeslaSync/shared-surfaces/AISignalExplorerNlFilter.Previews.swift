//
//  AISignalExplorerNlFilter.Previews.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  Xcode previews for each surface state (idle / prompt entered / streaming / proposal / stream-error
//  / gate-loading / gate-error / stale / offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: SignalExplorerFilterInputSnapshot,
        prompt: String = "",
        configure: ((SignalExplorerFilterModel, InMemorySignalExplorerFilterSource) -> Void)? = nil
    ) -> SignalExplorerFilterModel {
        let source = InMemorySignalExplorerFilterSource(initial: input)
        let model = SignalExplorerFilterModel(source: source, onApply: { _ in })
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 42)
    private let samplePrompt = "show me battery level and cabin temperature for yesterday"

    #Preview("Idle / invite") {
        AISignalExplorerNlFilter(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AISignalExplorerNlFilter(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AISignalExplorerNlFilter(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal") {
        AISignalExplorerNlFilter(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushDraft(
                vehicleID: 42,
                signals: ["battery_level", "inside_temp"],
                rangePreset: "24h",
                perPage: 100
            )
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AISignalExplorerNlFilter(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AISignalExplorerNlFilter(model: previewModel(
            SignalExplorerFilterInputSnapshot(gate: .loading, vehicleID: 42)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AISignalExplorerNlFilter(model: previewModel(
            SignalExplorerFilterInputSnapshot(gate: .loading, vehicleID: 42, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AISignalExplorerNlFilter(model: previewModel(
            SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 42, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AISignalExplorerNlFilter(model: previewModel(
            SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 42, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
