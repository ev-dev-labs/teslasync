//
//  AINLDashboardComposer.Previews.swift
//  TeslaSync — P4 shared surface · 0031 · AINLDashboardComposer (Apple)
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
        _ input: NLDashboardComposerInputSnapshot,
        prompt: String = "",
        configure: ((NLDashboardComposerModel, InMemoryNLDashboardComposerSource) -> Void)? = nil
    ) -> NLDashboardComposerModel {
        let source = InMemoryNLDashboardComposerSource(initial: input)
        let model = NLDashboardComposerModel(source: source)
        model.prompt = prompt
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = NLDashboardComposerInputSnapshot(gate: .on)
    private let samplePrompt =
        "give me an overview dashboard with daily drives, current battery, and recent alerts"
    private let sampleRationale = """
    An overview dashboard scoped to your fleet: a wide daily-drives trend on top, the current \
    battery state-of-charge gauge below it, and a recent-alerts table alongside. Built from the \
    curated panel catalog — apply it to the editor to fine-tune before saving.
    """
    private let sampleDraft = DashboardLayoutDraft(
        prompt: "give me an overview dashboard with daily drives, current battery, and recent alerts",
        dashboard: DashboardEnvelope(
            title: "Fleet Overview",
            slots: [
                DashboardSlot(
                    panelName: "daily-drives",
                    gridPos: DashboardSlotGrid(x: 0, y: 0, width: 12, height: 8)
                ),
                DashboardSlot(
                    panelName: "current-battery",
                    gridPos: DashboardSlotGrid(x: 0, y: 8, width: 6, height: 8)
                ),
                DashboardSlot(
                    panelName: "recent-alerts",
                    gridPos: DashboardSlotGrid(x: 6, y: 8, width: 6, height: 8)
                )
            ]
        ),
        rationale: "Daily drive counts, the current battery state, and the latest alerts.",
        referencedPanels: ["daily-drives", "current-battery", "recent-alerts"]
    )

    #Preview("Idle / invite") {
        AINLDashboardComposer(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AINLDashboardComposer(model: previewModel(readyInput, prompt: samplePrompt))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AINLDashboardComposer(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Rationale streamed") {
        AINLDashboardComposer(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushAnswer(sampleRationale)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Draft ready") {
        AINLDashboardComposer(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushDraft(sampleDraft, rationaleDeltas: [sampleRationale])
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AINLDashboardComposer(model: previewModel(readyInput, prompt: samplePrompt) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty prompt") {
        AINLDashboardComposer(model: previewModel(NLDashboardComposerInputSnapshot(gate: .on)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AINLDashboardComposer(model: previewModel(
            NLDashboardComposerInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AINLDashboardComposer(model: previewModel(
            NLDashboardComposerInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AINLDashboardComposer(model: previewModel(
            NLDashboardComposerInputSnapshot(gate: .on, connection: .stale),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AINLDashboardComposer(model: previewModel(
            NLDashboardComposerInputSnapshot(gate: .on, connection: .offline),
            prompt: samplePrompt
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
