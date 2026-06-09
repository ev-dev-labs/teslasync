//
//  AIFeatureToggleList.Previews.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AIFeatureTogglePreviewData {
        /// A handful of opt-ins flipped on so the populated preview shows mixed switch states; every
        /// other registry feature reads off (web `Boolean(values[id])`).
        static let values: [String: Bool] = [
            "nl-search": true,
            "drive-coaching": true,
            "rag-help": true,
            "voice-mode": true,
            "predictive-maintenance": true
        ]
    }

    @MainActor
    private func previewModel(_ update: AIFeatureToggleUpdate) -> AIFeatureToggleListModel {
        let source = InMemoryAIFeatureToggleSource(initial: update)
        let model = AIFeatureToggleListModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewSurface(_ update: AIFeatureToggleUpdate) -> some View {
        ScrollView {
            AIFeatureToggleList(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(AIFeatureToggleUpdate(status: .loaded, values: AIFeatureTogglePreviewData.values))
    }

    #Preview("All off") {
        previewSurface(AIFeatureToggleUpdate(status: .loaded, values: [:]))
    }

    #Preview("Empty") {
        previewSurface(AIFeatureToggleUpdate(status: .empty))
    }

    #Preview("Loading") {
        previewSurface(AIFeatureToggleUpdate(status: .loading))
    }

    #Preview("Error") {
        previewSurface(AIFeatureToggleUpdate(status: .failed("Network request timed out")))
    }

    #Preview("Stale") {
        previewSurface(AIFeatureToggleUpdate(
            status: .loaded,
            connection: .stale,
            values: AIFeatureTogglePreviewData.values
        ))
    }

    #Preview("Offline") {
        previewSurface(AIFeatureToggleUpdate(
            status: .loaded,
            connection: .offline,
            values: AIFeatureTogglePreviewData.values
        ))
    }
#endif
