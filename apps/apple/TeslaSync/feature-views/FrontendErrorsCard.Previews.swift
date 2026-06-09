//
//  FrontendErrorsCard.Previews.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum FrontendErrorsPreviewData {
        static let summary = FrontendErrorsSummary(
            total: 1234,
            top: [
                FrontendErrorEntry(name: "DriveChart", route: "/drives/4821", count: 312),
                FrontendErrorEntry(name: "BatteryPanel", route: "/battery", count: 87),
                FrontendErrorEntry(name: "", route: "", count: 5)
            ]
        )

        static let healthy = FrontendErrorsSummary(total: 0, top: [])
    }

    @MainActor
    private func previewModel(_ input: FrontendErrorsInput) -> FrontendErrorsModel {
        let source = InMemoryFrontendErrorsSource(initial: input)
        let model = FrontendErrorsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        FrontendErrorsCard(model: previewModel(FrontendErrorsInput(summary: FrontendErrorsPreviewData.summary)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · no errors") {
        FrontendErrorsCard(model: previewModel(FrontendErrorsInput(summary: FrontendErrorsPreviewData.healthy)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        FrontendErrorsCard(model: previewModel(FrontendErrorsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error · no data") {
        FrontendErrorsCard(model: previewModel(FrontendErrorsInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        FrontendErrorsCard(model: previewModel(FrontendErrorsInput(
            summary: FrontendErrorsPreviewData.summary,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        FrontendErrorsCard(model: previewModel(FrontendErrorsInput(
            summary: FrontendErrorsPreviewData.summary,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
