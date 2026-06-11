//
//  DraftRecoveryBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  Xcode previews for each surface state (data with / without a noun, unknown save time, empty,
//  loading, error, stale, offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DraftRecoveryPreviewData {
        /// 5 minutes ago → "5m ago".
        static let recent = Date().addingTimeInterval(-5 * 60)
        /// 2 hours ago → "2h ago".
        static let earlier = Date().addingTimeInterval(-2 * 60 * 60)
    }

    @MainActor
    private func previewModel(_ input: DraftRecoveryInput) -> DraftRecoveryBannerModel {
        let source = InMemoryDraftRecoverySource(initial: input)
        let model = DraftRecoveryBannerModel(source: source, onRestore: {}, onDiscard: {})
        model.start()
        return model
    }

    #Preview("Data — with noun") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: DraftRecoveryPreviewData.recent, itemNoun: "rule")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — no noun") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: DraftRecoveryPreviewData.earlier)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — unknown time") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: nil, itemNoun: "automation")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput(
            errorMessage: "The draft store is unavailable"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: DraftRecoveryPreviewData.recent, itemNoun: "rule"),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        DraftRecoveryBanner(model: previewModel(DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: DraftRecoveryPreviewData.earlier),
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
