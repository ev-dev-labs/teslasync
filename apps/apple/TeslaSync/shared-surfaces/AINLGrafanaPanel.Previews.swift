//
//  AINLGrafanaPanel.Previews.swift
//  TeslaSync — P4 shared surface · 0033 · AINLGrafanaPanel (Apple)
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
        _ input: NLGrafanaPanelInputSnapshot,
        prompt: String = "",
        configure: ((NLGrafanaPanelModel, InMemoryNLGrafanaPanelSource) -> Void)? = nil
    ) -> NLGrafanaPanelModel {
        let source = InMemoryNLGrafanaPanelSource(initial: input)
        let model = NLGrafanaPanelModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = NLGrafanaPanelInputSnapshot(gate: .on)
    private let samplePrompt = "show me a daily time series of how far I drove this month"
    private let sampleRationale = """
    A daily time-series panel scoped to your fleet: one Postgres query sums each day's drive \
    distance over the current month from the drives table, plotted as a time series. Apply it \
    to the editor to fine-tune the window or styling before saving.
    """
    private let sampleDraft = GrafanaPanelDraft(
        prompt: "show me a daily time series of how far I drove this month",
        panel: GrafanaPanelEnvelope(
            title: "Daily Distance — This Month",
            type: "timeseries",
            datasource: GrafanaDatasourceRef(type: "postgres", uid: "teslasync-tsdb"),
            targets: [
                GrafanaPanelTarget(
                    refID: "A",
                    rawSQL: """
                    SELECT time_bucket('1 day', started_at) AS time, sum(distance_m) AS distance \
                    FROM drives WHERE started_at >= date_trunc('month', now()) GROUP BY 1 ORDER BY 1
                    """,
                    expr: nil,
                    format: "time_series"
                )
            ],
            gridPos: GrafanaPanelGridPos(x: 0, y: 0, width: 12, height: 8)
        ),
        rationale: "Sums daily drive distance for the current month from the drives table.",
        referencedTables: ["drives"]
    )

    #Preview("Idle / invite") {
        AINLGrafanaPanel(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AINLGrafanaPanel(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AINLGrafanaPanel(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Rationale streamed") {
        AINLGrafanaPanel(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushAnswer(sampleRationale)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Draft ready") {
        AINLGrafanaPanel(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushDraft(sampleDraft, rationaleDeltas: [sampleRationale])
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AINLGrafanaPanel(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty prompt") {
        AINLGrafanaPanel(model: previewModel(NLGrafanaPanelInputSnapshot(gate: .on)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AINLGrafanaPanel(model: previewModel(
            NLGrafanaPanelInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AINLGrafanaPanel(model: previewModel(
            NLGrafanaPanelInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AINLGrafanaPanel(model: previewModel(
            NLGrafanaPanelInputSnapshot(gate: .on, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AINLGrafanaPanel(model: previewModel(
            NLGrafanaPanelInputSnapshot(gate: .on, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
