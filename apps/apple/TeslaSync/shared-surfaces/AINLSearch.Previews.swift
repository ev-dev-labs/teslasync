//
//  AINLSearch.Previews.swift
//  TeslaSync — P4 shared surface · 0034 · AINLSearch (Apple)
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
        _ input: NLSearchInputSnapshot,
        prompt: String = "",
        configure: ((NLSearchModel, InMemoryNLSearchSource) -> Void)? = nil
    ) -> NLSearchModel {
        let source = InMemoryNLSearchSource(initial: input)
        let model = NLSearchModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = NLSearchInputSnapshot(gate: .on)
    private let samplePrompt = "drives last weekend over 200 km with phantom drain"
    private let sampleAnswer = """
    Found 2 matches. Drive “Coast run” (Sat 7 Jun, 214.6 km) lost 4.1% overnight before it — \
    flagged by alert “Phantom drain > 3%/night”. Drive “Airport return” (Sun 8 Jun, 207.0 km) \
    paired with charging session #4471 at Home (41.2 kWh). Tap any entity to open it.
    """

    #Preview("Idle / invite") {
        AINLSearch(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AINLSearch(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AINLSearch(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Answer") {
        AINLSearch(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushAnswer(sampleAnswer)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AINLSearch(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty prompt") {
        AINLSearch(model: previewModel(NLSearchInputSnapshot(gate: .on)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AINLSearch(model: previewModel(
            NLSearchInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AINLSearch(model: previewModel(
            NLSearchInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AINLSearch(model: previewModel(
            NLSearchInputSnapshot(gate: .on, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AINLSearch(model: previewModel(
            NLSearchInputSnapshot(gate: .on, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
