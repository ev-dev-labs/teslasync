//
//  VisuallyHidden.Previews.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum VisuallyHiddenPreviewData {
        /// A small spread of recent announcements across both priorities, the native mirror of
        /// the messages the web live regions would have received.
        static let messages: [VisuallyHiddenMessage] = [
            sample(id: 1, text: "Filter applied: last 30 days", priority: .polite, secondsAgo: 95),
            sample(id: 2, text: "3 vehicles archived", priority: .polite, secondsAgo: 60),
            sample(id: 3, text: "Saved view applied", priority: .polite, secondsAgo: 30),
            sample(id: 4, text: "Session expires in 2 minutes", priority: .assertive, secondsAgo: 8)
        ]

        static func sample(
            id: Int,
            text: String,
            priority: VisuallyHiddenPriority,
            secondsAgo: TimeInterval
        ) -> VisuallyHiddenMessage {
            VisuallyHiddenMessage(
                id: id,
                text: text,
                announcementText: VisuallyHiddenPadding.padded(text, sequence: id),
                priority: priority,
                timestamp: Date(timeIntervalSinceNow: -secondsAgo)
            )
        }
    }

    @MainActor
    private func previewModel(_ input: VisuallyHiddenInput) -> VisuallyHiddenModel {
        let source = InMemoryVisuallyHiddenSource(initial: input)
        let model = VisuallyHiddenModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        ScrollView {
            VisuallyHidden(model: previewModel(VisuallyHiddenInput(
                messages: VisuallyHiddenPreviewData.messages
            )))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ScrollView {
            VisuallyHidden(model: previewModel(VisuallyHiddenInput()))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VisuallyHidden(model: previewModel(VisuallyHiddenInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VisuallyHidden(model: previewModel(VisuallyHiddenInput(
            errorMessage: "The announcement feed timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            VisuallyHidden(model: previewModel(VisuallyHiddenInput(
                messages: VisuallyHiddenPreviewData.messages,
                connection: .stale
            )))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            VisuallyHidden(model: previewModel(VisuallyHiddenInput(
                messages: VisuallyHiddenPreviewData.messages,
                connection: .offline
            )))
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
