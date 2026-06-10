//
//  AIAutoTripNameSuggestion.Previews.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  Xcode previews for each surface state (gated-off / no-trip / idle / thinking / suggestion /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: AITripNameInput,
        stream: AiStreamSnapshot? = nil
    ) -> AITripNameModel {
        let source = InMemoryAITripNameSource(initial: input)
        let driver = InMemoryAITripNameStreamDriver()
        let model = AITripNameModel(source: source, streamDriver: driver)
        model.start()
        if let stream { driver.push(stream) }
        return model
    }

    private func staged(_ model: AITripNameModel) -> some View {
        AIAutoTripNameSuggestion(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    // The gate-off surface renders nothing (faithful `withAiFeature` parity); the preview shows the
    // collapse alongside its label so the behaviour is visible in the canvas.
    #Preview("Gated off") {
        staged(previewModel(AITripNameInput(featureEnabled: false, tripID: "42")))
    }

    #Preview("No trip") {
        staged(previewModel(AITripNameInput(tripID: nil)))
    }

    #Preview("Idle") {
        staged(previewModel(AITripNameInput(tripID: "42")))
    }

    #Preview("Thinking") {
        staged(previewModel(
            AITripNameInput(tripID: "42"),
            stream: AiStreamSnapshot(lifecycle: .streaming)
        ))
    }

    #Preview("Suggestion") {
        staged(previewModel(
            AITripNameInput(tripID: "42"),
            stream: AiStreamSnapshot(lifecycle: .done, text: "Sunday Morning Coast Run")
        ))
    }

    #Preview("Error") {
        staged(previewModel(
            AITripNameInput(tripID: "42"),
            stream: AiStreamSnapshot(lifecycle: .error, error: "stream_http_429")
        ))
    }

    #Preview("Stale") {
        staged(previewModel(
            AITripNameInput(tripID: "42", connection: .stale),
            stream: AiStreamSnapshot(lifecycle: .done, text: "Evening Commute")
        ))
    }

    #Preview("Offline") {
        staged(previewModel(
            AITripNameInput(tripID: "42", connection: .offline),
            stream: AiStreamSnapshot(lifecycle: .done, text: "Evening Commute")
        ))
    }
#endif
