//
//  HttpStatusTool.Previews.swift
//  TeslaSync — P4 feature view · 0016 · HttpStatusTool (Apple)
//
//  Xcode previews for each surface state (content / search-filtered /
//  search-empty / loading / empty / error / stale / offline). DEBUG-only;
//  skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: HttpStatusUpdate, search: String = "") -> HttpStatusModel {
        let source = InMemoryHttpStatusSource(initial: update)
        let model = HttpStatusModel(source: source)
        model.start()
        if !search.isEmpty { model.search = search }
        return model
    }

    private let loadedUpdate = HttpStatusUpdate(
        status: .loaded,
        connection: .live,
        codes: HttpStatusCatalog.codes,
        updatedAt: Date()
    )

    @MainActor
    private func previewShell(_ tool: HttpStatusTool) -> some View {
        tool
            .frame(maxWidth: 480)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewShell(HttpStatusTool(model: previewModel(loadedUpdate)))
    }

    #Preview("Search · filtered") {
        previewShell(HttpStatusTool(model: previewModel(loadedUpdate, search: "404")))
    }

    #Preview("Search · empty") {
        previewShell(HttpStatusTool(model: previewModel(loadedUpdate, search: "zzz")))
    }

    #Preview("Loading") {
        previewShell(HttpStatusTool(model: previewModel(HttpStatusUpdate(status: .loading))))
    }

    #Preview("Empty") {
        previewShell(HttpStatusTool(model: previewModel(HttpStatusUpdate(status: .empty, codes: []))))
    }

    #Preview("Error") {
        previewShell(
            HttpStatusTool(model: previewModel(HttpStatusUpdate(status: .failed("Network unavailable"))))
        )
    }

    #Preview("Stale (cached)") {
        previewShell(
            HttpStatusTool(
                model: previewModel(
                    HttpStatusUpdate(
                        status: .loaded,
                        connection: .stale,
                        codes: HttpStatusCatalog.codes,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        previewShell(
            HttpStatusTool(
                model: previewModel(
                    HttpStatusUpdate(
                        status: .loaded,
                        connection: .offline,
                        codes: HttpStatusCatalog.codes,
                        updatedAt: Date().addingTimeInterval(-900)
                    )
                )
            )
        )
    }
#endif
