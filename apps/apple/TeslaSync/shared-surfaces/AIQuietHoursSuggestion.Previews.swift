//
//  AIQuietHoursSuggestion.Previews.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  Xcode previews for each surface state (idle invite / streaming / proposed window / proposed window
//  with the insufficient-history + existing-count notes / stream-error / gate-loading / gate-error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: QuietHoursSuggestionInputSnapshot,
        configure: ((QuietHoursSuggestionModel, InMemoryQuietHoursSuggestionSource) -> Void)? = nil
    ) -> QuietHoursSuggestionModel {
        let source = InMemoryQuietHoursSuggestionSource(initial: input)
        let model = QuietHoursSuggestionModel(source: source)
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = QuietHoursSuggestionInputSnapshot(gate: .on)

    #Preview("Idle / invite") {
        AIQuietHoursSuggestion(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AIQuietHoursSuggestion(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposed window") {
        AIQuietHoursSuggestion(model: previewModel(readyInput) { _, source in
            source.pushProposal(
                startLocal: "22:00",
                endLocal: "07:00",
                timezone: "America/Los_Angeles",
                weekdays: 127,
                bypassSeverities: ["critical"]
            )
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposed window / advisories") {
        AIQuietHoursSuggestion(model: previewModel(readyInput) { _, source in
            source.pushProposal(
                startLocal: "23:30",
                endLocal: "06:30",
                timezone: "Europe/Berlin",
                weekdays: 62,
                bypassSeverities: ["critical", "warning"],
                status: "insufficient_history",
                existingWindowsCount: 2
            )
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AIQuietHoursSuggestion(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AIQuietHoursSuggestion(model: previewModel(
            QuietHoursSuggestionInputSnapshot(gate: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIQuietHoursSuggestion(model: previewModel(
            QuietHoursSuggestionInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIQuietHoursSuggestion(model: previewModel(
            QuietHoursSuggestionInputSnapshot(gate: .on, connection: .stale)
        ) { _, source in
            source.pushProposal()
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIQuietHoursSuggestion(model: previewModel(
            QuietHoursSuggestionInputSnapshot(gate: .on, connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
