//
//  DraftRestorePrompt.Previews.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  Xcode previews for each surface state (single / multiple drafts, empty, loading, error, stale,
//  offline) plus the review list and a lone row. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DraftRestorePreviewData {
        static func entry(
            _ key: String,
            _ label: String,
            _ route: String,
            minutesAgo: Double
        ) -> DraftEntry {
            DraftEntry(
                storageKey: key,
                label: label,
                route: route,
                savedAt: Date().addingTimeInterval(-minutesAgo * 60)
            )
        }

        static let alertRule = entry(
            "teslasync:draft:v1:alertstudio:rule:42",
            "Alert rule draft",
            "/notifications/studio",
            minutesAgo: 3
        )

        static let automation = entry(
            "teslasync:draft:v1:automation:edit:7",
            "Automation draft",
            "/automations",
            minutesAgo: 75
        )

        static let settings = entry(
            "teslasync:draft:v1:settings:general",
            "Settings draft",
            "/settings",
            minutesAgo: 1500
        )

        static let all = [alertRule, automation, settings]
    }

    @MainActor
    private func previewModel(_ update: DraftRestoreUpdate) -> DraftRestorePromptModel {
        let source = InMemoryDraftRestoreSource(initial: update)
        let model = DraftRestorePromptModel(source: source, onResume: { _ in })
        model.start()
        return model
    }

    #Preview("Data — single draft") {
        DraftRestorePrompt(model: previewModel(DraftRestoreUpdate(
            status: .loaded,
            drafts: [DraftRestorePreviewData.alertRule]
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — multiple drafts") {
        DraftRestorePrompt(model: previewModel(DraftRestoreUpdate(
            status: .loaded,
            drafts: DraftRestorePreviewData.all
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DraftRestorePrompt(model: previewModel(DraftRestoreUpdate(status: .empty)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DraftRestorePrompt(model: previewModel(DraftRestoreUpdate(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DraftRestorePrompt(model: previewModel(DraftRestoreUpdate(
            status: .failed("Local storage is unavailable")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        DraftRestorePrompt(model: previewModel(DraftRestoreUpdate(
            status: .loaded,
            connection: .stale,
            drafts: [DraftRestorePreviewData.alertRule]
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        DraftRestorePrompt(model: previewModel(DraftRestoreUpdate(
            status: .loaded,
            connection: .offline,
            drafts: DraftRestorePreviewData.all
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Review list") {
        DraftRestoreReviewList(
            drafts: DraftRestorePreviewData.all,
            onResume: { _ in },
            onDiscard: { _ in },
            onClose: {}
        )
        .padding()
        .frame(maxWidth: 460)
        .background(Color.TS.bg)
    }

    #Preview("Single row") {
        DraftRestoreRow(
            entry: DraftRestorePreviewData.alertRule,
            onResume: {},
            onDiscard: {}
        )
        .padding()
        .background(Color.TS.bg)
    }
#endif
