//
//  AIIncidentTimelineSummarizer.Previews.swift
//  TeslaSync — P4 shared surface · 0022 · AIIncidentTimelineSummarizer (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-incident, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: IncidentSummarizerInput) -> IncidentSummarizerModel {
        let source = InMemoryIncidentSummarizerSource(initial: input)
        let model = IncidentSummarizerModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleIncidentID = 4821

    private let sampleProse = """
    At 09:14 the MQTT ingest pod reported a rising fleet-telemetry backlog and the on-call was paged. \
    Two updates followed: at 09:21 the team correlated the backlog with a TimescaleDB connection-pool \
    saturation, and at 09:38 the pool size was raised and the backlog began draining. The incident was \
    marked resolved at 10:02 once signal_log writes caught up to live. No vehicle data was lost — the \
    broker held messages through the window. This summary only restates the recorded timeline; it does \
    not infer a root cause beyond what the updates state.
    """

    private func readyInput(
        stream: IncidentSummarizerStreamSnapshot,
        incidentID: Int? = sampleIncidentID,
        connection: IncidentSummarizerConnection = .live
    ) -> IncidentSummarizerInput {
        IncidentSummarizerInput(
            availability: .resolved(enabled: true),
            incidentID: incidentID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIIncidentTimelineSummarizer(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIIncidentTimelineSummarizer(model: previewModel(
            readyInput(stream: IncidentSummarizerStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIIncidentTimelineSummarizer(model: previewModel(
            readyInput(stream: IncidentSummarizerStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIIncidentTimelineSummarizer(model: previewModel(
            readyInput(stream: IncidentSummarizerStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no incident") {
        AIIncidentTimelineSummarizer(model: previewModel(readyInput(stream: .idle, incidentID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIIncidentTimelineSummarizer(model: previewModel(IncidentSummarizerInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIIncidentTimelineSummarizer(model: previewModel(
            IncidentSummarizerInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIIncidentTimelineSummarizer(model: previewModel(
            readyInput(
                stream: IncidentSummarizerStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIIncidentTimelineSummarizer(model: previewModel(
            readyInput(
                stream: IncidentSummarizerStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIIncidentTimelineSummarizer(model: previewModel(
            IncidentSummarizerInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
