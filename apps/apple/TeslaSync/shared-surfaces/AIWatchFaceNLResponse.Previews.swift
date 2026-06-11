//
//  AIWatchFaceNLResponse.Previews.swift
//  TeslaSync — P4 shared surface · 0060 · AIWatchFaceNLResponse (Apple)
//
//  Xcode previews for each surface state (idle / prompt entered / streaming / answer /
//  stream-error / over-cap / gate-loading / gate-error / stale / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: WatchFaceNLInputSnapshot,
        message: String = "",
        configure: ((WatchFaceNLModel, InMemoryWatchFaceNLSource) -> Void)? = nil
    ) -> WatchFaceNLModel {
        let source = InMemoryWatchFaceNLSource(initial: input)
        let model = WatchFaceNLModel(source: source)
        model.message = message
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = WatchFaceNLInputSnapshot(gate: .on)
    private let sampleMessage = "How is my battery and is the car locked right now?"
    private let sampleAnswer = """
    Your battery is at 72% (about 248 km of range) and not currently charging. The car is \
    locked, climate is off, and Sentry Mode is armed. No alerts in the last 24 hours.
    """

    #Preview("Idle / invite (empty is valid)") {
        AIWatchFaceNLResponse(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Idle / prompt entered") {
        AIWatchFaceNLResponse(model: previewModel(readyInput, message: sampleMessage))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AIWatchFaceNLResponse(model: previewModel(readyInput, message: sampleMessage) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Answer") {
        AIWatchFaceNLResponse(model: previewModel(readyInput, message: sampleMessage) { _, source in
            source.pushAnswer(sampleAnswer)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AIWatchFaceNLResponse(model: previewModel(readyInput, message: sampleMessage) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Over-cap prompt") {
        AIWatchFaceNLResponse(model: previewModel(
            readyInput,
            message: String(repeating: "How is my battery? ", count: 60)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AIWatchFaceNLResponse(model: previewModel(WatchFaceNLInputSnapshot(gate: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIWatchFaceNLResponse(model: previewModel(
            WatchFaceNLInputSnapshot(gate: .loading, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIWatchFaceNLResponse(model: previewModel(
            WatchFaceNLInputSnapshot(gate: .on, connection: .stale),
            message: sampleMessage
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIWatchFaceNLResponse(model: previewModel(
            WatchFaceNLInputSnapshot(gate: .on, connection: .offline),
            message: sampleMessage
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
