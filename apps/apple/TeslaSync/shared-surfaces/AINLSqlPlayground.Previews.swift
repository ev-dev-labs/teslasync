//
//  AINLSqlPlayground.Previews.swift
//  TeslaSync — P4 shared surface · 0035 · AINLSqlPlayground (Apple)
//
//  Xcode previews for each surface state (idle / prompt entered / streaming / rationale /
//  draft-ready / stream-error / gate-loading / gate-error / stale / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: NLSqlPlaygroundInputSnapshot,
        prompt: String = "",
        configure: ((NLSqlPlaygroundModel, InMemoryNLSqlPlaygroundSource) -> Void)? = nil
    ) -> NLSqlPlaygroundModel {
        let source = InMemoryNLSqlPlaygroundSource(initial: input)
        let model = NLSqlPlaygroundModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = NLSqlPlaygroundInputSnapshot(gate: .on)
    private let samplePrompt = "how many drives did I take last week and how far did I go"
    private let sampleRationale = """
    Counting rows in the drives table within the trailing 7 days and summing the distance \
    column, scoped to your vehicles. This is a read-only aggregate — safe to run.
    """
    private let sampleDraft = ReadonlySQLDraft(
        prompt: "how many drives did I take last week and how far did I go",
        sql: """
        SELECT count(*) AS drive_count, round(sum(distance_m) / 1000.0, 1) AS total_km
        FROM drives
        WHERE started_at >= now() - interval '7 days';
        """,
        rationale: "Aggregate count + distance over the trailing week.",
        referencedTables: ["drives"]
    )

    #Preview("Idle / invite") {
        AINLSqlPlayground(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AINLSqlPlayground(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AINLSqlPlayground(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Rationale streamed") {
        AINLSqlPlayground(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushAnswer(sampleRationale)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Draft ready") {
        AINLSqlPlayground(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushDraft(sampleDraft, rationaleDeltas: [sampleRationale])
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AINLSqlPlayground(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty prompt") {
        AINLSqlPlayground(model: previewModel(NLSqlPlaygroundInputSnapshot(gate: .on)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AINLSqlPlayground(model: previewModel(
            NLSqlPlaygroundInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AINLSqlPlayground(model: previewModel(
            NLSqlPlaygroundInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AINLSqlPlayground(model: previewModel(
            NLSqlPlaygroundInputSnapshot(gate: .on, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AINLSqlPlayground(model: previewModel(
            NLSqlPlaygroundInputSnapshot(gate: .on, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
