//
//  AITripPostcardShareCardImageGeneration.Previews.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  Xcode previews for each surface state (gated-off / no-trip / idle / thinking / draft / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: AIPostcardInput,
        stream: AIPostcardStreamSnapshot? = nil
    ) -> AIPostcardModel {
        let source = InMemoryAIPostcardSource(initial: input)
        let driver = InMemoryAIPostcardStreamDriver()
        let model = AIPostcardModel(source: source, streamDriver: driver)
        model.start()
        if let stream { driver.push(stream) }
        return model
    }

    private func staged(_ model: AIPostcardModel) -> some View {
        AITripPostcardShareCardImageGeneration(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    private let sampleDraft =
        "Image prompt: a minimalist sunrise coastal drive postcard, soft teal-and-amber gradient sky, " +
        "clean sans-serif overlay. Preview spec: 1200×630, distance + duration chips, no map, no " +
        "coordinates."

    // The gate-off surface renders nothing (faithful `withAiFeature` parity); the preview shows the
    // collapse alongside its label so the behaviour is visible in the canvas.
    #Preview("Gated off") {
        staged(previewModel(AIPostcardInput(featureEnabled: false, tripID: 42)))
    }

    #Preview("No trip") {
        staged(previewModel(AIPostcardInput(tripID: nil)))
    }

    #Preview("Idle") {
        staged(previewModel(AIPostcardInput(tripID: 42)))
    }

    #Preview("Thinking") {
        staged(previewModel(
            AIPostcardInput(tripID: 42),
            stream: AIPostcardStreamSnapshot(lifecycle: .streaming)
        ))
    }

    #Preview("Draft") {
        staged(previewModel(
            AIPostcardInput(tripID: 42, styleHint: "vintage"),
            stream: AIPostcardStreamSnapshot(lifecycle: .done, text: sampleDraft)
        ))
    }

    #Preview("Error") {
        staged(previewModel(
            AIPostcardInput(tripID: 42),
            stream: AIPostcardStreamSnapshot(lifecycle: .error, error: "stream_http_429")
        ))
    }

    #Preview("Stale") {
        staged(previewModel(
            AIPostcardInput(tripID: 42, connection: .stale),
            stream: AIPostcardStreamSnapshot(lifecycle: .done, text: sampleDraft)
        ))
    }

    #Preview("Offline") {
        staged(previewModel(
            AIPostcardInput(tripID: 42, connection: .offline),
            stream: AIPostcardStreamSnapshot(lifecycle: .done, text: sampleDraft)
        ))
    }
#endif
