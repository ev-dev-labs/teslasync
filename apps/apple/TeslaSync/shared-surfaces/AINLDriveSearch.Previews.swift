//
//  AINLDriveSearch.Previews.swift
//  TeslaSync — P4 shared surface · 0032 · AINLDriveSearch (Apple)
//
//  Xcode previews for each surface state (idle / prompt entered / streaming / answer /
//  stream-error / gate-loading / gate-error / stale / offline). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: NLDriveSearchInputSnapshot,
        prompt: String = "",
        configure: ((NLDriveSearchModel, InMemoryNLDriveSearchSource) -> Void)? = nil
    ) -> NLDriveSearchModel {
        let source = InMemoryNLDriveSearchSource(initial: input)
        let model = NLDriveSearchModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = NLDriveSearchInputSnapshot(gate: .on)
    private let samplePrompt = "last Friday's trip to the coast, the long one along the cliffs"
    private let sampleAnswer = """
    Found it — your drive on Fri 6 Jun, 17:42: a 78.4 km coastal run from Home to Pacifica \
    Overlook taking 1 h 12 m, with 14.6 kWh used and a 612 m elevation gain. Opening its replay…
    """

    #Preview("Idle / invite") {
        AINLDriveSearch(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AINLDriveSearch(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AINLDriveSearch(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Answer") {
        AINLDriveSearch(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushAnswer(sampleAnswer)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AINLDriveSearch(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty prompt") {
        AINLDriveSearch(model: previewModel(NLDriveSearchInputSnapshot(gate: .on)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AINLDriveSearch(model: previewModel(
            NLDriveSearchInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AINLDriveSearch(model: previewModel(
            NLDriveSearchInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AINLDriveSearch(model: previewModel(
            NLDriveSearchInputSnapshot(gate: .on, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AINLDriveSearch(model: previewModel(
            NLDriveSearchInputSnapshot(gate: .on, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
