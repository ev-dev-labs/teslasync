//
//  SuggestedPrompts.Previews.swift
//  TeslaSync — P4 feature view · 0223 · SuggestedPrompts (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SuggestedPromptsUpdate) -> SuggestedPromptsModel {
        let source = InMemorySuggestedPromptsSource(initial: update)
        let model = SuggestedPromptsModel(source: source)
        model.start()
        return model
    }

    #Preview("Content") {
        SuggestedPrompts(
            model: previewModel(SuggestedPromptsUpdate(
                status: .loaded,
                suggestions: SuggestedPromptsCatalog.defaults
            ))
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SuggestedPrompts(
            model: previewModel(SuggestedPromptsUpdate(status: .empty, suggestions: []))
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SuggestedPrompts(
            model: previewModel(SuggestedPromptsUpdate(status: .loading))
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        SuggestedPrompts(
            model: previewModel(SuggestedPromptsUpdate(status: .failed("Network request timed out")))
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SuggestedPrompts(
            model: previewModel(SuggestedPromptsUpdate(
                status: .loaded,
                connection: .stale,
                suggestions: SuggestedPromptsCatalog.defaults
            ))
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SuggestedPrompts(
            model: previewModel(SuggestedPromptsUpdate(
                status: .loaded,
                connection: .offline,
                suggestions: SuggestedPromptsCatalog.defaults
            ))
        )
        .padding()
        .background(Color.TS.bg)
    }
#endif
