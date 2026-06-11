//
//  BulkActionsToolbar.Previews.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  Xcode previews for each surface state (active / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum BulkActionsPreviewData {
        /// A representative selection — a mix of numeric row ids and a string id, the native mirror of
        /// the web `Array<string | number>`.
        static let selection: [BulkSelectionID] = [.int(12), .int(48), .string("trip-7")]

        /// A representative action set — an export, a tag, and a destructive delete that gates through
        /// the confirm dialog (web `variant: 'danger'` + `confirm`).
        static let actions: [BulkActionDescriptor] = [
            BulkActionDescriptor(id: "export", label: "Export", systemImage: "square.and.arrow.up") { _ in },
            BulkActionDescriptor(id: "tag", label: "Tag", systemImage: "tag") { _ in },
            BulkActionDescriptor(
                id: "delete",
                label: "Delete",
                systemImage: "trash",
                variant: .danger,
                confirm: BulkActionConfirm(
                    title: "Delete 3 items?",
                    message: "This permanently removes the selected items. This can't be undone.",
                    confirmLabel: "Delete"
                )
            ) { _ in }
        ]

        static let activeInput = BulkActionsInput(
            selection: selection,
            total: 27,
            itemNoun: BulkItemNoun(one: "drive", other: "drives"),
            actions: actions
        )
    }

    @MainActor
    private func previewModel(_ input: BulkActionsInput) -> BulkActionsToolbarModel {
        let source = InMemoryBulkActionsToolbarSource(initial: input)
        let model = BulkActionsToolbarModel(source: source)
        model.start()
        return model
    }

    #Preview("Active") {
        BulkActionsToolbar(model: previewModel(BulkActionsPreviewData.activeInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BulkActionsToolbar(model: previewModel(BulkActionsInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BulkActionsToolbar(model: previewModel(BulkActionsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        BulkActionsToolbar(model: previewModel(BulkActionsInput(
            errorMessage: "The selection feed timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        BulkActionsToolbar(model: previewModel(BulkActionsInput(
            selection: BulkActionsPreviewData.selection,
            total: 27,
            itemNoun: BulkItemNoun(one: "drive", other: "drives"),
            actions: BulkActionsPreviewData.actions,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        BulkActionsToolbar(model: previewModel(BulkActionsInput(
            selection: BulkActionsPreviewData.selection,
            total: 27,
            itemNoun: BulkItemNoun(one: "drive", other: "drives"),
            actions: BulkActionsPreviewData.actions,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
