//
//  withAiFeature.Previews.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  Xcode previews for each gate verdict, wrapping the DEBUG sample inner. The "presented" verdict
//  shows the inner content stamped with the marker; every fail-closed verdict (unknown feature /
//  unresolved / failed / mode-off / flag-off) withdraws the surface (web `withAiFeature` → null),
//  shown in the canvas next to its label so the collapse is visible. DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: AiFeatureGateInput) -> WithAiFeatureGateModel {
        let source = InMemoryWithAiFeatureGateSource(initial: input)
        let model = WithAiFeatureGateModel(feature: input.featureID, source: source)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ label: String, _ input: AiFeatureGateInput) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            WithAiFeature(model: previewModel(input)) {
                WithAiFeatureSampleInner()
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    private let enabledFeature = "chatbot-llm"

    #Preview("Presented · live") {
        staged("enabled / live", AiFeatureGateInput(
            featureID: enabledFeature,
            status: .resolved,
            mode: .local,
            featureEnabled: true,
            connection: .live
        ))
    }

    #Preview("Presented · stale") {
        staged("enabled / stale", AiFeatureGateInput(
            featureID: enabledFeature,
            status: .resolved,
            mode: .cloud,
            featureEnabled: true,
            connection: .stale
        ))
    }

    #Preview("Presented · offline") {
        staged("enabled / offline", AiFeatureGateInput(
            featureID: enabledFeature,
            status: .resolved,
            mode: .local,
            featureEnabled: true,
            connection: .offline
        ))
    }

    // The fail-closed verdicts all withdraw the surface (faithful `withAiFeature` null); the label
    // makes the collapse visible in the canvas.
    #Preview("Withdrawn · mode off") {
        staged("disabled / ai_mode off", AiFeatureGateInput(
            featureID: enabledFeature,
            status: .resolved,
            mode: .off,
            featureEnabled: true
        ))
    }

    #Preview("Withdrawn · flag off") {
        staged("disabled / per-feature flag off", AiFeatureGateInput(
            featureID: enabledFeature,
            status: .resolved,
            mode: .local,
            featureEnabled: false
        ))
    }

    #Preview("Withdrawn · loading") {
        staged("unresolved / settings loading", AiFeatureGateInput(
            featureID: enabledFeature,
            status: .loading
        ))
    }

    #Preview("Withdrawn · failed") {
        staged("failed / settings query failed", AiFeatureGateInput(
            featureID: enabledFeature,
            status: .failed
        ))
    }
#endif
