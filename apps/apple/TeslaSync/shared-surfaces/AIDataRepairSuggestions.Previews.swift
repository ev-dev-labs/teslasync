//
//  AIDataRepairSuggestions.Previews.swift
//  TeslaSync — P4 shared surface · 0015 · AIDataRepairSuggestions (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error, loading,
//  gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: DataRepairSuggestionsInput) -> DataRepairSuggestionsModel {
        let source = InMemoryDataRepairSuggestionsSource(initial: input)
        let model = DataRepairSuggestionsModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleProse = """
    Stale charging session #4821 (Supercharger, started 2 days ago, never closed): the last \
    telemetry frame is 14h old and the vehicle has since driven, so the session is orphaned. \
    Proposed plan — CLOSE at the last known frame (47.3 kWh added, 18:42 local). Review and apply \
    via the Close button on the matching row below; Helix does not write.
    """

    private func readyInput(
        stream: DataRepairStreamSnapshot,
        connection: DataRepairConnection = .live
    ) -> DataRepairSuggestionsInput {
        DataRepairSuggestionsInput(
            availability: .resolved(enabled: true),
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIDataRepairSuggestions(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIDataRepairSuggestions(model: previewModel(
            readyInput(stream: DataRepairStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIDataRepairSuggestions(model: previewModel(
            readyInput(stream: DataRepairStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIDataRepairSuggestions(model: previewModel(
            readyInput(stream: DataRepairStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIDataRepairSuggestions(model: previewModel(DataRepairSuggestionsInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIDataRepairSuggestions(model: previewModel(
            DataRepairSuggestionsInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIDataRepairSuggestions(model: previewModel(
            readyInput(stream: DataRepairStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIDataRepairSuggestions(model: previewModel(
            readyInput(stream: DataRepairStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIDataRepairSuggestions(model: previewModel(
            DataRepairSuggestionsInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
