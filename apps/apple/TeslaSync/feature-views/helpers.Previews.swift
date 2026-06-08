//
//  helpers.Previews.swift
//  TeslaSync — P4 feature view · 0245 · helpers (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum StatusHelpersPreviewData {
        /// Covers every classification branch — success (`healthy`), the
        /// colour-success / badge-neutral divergence (`connected`), warning
        /// (`degraded`, `queued`), danger (`offline`), and neutral (`unknown`).
        static let samples = ["healthy", "connected", "degraded", "offline", "queued", "unknown"]
        /// 1d 2h 3m.
        static let uptime: Double = 93784
        /// 1.5 KB.
        static let bytes: Double = 1536
    }

    @MainActor
    private func previewModel(_ input: StatusHelpersInput) -> StatusHelpersModel {
        let source = InMemoryStatusHelpersSource(initial: input)
        let model = StatusHelpersModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        StatusHelpersPanel(model: previewModel(StatusHelpersInput(
            samples: StatusHelpersPreviewData.samples,
            uptimeSeconds: StatusHelpersPreviewData.uptime,
            byteCount: StatusHelpersPreviewData.bytes
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        StatusHelpersPanel(model: previewModel(StatusHelpersInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        StatusHelpersPanel(model: previewModel(StatusHelpersInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        StatusHelpersPanel(model: previewModel(StatusHelpersInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        StatusHelpersPanel(model: previewModel(StatusHelpersInput(
            samples: StatusHelpersPreviewData.samples,
            uptimeSeconds: StatusHelpersPreviewData.uptime,
            byteCount: StatusHelpersPreviewData.bytes,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        StatusHelpersPanel(model: previewModel(StatusHelpersInput(
            samples: StatusHelpersPreviewData.samples,
            uptimeSeconds: StatusHelpersPreviewData.uptime,
            byteCount: StatusHelpersPreviewData.bytes,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
