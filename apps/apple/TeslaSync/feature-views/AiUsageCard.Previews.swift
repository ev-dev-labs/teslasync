//
//  AiUsageCard.Previews.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  Xcode previews for each surface state (data / data with error intent / empty / loading / error
//  / stale / offline / gated / euro currency). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AiUsagePreviewData {
        static let today = AiUsageToday(
            callCount: 42,
            inputTokens: 18450,
            outputTokens: 7320,
            costMicroCents: 1_234_560,
            errorCount: 1,
            avgLatencyMs: 642
        )

        static let highErrorToday = AiUsageToday(
            callCount: 40,
            inputTokens: 12000,
            outputTokens: 5000,
            costMicroCents: 980_000,
            errorCount: 9,
            avgLatencyMs: 1180
        )

        static let byFeature = [
            AiUsageFeatureRow(featureID: "chat", callCount: 28),
            AiUsageFeatureRow(featureID: "drive-summary", callCount: 9),
            AiUsageFeatureRow(featureID: "anomaly-explain", callCount: 5)
        ]

        static func recent(now: Date) -> [AiUsageRecentRow] {
            let iso = ISO8601DateFormatter()
            return [
                AiUsageRecentRow(
                    id: 1,
                    featureID: "chat",
                    model: "gpt-4o-mini",
                    inputTokens: 820,
                    outputTokens: 240,
                    startedAt: iso.string(from: now.addingTimeInterval(-35))
                ),
                AiUsageRecentRow(
                    id: 2,
                    featureID: "drive-summary",
                    model: "claude-3-haiku",
                    inputTokens: 1400,
                    outputTokens: 360,
                    startedAt: iso.string(from: now.addingTimeInterval(-420)),
                    error: "rate_limited"
                ),
                AiUsageRecentRow(
                    id: 3,
                    featureID: "anomaly-explain",
                    model: "gpt-4o",
                    inputTokens: 2100,
                    outputTokens: 540,
                    startedAt: iso.string(from: now.addingTimeInterval(-7200))
                )
            ]
        }
    }

    @MainActor
    private func previewModel(_ input: AiUsageInput) -> AiUsageModel {
        let source = InMemoryAiUsageSource(initial: input)
        let model = AiUsageModel(source: source)
        model.start()
        return model
    }

    private func dataInput(currencySymbol: String = "$", connection: AiUsageConnection = .live) -> AiUsageInput {
        let now = Date()
        return AiUsageInput(
            today: AiUsagePreviewData.today,
            byFeature: AiUsagePreviewData.byFeature,
            recent: AiUsagePreviewData.recent(now: now),
            currencySymbol: currencySymbol,
            connection: connection,
            now: now
        )
    }

    #Preview("Data") {
        AiUsageCard(model: previewModel(dataInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data · high error rate") {
        AiUsageCard(model: previewModel(AiUsageInput(
            today: AiUsagePreviewData.highErrorToday,
            byFeature: AiUsagePreviewData.byFeature
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty · no calls") {
        AiUsageCard(model: previewModel(AiUsageInput(today: .zero)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AiUsageCard(model: previewModel(AiUsageInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AiUsageCard(model: previewModel(AiUsageInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AiUsageCard(model: previewModel(dataInput(connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AiUsageCard(model: previewModel(dataInput(connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AiUsageCard(model: previewModel(AiUsageInput(aiModeOff: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Euro · precision 2") {
        AiUsageCard(model: previewModel(dataInput(currencySymbol: "€")))
            .padding()
            .background(Color.TS.bg)
    }
#endif
