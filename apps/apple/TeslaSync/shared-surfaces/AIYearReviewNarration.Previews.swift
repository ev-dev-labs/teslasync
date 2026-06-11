//
//  AIYearReviewNarration.Previews.swift
//  TeslaSync — P4 shared surface · 0061 · AIYearReviewNarration (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-vehicle,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: YearReviewNarrationInput) -> YearReviewNarrationModel {
        let source = InMemoryYearReviewNarrationSource(initial: input)
        let model = YearReviewNarrationModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicleID = 7

    private let sampleProse = """
    What a year. You covered about 14,200 km across 268 drives — your busiest stretch was a \
    coast-to-coast week in July that added five new Supercharger stops to your map. Charging stayed \
    overwhelmingly at home (82%), and your regen recovered the equivalent of roughly 1,900 km of \
    "free" range. Efficiency edged up 4% versus last year despite a colder winter, and your longest \
    single drive — 412 km — beat your previous best by 30 km. A steady, well-driven year overall.
    """

    private func readyInput(
        stream: YearReviewNarrationStreamSnapshot,
        vehicleID: Int? = sampleVehicleID,
        connection: YearReviewNarrationConnection = .live
    ) -> YearReviewNarrationInput {
        YearReviewNarrationInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIYearReviewNarration(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIYearReviewNarration(model: previewModel(
            readyInput(stream: YearReviewNarrationStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIYearReviewNarration(model: previewModel(
            readyInput(stream: YearReviewNarrationStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIYearReviewNarration(model: previewModel(
            readyInput(stream: YearReviewNarrationStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIYearReviewNarration(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIYearReviewNarration(model: previewModel(
            YearReviewNarrationInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIYearReviewNarration(model: previewModel(
            YearReviewNarrationInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIYearReviewNarration(model: previewModel(
            readyInput(
                stream: YearReviewNarrationStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIYearReviewNarration(model: previewModel(
            readyInput(
                stream: YearReviewNarrationStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIYearReviewNarration(model: previewModel(
            YearReviewNarrationInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
