//
//  EmptyStateThreshold.Previews.swift
//  TeslaSync — P4 shared surface · 0119 · EmptyStateThreshold (Apple)
//
//  Xcode previews for each surface state (the threshold card with a custom noun + description + CTA,
//  the default-noun card, the custom-message card, plus empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum EmptyStateThresholdPreviewData {
        static func gate(
            sectionLabel: String,
            currentCount: Int,
            threshold: Int,
            itemNoun: String? = nil,
            description: String? = nil,
            customMessage: String? = nil,
            actionLabel: String? = nil
        ) -> EmptyStateThresholdGate {
            EmptyStateThresholdGate(
                currentCount: currentCount,
                threshold: threshold,
                sectionLabel: .verbatim(sectionLabel),
                itemNoun: itemNoun.map(EmptyStateThresholdText.verbatim),
                description: description.map(EmptyStateThresholdText.verbatim),
                customMessage: customMessage.map(EmptyStateThresholdText.verbatim),
                actionLabel: actionLabel.map(EmptyStateThresholdText.verbatim)
            )
        }
    }

    /// Builds an optional no-op handler, sidestepping the `cond ? {} : nil` inference limitation for
    /// `@MainActor` closures by returning the closure from an explicitly-typed function.
    @MainActor
    private func previewHandler(_ enabled: Bool) -> (@MainActor () -> Void)? {
        guard enabled else { return nil }
        return {}
    }

    @MainActor
    private func previewModel(_ input: EmptyStateThresholdInput, action: Bool = true) -> EmptyStateThresholdModel {
        let source = InMemoryEmptyStateThresholdSource(initial: input)
        let model = EmptyStateThresholdModel(source: source, onAction: previewHandler(action))
        model.start()
        return model
    }

    #Preview("Threshold — noun + CTA") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput(
            gate: EmptyStateThresholdPreviewData.gate(
                sectionLabel: "Cost Heatmap",
                currentCount: 5,
                threshold: 30,
                itemNoun: "sessions",
                description: "Visualises where and when charging is cheapest.",
                actionLabel: "Adjust filters"
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Threshold — default noun") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput(
            gate: EmptyStateThresholdPreviewData.gate(
                sectionLabel: "Optimizer recommendations",
                currentCount: 1,
                threshold: 10
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Threshold — custom message") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput(
            gate: EmptyStateThresholdPreviewData.gate(
                sectionLabel: "Battery degradation trend",
                currentCount: 0,
                threshold: 90,
                customMessage: "Collecting daily readings — the trend appears after about three months."
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput(
            errorMessage: "The session count request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput(
            gate: EmptyStateThresholdPreviewData.gate(
                sectionLabel: "Cost Heatmap",
                currentCount: 5,
                threshold: 30,
                itemNoun: "sessions"
            ),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        EmptyStateThreshold(model: previewModel(EmptyStateThresholdInput(
            gate: EmptyStateThresholdPreviewData.gate(
                sectionLabel: "Cost Heatmap",
                currentCount: 5,
                threshold: 30,
                itemNoun: "sessions"
            ),
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
