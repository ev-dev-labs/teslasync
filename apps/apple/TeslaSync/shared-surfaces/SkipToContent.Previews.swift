//
//  SkipToContent.Previews.swift
//  TeslaSync — P4 shared surface · 0139 · SkipToContent (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SkipToContentPreviewData {
        /// The main content landmark plus a couple of secondary landmarks, the native mirror of a
        /// page that has registered more than one skippable region.
        static let targets: [SkipTarget] = [
            SkipTarget(id: "main-content", label: "Main content", isPrimary: true),
            SkipTarget(id: "primary-nav", label: "Primary navigation"),
            SkipTarget(id: "vehicle-filters", label: "Vehicle filters")
        ]
    }

    @MainActor
    private func previewModel(_ input: SkipToContentInput) -> SkipToContentModel {
        let source = InMemorySkipToContentSource(initial: input)
        let model = SkipToContentModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        SkipToContent(model: previewModel(SkipToContentInput(
            targets: SkipToContentPreviewData.targets
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SkipToContent(model: previewModel(SkipToContentInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SkipToContent(model: previewModel(SkipToContentInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SkipToContent(model: previewModel(SkipToContentInput(
            errorMessage: "The landmark registry timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SkipToContent(model: previewModel(SkipToContentInput(
            targets: SkipToContentPreviewData.targets,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SkipToContent(model: previewModel(SkipToContentInput(
            targets: SkipToContentPreviewData.targets,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
