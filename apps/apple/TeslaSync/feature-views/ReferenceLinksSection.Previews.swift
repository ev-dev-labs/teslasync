//
//  ReferenceLinksSection.Previews.swift
//  TeslaSync — P4 feature view · 0007 · ReferenceLinksSection (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: ReferenceLinksInput) -> ReferenceLinksModel {
        let source = InMemoryReferenceLinksSource(initial: input)
        let model = ReferenceLinksModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        ReferenceLinksSection(model: previewModel(
            ReferenceLinksInput(links: ReferenceLinkCatalog.defaultLinks)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ReferenceLinksSection(model: previewModel(ReferenceLinksInput(links: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ReferenceLinksSection(model: previewModel(ReferenceLinksInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ReferenceLinksSection(model: previewModel(
            ReferenceLinksInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ReferenceLinksSection(model: previewModel(ReferenceLinksInput(
            links: ReferenceLinkCatalog.defaultLinks,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ReferenceLinksSection(model: previewModel(ReferenceLinksInput(
            links: ReferenceLinkCatalog.defaultLinks,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
