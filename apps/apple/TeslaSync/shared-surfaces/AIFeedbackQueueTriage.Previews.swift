//
//  AIFeedbackQueueTriage.Previews.swift
//  TeslaSync — P4 shared surface · 0019 · AIFeedbackQueueTriage (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-feedback, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: FeedbackTriageInput) -> FeedbackTriageModel {
        let source = InMemoryFeedbackTriageSource(initial: input)
        let model = FeedbackTriageModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleFeedback = 482

    private let sampleProse = """
    Proposed status: needs-info. The report describes the charging-curve chart rendering blank on the \
    iPad split view, but omits the firmware build and whether it reproduces in portrait — both are \
    needed before this can move to triaged. Proposed category: bug · charts. Proposed priority: P2 — \
    it degrades a core analytics surface but has a clear workaround (rotate to full-screen). This is \
    a suggestion only; use the manual Status, GitHub URL, and Forward controls above to record any \
    decision.
    """

    private func readyInput(
        stream: FeedbackTriageStreamSnapshot,
        feedbackID: Int? = sampleFeedback,
        connection: FeedbackTriageConnection = .live
    ) -> FeedbackTriageInput {
        FeedbackTriageInput(
            availability: .resolved(enabled: true),
            feedbackID: feedbackID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIFeedbackQueueTriage(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIFeedbackQueueTriage(model: previewModel(
            readyInput(stream: FeedbackTriageStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIFeedbackQueueTriage(model: previewModel(
            readyInput(stream: FeedbackTriageStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIFeedbackQueueTriage(model: previewModel(
            readyInput(stream: FeedbackTriageStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no feedback") {
        AIFeedbackQueueTriage(model: previewModel(readyInput(stream: .idle, feedbackID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIFeedbackQueueTriage(model: previewModel(FeedbackTriageInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIFeedbackQueueTriage(model: previewModel(
            FeedbackTriageInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIFeedbackQueueTriage(model: previewModel(
            readyInput(stream: FeedbackTriageStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIFeedbackQueueTriage(model: previewModel(
            readyInput(stream: FeedbackTriageStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIFeedbackQueueTriage(model: previewModel(
            FeedbackTriageInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
