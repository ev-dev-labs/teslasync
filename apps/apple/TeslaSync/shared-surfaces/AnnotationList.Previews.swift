//
//  AnnotationList.Previews.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  Xcode previews for each surface state (loading / error / empty-state / withdrawn /
//  populated-live / populated-stale / populated-offline). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AnnotationListPreviewData {
        static let sample: [AnnotationListItem] = [
            AnnotationListItem(
                id: "1",
                label: "100k miles",
                timestamp: "Jan 4, 2026",
                category: .milestone,
                description: "Crossed the six-figure odometer mark"
            ),
            AnnotationListItem(
                id: "2",
                label: "Tire rotation",
                timestamp: "Feb 12, 2026",
                category: .maintenance,
                description: "Front/rear swap at the service centre"
            ),
            AnnotationListItem(
                id: "3",
                label: "Road trip to Tahoe",
                timestamp: "Mar 1, 2026",
                category: .trip,
                description: nil
            ),
            AnnotationListItem(
                id: "4",
                label: "12V warning",
                timestamp: "Mar 18, 2026",
                category: .issue,
                description: "Low-voltage alert cleared after a drive"
            )
        ]
    }

    @MainActor
    private func previewModel(_ input: AnnotationListInput) -> AnnotationListModel {
        let source = InMemoryAnnotationListSource(initial: input)
        let model = AnnotationListModel(source: source, onRemove: { _ in })
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: AnnotationListModel) -> some View {
        AnnotationList(model: model)
            .padding()
            .frame(maxWidth: 420, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(AnnotationListInput(availability: .loading)))
    }

    #Preview("Error") {
        staged(previewModel(AnnotationListInput(availability: .failed("Network timed out"))))
    }

    #Preview("Empty (shown)") {
        staged(previewModel(AnnotationListInput(availability: .resolved([]), emptyBehavior: .emptyState)))
    }

    #Preview("Withdrawn (web null)") {
        staged(previewModel(AnnotationListInput(availability: .resolved([]), emptyBehavior: .withdraw)))
    }

    #Preview("Populated live") {
        staged(previewModel(AnnotationListInput(
            availability: .resolved(AnnotationListPreviewData.sample),
            connection: .live
        )))
    }

    #Preview("Populated stale") {
        staged(previewModel(AnnotationListInput(
            availability: .resolved(AnnotationListPreviewData.sample),
            connection: .stale
        )))
    }

    #Preview("Populated offline") {
        staged(previewModel(AnnotationListInput(
            availability: .resolved(AnnotationListPreviewData.sample),
            connection: .offline
        )))
    }
#endif
