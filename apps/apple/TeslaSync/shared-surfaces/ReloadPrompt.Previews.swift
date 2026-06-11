//
//  ReloadPrompt.Previews.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline) plus the
//  lone reload banner. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func reloadPreviewModel(_ update: ReloadPromptUpdate) -> ReloadPromptModel {
        let source = InMemoryReloadPromptSource(initial: update)
        let model = ReloadPromptModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — update available") {
        ReloadPrompt(model: reloadPreviewModel(ReloadPromptUpdate(status: .idle, updateAvailable: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — up to date") {
        ReloadPrompt(model: reloadPreviewModel(ReloadPromptUpdate(status: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ReloadPrompt(model: reloadPreviewModel(ReloadPromptUpdate(status: .checking)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ReloadPrompt(model: reloadPreviewModel(ReloadPromptUpdate(
            status: .failed("The update channel is unreachable")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ReloadPrompt(model: reloadPreviewModel(ReloadPromptUpdate(
            status: .idle,
            connection: .stale,
            updateAvailable: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ReloadPrompt(model: reloadPreviewModel(ReloadPromptUpdate(
            status: .idle,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Banner") {
        ReloadPromptBanner(countdown: 3, onTick: {}, onLater: {}, onReloadNow: {})
            .padding()
            .background(Color.TS.bg)
    }
#endif
