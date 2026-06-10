//
//  AILogTraceSummarization.Previews.swift
//  TeslaSync — P4 shared surface · 0026 · AILogTraceSummarization (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-window, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: LogTraceSummaryInput) -> LogTraceSummaryModel {
        let source = InMemoryLogTraceSummarySource(initial: input)
        let model = LogTraceSummaryModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    // A valid in-scope window: a 30-minute span (1800 s ≤ the 24-hour cap) of Unix seconds.
    private let sampleFromUnix = 1_717_000_000
    private let sampleToUnix = 1_717_001_800
    private let sampleVehicle = 7

    private let sampleProse = """
    The window is quiet and healthy: 412 events, no errors, two warnings. \
    The MQTT subscriber reconnected once at 18:41 and resumed within 200 ms; \
    the FSM logged three drive→park transitions and one charge start. Signal-store \
    hydration completed on boot and the SSE hub stayed subscribed throughout. \
    Nothing in this window indicates a fault — these are descriptive counts of the \
    same lines the table below shows, not a root-cause claim.
    """

    private func readyInput(
        stream: LogTraceSummaryStreamSnapshot,
        fromUnix: Int? = sampleFromUnix,
        toUnix: Int? = sampleToUnix,
        connection: LogTraceSummaryConnection = .live
    ) -> LogTraceSummaryInput {
        LogTraceSummaryInput(
            availability: .resolved(enabled: true),
            fromUnix: fromUnix,
            toUnix: toUnix,
            vehicleID: sampleVehicle,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AILogTraceSummarization(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AILogTraceSummarization(model: previewModel(
            readyInput(stream: LogTraceSummaryStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AILogTraceSummarization(model: previewModel(
            readyInput(stream: LogTraceSummaryStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AILogTraceSummarization(model: previewModel(
            readyInput(stream: LogTraceSummaryStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no window") {
        AILogTraceSummarization(model: previewModel(
            readyInput(stream: .idle, fromUnix: nil, toUnix: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AILogTraceSummarization(model: previewModel(
            LogTraceSummaryInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AILogTraceSummarization(model: previewModel(
            LogTraceSummaryInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AILogTraceSummarization(model: previewModel(
            readyInput(
                stream: LogTraceSummaryStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AILogTraceSummarization(model: previewModel(
            readyInput(
                stream: LogTraceSummaryStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AILogTraceSummarization(model: previewModel(
            LogTraceSummaryInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
