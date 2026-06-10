//
//  AILifetimeStatsQA.Previews.swift
//  TeslaSync — P4 shared surface · 0024 · AILifetimeStatsQA (Apple)
//
//  Xcode previews for each surface state (idle / prompt entered / streaming / answer /
//  stream-error / gate-loading / gate-error / stale / offline). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: LifetimeStatsQAInputSnapshot,
        question: String = "",
        configure: ((LifetimeStatsQAModel, InMemoryLifetimeStatsQASource) -> Void)? = nil
    ) -> LifetimeStatsQAModel {
        let source = InMemoryLifetimeStatsQASource(initial: input)
        let model = LifetimeStatsQAModel(source: source)
        model.question = question
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42)
    private let sampleQuestion = "How far have I driven in total, and how much have I saved on fuel?"
    private let sampleAnswer = """
    Across the life of this vehicle you've driven 48,210 km over 1,204 drives. \
    You've added 11.6 MWh in 318 charging sessions, saving roughly $5,940 versus petrol — \
    and unlocked 14 achievements, including a 612 km single-day record.
    """

    #Preview("Idle / invite") {
        AILifetimeStatsQA(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / question entered") {
        AILifetimeStatsQA(model: previewModel(readyInput, question: sampleQuestion))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AILifetimeStatsQA(model: previewModel(readyInput, question: sampleQuestion) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Answer") {
        AILifetimeStatsQA(model: previewModel(readyInput, question: sampleQuestion) { _, source in
            source.pushAnswer(sampleAnswer)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AILifetimeStatsQA(model: previewModel(readyInput, question: sampleQuestion) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No vehicle") {
        AILifetimeStatsQA(model: previewModel(
            LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 0),
            question: sampleQuestion
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AILifetimeStatsQA(model: previewModel(
            LifetimeStatsQAInputSnapshot(gate: .loading, vehicleID: 42)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AILifetimeStatsQA(model: previewModel(
            LifetimeStatsQAInputSnapshot(gate: .loading, vehicleID: 42, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AILifetimeStatsQA(model: previewModel(
            LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42, connection: .stale),
            question: sampleQuestion
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AILifetimeStatsQA(model: previewModel(
            LifetimeStatsQAInputSnapshot(gate: .on, vehicleID: 42, connection: .offline),
            question: sampleQuestion
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
