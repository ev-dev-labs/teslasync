//
//  AnnouncerRegion.Previews.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AnnouncerRegionPreviewData {
        /// A small spread of recent announcements across both priorities, the native mirror of
        /// the messages the web regions would have received.
        static let entries: [AnnouncerMessage] = [
            sample(id: 1, text: "Filter applied: last 30 days", priority: .polite, secondsAgo: 95),
            sample(id: 2, text: "3 vehicles archived", priority: .polite, secondsAgo: 60),
            sample(id: 3, text: "Saved view applied", priority: .polite, secondsAgo: 30),
            sample(id: 4, text: "Session expires in 2 minutes", priority: .assertive, secondsAgo: 8)
        ]

        static func sample(
            id: Int,
            text: String,
            priority: AnnouncerPriority,
            secondsAgo: TimeInterval
        ) -> AnnouncerMessage {
            AnnouncerMessage(
                id: id,
                text: text,
                announcementText: AnnouncerPadding.padded(text, sequence: id),
                priority: priority,
                timestamp: Date(timeIntervalSinceNow: -secondsAgo)
            )
        }
    }

    @MainActor
    private func previewModel(_ input: AnnouncerRegionInput) -> AnnouncerRegionModel {
        let source = InMemoryAnnouncerRegionSource(initial: input)
        let model = AnnouncerRegionModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        AnnouncerRegion(model: previewModel(AnnouncerRegionInput(
            entries: AnnouncerRegionPreviewData.entries
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AnnouncerRegion(model: previewModel(AnnouncerRegionInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AnnouncerRegion(model: previewModel(AnnouncerRegionInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AnnouncerRegion(model: previewModel(AnnouncerRegionInput(
            errorMessage: "The announcement feed timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AnnouncerRegion(model: previewModel(AnnouncerRegionInput(
            entries: AnnouncerRegionPreviewData.entries,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AnnouncerRegion(model: previewModel(AnnouncerRegionInput(
            entries: AnnouncerRegionPreviewData.entries,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
