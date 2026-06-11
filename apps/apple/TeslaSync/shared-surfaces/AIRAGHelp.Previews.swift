//
//  AIRAGHelp.Previews.swift
//  TeslaSync — P4 shared surface · 0042 · AIRAGHelp (Apple)
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
        _ input: RAGHelpInputSnapshot,
        prompt: String = "",
        configure: ((RAGHelpModel, InMemoryRAGHelpSource) -> Void)? = nil
    ) -> RAGHelpModel {
        let source = InMemoryRAGHelpSource(initial: input)
        let model = RAGHelpModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = RAGHelpInputSnapshot(gate: .on)
    private let samplePrompt = "How do I enable energy cost forecasting?"
    private let sampleAnswer = """
    Turn it on in Settings → Energy → Cost forecasting: toggle “Forecast costs”, then set your \
    tariff under Tariffs [docs: energy/cost-forecasting.md §2]. The Cost card starts projecting \
    once seven days of charging history exist [runbook: forecasting-bootstrap.md]. The toggle’s \
    label is the i18n string settings.energy.costForecast.title.
    """

    #Preview("Idle / invite") {
        AIRAGHelp(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AIRAGHelp(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AIRAGHelp(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Answer") {
        AIRAGHelp(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushAnswer(sampleAnswer)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AIRAGHelp(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty prompt") {
        AIRAGHelp(model: previewModel(RAGHelpInputSnapshot(gate: .on)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AIRAGHelp(model: previewModel(
            RAGHelpInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIRAGHelp(model: previewModel(
            RAGHelpInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIRAGHelp(model: previewModel(
            RAGHelpInputSnapshot(gate: .on, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIRAGHelp(model: previewModel(
            RAGHelpInputSnapshot(gate: .on, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
