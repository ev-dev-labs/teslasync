//
//  globalShortcuts.Previews.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum GlobalShortcutsPreviewData {
        /// The full canonical registry, resolved with the English fallbacks (no bundle
        /// in previews) — the same `defs` the web `GlobalShortcuts` registers.
        static let canonical: [GlobalShortcutDefinition] =
            GlobalShortcutsCatalog.canonicalDefinitions(resolve: { _, fallback in fallback })
    }

    @MainActor
    private func previewModel(_ input: GlobalShortcutsInput) -> GlobalShortcutsModel {
        let source = InMemoryGlobalShortcutsSource(initial: input)
        let model = GlobalShortcutsModel(
            source: source,
            strings: { _, fallback in fallback }
        )
        model.start()
        return model
    }

    #Preview("Data") {
        GlobalShortcuts(model: previewModel(GlobalShortcutsInput(
            definitions: GlobalShortcutsPreviewData.canonical
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        GlobalShortcuts(model: previewModel(GlobalShortcutsInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        GlobalShortcuts(model: previewModel(GlobalShortcutsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        GlobalShortcuts(model: previewModel(GlobalShortcutsInput(
            errorMessage: "The registry feed timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        GlobalShortcuts(model: previewModel(GlobalShortcutsInput(
            definitions: GlobalShortcutsPreviewData.canonical,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        GlobalShortcuts(model: previewModel(GlobalShortcutsInput(
            definitions: GlobalShortcutsPreviewData.canonical,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
