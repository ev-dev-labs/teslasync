//
//  AIRestorePanel.Previews.swift
//  TeslaSync — P4 feature view · 0201 · AIRestorePanel (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AIRestorePreviewData {
        /// A mixed archive: two known features, one disabled (dropped), and one
        /// unknown id (rendered verbatim) — exercises every `previewLabels` branch.
        static let archived: [AIArchivedEntry] = [
            AIArchivedEntry(id: "chatbot-llm", enabled: true),
            AIArchivedEntry(id: "nl-search", enabled: true),
            AIArchivedEntry(id: "drive-coaching", enabled: false),
            AIArchivedEntry(id: "legacy-removed-feature", enabled: true)
        ]
    }

    @MainActor
    private func previewModel(_ input: AIRestoreInput) -> AIRestoreModel {
        let source = InMemoryAIRestoreSource(initial: input)
        let model = AIRestoreModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        AIRestorePanel(model: previewModel(AIRestoreInput(archived: AIRestorePreviewData.archived)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AIRestorePanel(model: previewModel(AIRestoreInput(
            archived: [AIArchivedEntry(id: "chatbot-llm", enabled: false)]
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIRestorePanel(model: previewModel(AIRestoreInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AIRestorePanel(model: previewModel(AIRestoreInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIRestorePanel(model: previewModel(AIRestoreInput(
            archived: AIRestorePreviewData.archived,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIRestorePanel(model: previewModel(AIRestoreInput(
            archived: AIRestorePreviewData.archived,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
