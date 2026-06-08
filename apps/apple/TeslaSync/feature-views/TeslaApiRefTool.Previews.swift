//
//  TeslaApiRefTool.Previews.swift
//  TeslaSync — P4 feature view · 0020 · TeslaApiRefTool (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error / stale /
//  offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ApiRefUpdate) -> TeslaApiRefModel {
        let source = InMemoryTeslaApiRefSource(initial: update)
        let model = TeslaApiRefModel(source: source)
        model.start()
        return model
    }

    private func previewUpdate(
        status: ApiRefLoadStatus = .loaded,
        connection: ApiRefConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        endpoints: [TeslaApiEndpoint] = TeslaApiCatalog.endpoints,
        updatedAt: Date? = Date()
    ) -> ApiRefUpdate {
        ApiRefUpdate(
            status: status,
            connection: connection,
            isFetching: isFetching,
            isError: isError,
            endpoints: endpoints,
            updatedAt: updatedAt
        )
    }

    private let previewEmpty = ApiRefUpdate(status: .loaded, endpoints: [])

    #Preview("Content") {
        TeslaApiRefTool(model: previewModel(previewUpdate()))
            .frame(width: 380, height: 460)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TeslaApiRefTool(model: previewModel(previewUpdate(status: .loading, endpoints: [], updatedAt: nil)))
            .frame(width: 380, height: 460)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TeslaApiRefTool(model: previewModel(previewEmpty))
            .frame(width: 380, height: 460)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TeslaApiRefTool(
            model: previewModel(
                ApiRefUpdate(status: .failed("Network unavailable"), isError: true, endpoints: [])
            )
        )
        .frame(width: 380, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TeslaApiRefTool(
            model: previewModel(previewUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-240)))
        )
        .frame(width: 380, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        TeslaApiRefTool(
            model: previewModel(previewUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600)))
        )
        .frame(width: 380, height: 460)
        .padding()
        .background(Color.TS.bg)
    }
#endif
