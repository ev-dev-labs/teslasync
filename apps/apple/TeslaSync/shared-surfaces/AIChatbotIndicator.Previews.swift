//
//  AIChatbotIndicator.Previews.swift
//  TeslaSync — P4 shared surface · 0012 · AIChatbotIndicator (Apple)
//
//  Xcode previews for each surface state (gated-off / loading / unavailable / presented-live /
//  presented-stale / presented-offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: AIChatbotIndicatorInput) -> AIChatbotIndicatorModel {
        let source = InMemoryAIChatbotIndicatorSource(initial: input)
        let model = AIChatbotIndicatorModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: AIChatbotIndicatorModel) -> some View {
        AIChatbotIndicator(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    // The gate-off surface renders nothing (faithful `withAiFeature` parity); the preview shows the
    // collapse alongside its label so the behaviour is visible in the canvas.
    #Preview("Gated off") {
        staged(previewModel(AIChatbotIndicatorInput(status: .resolved, mode: .off, featureEnabled: true)))
    }

    #Preview("Loading") {
        staged(previewModel(AIChatbotIndicatorInput(status: .loading)))
    }

    #Preview("Unavailable") {
        staged(previewModel(AIChatbotIndicatorInput(status: .failed)))
    }

    #Preview("Presented live") {
        staged(previewModel(AIChatbotIndicatorInput(
            status: .resolved,
            mode: .local,
            featureEnabled: true,
            connection: .live
        )))
    }

    #Preview("Presented stale") {
        staged(previewModel(AIChatbotIndicatorInput(
            status: .resolved,
            mode: .cloud,
            featureEnabled: true,
            connection: .stale
        )))
    }

    #Preview("Presented offline") {
        staged(previewModel(AIChatbotIndicatorInput(
            status: .resolved,
            mode: .local,
            featureEnabled: true,
            connection: .offline
        )))
    }
#endif
