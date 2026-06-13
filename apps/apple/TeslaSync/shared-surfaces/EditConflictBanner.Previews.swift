//
//  EditConflictBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  Xcode previews for each surface state (conflict with / without a resource label, empty because this
//  tab owns the lease, empty because no peer is editing, loading, error, stale, offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum EditConflictPreviewData {
        static let peer = EditConflictPeer(tabID: "peer-tab-aaa", claimedAt: Date().addingTimeInterval(-30))
    }

    @MainActor
    private func previewModel(_ input: EditConflictInput) -> EditConflictBannerModel {
        let source = InMemoryEditConflictSource(initial: input)
        let model = EditConflictBannerModel(source: source, onTakeOver: {})
        model.start()
        return model
    }

    #Preview("Data — with label") {
        EditConflictBanner(model: previewModel(EditConflictInput(
            otherTab: EditConflictPreviewData.peer,
            resourceKey: "settings/general",
            resourceLabel: "Your settings"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — no label") {
        EditConflictBanner(model: previewModel(EditConflictInput(
            otherTab: EditConflictPreviewData.peer,
            resourceKey: "alert-rules/list"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — owner") {
        EditConflictBanner(model: previewModel(EditConflictInput(
            isOwner: true,
            resourceKey: "settings/general"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — no peer") {
        EditConflictBanner(model: previewModel(EditConflictInput(resourceKey: "automation/42")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EditConflictBanner(model: previewModel(EditConflictInput(
            resourceKey: "settings/general",
            isLoading: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        EditConflictBanner(model: previewModel(EditConflictInput(
            resourceKey: "settings/general",
            errorMessage: "The lease coordinator is unavailable"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        EditConflictBanner(model: previewModel(EditConflictInput(
            otherTab: EditConflictPreviewData.peer,
            resourceKey: "settings/general",
            resourceLabel: "Your settings",
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        EditConflictBanner(model: previewModel(EditConflictInput(
            otherTab: EditConflictPreviewData.peer,
            resourceKey: "alert-rules/list",
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
