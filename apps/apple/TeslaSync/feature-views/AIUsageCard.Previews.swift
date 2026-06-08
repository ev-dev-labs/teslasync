//
//  AIUsageCard.Previews.swift
//  TeslaSync — P4 feature view · 0203 · AIUsageCard (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AIUsagePreviewData {
        static let active = AIUsageData(
            callCount: 42,
            inputTokens: 18450,
            outputTokens: 7320,
            costMicroCents: 1_234_560
        )

        static let noCalls = AIUsageData.zero
    }

    @MainActor
    private func previewModel(_ input: AIUsageInput) -> AIUsageModel {
        let source = InMemoryAIUsageSource(initial: input)
        let model = AIUsageModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        AIUsageCard(model: previewModel(AIUsageInput(data: AIUsagePreviewData.active)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · no calls today") {
        AIUsageCard(model: previewModel(AIUsageInput(data: AIUsagePreviewData.noCalls)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · absent") {
        AIUsageCard(model: previewModel(AIUsageInput(data: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIUsageCard(model: previewModel(AIUsageInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AIUsageCard(model: previewModel(AIUsageInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIUsageCard(model: previewModel(AIUsageInput(
            data: AIUsagePreviewData.active,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIUsageCard(model: previewModel(AIUsageInput(
            data: AIUsagePreviewData.active,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Euro · precision 2") {
        AIUsageCard(model: previewModel(AIUsageInput(
            data: AIUsagePreviewData.active,
            currencySymbol: "€",
            decimalPrecision: 2
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
